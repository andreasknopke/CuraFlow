/**
 * CuraFlow — useCertificates Hook
 *
 * TanStack Query hooks for certificate management:
 * - List certificates for a doctor or qualification
 * - Auto-refetch while analysis is pending
 * - Upload, check, update, delete, reanalyze mutations
 * - Expiring certificates endpoint
 * - Helper to open certificate in a new tab
 *
 * @module hooks/useCertificates
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

const DEFAULT_WARNING_DAYS = 60;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CertificatesFilter {
  doctorId?: string | null;
  qualificationId?: string | null;
  enabled?: boolean;
}

interface CertificateItem {
  id?: string | number;
  analysis_status?: string;
  [key: string]: unknown;
}

interface UploadPayload {
  file: File;
  doctor_id: string;
  qualification_id?: string;
  doctor_qualification_id?: string;
  granted_date?: string;
  expiry_date?: string;
  notes?: string;
  evidence_role?: string;
  qualification_name?: string;
  qualification_description?: string;
  approval_token?: string;
}

interface CheckPayload {
  file: File;
  qualification_name: string;
  qualification_description?: string;
}

interface UpdatePayload {
  id: string;
  granted_date?: string;
  expiry_date?: string;
  notes?: string;
  evidence_role?: string;
}

interface ReanalyzePayload {
  id: string;
  qualification_name?: string;
  qualification_description?: string;
}

// ─── useCertificates ─────────────────────────────────────────────────────────

/**
 * Fetches certificates for a given doctor or qualification.
 * Non-admin users are server-side restricted to their own records.
 * Automatically re-fetches every 3s while any certificate analysis is pending.
 */
export function useCertificates({
  doctorId = null,
  qualificationId = null,
  enabled = true,
}: CertificatesFilter = {}) {
  const queryClient = useQueryClient();

  const queryKey = ['certificates', { doctorId, qualificationId }];

  const {
    data: certificates = [] as CertificateItem[],
    isLoading,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () =>
      api.listCertificates({
        doctor_id: doctorId || undefined,
        qualification_id: qualificationId || undefined,
      }),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as CertificateItem[] | undefined;
      if (
        Array.isArray(data) &&
        data.some((c) => c.analysis_status === 'pending')
      ) {
        return 3000;
      }
      return false;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['certificates'] });
    queryClient.invalidateQueries({ queryKey: ['certificates-expiring'] });
  };

  const uploadMutation = useMutation({
    mutationFn: (payload: UploadPayload) => api.uploadCertificate(payload),
    onSuccess: invalidate,
  });

  const checkMutation = useMutation({
    mutationFn: (payload: CheckPayload) => api.checkCertificate(payload),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...rest }: UpdatePayload) =>
      api.updateCertificate(id, rest),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCertificate(id),
    onSuccess: invalidate,
  });

  const reanalyzeMutation = useMutation({
    mutationFn: ({
      id,
      qualification_name,
      qualification_description,
    }: ReanalyzePayload) =>
      api.reanalyzeCertificate(id, {
        qualification_name,
        qualification_description,
      }),
    onSuccess: invalidate,
  });

  return {
    certificates,
    isLoading,
    refetch,
    checkCertificate: checkMutation.mutateAsync,
    uploadCertificate: uploadMutation.mutateAsync,
    updateCertificate: updateMutation.mutateAsync,
    deleteCertificate: deleteMutation.mutateAsync,
    reanalyzeCertificate: reanalyzeMutation.mutateAsync,
    isChecking: checkMutation.isPending,
    isUploading: uploadMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isReanalyzing: reanalyzeMutation.isPending,
  };
}

// ─── useExpiringCertificates ─────────────────────────────────────────────────

/**
 * Fetches certificates that expire within the given warning period,
 * or have already expired. Restricted to own records for non-admins.
 */
export function useExpiringCertificates({
  days = DEFAULT_WARNING_DAYS,
  enabled = true,
}: { days?: number; enabled?: boolean } = {}) {
  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['certificates-expiring', days],
    queryFn: () => api.listExpiringCertificates(days),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  return {
    expiring: data as CertificateItem[],
    isLoading,
    refetch,
  };
}

// ─── openCertificateInNewTab ─────────────────────────────────────────────────

/**
 * Downloads a certificate blob from the server and opens it in a new tab.
 * Falls back to a download link if pop-ups are blocked.
 */
export async function openCertificateInNewTab(certificateId: string): Promise<void> {
  const blob = await api.fetchCertificateBlob(certificateId);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  // Revoke after a short delay so the new tab can load the content.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (!win) {
    // Pop-up blocked: trigger as download link instead.
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
