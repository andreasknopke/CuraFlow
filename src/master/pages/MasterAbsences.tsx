import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CalendarX2, Loader2 } from 'lucide-react';
import MasterAbsenceCharts from '@/master/components/MasterAbsenceCharts';
import { ABSENCE_TYPES } from '@/master/utils/absenceTypes';
import type { Tenant, AbsenceEntry, AbsenceSummary, AbsenceStatsData } from '@/types/master';

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export default function MasterAbsences() {
  const [selectedTenant, setSelectedTenant] = useState('all');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState((new Date().getMonth() + 1).toString().padStart(2, '0'));

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = new Set<number>([2024, currentYear - 1, currentYear, currentYear + 1]);
    return [...years].sort((a, b) => a - b);
  }, []);

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['master-tenants'],
    queryFn: async () => {
      try {
        return (await api.request('/api/admin/db-tokens')) as Tenant[];
      } catch {
        return [];
      }
    },
  });

  const isFullYear = selectedMonth === 'all';

  const { data: absenceData, isLoading } = useQuery<{ entries: AbsenceEntry[]; summary: AbsenceSummary }>({
    queryKey: ['master-absences', selectedTenant, selectedYear, selectedMonth],
    queryFn: async () => {
      try {
        const params = new URLSearchParams({
          year: selectedYear,
          ...(selectedTenant !== 'all' && { tenantId: selectedTenant }),
          ...(!isFullYear && { month: selectedMonth }),
        });
        return (await api.request(`/api/master/absences?${params}`)) as { entries: AbsenceEntry[]; summary: AbsenceSummary };
      } catch {
        return { entries: [], summary: {} };
      }
    },
  });

  // Yearly aggregated stats for the charts (analogous to tenant statistics)
  const { data: absenceStats, isLoading: isLoadingStats } = useQuery<AbsenceStatsData>({
    queryKey: ['master-absence-stats', selectedTenant, selectedYear],
    queryFn: async () => {
      try {
        const params = new URLSearchParams({
          year: selectedYear,
          ...(selectedTenant !== 'all' && { tenantId: selectedTenant }),
        });
        return (await api.request(`/api/master/absence-stats?${params}`)) as AbsenceStatsData;
      } catch {
        return { monthly: [], byType: {}, staffCount: 0 };
      }
    },
  });

  const entries = absenceData?.entries ?? [];
  const summary = absenceData?.summary ?? {};
  const periodLabel = isFullYear ? `Gesamtjahr ${selectedYear}` : `${MONTHS[parseInt(selectedMonth) - 1]} ${selectedYear}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Fehlzeiten</h1>
        <p className="text-slate-500 mt-1">
          Übersicht aller Abwesenheiten und Fehlzeiten über alle Mandanten
        </p>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedTenant} onValueChange={setSelectedTenant}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Mandant" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Mandanten</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedYear} onValueChange={setSelectedYear}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Ganzes Jahr</SelectItem>
            {MONTHS.map((name, i) => (
              <SelectItem key={i} value={(i + 1).toString().padStart(2, '0')}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Diagramme (Jahresverlauf, analog zum Statistikbereich der Mandanten) */}
      <MasterAbsenceCharts
        stats={absenceStats}
        isLoading={isLoadingStats}
        year={selectedYear}
        month={selectedMonth}
      />

      {/* Zusammenfassung nach Typ */}
      {Object.keys(summary).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {Object.entries(ABSENCE_TYPES).map(([type, config]) => (
            <div key={type} className={`p-3 rounded-lg ${config.color}`}>
              <div className="text-xs opacity-70">{config.icon} {type}</div>
              <div className="text-xl font-bold mt-1">{summary[type] ?? 0}</div>
              <div className="text-xs opacity-60">Tage</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabelle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarX2 className="w-5 h-5" />
            Fehlzeiten {periodLabel}
          </CardTitle>
          <CardDescription>
            Detaillierte Auflistung aller Abwesenheiten
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Daten werden geladen…
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <CalendarX2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Keine Fehlzeiten im ausgewählten Zeitraum.</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mandant</TableHead>
                    <TableHead>Mitarbeiter</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead>Datum</TableHead>
                    <TableHead>Bemerkung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry, i) => {
                    const config = ABSENCE_TYPES[entry.type as keyof typeof ABSENCE_TYPES] || { color: 'bg-slate-100 text-slate-800' };
                    return (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{entry.tenantName}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">{entry.staffName}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.color}`}>
                            {entry.type}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{entry.date}</TableCell>
                        <TableCell className="text-sm text-slate-500 max-w-[200px] truncate">
                          {entry.note || '–'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
