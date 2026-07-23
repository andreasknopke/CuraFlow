import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CalendarX2, Loader2, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ABSENCE_TYPES, ABSENCE_TYPE_ORDER, UNKNOWN_ABSENCE_TYPE } from '@/master/utils/absenceTypes';
import { toMonthlyTypeData, toTypeShareData } from '@/master/utils/absenceChartUtils';
import type { AbsenceStatsData } from '@/types/master';

const MONTH_SHORT_LABELS = [
  'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
];

const MONTHS_FULL = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

interface MasterAbsenceChartsProps {
  stats: AbsenceStatsData | undefined;
  isLoading: boolean;
  year: string;
  /** 'all' for the full year, otherwise '01'–'12'. */
  month: string;
}

/**
 * Yearly absence charts for the master frontend, analogous to the
 * AbsenceReport charts in the tenant statistics area:
 *  - stacked bar chart: absence days per month and type (full year,
 *    with the currently selected month highlighted)
 *  - donut chart: yearly/monthly distribution across absence types
 */
export default function MasterAbsenceCharts({ stats, isLoading, year, month }: MasterAbsenceChartsProps) {
  const selectedMonth = month === 'all' ? 'all' : parseInt(month, 10);

  const monthlyData = useMemo(() => {
    if (!stats) return [];
    const points = toMonthlyTypeData(stats.monthly, ABSENCE_TYPE_ORDER);
    // Client-side labels ensure consistent German short month names
    return points.map((p) => ({ ...p, label: MONTH_SHORT_LABELS[p.month - 1] ?? p.label }));
  }, [stats]);

  const shareData = useMemo(() => {
    if (!stats) return [];
    if (selectedMonth === 'all') {
      return toTypeShareData(stats.byType, ABSENCE_TYPE_ORDER);
    }
    const monthPoint = stats.monthly.find((p) => p.month === selectedMonth);
    return toTypeShareData(monthPoint?.days ?? {}, ABSENCE_TYPE_ORDER);
  }, [stats, selectedMonth]);

  const totalDaysInScope = useMemo(
    () => shareData.reduce((sum, p) => sum + p.days, 0),
    [shareData],
  );

  const yearlyTotal = useMemo(
    () =>
      stats
        ? ABSENCE_TYPE_ORDER.reduce((sum, t) => sum + (stats.byType[t] ?? 0), 0)
        : 0,
    [stats],
  );

  const scopeLabel =
    selectedMonth === 'all'
      ? `Gesamtjahr ${year}`
      : `${MONTHS_FULL[selectedMonth - 1] ?? ''} ${year}`;

  return (
    <Card data-testid="master-absence-charts">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarX2 className="w-5 h-5" />
              Fehlzeiten im Jahresverlauf {year}
            </CardTitle>
            <CardDescription>
              Abwesenheitstage nach Typ und Monat
              {selectedMonth !== 'all' && ' — ausgewählter Monat ist hervorgehoben'}
            </CardDescription>
          </div>
          {stats && stats.staffCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
              <Users className="w-3.5 h-3.5" />
              {stats.staffCount} Mitarbeitende
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Diagrammdaten werden geladen…
          </div>
        ) : yearlyTotal === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <CalendarX2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Keine Fehlzeiten im ausgewählten Zeitraum.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Monthly stacked bar chart */}
            <div className="lg:col-span-2 rounded-lg border bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">
                Abwesenheitstage pro Monat ({scopeLabel})
              </h3>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(value) => [`${value} Tage`]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                    {ABSENCE_TYPE_ORDER.map((type) => (
                      <Bar
                        key={type}
                        dataKey={type}
                        stackId="absences"
                        fill={(ABSENCE_TYPES[type] ?? UNKNOWN_ABSENCE_TYPE).hex}
                        maxBarSize={36}
                      >
                        {monthlyData.map((point) => (
                          <Cell
                            key={point.month}
                            fillOpacity={
                              selectedMonth === 'all' || point.month === selectedMonth ? 1 : 0.25
                            }
                          />
                        ))}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Distribution donut */}
            <div className="rounded-lg border bg-white p-4 flex flex-col">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">
                Verteilung nach Typ ({scopeLabel})
              </h3>
              <div className="relative h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={shareData}
                      dataKey="days"
                      nameKey="type"
                      innerRadius="60%"
                      outerRadius="90%"
                      paddingAngle={2}
                      strokeWidth={1}
                    >
                      {shareData.map((slice) => (
                        <Cell
                          key={slice.type}
                          fill={(ABSENCE_TYPES[slice.type] ?? UNKNOWN_ABSENCE_TYPE).hex}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(value, name, entry) => {
                        const share = (entry.payload as { share?: number }).share ?? 0;
                        return [`${value} Tage (${share} %)`, name];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-slate-900">{totalDaysInScope}</span>
                  <span className="text-xs text-slate-500">Tage</span>
                </div>
              </div>
              <ul className="mt-4 space-y-1.5">
                {shareData.map((slice) => (
                  <li key={slice.type} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: (ABSENCE_TYPES[slice.type] ?? UNKNOWN_ABSENCE_TYPE).hex }}
                    />
                    <span className="flex-1 text-slate-600">{slice.type}</span>
                    <span className="font-semibold text-slate-900">{slice.days}</span>
                    <span className="w-10 text-right text-slate-400">{slice.share} %</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
