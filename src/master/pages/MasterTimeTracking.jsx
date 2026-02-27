import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Clock, Building2, Loader2, Info } from 'lucide-react';

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export default function MasterTimeTracking() {
  const [selectedTenant, setSelectedTenant] = useState('all');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState((new Date().getMonth() + 1).toString().padStart(2, '0'));

  // Mandanten laden
  const { data: tenants = [] } = useQuery({
    queryKey: ['master-tenants'],
    queryFn: async () => {
      try {
        return await api.request('/api/admin/db-tokens');
      } catch {
        return [];
      }
    },
  });

  // Aggregierte Zeiterfassungsdaten laden
  const { data: timeData, isLoading } = useQuery({
    queryKey: ['master-time-tracking', selectedTenant, selectedYear, selectedMonth],
    queryFn: async () => {
      try {
        const params = new URLSearchParams({
          year: selectedYear,
          month: selectedMonth,
          ...(selectedTenant !== 'all' && { tenantId: selectedTenant }),
        });
        return await api.request(`/api/master/time-tracking?${params}`);
      } catch {
        return { entries: [], summary: null };
      }
    },
  });

  const entries = timeData?.entries ?? [];
  const summary = timeData?.summary ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Zeiterfassung</h1>
        <p className="text-slate-500 mt-1">
          Manuelle Zeiterfassung und Soll/Ist-Vergleich über alle Mandanten
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
            {[2024, 2025, 2026, 2027].map((y) => (
              <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((name, i) => (
              <SelectItem key={i} value={(i + 1).toString().padStart(2, '0')}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Zusammenfassung */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard label="Mitarbeiter" value={summary.staffCount} />
          <StatCard label="Soll-Stunden" value={`${summary.totalTargetHours}h`} color="blue" />
          <StatCard label="Ist-Stunden" value={`${summary.totalActualHours}h`} color="emerald" />
          <StatCard
            label="Delta"
            value={`${summary.totalDelta > 0 ? '+' : ''}${summary.totalDelta}h`}
            color={summary.totalDelta >= 0 ? 'emerald' : 'red'}
          />
        </div>
      )}

      {/* Tabelle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Monatsübersicht {MONTHS[parseInt(selectedMonth) - 1]} {selectedYear}
          </CardTitle>
          <CardDescription className="flex items-center gap-1">
            <Info className="w-3 h-3" />
            Soll/Ist-Vergleich der Arbeitszeiten pro Mitarbeiter
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
              <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Keine Zeiterfassungsdaten vorhanden.</p>
              <p className="text-sm mt-1">Die Master-API muss noch mit den Mandanten-Datenbanken verbunden werden.</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mandant</TableHead>
                    <TableHead>Mitarbeiter</TableHead>
                    <TableHead>Rolle</TableHead>
                    <TableHead className="text-right">Soll (h)</TableHead>
                    <TableHead className="text-right">Ist (h)</TableHead>
                    <TableHead className="text-right">Delta (h)</TableHead>
                    <TableHead className="text-right">Arbeitstage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry, i) => {
                    const delta = (entry.actualHours - entry.targetHours).toFixed(1);
                    const deltaNum = parseFloat(delta);
                    return (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {entry.tenantName}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{entry.staffName}</TableCell>
                        <TableCell className="text-slate-500 text-sm">{entry.role}</TableCell>
                        <TableCell className="text-right">{entry.targetHours}</TableCell>
                        <TableCell className="text-right font-semibold">{entry.actualHours}</TableCell>
                        <TableCell className={`text-right font-semibold ${deltaNum >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {deltaNum > 0 ? '+' : ''}{delta}
                        </TableCell>
                        <TableCell className="text-right text-slate-500">{entry.workDays}</TableCell>
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

function StatCard({ label, value, color = 'slate' }) {
  const colorMap = {
    slate: 'text-slate-900',
    blue: 'text-blue-700',
    emerald: 'text-emerald-700',
    red: 'text-red-700',
  };
  return (
    <div className="p-4 bg-white rounded-lg border">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colorMap[color]}`}>{value}</p>
    </div>
  );
}
