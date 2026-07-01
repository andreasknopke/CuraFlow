import { useQuery } from '@tanstack/react-query';
import { base44, db } from "@/api/client";

export function useStaffingCheck(doctors, shifts) {
    const { data: settings = [] } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => base44.entities.SystemSetting.list(),
        staleTime: 1000 * 60 * 5 // 5 minutes
    });

    // Alle Arzt-Qualifikationen laden
    const { data: allDoctorQualifications = [] } = useQuery({
        queryKey: ['allDoctorQualifications'],
        queryFn: () => db.DoctorQualification.list(),
        staleTime: 1000 * 60 * 5,
    });

    // Parse thresholds
    const rawThresholds = settings.find(s => s.key === 'availability_thresholds')?.value;
    const availabilityThresholds = rawThresholds ? (() => { try { return JSON.parse(rawThresholds); } catch { return []; } })() : [];

    // Hilfsfunktion: Qualifikations-IDs eines Arztes
    const getDoctorQualIds = (doctorId) => {
        return allDoctorQualifications
            .filter(dq => String(dq.doctor_id) === doctorId)
            .map(dq => String(dq.qualification_id));
    };

    const checkStaffing = (dateStr, newAbsentDoctorId = null) => {
        if (!doctors || !shifts) return null;
        if (!availabilityThresholds || availabilityThresholds.length === 0) return null;

        const ABSENCE_POSITIONS = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];

        // Aktuelle Abwesenheiten
        const absentDocIds = new Set();
        shifts.forEach(s => {
            if (s.date === dateStr && ABSENCE_POSITIONS.includes(s.position)) {
                absentDocIds.add(s.doctor_id);
            }
        });
        if (newAbsentDoctorId && !absentDocIds.has(newAbsentDoctorId)) {
            absentDocIds.add(newAbsentDoctorId);
        }

        const warnings = [];

        availabilityThresholds.forEach(threshold => {
            const qId = threshold.qualificationId;
            const qualName = threshold.qualificationName || qId;
            const minCount = threshold.min;

            // Ärzte mit dieser Qualifikation
            const docsWithQual = doctors.filter(d => {
                const qualIds = getDoctorQualIds(d.id);
                return qualIds.includes(qId);
            });

            const total = docsWithQual.length;
            const absent = docsWithQual.filter(d => absentDocIds.has(d.id)).length;
            const present = total - absent;

            if (present < minCount) {
                warnings.push(`${qualName}: ${present} (Min: ${minCount})`);
            }
        });

        if (warnings.length > 0) {
            return `Achtung: Mindestbesetzung unterschritten!\n${warnings.join('\n')}`;
        }

        return null;
    };

    return { checkStaffing };
}