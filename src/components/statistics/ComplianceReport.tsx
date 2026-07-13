import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { db } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { isWeekend, parseISO, isValid } from 'date-fns';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import type { Doctor, ShiftEntry, Workplace } from '@/types';

interface DoctorCompliance {
    name: string;
    role: string;
    fgCount: number;
    fgLimit: number;
    fgLimitRaw: number;
    bgCount: number;
    bgLimit: number;
    bgLimitRaw: number;
    weekendCount: number;
    weekendLimit: number;
    weekendLimitRaw: number;
    fte: number;
    maxStreak: number;
}

export default function ComplianceReport({
  doctors,
  shifts,
  workplaces,
  month,
}: {
  doctors: Doctor[];
  shifts: ShiftEntry[];
  workplaces: Workplace[];
  month: string;
}) {
  // Fetch system settings for limit values
  const { data: systemSettings = [] } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: () => db.SystemSetting.list() as Promise<{ key: string; value: string }[]>,
    staleTime: 1000 * 60 * 5,
  });

  // Fetch staffing entries for FTE calculation
  const { data: staffingEntries = [] } = useQuery({
    queryKey: ['staffingPlanEntries'],
    queryFn: () => db.StaffingPlanEntry.list() as Promise<{ doctor_id: string; year: number; month: number; value: string }[]>,
    staleTime: 1000 * 60 * 5,
  });

  const limitFG = parseInt(systemSettings.find(s => s.key === 'limit_fore_services')?.value || '4');
  const limitBG = parseInt(systemSettings.find(s => s.key === 'limit_back_services')?.value || '12');
  const limitWeekend = parseInt(systemSettings.find(s => s.key === 'limit_weekend_services')?.value || '1');

  const fgLimitRaw = limitFG;
  const bgLimitRaw = limitBG;

  // Build foreground/background position sets from workplaces
  const serviceWorkplaces = workplaces.filter(w => w.category === 'Dienste');
  const foregroundPositions = new Set(serviceWorkplaces.filter(w => w.service_type === 1).map(w => w.name));
  const backgroundPositions = new Set(serviceWorkplaces.filter(w => w.service_type === 2).map(w => w.name));

  // Legacy fallback: if no service_type set, first service = FG, rest = BG
  const sortedServices = [...serviceWorkplaces].sort((a, b) => (a.order || 0) - (b.order || 0));
  if (foregroundPositions.size === 0 && backgroundPositions.size === 0 && sortedServices.length > 0) {
    foregroundPositions.add(sortedServices[0].name);
    sortedServices.slice(1).forEach(w => backgroundPositions.add(w.name));
  }

  // Get doctor FTE for the selected period
  const getDoctorFte = (docId: string): number => {
    // Use the first month of the selected range for FTE lookup
    const refMonth = month === 'all' ? new Date().getMonth() : parseInt(month);
    const refYear = new Date().getFullYear();
    const refMonth1 = refMonth + 1;

    const entry = staffingEntries.find(
      e => e.doctor_id === docId && e.year === refYear && e.month === refMonth1
    );

    if (entry) {
      const val = String(entry.value).replace(',', '.');
      const num = parseFloat(val);
      if (isNaN(num)) return 0;
      return num;
    }

    const doctor = doctors.find(d => d.id === docId);
    return doctor?.fte ?? 1.0;
  };

  const stats: DoctorCompliance[] = useMemo(() => {
    return doctors
      .map(doc => {
        const docShifts = shifts.filter(s => {
          if (s.doctor_id !== doc.id) return false;
          if (month !== 'all') {
            const sMonth = new Date(s.date).getMonth();
            if (sMonth !== parseInt(month)) return false;
          }
          return true;
        });

        const fte = getDoctorFte(doc.id);

        // Count services by type
        let fgCount = 0, bgCount = 0, weekendCount = 0;
        docShifts.forEach(s => {
          if (foregroundPositions.has(s.position)) {
            fgCount++;
            const sDate = parseISO(s.date);
            if (isValid(sDate) && isWeekend(sDate)) weekendCount++;
          }
          if (backgroundPositions.has(s.position)) bgCount++;
        });

        // Consecutive days streak
        const sortedShifts = [...docShifts]
          .filter(s => !['Frei', 'Urlaub', 'Krank', 'Dienstreise', 'Nicht verfügbar'].includes(s.position))
          .sort((a, b) => a.date.localeCompare(b.date));

        let maxStreak = 0, currentStreak = 0;
        let lastDate: string | null = null;
        sortedShifts.forEach(shift => {
          if (!lastDate) {
            currentStreak = 1;
          } else {
            const curr = new Date(shift.date);
            const prev = new Date(lastDate);
            const diffDays = Math.ceil(Math.abs(curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) {
              currentStreak++;
            } else {
              maxStreak = Math.max(maxStreak, currentStreak);
              currentStreak = 1;
            }
          }
          lastDate = shift.date;
        });
        maxStreak = Math.max(maxStreak, currentStreak);

        // Skip limits for FTE <= 0 (externally managed / no data)
        if (fte <= 0) {
          return {
            name: doc.name,
            role: doc.role as string,
            fgCount, fgLimit: 0, fgLimitRaw,
            bgCount, bgLimit: 0, bgLimitRaw,
            weekendCount, weekendLimit: 0, weekendLimitRaw: limitWeekend,
            fte,
            maxStreak,
          };
        }

        return {
          name: doc.name,
          role: doc.role as string,
          fgCount,
          fgLimit: Math.round(limitFG * fte),
          fgLimitRaw,
          bgCount,
          bgLimit: Math.round(limitBG * fte),
          bgLimitRaw,
          weekendCount,
          weekendLimit: limitWeekend,
          weekendLimitRaw: limitWeekend,
          fte,
          maxStreak,
        };
      })
      .sort((a, b) => {
        // Violations first, then by name
        const aViol = a.fte > 0 && (a.fgCount > a.fgLimit || a.bgCount > a.bgLimit || a.weekendCount > a.weekendLimit) ? 1 : 0;
        const bViol = b.fte > 0 && (b.fgCount > b.fgLimit || b.bgCount > b.bgLimit || b.weekendCount > b.weekendLimit) ? 1 : 0;
        if (aViol !== bViol) return bViol - aViol;
        return a.name.localeCompare(b.name);
      });
  }, [doctors, shifts, month, limitFG, limitBG, limitWeekend, staffingEntries]);

  const hasViolations = stats.some(
    d => d.fte > 0 && (d.fgCount > d.fgLimit || d.bgCount > d.bgLimit || d.weekendCount > d.weekendLimit || d.maxStreak > 12)
  );

  return (
    <div className="space-y-6">
      {/* Compliance Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-indigo-500" />
              Bereitschaftsdienste (FG)
            </CardTitle>
            <CardDescription>System-Limit: {limitFG} · FTE-angepasst pro Arzt</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.filter(d => d.fte > 0 && d.fgCount > d.fgLimit).length === 0 ? (
              <p className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> Keine Überschreitungen
              </p>
            ) : (
              stats.filter(d => d.fte > 0 && d.fgCount > d.fgLimit).map(d => (
                <div key={d.name} className="flex items-center justify-between py-1 text-sm">
                  <span>{d.name}</span>
                  <Badge variant="destructive">{d.fgCount} / {d.fgLimit}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-indigo-500" />
              Rufbereitschaft (BG)
            </CardTitle>
            <CardDescription>System-Limit: {limitBG} · FTE-angepasst pro Arzt</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.filter(d => d.fte > 0 && d.bgCount > d.bgLimit).length === 0 ? (
              <p className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> Keine Überschreitungen
              </p>
            ) : (
              stats.filter(d => d.fte > 0 && d.bgCount > d.bgLimit).map(d => (
                <div key={d.name} className="flex items-center justify-between py-1 text-sm">
                  <span>{d.name}</span>
                  <Badge variant="destructive">{d.bgCount} / {d.bgLimit}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-indigo-500" />
              Wochenend-Dienste
            </CardTitle>
            <CardDescription>System-Limit: {limitWeekend}</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.filter(d => d.fte > 0 && d.weekendCount > d.weekendLimit).length === 0 ? (
              <p className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> Keine Überschreitungen
              </p>
            ) : (
              stats.filter(d => d.fte > 0 && d.weekendCount > d.weekendLimit).map(d => (
                <div key={d.name} className="flex items-center justify-between py-1 text-sm">
                  <span>{d.name}</span>
                  <Badge variant="destructive">{d.weekendCount} / {d.weekendLimit}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Consecutive days warning */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Längste Arbeitsphasen
          </CardTitle>
          <CardDescription>Max. aufeinanderfolgende Arbeitstage — Warnung ab 13 Tagen</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...stats].sort((a, b) => b.maxStreak - a.maxStreak).slice(0, 8).map(doc => (
              <div key={doc.name} className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{doc.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {doc.maxStreak > 12 && <Badge variant="destructive">Warnung</Badge>}
                  <span className={`text-sm font-bold ${doc.maxStreak > 12 ? 'text-red-600' : 'text-slate-700'}`}>
                    {doc.maxStreak} Tage
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Main Compliance Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Limit-Compliance pro Arzt</CardTitle>
              <CardDescription>
                Dienst-Limits im gewählten Zeitraum
                {!hasViolations && ' — alle Limits eingehalten'}
              </CardDescription>
            </div>
            {!hasViolations && <CheckCircle2 className="h-8 w-8 text-green-500" />}
            {hasViolations && <AlertTriangle className="h-8 w-8 text-amber-500" />}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arzt</TableHead>
                <TableHead className="text-right">VK</TableHead>
                <TableHead className="text-right">FG Ist</TableHead>
                <TableHead className="text-right">FG Limit</TableHead>
                <TableHead className="text-right">BG Ist</TableHead>
                <TableHead className="text-right">BG Limit</TableHead>
                <TableHead className="text-right">WE Ist</TableHead>
                <TableHead className="text-right">WE Limit</TableHead>
                <TableHead className="text-right">Max. Serie</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.filter(d => d.fte > 0).map(doc => {
                const fgExceeded = doc.fgCount > doc.fgLimit;
                const bgExceeded = doc.bgCount > doc.bgLimit;
                const weekendExceeded = doc.weekendCount > doc.weekendLimit;
                const streakWarning = doc.maxStreak > 12;
                const hasIssue = fgExceeded || bgExceeded || weekendExceeded || streakWarning;

                return (
                  <TableRow key={doc.name} className={hasIssue ? 'bg-red-50/50' : undefined}>
                    <TableCell className="font-medium">{doc.name}</TableCell>
                    <TableCell className="text-right text-xs text-slate-500">{doc.fte}</TableCell>
                    <TableCell className={`text-right ${fgExceeded ? 'text-red-600 font-bold' : ''}`}>{doc.fgCount}</TableCell>
                    <TableCell className="text-right text-slate-500">{doc.fgLimit}</TableCell>
                    <TableCell className={`text-right ${bgExceeded ? 'text-red-600 font-bold' : ''}`}>{doc.bgCount}</TableCell>
                    <TableCell className="text-right text-slate-500">{doc.bgLimit}</TableCell>
                    <TableCell className={`text-right ${weekendExceeded ? 'text-red-600 font-bold' : ''}`}>{doc.weekendCount}</TableCell>
                    <TableCell className="text-right text-slate-500">{doc.weekendLimit}</TableCell>
                    <TableCell className={`text-right ${streakWarning ? 'text-red-600 font-bold' : ''}`}>{doc.maxStreak}</TableCell>
                    <TableCell className="text-right">
                      {fgExceeded && <Badge variant="destructive" className="mr-0.5 text-xs">FG</Badge>}
                      {bgExceeded && <Badge variant="destructive" className="mr-0.5 text-xs">BG</Badge>}
                      {weekendExceeded && <Badge variant="destructive" className="mr-0.5 text-xs">WE</Badge>}
                      {streakWarning && <Badge variant="destructive" className="mr-0.5 text-xs">Serie</Badge>}
                      {!hasIssue && <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">OK</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}