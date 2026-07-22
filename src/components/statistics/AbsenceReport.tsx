import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { CalendarX2, ArrowUpDown, ArrowUp, ArrowDown, Loader2, TriangleAlert } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';
import { useHolidays } from '@/components/useHolidays';
import { computeAbsenceStats, computeMonthlyStats } from '@/components/statistics/absenceStatsUtils';
import type { AbsenceRow, AbsenceStats, MonthlyStatsPoint } from '@/components/statistics/absenceStatsUtils';
import type { Doctor, ShiftEntry } from '@/types';

// ── Constants ──────────────────────────────────────────────────────────────

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

export default function AbsenceReport({ year, month }: { year: string; month: string }) {
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
    if (isLoading) return { rows: [], tenantAvgSick: 0, tenantAvgTrip: 0, tenantAvgSickNoOutliers: 0, tenantAvgTripNoOutliers: 0, roleAverages: {} };
    return computeAbsenceStats({
      doctors,
      shifts,
      year: yearNum,
      month: monthNum,
      isPublicHoliday,
    });
  }, [doctors, shifts, yearNum, monthNum, isPublicHoliday, isLoading]);

  // ── Monthly chart data ─────────────────────────────────────────────────

  const monthlyStats: MonthlyStatsPoint[] = useMemo(() => {
    if (isLoading) return [];
    return computeMonthlyStats(doctors, shifts, yearNum, isPublicHoliday);
  }, [doctors, shifts, yearNum, isPublicHoliday, isLoading]);

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
  const totalSickNoOutliers = stats.rows
    .filter((r) => !r.isSickOutlier)
    .reduce((s, r) => s + r.sickDays, 0);
  const totalTripNoOutliers = stats.rows
    .filter((r) => !r.isTripOutlier)
    .reduce((s, r) => s + r.businessTripDays, 0);
  const hasOutliers = stats.rows.some((r) => r.isSickOutlier || r.isTripOutlier);

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

        </div>
      </CardHeader>

      <CardContent>
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-red-50 rounded-lg">
            <div className="text-sm text-red-600">Kranktage gesamt</div>
            <div className="text-2xl font-bold text-red-900">{totalSick}</div>
            {hasOutliers && (
              <div className="text-xs text-red-500/70 mt-0.5">
                ohne Ausreißer: {totalSickNoOutliers}
              </div>
            )}
          </div>
          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="text-sm text-blue-600">Dienstreisetage gesamt</div>
            <div className="text-2xl font-bold text-blue-900">{totalTrip}</div>
            {hasOutliers && (
              <div className="text-xs text-blue-500/70 mt-0.5">
                ohne Ausreißer: {totalTripNoOutliers}
              </div>
            )}
          </div>
          <div className="p-4 bg-red-50/50 rounded-lg">
            <div className="text-sm text-red-600/80">Ø Krank / Person</div>
            <div className="text-2xl font-bold text-red-900/80">
              {stats.tenantAvgSick.toFixed(1)}
            </div>
            {hasOutliers && stats.tenantAvgSickNoOutliers !== stats.tenantAvgSick && (
              <div className="text-xs text-red-500/70 mt-0.5">
                ohne Ausreißer: {stats.tenantAvgSickNoOutliers.toFixed(1)}
              </div>
            )}
          </div>
          <div className="p-4 bg-blue-50/50 rounded-lg">
            <div className="text-sm text-blue-600/80">Ø Dienstreise / Person</div>
            <div className="text-2xl font-bold text-blue-900/80">
              {stats.tenantAvgTrip.toFixed(1)}
            </div>
            {hasOutliers && stats.tenantAvgTripNoOutliers !== stats.tenantAvgTrip && (
              <div className="text-xs text-blue-500/70 mt-0.5">
                ohne Ausreißer: {stats.tenantAvgTripNoOutliers.toFixed(1)}
              </div>
            )}
          </div>
        </div>

        {/* Monthly trend charts */}
        {!isLoading && monthlyStats.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Krank chart */}
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-sm font-semibold text-red-700 mb-3">
                Ø Kranktage pro Person — Monatsverlauf {year}
              </h3>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthlyStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend
                      wrapperStyle={{ fontSize: '12px' }}
                      payload={[
                        { value: 'Ø Krank', type: 'line', color: '#dc2626' },
                        { value: 'Ø Krank (ohne Ausreißer)', type: 'line', color: '#f87171' },
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgSick"
                      stroke="#dc2626"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#dc2626' }}
                      name="Ø Krank"
                    />
                    <Line
                      type="monotone"
                      dataKey="avgSickNoOutliers"
                      stroke="#f87171"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ r: 3, fill: '#f87171' }}
                      name="Ø Krank (ohne Ausreißer)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Dienstreise chart */}
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-sm font-semibold text-blue-700 mb-3">
                Ø Dienstreisetage pro Person — Monatsverlauf {year}
              </h3>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthlyStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend
                      wrapperStyle={{ fontSize: '12px' }}
                      payload={[
                        { value: 'Ø Dienstreise', type: 'line', color: '#2563eb' },
                        { value: 'Ø Dienstreise (ohne Ausreißer)', type: 'line', color: '#60a5fa' },
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgTrip"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#2563eb' }}
                      name="Ø Dienstreise"
                    />
                    <Line
                      type="monotone"
                      dataKey="avgTripNoOutliers"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ r: 3, fill: '#60a5fa' }}
                      name="Ø Dienstreise (ohne Ausreißer)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

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
                        <span className={`font-semibold inline-flex items-center gap-1 ${row.isSickOutlier ? 'text-amber-700' : ''}`}>
                          {row.isSickOutlier && (
                            <TriangleAlert className="w-3.5 h-3.5 text-amber-500" title="Ausreißer" />
                          )}
                          {row.sickDays}
                        </span>
                        <br />
                        <DeviationBadge value={row.sickDays} avg={stats.tenantAvgSick} label="Ø Abt" />
                        {roleAvg && (
                          <DeviationBadge value={row.sickDays} avg={roleAvg.sick} label="Ø Funkt" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-semibold inline-flex items-center gap-1 ${row.isTripOutlier ? 'text-amber-700' : ''}`}>
                          {row.isTripOutlier && (
                            <TriangleAlert className="w-3.5 h-3.5 text-amber-500" title="Ausreißer" />
                          )}
                          {row.businessTripDays}
                        </span>
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
            {hasOutliers && (
              <span className="text-slate-400">
                ohne Ausreißer: Krank {stats.tenantAvgSickNoOutliers.toFixed(1)} · Dienstreise{' '}
                {stats.tenantAvgTripNoOutliers.toFixed(1)}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
