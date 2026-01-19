import { format, addDays, isWeekend, parseISO } from 'date-fns';

/**
 * Zentrale Validierungsschicht für alle ShiftEntry-Operationen
 * Wird von ScheduleBoard, ServiceStaffing und Wish-Genehmigung verwendet
 */

export class ShiftValidator {
    constructor({ doctors, shifts, workplaces, wishes, systemSettings, staffingEntries }) {
        this.doctors = doctors || [];
        this.shifts = shifts || [];
        this.workplaces = workplaces || [];
        this.wishes = wishes || [];
        this.systemSettings = systemSettings || [];
        this.staffingEntries = staffingEntries || [];
        
        // Parse settings
        this.absenceBlockingRules = this._parseAbsenceRules();
        this.limits = this._parseLimits();
        this.staffingMinimums = this._parseStaffingMinimums();
    }

    _parseAbsenceRules() {
        const setting = this.systemSettings.find(s => s.key === 'absence_blocking_rules');
        return setting ? JSON.parse(setting.value) : {
            "Urlaub": true, "Krank": true, "Frei": true, "Dienstreise": false, "Nicht verfügbar": false
        };
    }

    _parseLimits() {
        const get = (key, def) => parseInt(this.systemSettings.find(s => s.key === key)?.value || def);
        return {
            foreground: get('limit_fore_services', '4'),
            background: get('limit_back_services', '12'),
            weekend: get('limit_weekend_services', '1')
        };
    }

    _parseStaffingMinimums() {
        const get = (key, def) => parseInt(this.systemSettings.find(s => s.key === key)?.value || def);
        return {
            specialists: get('min_present_specialists', '2'),
            assistants: get('min_present_assistants', '3')
        };
    }

    _getDoctorFte(doctorId, date) {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        
        const entry = this.staffingEntries.find(e => 
            e.doctor_id === doctorId && e.year === year && e.month === month
        );

        if (entry) {
            const val = String(entry.value).replace(',', '.');
            const num = parseFloat(val);
            if (isNaN(num)) return 0;
            return num;
        }

        const doctor = this.doctors.find(d => d.id === doctorId);
        return doctor?.fte ?? 1.0;
    }

    /**
     * Hauptvalidierungsmethode
     * @returns {{ canProceed: boolean, blockers: string[], warnings: string[] }}
     */
    validate(doctorId, dateStr, position, options = {}) {
        const { 
            excludeShiftId = null,  // Bei Updates: eigene Shift-ID ausschließen
            silent = false,         // Keine UI-Interaktion
            skipLimits = false,     // Limits überspringen (für Massenoperationen)
        } = options;

        const result = {
            canProceed: true,
            blockers: [],
            warnings: []
        };

        const date = new Date(dateStr);
        const doctor = this.doctors.find(d => d.id === doctorId);
        if (!doctor) {
            result.blockers.push('Arzt nicht gefunden');
            result.canProceed = false;
            return result;
        }

        // 1. Abwesenheits-Konflikte prüfen
        const absenceResult = this._checkAbsenceConflicts(doctorId, dateStr, position, excludeShiftId);
        if (absenceResult.blocker) {
            result.blockers.push(absenceResult.blocker);
            result.canProceed = false;
        }
        if (absenceResult.warning) {
            result.warnings.push(absenceResult.warning);
        }

        // 2. Dienst/Rotation-Konflikte prüfen
        const conflictResult = this._checkServiceRotationConflicts(doctorId, dateStr, position, excludeShiftId);
        if (conflictResult.blocker) {
            result.blockers.push(conflictResult.blocker);
            result.canProceed = false;
        }

        // 3. Aufeinanderfolgende Tage prüfen
        const consecutiveResult = this._checkConsecutiveDays(doctorId, dateStr, position, excludeShiftId);
        if (consecutiveResult.blocker) {
            result.blockers.push(consecutiveResult.blocker);
            result.canProceed = false;
        }

        // 4. Dienstlimits prüfen (nur Warnung, kein Blocker)
        if (!skipLimits) {
            const limitResult = this._checkServiceLimits(doctorId, dateStr, position, excludeShiftId);
            if (limitResult.warning) {
                result.warnings.push(limitResult.warning);
            }
        }

        // 5. Mindestbesetzung prüfen (nur für Abwesenheiten)
        const absencePositions = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];
        if (absencePositions.includes(position)) {
            const staffingResult = this._checkStaffingMinimums(doctorId, dateStr, excludeShiftId);
            if (staffingResult.warning) {
                result.warnings.push(staffingResult.warning);
            }
        }

