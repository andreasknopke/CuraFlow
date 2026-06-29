/**
 * CuraFlow — useQualifications & related hooks
 *
 * Hooks for dynamic qualifications/permissions, replacing hardcoded badges
 * ("Facharzt", "Vordergrund", "Hintergrund") with a configurable system.
 *
 * @module hooks/useQualifications
 */

import { useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Qualification {
  id?: string | number;
  name: string;
  short_label?: string | null;
  description?: string | null;
  color_bg?: string | null;
  color_text?: string | null;
  category?: string | null;
  order?: number | null;
  requires_certificate?: boolean | null;
  certificate_requirement_mode?: string | null;
  certificate_validity_months?: number | null;
  certificate_refresh_validity_months?: number | null;
  certificate_base_label?: string | null;
  certificate_refresh_label?: string | null;
  [key: string]: unknown;
}

interface DoctorQualification {
  id?: string | number;
  doctor_id?: string;
  qualification_id?: string;
  [key: string]: unknown;
}

interface WorkplaceQualification {
  id?: string | number;
  workplace_id?: string;
  qualification_id?: string;
  [key: string]: unknown;
}

// ─── Default Qualifications ──────────────────────────────────────────────────

/** Standard qualifications created on first initialization if DB is empty. */
export const DEFAULT_QUALIFICATIONS: Qualification[] = [
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
    requires_certificate: true,
    certificate_requirement_mode: 'base_refresh',
    certificate_validity_months: 60,
    certificate_refresh_validity_months: 60,
    certificate_base_label: 'Original-Fachkunde',
    certificate_refresh_label: 'Auffrischung / Aktualisierung',
  },
];

// ─── initializeDefaultQualifications ─────────────────────────────────────────

/** Seeds the DB with default qualifications if the table is empty. */
export async function initializeDefaultQualifications(): Promise<Qualification[]> {
  try {
    const existing = await db.Qualification.list();
    if (existing && (existing as unknown[]).length > 0) {
      return existing as unknown as Qualification[];
    }

    console.log('Initializing default qualifications...');
    const created: Qualification[] = [];
    for (const qual of DEFAULT_QUALIFICATIONS) {
      const result = await db.Qualification.create(qual as Record<string, unknown>);
      created.push(result as unknown as Qualification);
    }
    console.log('Default qualifications created');
    return created;
  } catch (error) {
    console.error('Failed to initialize qualifications:', error);
    return DEFAULT_QUALIFICATIONS;
  }
}

// ─── useQualifications ───────────────────────────────────────────────────────

/** Fetches all qualifications, grouping by category and building a lookup map. */
export function useQualifications() {
  const queryClient = useQueryClient();

  const {
    data: qualifications = [] as Qualification[],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['qualifications'],
    queryFn: async () => {
      const data = (await db.Qualification.list()) as unknown as Qualification[];
      if (!data || data.length === 0) {
        return initializeDefaultQualifications();
      }
      return data.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Qualification) =>
      db.Qualification.create({
        ...data,
        order: qualifications.length,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['qualifications'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Qualification> }) =>
      db.Qualification.update(id, data as Record<string, unknown>),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['qualifications'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Cascade delete: also remove all DoctorQualification and
      // WorkplaceQualification entries referencing this qualification.
      const [doctorQuals, workplaceQuals] = (await Promise.all([
        db.DoctorQualification.filter({ qualification_id: id }),
        db.WorkplaceQualification.filter({ qualification_id: id }),
      ])) as [DoctorQualification[], WorkplaceQualification[]];

      await Promise.all([
        ...doctorQuals.map((dq) => db.DoctorQualification.delete(String(dq.id))),
        ...workplaceQuals.map((wq) =>
          db.WorkplaceQualification.delete(String(wq.id)),
        ),
        db.Qualification.delete(id),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qualifications'] });
      queryClient.invalidateQueries({ queryKey: ['doctorQualifications'] });
      queryClient.invalidateQueries({ queryKey: ['workplaceQualifications'] });
    },
  });

  // Group qualifications by category
  const categories: string[] = [
    ...new Set(qualifications.map((q) => q.category || 'Allgemein')),
  ];
  const qualificationsByCategory: Record<string, Qualification[]> =
    categories.reduce(
      (acc, cat) => {
        acc[cat] = qualifications.filter(
          (q) => (q.category || 'Allgemein') === cat,
        );
        return acc;
      },
      {} as Record<string, Qualification[]>,
    );

  // id → qualification lookup map
  const qualificationMap: Record<string, Qualification> = qualifications.reduce(
    (acc, q) => {
      if (q.id !== undefined) acc[String(q.id)] = q;
      return acc;
    },
    {} as Record<string, Qualification>,
  );

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

// ─── useDoctorQualifications ─────────────────────────────────────────────────

/** Fetches qualifications assigned to a specific doctor. */
export function useDoctorQualifications(doctorId: string | null | undefined) {
  const queryClient = useQueryClient();

  const {
    data: doctorQualifications = [] as DoctorQualification[],
    isLoading,
  } = useQuery({
    queryKey: ['doctorQualifications', doctorId],
    queryFn: () =>
      db.DoctorQualification.filter({ doctor_id: doctorId }) as Promise<
        DoctorQualification[]
      >,
    enabled: !!doctorId,
  });

  const assignMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      db.DoctorQualification.create({
        doctor_id: doctorId,
        ...data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['doctorQualifications', doctorId],
      });
      queryClient.invalidateQueries({
        queryKey: ['allDoctorQualifications'],
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => db.DoctorQualification.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['doctorQualifications', doctorId],
      });
      queryClient.invalidateQueries({
        queryKey: ['allDoctorQualifications'],
      });
    },
  });

  return {
    doctorQualifications,
    isLoading,
    assignQualification: assignMutation.mutate,
    removeQualification: removeMutation.mutate,
  };
}

