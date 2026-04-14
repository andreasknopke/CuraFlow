/**
 * Utility-Funktionen für Timeslot-Berechnungen
 * Feature: Zeitfenster-Besetzung (Timeslots) für Arbeitsplätze
 */

import { isNonWorkingShiftPosition } from './shiftPositionUtils';

/**
 * Konvertiert Zeit-String zu Minuten seit Mitternacht
 * @param {string} time - Zeit im Format "HH:MM" oder "HH:MM:SS"
 * @returns {number} Minuten seit Mitternacht
 */
export function timeToMinutes(time) {
    if (!time) return 0;
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

/**
 * Konvertiert Minuten zu Zeit-String
 * @param {number} minutes - Minuten seit Mitternacht
 * @returns {string} Zeit im Format "HH:MM"
 */
export function minutesToTime(minutes) {
    const normalizedMinutes = ((minutes % 1440) + 1440) % 1440; // Normalisiere auf 0-1439
    const h = Math.floor(normalizedMinutes / 60);
    const m = normalizedMinutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Prüft ob ein Zeitfenster über Mitternacht geht
 * @param {string} startTime - Startzeit "HH:MM"
 * @param {string} endTime - Endzeit "HH:MM"
 * @returns {boolean}
 */
export function spansMidnight(startTime, endTime) {
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    return endMinutes <= startMinutes;
}

/**
 * Berechnet die Dauer eines Zeitfensters in Minuten
 * @param {string} startTime - Startzeit "HH:MM"
 * @param {string} endTime - Endzeit "HH:MM"
 * @returns {number} Dauer in Minuten
 */
export function calculateDurationMinutes(startTime, endTime) {
    const startMinutes = timeToMinutes(startTime);
    let endMinutes = timeToMinutes(endTime);
    
    // Über Mitternacht: Ende auf nächsten Tag erweitern
    if (endMinutes <= startMinutes) {
        endMinutes += 24 * 60;
    }
    
    return endMinutes - startMinutes;
}

/**
 * Berechnet Arbeitsstunden für eine Schicht
 * @param {object} shift - ShiftEntry-Objekt
 * @param {object|null} timeslot - WorkplaceTimeslot-Objekt (oder null für ganztägig)
 * @param {number} defaultHours - Standard-Arbeitstag in Stunden (default: 8)
 * @returns {number} Arbeitsstunden
 */
export function calculateShiftHours(shift, timeslot, defaultHours = 8) {
    if (!timeslot) {
        // Standard-Arbeitstag
        return defaultHours;
    }
    
    const durationMinutes = calculateDurationMinutes(
        timeslot.start_time,
        timeslot.end_time
    );
    
    return durationMinutes / 60;
}

/**
 * Prüft ob zwei Zeitfenster überlappen
 * Unterstützt Über-Mitternacht-Slots und Toleranz
 * 
 * @param {object} slot1 - { start_time: "HH:MM", end_time: "HH:MM" }
 * @param {object} slot2 - { start_time: "HH:MM", end_time: "HH:MM" }
 * @param {number} toleranceMinutes - Erlaubte Überschneidung in Minuten
 * @returns {boolean} true wenn Überlappung > Toleranz
 */
export function timeslotsOverlap(slot1, slot2, toleranceMinutes = 0) {
    if (!slot1 || !slot2) return false;
    
    const expandSlot = (slot) => {
        const start = timeToMinutes(slot.start_time);
        let end = timeToMinutes(slot.end_time);
        
        // Über Mitternacht: Ende auf nächsten Tag erweitern
        if (end <= start) {
            end += 24 * 60;
        }
        
        return { 
            start: start + toleranceMinutes, 
            end: end - toleranceMinutes 
        };
    };
    
    const s1 = expandSlot(slot1);
    const s2 = expandSlot(slot2);
    
    // Standard Überlappungsprüfung
    if (s1.start < s2.end && s2.start < s1.end) {
        return true;
    }
    
    // Bei Über-Mitternacht-Slots: Auch nächsten Tag prüfen
    // Slot2 um einen Tag verschieben
    const s2NextDay = { start: s2.start + 1440, end: s2.end + 1440 };
    if (s1.start < s2NextDay.end && s2NextDay.start < s1.end) {
        return true;
    }
    
    // Slot1 um einen Tag verschieben
    const s1NextDay = { start: s1.start + 1440, end: s1.end + 1440 };
    if (s1NextDay.start < s2.end && s2.start < s1NextDay.end) {
        return true;
    }
    
    return false;
}

/**
 * Formatiert ein Zeitfenster für Anzeige
 * @param {object} timeslot - { start_time: "HH:MM", end_time: "HH:MM", label: "Name" }
 * @returns {string} Formatierte Darstellung
 */
export function formatTimeslotLabel(timeslot) {
    if (!timeslot) return '';
    
    const start = timeslot.start_time?.substring(0, 5) || '00:00';
    const end = timeslot.end_time?.substring(0, 5) || '00:00';
    const midnight = spansMidnight(start, end);
    
    if (timeslot.label) {
        return `${timeslot.label} (${start}-${end}${midnight ? ' +1' : ''})`;
    }
    
    return `${start}-${end}${midnight ? ' +1' : ''}`;
}

/**
 * Formatiert kurzes Zeitfenster-Label für Grid-Anzeige
 * @param {object} timeslot 
 * @returns {string}
 */
export function formatTimeslotShort(timeslot) {
    if (!timeslot) return '';
    
    const start = timeslot.start_time?.substring(0, 5) || '';
    const end = timeslot.end_time?.substring(0, 5) || '';
    
    return `${start}-${end}`;
}

/**
 * Erstellt ein "ganztägig" Pseudo-Timeslot für Berechnungen
 * @returns {object}
 */
export function createFullDayTimeslot() {
    return {
        id: null,
        label: 'Ganztägig',
        start_time: '00:00',
        end_time: '23:59',
        spans_midnight: false,
        overlap_tolerance_minutes: 0
    };
}

/**
 * Aggregiert Arbeitsstunden pro Mitarbeiter im Zeitraum
 * @param {array} shifts - ShiftEntry-Array
 * @param {array} timeslots - WorkplaceTimeslot-Array
 * @param {object} dateRange - { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
 * @returns {object} Map von doctor_id zu Gesamtstunden
 */
export function aggregateWorkingHours(shifts, timeslots, dateRange) {
    const hoursPerDoctor = {};
    
    for (const shift of shifts) {
        if (isNonWorkingShiftPosition(shift.position)) {
            continue;
        }

        // Datumsfilter
        if (dateRange) {
            if (shift.date < dateRange.start || shift.date > dateRange.end) {
                continue;
            }
        }
        
        // Timeslot finden
        const timeslot = shift.timeslot_id 
            ? timeslots.find(t => t.id === shift.timeslot_id)
            : null;
        
        const hours = calculateShiftHours(shift, timeslot);
        
        hoursPerDoctor[shift.doctor_id] = 
            (hoursPerDoctor[shift.doctor_id] || 0) + hours;
    }
    
    return hoursPerDoctor;
}

/**
 * Parst Droppable-ID für Grid-Zellen (erweitert für Timeslots)
 * @param {string} droppableId - Format: "date__position" oder "date__position__timeslotId"
 * @returns {object} { date, position, timeslotId }
 */
export function parseDroppableId(droppableId) {
    if (!droppableId) return { date: null, position: null, timeslotId: null };
    
    const parts = droppableId.split('__');
    
    return {
        date: parts[0] || null,
        position: parts[1] || null,
        timeslotId: parts[2] === 'null' || parts[2] === undefined ? null : parts[2]
    };
}

/**
 * Erstellt Droppable-ID für Grid-Zellen (erweitert für Timeslots)
 * @param {string} date - Datum "YYYY-MM-DD"
 * @param {string} position - Position/Arbeitsplatz
 * @param {string|null} timeslotId - Timeslot-ID oder null
 * @returns {string}
 */
export function createDroppableId(date, position, timeslotId = null) {
    if (timeslotId) {
        return `${date}__${position}__${timeslotId}`;
    }
    return `${date}__${position}`;
}
