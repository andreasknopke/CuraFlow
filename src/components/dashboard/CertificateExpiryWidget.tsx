import { useMemo } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { de } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, FileCheck, Eye, Loader2 } from 'lucide-react';
import { useExpiringCertificates, openCertificateInNewTab } from '@/hooks/useCertificates';
import { useQualifications } from '@/hooks/useQualifications';
import { useToast } from '@/components/ui/use-toast';

function formatDate(value: any): string {
    if (!value) return '–';
    try {
        const d = typeof value === 'string' ? parseISO(value) : value;
        return isValid(d) ? format(d, 'dd.MM.yyyy', { locale: de }) : '–';
    } catch {
        return '–';
    }
}

/**
 * Dashboard-Widget: zeigt Zertifikate, die in den nächsten 60 Tagen ablaufen
 * oder bereits abgelaufen sind. Server-seitig gefiltert (Admins: alle Mitarbeiter
 * des Mandanten; sonst: nur eigene).
 *
 * Props:
 *  - doctors: Liste aller Doctor-Records (für Namensauflösung bei Admin-Ansicht)
 *  - isAdmin: bool
 */
export default function CertificateExpiryWidget({ doctors = [], isAdmin = false }: { doctors?: any[]; isAdmin?: boolean }) {
    const { toast } = useToast();
    const { expiring, isLoading } = useExpiringCertificates({ days: 60 });
    const { qualificationMap } = useQualifications();

    const doctorMap = useMemo(() => {
        const m = {};
        for (const d of doctors) m[d.id] = d;
        return m;
    }, [doctors]);

    if (!isLoading && expiring.length === 0) {
        return null;
    }

    const handleView = async (id: string) => {
        try {
            await openCertificateInNewTab(id);
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Datei kann nicht geöffnet werden', description: err.message });
        }
    };

    return (
        <Card className="border-amber-200 bg-amber-50/30">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-amber-800">
                    <AlertTriangle className="w-5 h-5" />
                    Zertifikate – Ablauf in Kürze
                </CardTitle>
                <CardDescription>
                    {isAdmin
                        ? 'Übersicht aller Mitarbeiterzertifikate, die innerhalb von 60 Tagen ablaufen.'
                        : 'Ihre Zertifikate, die innerhalb von 60 Tagen ablaufen oder bereits abgelaufen sind.'}
                </CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Loader2 className="w-4 h-4 animate-spin" /> Wird geladen...
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {expiring.map((cert) => {
                            const days = Number(cert.days_until_expiry);
                            const expired = Number.isFinite(days) && days < 0;
                            const doctor = doctorMap[cert.doctor_id];
                            const qual = qualificationMap?.[cert.qualification_id];
                            return (
                                <li
                                    key={cert.id}
                                    className="bg-white border rounded p-2 flex items-start gap-2"
                                >
                                    <FileCheck className={`w-4 h-4 mt-0.5 shrink-0 ${expired ? 'text-red-500' : 'text-amber-600'}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {qual && (
                                                <Badge
                                                    style={{ backgroundColor: qual.color_bg, color: qual.color_text }}
                                                    className="border-0 text-[10px]"
                                                >
                                                    {qual.short_label || qual.name?.substring(0, 3).toUpperCase()}
                                                </Badge>
                                            )}
                                            <span className="text-sm font-medium text-slate-800">
                                                {qual?.name || 'Qualifikation'}
                                            </span>
                                            {isAdmin && doctor && (
                                                <span className="text-xs text-slate-500">– {doctor.name}</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-0.5">
                                            Gültig bis {formatDate(cert.expiry_date)}
                                            {' · '}
                                            {expired
                                                ? <span className="text-red-600 font-medium">abgelaufen seit {Math.abs(days)} Tagen</span>
                                                : <span className="text-amber-700 font-medium">in {days} Tagen</span>}
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => handleView(cert.id)}
                                        title="Zertifikat anzeigen"
                                    >
                                        <Eye className="w-3.5 h-3.5" />
                                    </Button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
