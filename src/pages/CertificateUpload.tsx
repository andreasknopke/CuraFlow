import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FileCheck, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/components/AuthProvider';
import CertificateManager from '@/components/staff/CertificateManager';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useDoctorQualifications, useQualifications } from '@/hooks/useQualifications';
import { computeQualificationEvidenceSummary } from '@/lib/qualificationEvidence';
import type { EvidenceSummary } from '@/lib/qualificationEvidence';

function groupCertificatesByQualification(certificates: any[] = []) {
  return certificates.reduce((acc: Record<string, any[]>, certificate: any) => {
    if (!acc[certificate.qualification_id]) {
      acc[certificate.qualification_id] = [];
    }
    acc[certificate.qualification_id].push(certificate);
    return acc;
  }, {});
}

export default function CertificateUploadPage() {
  const location = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const selectedQualificationId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('qualification_id');
  }, [location.search]);

  const { qualifications, qualificationMap, isLoading: qualificationsLoading } = useQualifications();
  const { doctorQualifications = [], isLoading: doctorQualificationsLoading } = useDoctorQualifications((user as any)?.doctor_id);
  const { data: allCertificates = [], isLoading: certificatesLoading } = useQuery({
    queryKey: ['certificates-self-service', (user as any)?.doctor_id],
    queryFn: () => api.listCertificates({ doctor_id: (user as any).doctor_id }) as any,
    enabled: !!(user as any)?.doctor_id,
  });

  const groupedCertificates = useMemo(() => groupCertificatesByQualification(allCertificates), [allCertificates]);

  const visibleQualifications = useMemo(() => {
    const mapped = doctorQualifications
      .map((doctorQualification: any) => {
        const qualification: any = qualificationMap[doctorQualification.qualification_id];
        if (!qualification || qualification.requires_certificate !== true) {
          return null;
        }

        const summary: EvidenceSummary = computeQualificationEvidenceSummary({
          qualification,
          certificates: groupedCertificates[qualification.id] || [],
        });
        const shouldInclude = summary.status !== 'valid' || qualification.id === selectedQualificationId;
        if (!shouldInclude) {
          return null;
        }

        return {
          qualification,
          doctorQualification,
          summary,
        };
      })
      .filter(Boolean);
    return (mapped as any[]).sort((left: any, right: any) => {
        const leftPinned = left.qualification.id === selectedQualificationId ? 0 : 1;
        const rightPinned = right.qualification.id === selectedQualificationId ? 0 : 1;
        if (leftPinned !== rightPinned) return leftPinned - rightPinned;
        return left.qualification.name.localeCompare(right.qualification.name);
      });
  }, [doctorQualifications, groupedCertificates, qualificationMap, selectedQualificationId]);

  const isLoading = authLoading || qualificationsLoading || doctorQualificationsLoading || certificatesLoading;

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-4xl py-10">
        <div className="flex items-center justify-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Wird geladen...
        </div>
      </div>
    );
  }

  if (!user?.doctor_id) {
    return (
      <div className="container mx-auto max-w-4xl py-10">
        <Card>
          <CardContent className="py-10 text-center text-slate-500">
            Dieser Zugang ist nicht mit einem Mitarbeiterprofil verknuepft. Bitte wenden Sie sich an die Administration.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl py-8 space-y-6" data-testid="certificate-upload-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <FileCheck className="h-5 w-5" /> Zertifikatsnachweise hochladen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-600">
          <p>
            Hier sehen Sie alle Ihnen zugeordneten Qualifikationen, fuer die aktuell ein Nachweis fehlt oder nicht mehr gueltig ist.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
              <AlertTriangle className="mr-1 h-3 w-3" /> Offene oder ungueltige Nachweise
            </Badge>
            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
              <ShieldCheck className="mr-1 h-3 w-3" /> Upload wie im Mitarbeiterdialog
            </Badge>
          </div>
        </CardContent>
      </Card>

      {visibleQualifications.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-slate-500">
            Aktuell gibt es fuer Ihr Profil keine offenen Zertifikatsnachweise.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {visibleQualifications.map(({ qualification, doctorQualification, summary }) => (
            <div key={qualification.id} className="space-y-2">
              <div className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="font-medium text-slate-900">{qualification.name}</div>
                <div className="text-xs text-slate-500">{summary.reason}</div>
              </div>
              <CertificateManager
                doctorId={(user as any).doctor_id}
                qualificationId={qualification.id}
                qualificationName={qualification.name}
                qualificationDescription={qualification.description}
                qualificationRequirementMode={qualification.certificate_requirement_mode}
                qualificationValidityMonths={qualification.certificate_validity_months}
                qualificationRefreshValidityMonths={qualification.certificate_refresh_validity_months}
                qualificationBaseLabel={qualification.certificate_base_label}
                qualificationRefreshLabel={qualification.certificate_refresh_label}
                doctorQualificationId={doctorQualification.id}
                doctorQualification={doctorQualification}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}