        return result;
    }

    _checkAbsenceConflicts(doctorId, dateStr, newPosition, excludeShiftId) {
        const doctorShifts = this.shifts.filter(s => 
            s.doctor_id === doctorId && 
            s.date === dateStr &&
            s.id !== excludeShiftId
        );

        for (const shift of doctorShifts) {
            const isBlocking = this.absenceBlockingRules[shift.position];
            
            if (typeof isBlocking === 'boolean') {
                if (isBlocking) {
                    return { blocker: `Mitarbeiter ist bereits als "${shift.position}" eingetragen (blockiert).` };
                } else {
                    return { warning: `Konflikt: Mitarbeiter ist "${shift.position}".` };
                }
            }
        }

        return {};
    }

    _checkServiceRotationConflicts(doctorId, dateStr, newPosition, excludeShiftId) {
        const doctorShifts = this.shifts.filter(s => 
            s.doctor_id === doctorId && 
            s.date === dateStr &&
            s.id !== excludeShiftId
        );

        const rotationPositions = this.workplaces.filter(w => w.category === 'Rotationen').map(w => w.name);
        const exclusiveServices = this.workplaces
            .filter(w => w.category === 'Dienste' && w.allows_rotation_concurrently === false)
            .map(w => w.name);

        const isNewRotation = rotationPositions.includes(newPosition);
        const newServiceWorkplace = this.workplaces.find(w => w.name === newPosition && w.category === 'Dienste');
        const isNewService = !!newServiceWorkplace;

        // Neue Rotation + existierender exklusiver Dienst
        if (isNewRotation) {
            const conflict = doctorShifts.find(s => exclusiveServices.includes(s.position));
            if (conflict) {
                return { blocker: `Konflikt: "${conflict.position}" blockiert Rotation.` };
            }
        }

        // Neuer exklusiver Dienst + existierende Rotation
        if (isNewService && newServiceWorkplace.allows_rotation_concurrently === false) {
            const conflict = doctorShifts.find(s => rotationPositions.includes(s.position));
            if (conflict) {
                return { blocker: `Konflikt: Rotation "${conflict.position}" ist nicht mit diesem Dienst kombinierbar.` };
            }
        }

        return {};
    }

    _checkConsecutiveDays(doctorId, dateStr, newPosition, excludeShiftId) {
        // Check if this position allows consecutive days (from workplace config)
        const workplace = this.workplaces.find(w => w.name === newPosition);
        
        // Default: allow consecutive days unless explicitly set to false
        if (!workplace || workplace.allows_consecutive_days !== false) {
            return {};
        }

        const currentDate = new Date(dateStr);
        const prevDateStr = format(addDays(currentDate, -1), 'yyyy-MM-dd');
        const nextDateStr = format(addDays(currentDate, 1), 'yyyy-MM-dd');

        const hasConsecutive = this.shifts.some(s => 
            s.doctor_id === doctorId && 
            s.position === newPosition && 
            s.id !== excludeShiftId &&
            (s.date === prevDateStr || s.date === nextDateStr)
        );

        if (hasConsecutive) {
            return { blocker: `"${newPosition}" ist nicht an aufeinanderfolgenden Tagen erlaubt.` };
        }

        return {};
    }

    _checkServiceLimits(doctorId, dateStr, newPosition, excludeShiftId) {
        const workplace = this.workplaces.find(w => w.name === newPosition);
        if (!workplace || workplace.category !== 'Dienste') return {};

        // Get all service workplaces to identify foreground/background dynamically
        const serviceWorkplaces = this.workplaces.filter(w => w.category === 'Dienste');
        // Convention: First service in order is "foreground", second is "background"
        const sortedServices = [...serviceWorkplaces].sort((a, b) => (a.order || 0) - (b.order || 0));
        const foregroundPosition = sortedServices[0]?.name;
        const backgroundPosition = sortedServices[1]?.name;

        const date = new Date(dateStr);
        const isFG = newPosition === foregroundPosition;
        const isBG = newPosition === backgroundPosition;
        const isWknd = isWeekend(date) && isFG;

        let countFG = 0, countBG = 0, countWknd = 0;
        const monthStr = format(date, 'yyyy-MM');

        this.shifts.forEach(s => {
            if (s.doctor_id !== doctorId) return;
            if (!s.date.startsWith(monthStr)) return;
            if (s.id === excludeShiftId) return;

            if (s.position === foregroundPosition) {
                countFG++;
                const sDate = parseISO(s.date);
                if (isWeekend(sDate)) countWknd++;
            }
            if (s.position === backgroundPosition) countBG++;
        });

        if (isFG) countFG++;
        if (isBG) countBG++;
        if (isWknd) countWknd++;

        const fte = this._getDoctorFte(doctorId, date);
        const adjFG = Math.round(this.limits.foreground * fte);
        const adjBG = Math.round(this.limits.background * fte);

        const warnings = [];
        if (isFG && countFG > adjFG) warnings.push(`${countFG}. ${foregroundPosition} (Limit: ${adjFG})`);
        if (isBG && countBG > adjBG) warnings.push(`${countBG}. ${backgroundPosition} (Limit: ${adjBG})`);
        if (isWknd && countWknd > this.limits.weekend) warnings.push(`${countWknd}. Wochenenddienst (Limit: ${this.limits.weekend})`);

        if (warnings.length > 0) {
            return { warning: `Dienstlimit überschritten: ${warnings.join(', ')}` };
        }

        return {};
    }

    _checkStaffingMinimums(doctorId, dateStr, excludeShiftId) {
        const doctor = this.doctors.find(d => d.id === doctorId);
        if (!doctor) return {};

        const ABSENCE_POSITIONS = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];
        const SPECIALIST_ROLES = ["Chefarzt", "Oberarzt", "Facharzt"];
        const ASSISTANT_ROLES = ["Assistenzarzt"];

        // Zähle aktuelle Abwesenheiten (ohne diese neue)
        const absentOnDate = this.shifts.filter(s => 
            s.date === dateStr && 
            ABSENCE_POSITIONS.includes(s.position) &&
            s.id !== excludeShiftId
        ).map(s => s.doctor_id);

        // Füge den neuen Abwesenden hinzu
        const allAbsent = new Set([...absentOnDate, doctorId]);

        // Zähle verfügbare Ärzte
        const totalSpecialists = this.doctors.filter(d => SPECIALIST_ROLES.includes(d.role)).length;
        const totalAssistants = this.doctors.filter(d => ASSISTANT_ROLES.includes(d.role)).length;

        const absentSpecialists = this.doctors.filter(d => 
            SPECIALIST_ROLES.includes(d.role) && allAbsent.has(d.id)
        ).length;
        const absentAssistants = this.doctors.filter(d => 
            ASSISTANT_ROLES.includes(d.role) && allAbsent.has(d.id)
        ).length;

        const presentSpecialists = totalSpecialists - absentSpecialists;
        const presentAssistants = totalAssistants - absentAssistants;

        const warnings = [];
        if (presentSpecialists < this.staffingMinimums.specialists) {
            warnings.push(`Nur ${presentSpecialists} Fachärzte anwesend (Min: ${this.staffingMinimums.specialists})`);
        }
        if (presentAssistants < this.staffingMinimums.assistants) {
            warnings.push(`Nur ${presentAssistants} Assistenzärzte anwesend (Min: ${this.staffingMinimums.assistants})`);
        }

        if (warnings.length > 0) {
            return { warning: `Mindestbesetzung unterschritten: ${warnings.join(', ')}` };
        }

        return {};
    }

    /**
     * Prüft ob Auto-Frei am Folgetag erstellt werden soll
     * @returns {string|null} - Datum für Auto-Frei oder null
     */
    shouldCreateAutoFrei(position, dateStr, isPublicHoliday) {
        const workplace = this.workplaces.find(w => w.name === position);
        if (!workplace?.auto_off) return null;

        const nextDay = addDays(parseISO(dateStr), 1);
        
        // Kein Auto-Frei an Feiertagen (Wochenende ist jetzt erlaubt)
        if (isPublicHoliday && isPublicHoliday(nextDay)) return null;

        return format(nextDay, 'yyyy-MM-dd');
    }

    /**
     * Findet Auto-Frei-Einträge die gelöscht werden sollten wenn ein Dienst entfernt wird
     * @returns {object|null} - Der zu löschende Shift oder null
     */
    findAutoFreiToCleanup(doctorId, dateStr, position) {
        const workplace = this.workplaces.find(w => w.name === position);
        if (!workplace?.auto_off) return null;

        const nextDay = addDays(parseISO(dateStr), 1);
        const nextDayStr = format(nextDay, 'yyyy-MM-dd');

        const autoFreiShift = this.shifts.find(s => 
            s.date === nextDayStr && 
            s.doctor_id === doctorId && 
            s.position === 'Frei' &&
            (s.note?.includes('Autom.') || s.note?.includes('Freizeitausgleich'))
        );

        return autoFreiShift || null;
    }

    /**
     * Prüft ob eine Position Auto-Off auslöst
     */
    isAutoOffPosition(position) {
        const workplace = this.workplaces.find(w => w.name === position);
        return !!workplace?.auto_off;
    }
}

/**
 * Hook-artige Factory-Funktion für einfache Integration
 */
export function createShiftValidator(data) {
    return new ShiftValidator(data);
}