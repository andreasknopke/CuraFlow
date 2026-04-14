import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/client';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';

interface Doctor {
  id: number;
  role?: string;
  [key: string]: unknown;
}

interface ShiftEntry {
  id: number;
  doctor_id: number;
  date: string;
  position: string;
  [key: string]: unknown;
}

interface SystemSetting {
  key: string;
  value: string;
  [key: string]: unknown;
}

export function useStaffingCheck(doctors: Doctor[] | undefined, shifts: ShiftEntry[] | undefined) {
  const { data: settings = [] } = useQuery<SystemSetting[]>({
    queryKey: ['systemSettings'],
    queryFn: () => db.SystemSetting.list() as Promise<SystemSetting[]>,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Dynamische Facharzt-Rollen aus DB laden
  const { specialistRoles } = useTeamRoles();

  const minPresentSpecialists = parseInt(
    settings.find((s) => s.key === 'min_present_specialists')?.value || '2',
  );
  const minPresentAssistants = parseInt(
    settings.find((s) => s.key === 'min_present_assistants')?.value || '4',
  );

  const checkStaffing = (dateStr: string, newAbsentDoctorId?: number | null): string | null => {
    if (!doctors || !shifts) return null;

    // 1. Total Staff
    let totalSpecialists = 0;
    let totalAssistants = 0;
    doctors.forEach((d) => {
      if (d.role === 'Assistenzarzt') totalAssistants++;
      else if (d.role && specialistRoles.includes(d.role)) totalSpecialists++;
    });

    // 2. Current Absences
    let absentSpecialists = 0;
    let absentAssistants = 0;
    const absentDocIds = new Set();

    const ABSENCE_POSITIONS = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];

    shifts.forEach((s) => {
      if (s.date === dateStr && ABSENCE_POSITIONS.includes(s.position)) {
        absentDocIds.add(s.doctor_id);
      }
    });

    // Add the new absence if provided and not already counted
    if (newAbsentDoctorId && !absentDocIds.has(newAbsentDoctorId)) {
      absentDocIds.add(newAbsentDoctorId);
    }

    // Count based on unique IDs
    absentDocIds.forEach((id) => {
      const doc = doctors.find((d) => d.id === id);
      if (doc) {
        if (doc.role === 'Assistenzarzt') absentAssistants++;
        else if (doc.role && specialistRoles.includes(doc.role)) absentSpecialists++;
      }
    });

    const presentSpecialists = totalSpecialists - absentSpecialists;
    const presentAssistants = totalAssistants - absentAssistants;

    const specsLow = presentSpecialists < minPresentSpecialists;
    const asstsLow = presentAssistants < minPresentAssistants;

    if (specsLow || asstsLow) {
      let msg = 'Achtung: Mindestbesetzung unterschritten!';
      if (specsLow) msg += `\nFachärzte: ${presentSpecialists} (Min: ${minPresentSpecialists})`;
      if (asstsLow) msg += `\nAssistenzärzte: ${presentAssistants} (Min: ${minPresentAssistants})`;
      return msg;
    }

    return null;
  };

  return { checkStaffing };
}
