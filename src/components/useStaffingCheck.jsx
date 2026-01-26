import { useQuery } from '@tanstack/react-query';
import { api, db, base44 } from "@/api/client";
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';

export function useStaffingCheck(doctors, shifts) {
    const { data: settings = [] } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => base44.entities.SystemSetting.list(),
        staleTime: 1000 * 60 * 5 // 5 minutes
    });

    // Dynamische Facharzt-Rollen aus DB laden
    const { specialistRoles } = useTeamRoles();

    const minPresentSpecialists = parseInt(settings.find(s => s.key === 'min_present_specialists')?.value || '2');
    const minPresentAssistants = parseInt(settings.find(s => s.key === 'min_present_assistants')?.value || '4');

    const checkStaffing = (dateStr, newAbsentDoctorId = null) => {
        if (!doctors || !shifts) return null;

        // 1. Total Staff
        let totalSpecialists = 0;
        let totalAssistants = 0;
        doctors.forEach(d => {
             if (d.role === 'Assistenzarzt') totalAssistants++;
             else if (specialistRoles.includes(d.role)) totalSpecialists++;
        });

        // 2. Current Absences
        let absentSpecialists = 0;
        let absentAssistants = 0;
        const absentDocIds = new Set();

        const ABSENCE_POSITIONS = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];

        shifts.forEach(s => {
            if (s.date === dateStr && ABSENCE_POSITIONS.includes(s.position)) {
                absentDocIds.add(s.doctor_id);
            }
        });

        // Add the new absence if provided and not already counted
        if (newAbsentDoctorId && !absentDocIds.has(newAbsentDoctorId)) {
            absentDocIds.add(newAbsentDoctorId);
        }

        // Count based on unique IDs
        absentDocIds.forEach(id => {
            const doc = doctors.find(d => d.id === id);
            if (doc) {
                if (doc.role === 'Assistenzarzt') absentAssistants++;
                else if (specialistRoles.includes(doc.role)) absentSpecialists++;
            }
        });

        const presentSpecialists = totalSpecialists - absentSpecialists;
        const presentAssistants = totalAssistants - absentAssistants;

        const specsLow = presentSpecialists < minPresentSpecialists;
        const asstsLow = presentAssistants < minPresentAssistants;

        if (specsLow || asstsLow) {
            let msg = "Achtung: Mindestbesetzung unterschritten!";
            if (specsLow) msg += `\nFachärzte: ${presentSpecialists} (Min: ${minPresentSpecialists})`;
            if (asstsLow) msg += `\nAssistenzärzte: ${presentAssistants} (Min: ${minPresentAssistants})`;
            return msg;
        }

        return null;
    };

    return { checkStaffing };
}