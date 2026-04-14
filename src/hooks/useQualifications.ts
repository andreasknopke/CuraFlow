import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/client';
import type { Qualification, DoctorQualification, WorkplaceQualification } from '@/types';

/**
 * Hook für dynamische Qualifikationen/Berechtigungen
 * Ersetzt die hardcodierten Badges ("Facharzt", "Vordergrund", "Hintergrund")
 * durch ein flexibles, konfigurierbares System.
 */

type QualificationInput = Omit<Partial<Qualification>, 'id' | 'created_date' | 'updated_date'>;

// Standard-Qualifikationen die initial angelegt werden
export const DEFAULT_QUALIFICATIONS: QualificationInput[] = [
  {
    name: 'Facharzt',
    short_label: 'FA',
    description: 'Fachärztliche Qualifikation',
    color_bg: '#dcfce7',
    color_text: '#166534',
    category: 'Medizinisch',
    order: 0,
  },
  {
    name: 'Vordergrund-berechtigt',
    short_label: 'VG',
    description: 'Berechtigt für Vordergrunddienste',
    color_bg: '#dbeafe',
    color_text: '#1e40af',
    category: 'Dienst',
    order: 1,
  },
  {
    name: 'Hintergrund-berechtigt',
    short_label: 'HG',
    description: 'Berechtigt für Hintergrunddienste',
    color_bg: '#fed7aa',
    color_text: '#9a3412',
    category: 'Dienst',
    order: 2,
  },
  {
    name: 'Strahlenschutz',
    short_label: 'SS',
    description: 'Fachkunde Strahlenschutz',
    color_bg: '#fef9c3',
    color_text: '#854d0e',
    category: 'Zertifizierung',
    order: 3,
  },
];

// Initialisiert Standard-Qualifikationen in der Datenbank falls noch keine vorhanden
export async function initializeDefaultQualifications(): Promise<
  Qualification[] | QualificationInput[]
> {
  try {
    const existing = (await db.Qualification.list()) as Qualification[];
    if (existing && existing.length > 0) {
      return existing;
    }

    console.log('Initializing default qualifications...');
    const created: Qualification[] = [];
    for (const qual of DEFAULT_QUALIFICATIONS) {
      const result = (await db.Qualification.create(qual)) as Qualification;
      created.push(result);
    }
    console.log('Default qualifications created');
    return created;
  } catch (error) {
    console.error('Failed to initialize qualifications:', error);
    return DEFAULT_QUALIFICATIONS;
  }
}

/**
 * Hook: Alle Qualifikationen laden
 */
