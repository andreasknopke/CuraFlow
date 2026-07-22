import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { CalendarX2, ArrowUpDown, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';
import { useHolidays } from '@/components/useHolidays';
import { computeAbsenceStats } from '@/components/statistics/absenceStatsUtils';
import type { AbsenceRow, AbsenceStats } from '@/components/statistics/absenceStatsUtils';
import type { Doctor, ShiftEntry } from '@/types';

// ── Constants ──────────────────────────────────────────────────────────────

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

type SortKey = 'name' | 'role' | 'sickDays' | 'businessTripDays' | 'totalDays';
type SortDir = 'asc' | 'desc';

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Mitarbeiter',
  role: 'Funktion',
  sickDays: 'Krank',
  businessTripDays: 'Dienstreise',
  totalDays: 'Gesamt',
};

// ── Sub-components ─────────────────────────────────────────────────────────

function DeviationBadge({ value, avg, label }: { value: number; avg: number; label: string }) {
  const delta = value - avg;
  if (Math.abs(delta) < 0.05) {
    return <span className="text-xs text-slate-400 ml-1">{label} ±0</span>;
  }
  const isAbove = delta > 0;
  const sign = isAbove ? '+' : '';
  return (
    <span
      className={`text-xs ml-1 inline-flex items-center gap-0.5 ${
        isAbove ? 'text-red-600' : 'text-green-600'
      }`}
      title={`${label}: ${sign}${delta.toFixed(1)}`}
    >
      {isAbove ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {sign}{delta.toFixed(1)}
    </span>
  );
}

function SortIcon({ column, activeKey, dir }: { column: SortKey; activeKey: SortKey; dir: SortDir }) {
  if (column !== activeKey) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
  return dir === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
}

// ── Main component ─────────────────────────────────────────────────────────

export default function AbsenceReport() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear.toString());
  const [month, setMonth] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const yearNum = parseInt(year, 10);
  const monthNum = month === 'all' ? 'all' : parseInt(month, 10);

  // Team roles for filtering & sorting
  const { statisticsExcludedRoles, rolePriority } = useTeamRoles();

  // Public holidays for working-day computation
  const { isPublicHoliday: isPublicHolidayFn, isLoading: isLoadingHolidays } = useHolidays(yearNum);
  const isPublicHoliday = useCallback(
    (dateStr: string) => Boolean(isPublicHolidayFn(new Date(dateStr + 'T12:00:00'))),
    [isPublicHolidayFn],
  );

  // ── Data fetching ──────────────────────────────────────────────────────

  const { data: doctors = [], isLoading: isLoadingDocs } = useQuery({
    queryKey: ['doctors', statisticsExcludedRoles],
    queryFn: () => db.Doctor.list(),
    select: (data: Doctor[]) =>
      data
        .filter((d) => !statisticsExcludedRoles.includes(d.role || ''))
        .sort((a, b) => {
          const pa = rolePriority[a.role ?? ''] ?? 99;
          const pb = rolePriority[b.role ?? ''] ?? 99;
          if (pa !== pb) return pa - pb;
          return a.name.localeCompare(b.name);
        }),
  });

  const { data: shifts = [], isLoading: isLoadingShifts } = useQuery({
    queryKey: ['shifts', year],
    queryFn: async () => {
      try {
        return ((await db.ShiftEntry.filter({
          date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
        })) || []) as ShiftEntry[];
      } catch {
        const all = (await db.ShiftEntry.list()) as ShiftEntry[];
        return all.filter((s) => s.date.startsWith(year));
      }
    },
  });

  const isLoading = isLoadingDocs || isLoadingShifts || isLoadingHolidays;

  // ── Aggregation ────────────────────────────────────────────────────────

  const stats: AbsenceStats = useMemo(() => {
    if (isLoading) return { rows: [], tenantAvgSick: 0, tenantAvgTrip: 0, roleAverages: {} };
    return computeAbsenceStats({
      doctors,
      shifts,
      year: yearNum,
      month: monthNum,
      isPublicHoliday,
    });
  }, [doctors, shifts, yearNum, monthNum, isPublicHoliday, isLoading]);

  // ── Sorting ────────────────────────────────────────────────────────────

  const sortedRows: AbsenceRow[] = useMemo(() => {
    const sorted = [...stats.rows];
    const dir = sortDir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      let cmp: number;
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortKey === 'role') {
        const pa = rolePriority[a.role] ?? 99;
        const pb = rolePriority[b.role] ?? 99;
        cmp = pa !== pb ? pa - pb : a.name.localeCompare(b.name);
      } else {
        cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return cmp * dir;
    });
    return sorted;
  }, [stats.rows, sortKey, sortDir, rolePriority]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc'); // Numeric columns default descending
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const totalSick = stats.rows.reduce((s, r) => s + r.sickDays, 0);
  const totalTrip = stats.rows.reduce((s, r) => s + r.businessTripDays, 0);

  return (
    <Card data-testid="absence-report">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarX2 className="w-5 h-5" />
              Fehlzeiten
            </CardTitle>
            <CardDescription>
              Krank (nur Arbeitstage) und Dienstreise (alle Kalendertage)
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-[100px]" data-testid="absence-report-year-trigger">
                <SelectValue placeholder="Jahr" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: currentYear - 2023 + 1 }, (_, i) => currentYear - i).map(
                  (y) => (
                    <SelectItem key={y} value={y.toString()}>
                      {y}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-[140px]" data-testid="absence-report-month-trigger">
                <SelectValue placeholder="Monat" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Ganzes Jahr</SelectItem>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i} value={i.toString()}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-red-50 rounded-lg">
            <div className="text-sm text-red-600">Kranktage gesamt</div>
            <div className="text-2xl font-bold text-red-900">{totalSick}</div>
          </div>
          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="text-sm text-blue-600">Dienstreisetage gesamt</div>
            <div className="text-2xl font-bold text-blue-900">{totalTrip}</div>
          </div>
          <div className="p-4 bg-red-50/50 rounded-lg">
            <div className="text-sm text-red-600/80">Ø Krank / Person</div>
            <div className="text-2xl font-bold text-red-900/80">
              {stats.tenantAvgSick.toFixed(1)}
            </div>
          </div>
          <div className="p-4 bg-blue-50/50 rounded-lg">
            <div className="text-sm text-blue-600/80">Ø Dienstreise / Person</div>
            <div className="text-2xl font-bold text-blue-900/80">
              {stats.tenantAvgTrip.toFixed(1)}
            </div>
          </div>
        </div>

        {/* Table */}
        <ScrollArea className="h-[600px] rounded-md border">
          <Table data-testid="absence-report-table">
            <TableHeader>
              <TableRow>
                {(['name', 'role', 'sickDays', 'businessTripDays', 'totalDays'] as SortKey[]).map(
                  (key) => (
                    <TableHead
                      key={key}
                      className={
                        key === 'sickDays' || key === 'businessTripDays' || key === 'totalDays'
                          ? 'text-right cursor-pointer select-none'
                          : 'cursor-pointer select-none'
                      }
                      data-testid={`absence-report-header-${key}`}
                      onClick={() => handleSort(key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {SORT_LABELS[key]}
                        <SortIcon column={key} activeKey={sortKey} dir={sortDir} />
                      </span>
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                    Daten werden geladen...
                  </TableCell>
                </TableRow>
              ) : sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                    Keine Daten für den ausgewählten Zeitraum.
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((row) => {
                  const roleAvg = stats.roleAverages[row.role || '(ohne Funktion)'];
                  return (
                    <TableRow key={row.doctorId}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {row.role || '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-semibold">{row.sickDays}</span>
                        <br />
                        <DeviationBadge value={row.sickDays} avg={stats.tenantAvgSick} label="Ø Abt" />
                        {roleAvg && (
                          <DeviationBadge value={row.sickDays} avg={roleAvg.sick} label="Ø Funkt" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-semibold">{row.businessTripDays}</span>
                        <br />
                        <DeviationBadge
                          value={row.businessTripDays}
                          avg={stats.tenantAvgTrip}
                          label="Ø Abt"
                        />
                        {roleAvg && (
                          <DeviationBadge
                            value={row.businessTripDays}
                            avg={roleAvg.trip}
                            label="Ø Funkt"
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right font-bold">{row.totalDays}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </ScrollArea>

        {/* Footer row with averages */}
        {!isLoading && sortedRows.length > 0 && (
          <div className="mt-2 text-xs text-slate-500 flex gap-6 justify-end">
            <span>
              Ø Abteilung: Krank {stats.tenantAvgSick.toFixed(1)} · Dienstreise{' '}
              {stats.tenantAvgTrip.toFixed(1)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
