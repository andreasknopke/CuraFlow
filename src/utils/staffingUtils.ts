/**
 * CuraFlow — Staffing Utils
 *
 * Utility functions for staffing checks, particularly availability thresholds
 * based on qualifications.
 *
 * @module utils/staffingUtils
 */

const ABSENCE_POSITIONS = ["Frei", "Krank", "Urlaub", "Schichturlaub", "Dienstreise", "Nicht verfügbar"];

/**
 * Prüft für einen bestimmten Tag, ob die Verfügbarkeits-Grenzwerte (hinterlegt
 * in availabilityThresholds) durch die aktuellen Abwesenheiten unterschritten
 * werden.
 *
 * @param {object} params
 * @param {Array} params.doctors              — Alle Ärzte/Mitarbeiter
 * @param {Array} params.shifts               — Alle Schichten (zur Bestimmung der Abwesenheiten)
 * @param {string} params.dateStr             — Datum im Format 'yyyy-MM-dd'
 * @param {string|null} params.newAbsentDoctorId  — Optional: ein zusätzlich abwesender Mitarbeiter
 * @param {object} params.qualificationMap    — { id → { name, … } }
 * @param {object} params.doctorQualByDoctor  — { doctorId → [{ qualification_id, … }] }
 * @param {Array} params.availabilityThresholds — [{ qualificationId, qualificationName, min }]
 * @returns {{ hasWarning: boolean, warnings: Array<{ qualName: string, present: number, min: number }> }}
 */
export function getAvailabilityWarnings({
    doctors = [],
    shifts = [],
    dateStr = '',
    newAbsentDoctorId = null,
    qualificationMap = {},
    doctorQualByDoctor = {},
    availabilityThresholds = [],
}: {
    doctors?: { id: string; role?: string | null; exclude_from_staffing_plan?: boolean }[];
    shifts?: { date: string; doctor_id: string; position: string }[];
    dateStr?: string;
    newAbsentDoctorId?: string | null;
    qualificationMap?: Record<string, { name: string; id: string | number }>;
    doctorQualByDoctor?: Record<string, { qualification_id: string | number }[]>;
    availabilityThresholds?: { qualificationId: string | number; qualificationName?: string; min: number }[];
}) {
    if (!availabilityThresholds || availabilityThresholds.length === 0) {
        return { hasWarning: false, warnings: [] };
    }

    // Abwesende IDs sammeln
    const absentDocIds = new Set();
    shifts.forEach(s => {
        if (s.date === dateStr && ABSENCE_POSITIONS.includes(s.position)) {
            absentDocIds.add(s.doctor_id);
        }
    });
    if (newAbsentDoctorId && !absentDocIds.has(newAbsentDoctorId)) {
        absentDocIds.add(newAbsentDoctorId);
    }

    // Hilfsfunktion: Qualifikations-IDs eines Arztes
    const getDocQualIds = (doctorId: string): string[] => {
        const entries = doctorQualByDoctor[doctorId];
        if (entries && entries.length > 0) {
            return entries.map(e => String(e.qualification_id));
        }
        // Fallback: Rolle als Qualifikationsname
        const doc = doctors.find(d => d.id === doctorId);
        if (doc?.role) {
            const qual = Object.values(qualificationMap).find(q => q.name === doc.role);
            if (qual?.id) return [String(qual.id)];
        }
        return [];
    };

    const warnings: { qualName: string; present: number; min: number }[] = [];

    availabilityThresholds.forEach(threshold => {
        const qId = String(threshold.qualificationId);
        const qualName = threshold.qualificationName || qualificationMap[qId]?.name || qId;
        const minCount = threshold.min;

        const docsWithQual = doctors.filter(d => {
            const qualIds = getDocQualIds(d.id);
            return qualIds.includes(String(qId));
        });

        const total = docsWithQual.length;
        const absent = docsWithQual.filter(d => absentDocIds.has(d.id)).length;
        const present = total - absent;

        if (present < minCount) {
            warnings.push({ qualName, present, min: minCount });
        }
    });

    return { hasWarning: warnings.length > 0, warnings };
}

export { ABSENCE_POSITIONS };