export function useQualifications() {
  const queryClient = useQueryClient();

  const {
    data: qualifications = [] as Qualification[],
    isLoading,
    refetch,
  } = useQuery<Qualification[]>({
    queryKey: ['qualifications'],
    queryFn: async (): Promise<Qualification[]> => {
      const data = (await db.Qualification.list()) as Qualification[];
      if (!data || data.length === 0) {
        return (await initializeDefaultQualifications()) as Qualification[];
      }
      return data.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: QualificationInput) =>
      db.Qualification.create({ ...data, order: qualifications.length }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['qualifications'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: QualificationInput }) =>
      db.Qualification.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['qualifications'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Also delete all DoctorQualification and WorkplaceQualification entries referencing this qualification
      const [doctorQuals, workplaceQuals] = await Promise.all([
        db.DoctorQualification.filter({ qualification_id: id }) as Promise<DoctorQualification[]>,
        db.WorkplaceQualification.filter({ qualification_id: id }) as Promise<
          WorkplaceQualification[]
        >,
      ]);
      await Promise.all([
        ...doctorQuals.map((dq) => db.DoctorQualification.delete(dq.id)),
        ...workplaceQuals.map((wq) => db.WorkplaceQualification.delete(wq.id)),
        db.Qualification.delete(id),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qualifications'] });
      queryClient.invalidateQueries({ queryKey: ['doctorQualifications'] });
      queryClient.invalidateQueries({ queryKey: ['workplaceQualifications'] });
    },
  });

  // Qualifications grouped by category
  const categories = [...new Set(qualifications.map((q) => q.category || 'Allgemein'))];
  const qualificationsByCategory = categories.reduce<Record<string, Qualification[]>>(
    (acc, cat) => {
      acc[cat] = qualifications.filter((q) => (q.category || 'Allgemein') === cat);
      return acc;
    },
    {},
  );

  const qualificationMap = qualifications.reduce<Record<string, Qualification>>((acc, q) => {
    acc[q.id] = q;
    return acc;
  }, {});

  return {
    qualifications,
    categories,
    qualificationsByCategory,
    qualificationMap,
    isLoading,
    refetch,
    createQualification: createMutation.mutate,
    updateQualification: updateMutation.mutate,
    deleteQualification: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

/**
 * Hook: Qualifikationen eines bestimmten Mitarbeiters laden
 */
export function useDoctorQualifications(doctorId: string | null | undefined) {
  const queryClient = useQueryClient();

  const { data: doctorQualifications = [] as DoctorQualification[], isLoading } = useQuery<
    DoctorQualification[]
  >({
    queryKey: ['doctorQualifications', doctorId],
    queryFn: () =>
      db.DoctorQualification.filter({ doctor_id: doctorId }) as Promise<DoctorQualification[]>,
    enabled: !!doctorId,
  });

  const assignMutation = useMutation({
    mutationFn: (data: Partial<DoctorQualification>) =>
      db.DoctorQualification.create({
        doctor_id: doctorId,
        ...data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doctorQualifications', doctorId] });
      queryClient.invalidateQueries({ queryKey: ['allDoctorQualifications'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => db.DoctorQualification.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doctorQualifications', doctorId] });
      queryClient.invalidateQueries({ queryKey: ['allDoctorQualifications'] });
    },
  });

  return {
    doctorQualifications,
    isLoading,
    assignQualification: assignMutation.mutate,
    removeQualification: removeMutation.mutate,
  };
}

/**
 * Hook: Alle Doctor-Qualification Zuordnungen laden (für Listen-Ansichten)
 */
export function useAllDoctorQualifications() {
  const { data: allDoctorQualifications = [] as DoctorQualification[], isLoading } = useQuery<
    DoctorQualification[]
  >({
    queryKey: ['allDoctorQualifications'],
    queryFn: () => db.DoctorQualification.list() as Promise<DoctorQualification[]>,
  });

  // Group by doctor_id for fast lookup
  const byDoctor = allDoctorQualifications.reduce<Record<string, DoctorQualification[]>>(
    (acc, dq) => {
      if (!acc[dq.doctor_id]) acc[dq.doctor_id] = [];
      acc[dq.doctor_id].push(dq);
      return acc;
    },
    {},
  );

  // Get qualification IDs for a specific doctor
  const getQualificationIds = (doctorId: string): string[] => {
    return (byDoctor[doctorId] || []).map((dq) => dq.qualification_id);
  };

  return {
    allDoctorQualifications,
    byDoctor,
    getQualificationIds,
    isLoading,
  };
}

/**
 * Hook: Qualifikationsanforderungen eines Arbeitsplatzes laden
 */
export function useWorkplaceQualifications(workplaceId: string | null | undefined) {
  const queryClient = useQueryClient();

  const { data: workplaceQualifications = [] as WorkplaceQualification[], isLoading } = useQuery<
    WorkplaceQualification[]
  >({
    queryKey: ['workplaceQualifications', workplaceId],
    queryFn: () =>
      db.WorkplaceQualification.filter({ workplace_id: workplaceId }) as Promise<
        WorkplaceQualification[]
      >,
    enabled: !!workplaceId,
  });

  const assignMutation = useMutation({
    mutationFn: (data: Partial<WorkplaceQualification>) =>
      db.WorkplaceQualification.create({
        workplace_id: workplaceId,
        ...data,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['workplaceQualifications', workplaceId] }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => db.WorkplaceQualification.delete(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['workplaceQualifications', workplaceId] }),
  });

  return {
    workplaceQualifications,
    isLoading,
    assignQualification: assignMutation.mutate,
    removeQualification: removeMutation.mutate,
  };
}

/**
 * Hook: Alle Workplace-Qualification Zuordnungen laden
 */
export function useAllWorkplaceQualifications() {
  const { data: allWorkplaceQualifications = [] as WorkplaceQualification[], isLoading } = useQuery<
    WorkplaceQualification[]
  >({
    queryKey: ['allWorkplaceQualifications'],
    queryFn: () => db.WorkplaceQualification.list() as Promise<WorkplaceQualification[]>,
  });

  // Group by workplace_id
  const byWorkplace = allWorkplaceQualifications.reduce<Record<string, WorkplaceQualification[]>>(
    (acc, wq) => {
      if (!acc[wq.workplace_id]) acc[wq.workplace_id] = [];
      acc[wq.workplace_id].push(wq);
      return acc;
    },
    {},
  );

  const getRequiredQualificationIds = (workplaceId: string): string[] => {
    return (byWorkplace[workplaceId] || [])
      .filter((wq) => wq.is_mandatory && !wq.is_excluded)
      .map((wq) => wq.qualification_id);
  };

  const getPreferredQualificationIds = (workplaceId: string): string[] => {
    return (byWorkplace[workplaceId] || [])
      .filter((wq) => !wq.is_mandatory && !wq.is_excluded)
      .map((wq) => wq.qualification_id);
  };

  const getDiscouragedQualificationIds = (workplaceId: string): string[] => {
    return (byWorkplace[workplaceId] || [])
      .filter((wq) => wq.is_mandatory && wq.is_excluded)
      .map((wq) => wq.qualification_id);
  };

  const getExcludedQualificationIds = (workplaceId: string): string[] => {
    return (byWorkplace[workplaceId] || [])
      .filter((wq) => !wq.is_mandatory && wq.is_excluded)
      .map((wq) => wq.qualification_id);
  };

  return {
    allWorkplaceQualifications,
    byWorkplace,
    getRequiredQualificationIds,
    getPreferredQualificationIds,
    getOptionalQualificationIds: getPreferredQualificationIds,
    getDiscouragedQualificationIds,
    getExcludedQualificationIds,
    isLoading,
  };
}

/**
 * Helper: Prüft ob ein Mitarbeiter alle benötigten Qualifikationen für einen Arbeitsplatz hat
 */
export function checkDoctorQualifications(
  doctorQualIds: string[],
  requiredQualIds: string[],
): { qualified: boolean; missing: string[] } {
  if (!requiredQualIds || requiredQualIds.length === 0) return { qualified: true, missing: [] };

  const missing = requiredQualIds.filter((id) => !doctorQualIds.includes(id));
  return {
    qualified: missing.length === 0,
    missing,
  };
}