// ─── useAllDoctorQualifications ──────────────────────────────────────────────

/** Fetches ALL doctor-qualification assignments for list views. */
export function useAllDoctorQualifications() {
  const {
    data: allDoctorQualifications = [] as DoctorQualification[],
    isLoading,
  } = useQuery({
    queryKey: ['allDoctorQualifications'],
    queryFn: () =>
      db.DoctorQualification.list() as Promise<DoctorQualification[]>,
  });

  // Group by doctor_id for fast lookup (memoized – stable reference)
  const byDoctor: Record<string, DoctorQualification[]> = useMemo(() => {
    return allDoctorQualifications.reduce(
      (acc, dq) => {
        const key = String(dq.doctor_id ?? '');
        if (!acc[key]) acc[key] = [];
        acc[key].push(dq);
        return acc;
      },
      {} as Record<string, DoctorQualification[]>,
    );
  }, [allDoctorQualifications]);

  const getQualificationIds = useCallback(
    (doctorId: string): string[] => {
      return (byDoctor[doctorId] || []).map((dq) =>
        String(dq.qualification_id ?? ''),
      );
    },
    [byDoctor],
  );

  return {
    allDoctorQualifications,
    byDoctor,
    getQualificationIds,
    isLoading,
  };
}

// ─── useWorkplaceQualifications ──────────────────────────────────────────────

/** Fetches qualification requirements for a specific workplace. */
export function useWorkplaceQualifications(
  workplaceId: string | null | undefined,
) {
  const queryClient = useQueryClient();

  const {
    data: workplaceQualifications = [] as WorkplaceQualification[],
    isLoading,
  } = useQuery({
    queryKey: ['workplaceQualifications', workplaceId],
    queryFn: () =>
      db.WorkplaceQualification.filter({
        workplace_id: workplaceId,
      }) as Promise<WorkplaceQualification[]>,
    enabled: !!workplaceId,
  });

  const assignMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      db.WorkplaceQualification.create({
        workplace_id: workplaceId,
        ...data,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['workplaceQualifications', workplaceId],
      }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => db.WorkplaceQualification.delete(id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['workplaceQualifications', workplaceId],
      }),
  });

  return {
    workplaceQualifications,
    isLoading,
    assignQualification: assignMutation.mutate,
    removeQualification: removeMutation.mutate,
  };
}

// ─── useAllWorkplaceQualifications ───────────────────────────────────────────

/** Fetches ALL workplace-qualification assignments for list views. */
export function useAllWorkplaceQualifications() {
  const {
    data: allWorkplaceQualifications = [] as WorkplaceQualification[],
    isLoading,
  } = useQuery({
    queryKey: ['allWorkplaceQualifications'],
    queryFn: () =>
      db.WorkplaceQualification.list() as Promise<WorkplaceQualification[]>,
  });

  // Group by workplace_id
  const byWorkplace = (allWorkplaceQualifications as WorkplaceQualification[]).reduce(
    (acc, wq) => {
      const key = String(wq.workplace_id ?? '');
      if (!acc[key]) acc[key] = [];
      acc[key].push(wq);
      return acc;
    },
    {} as Record<string, WorkplaceQualification[]>,
  );

  const getRequiredQualificationIds = (workplaceId: string): string[] => {
    return (byWorkplace[workplaceId] || [])
      .filter((wq) => wq.is_mandatory && !wq.is_excluded)
      .map((wq) => String(wq.qualification_id ?? ''));
  };

  const getPreferredQualificationIds = (workplaceId: string): string[] => {
    return (byWorkplace[workplaceId] || [])
      .filter((wq) => !wq.is_mandatory && !wq.is_excluded)
      .map((wq) => String(wq.qualification_id ?? ''));
  };

  const getDiscouragedQualificationIds = (workplaceId: string): string[] => {
    return (byWorkplace[workplaceId] || [])
      .filter((wq) => wq.is_mandatory && wq.is_excluded)
      .map((wq) => String(wq.qualification_id ?? ''));
  };

  const getExcludedQualificationIds = (workplaceId: string): string[] => {
    return (byWorkplace[workplaceId] || [])
      .filter((wq) => !wq.is_mandatory && wq.is_excluded)
      .map((wq) => String(wq.qualification_id ?? ''));
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

// ─── checkDoctorQualifications ───────────────────────────────────────────────

/**
 * Checks whether a doctor has all required qualifications for a workplace.
 */
export function checkDoctorQualifications(
  doctorQualIds: string[],
  requiredQualIds: string[],
): { qualified: boolean; missing: string[] } {
  if (!requiredQualIds || requiredQualIds.length === 0) {
    return { qualified: true, missing: [] };
  }

  const missing = requiredQualIds.filter((id) => !doctorQualIds.includes(id));
  return {
    qualified: missing.length === 0,
    missing,
  };
}
