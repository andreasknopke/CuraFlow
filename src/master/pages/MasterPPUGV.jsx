import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import {
  BarChart3,
  RefreshCw,
  Loader2,
  AlertCircle,
  Calendar,
  Activity,
  Server,
  Clock,
} from 'lucide-react';

const MONTH_ORDER = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

const CHART_COLORS = {
  pflegekraefte: '#6366f1',
  hilfskraefte: '#f59e0b',
  hebammen: '#ec4899',
  belegung: '#10b981',
  patienten: '#3b82f6',
};

function formatDecimal(value) {
  return Number(value || 0).toFixed(2);
}

export default function MasterPPUGV() {
  const queryClient = useQueryClient();
  const [selectedStation, setSelectedStation] = useState('all');
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [chartMode, setChartMode] = useState('staffing');
  const [refreshStarted, setRefreshStarted] = useState(false);
  const pollIntervalRef = useRef(null);

  // Stationen laden
  const { data: stationsData } = useQuery({
    queryKey: ['ppugv-stations'],
    queryFn: async () => {
      try {
        return await api.request('/api/master/ppugv/stations');
      } catch {
        return { stations: [] };
      }
    },
  });

  const stations = stationsData?.stations ?? [];

  // PPUGV-Daten laden – auto-poll wenn building
  const { data, isLoading, isError, error, refetch: refetchData } = useQuery({
    queryKey: ['ppugv-data', selectedStation, selectedYear],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedStation && selectedStation !== 'all') params.set('station', selectedStation);
      if (selectedYear) params.set('jahr', selectedYear);
      const qs = params.toString();
      const result = await api.request(`/api/master/ppugv${qs ? `?${qs}` : ''}`);

      // Wenn building, aktivieren wir den Poll-Intervall im naechsten Render
      if (result?.building) {
        setRefreshStarted(true);
      } else if (result?.data?.length > 0) {
        setRefreshStarted(false);
      }

      return result;
    },
    // Pollt alle 10s wenn Cache gerade im Aufbau ist – der Client erfaehrt
    // ueber `building` im Response, ob ein Hintergrund-Refresh laeuft.
    // Sobald Daten da sind, stoppt TanStack Query das Pollen von selbst,
    // da sich der Cache key nicht aendert.
    refetchInterval: (query) => {
      const state = query.state.data;
      if (state?.building) return 10000; // alle 10s poll waehrend Aufbau
      return false; // ausgeschaltet wenn Daten da sind
    },
  });

  const rows = data?.data ?? [];
  const meta = data?.meta;
  const isBuilding = data?.building === true;
  const isFirstLoad = !isLoading && rows.length === 0 && !isBuilding;

  // Cache-Refresh – der Server antwortet sofort mit 202 Accepted
  const refreshMutation = useMutation({
    mutationFn: async () => {
      setRefreshStarted(true);
      return await api.request('/api/master/ppugv/refresh', { method: 'POST' });
    },
    onSettled: () => {
      // Nicht sofort invalidieren – der Refresh laeuft ja noch im Hintergrund.
      // Stattdessen starten wir den Poll-Mechanismus ueber die refetchInterval-Logik.
      queryClient.invalidateQueries({ queryKey: ['ppugv-meta'] });
    },
  });

  // Cleanup beim Unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Daten fuer Diagramm aufbereiten
  const chartData = useCallback(() => {
    const monthMap = new Map();

    let filteredRows = rows;
    if (selectedStation !== 'all') {
      filteredRows = rows.filter(r => r.stationsname === selectedStation);
    }

    for (const row of filteredRows) {
      const monthIndex = MONTH_ORDER.indexOf(row.monat);
      if (monthIndex === -1) continue;

      if (!monthMap.has(row.monat)) {
        monthMap.set(row.monat, {
          name: row.monat,
          monthIndex,
          pflege_tag: 0,
          pflege_nacht: 0,
          hilfe_tag: 0,
          hilfe_nacht: 0,
          hebamme_tag: 0,
          hebamme_nacht: 0,
          belegung_tag: 0,
          belegung_nacht: 0,
          patienten_tag: 0,
          patienten_nacht: 0,
        });
      }

      const entry = monthMap.get(row.monat);
      if (row.schicht === 'Tag') {
        entry.pflege_tag += Number(row.pflegekraefte_ist);
        entry.hilfe_tag += Number(row.hilfskraefte_ist);
        entry.hebamme_tag += Number(row.hebammen_ist);
        entry.belegung_tag += Number(row.belegung);
        entry.patienten_tag += Number(row.patienten);
      } else if (row.schicht === 'Nacht') {
        entry.pflege_nacht += Number(row.pflegekraefte_ist);
        entry.hilfe_nacht += Number(row.hilfskraefte_ist);
        entry.hebamme_nacht += Number(row.hebammen_ist);
        entry.belegung_nacht += Number(row.belegung);
        entry.patienten_nacht += Number(row.patienten);
      }
    }

    return Array.from(monthMap.values())
      .sort((a, b) => a.monthIndex - b.monthIndex);
  }, [rows, selectedStation]);

  const getLastRefreshStatus = () => {
    if (!meta) return { label: 'Nicht geladen', color: 'bg-gray-100 text-gray-600', icon: Server };
    if (isBuilding || meta.status === 'running') {
      return { label: 'Cache wird im Hintergrund aufgebaut…', color: 'bg-blue-100 text-blue-700 animate-pulse', icon: Loader2 };
    }
    if (meta.status === 'error') {
      return { label: `Fehler: ${meta.error_message || 'Unbekannt'}`, color: 'bg-red-100 text-red-700', icon: AlertCircle };
    }
    const date = meta.refreshed_at ? new Date(meta.refreshed_at).toLocaleString('de-DE') : 'Unbekannt';
    return { label: `Stand: ${date} (${meta.row_count} Datensätze)`, color: 'bg-green-100 text-green-700', icon: Clock };
  };

  const statusInfo = getLastRefreshStatus();
  const StatusIcon = statusInfo.icon;

  // Jahre fuer Dropdown
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => String(currentYear - 3 + i));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">PPUGV-Statistik</h1>
          <p className="text-slate-500 mt-1">
            Pflegepersonaluntergrenzen-Verordnung – Monatliche Auswertung
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-xs ${statusInfo.color} flex items-center gap-1`}>
            <StatusIcon className={`w-3 h-3 ${isBuilding || meta?.status === 'running' ? 'animate-spin' : ''}`} />
            {statusInfo.label}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending || isBuilding}
          >
            {refreshMutation.isPending || isBuilding ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-1" />
            )}
            {isBuilding ? 'Wird geladen…' : 'Aktualisieren'}
          </Button>
        </div>
      </div>

      {/* Building-Banner (nur bei erstmaligem/leerem Cache) */}
      {isBuilding && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-blue-900 text-sm">PPUGV-Cache wird im Hintergrund aufgebaut</p>
            <p className="text-blue-700 text-sm mt-1">
              Die Daten werden aus der ppugv-Datenbank abgerufen. Dies kann bis zu 15 Minuten dauern.
              Du kannst CuraFlow währenddessen ganz normal weiter nutzen.
              Die Seite lädt automatisch neu, sobald die Daten verfügbar sind.
            </p>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-slate-400" />
          <Select value={selectedStation} onValueChange={setSelectedStation}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Station" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Stationen</SelectItem>
              {stations.map((s) => (
                <SelectItem key={s.stationsname} value={s.stationsname}>
                  {s.stationsname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-24">
              <SelectValue placeholder="Jahr" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 ml-2">
          <BarChart3 className="w-4 h-4 text-slate-400" />
          <Select value={chartMode} onValueChange={setChartMode}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Diagramm" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="staffing">Personalbesetzung</SelectItem>
              <SelectItem value="occupancy">Belegung & Patienten</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Diagramm */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {chartMode === 'staffing'
              ? 'Durchschnittliche Personalbesetzung (VK)'
              : 'Belegungstage & Patientenzahlen'}
          </CardTitle>
          <CardDescription>
            {selectedStation !== 'all' ? selectedStation : 'Alle Stationen'} – {selectedYear}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 py-8 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <span>Fehler beim Laden: {error?.message}</span>
            </div>
          ) : chartData().length === 0 && !isBuilding ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <BarChart3 className="w-8 h-8 mr-2" />
              <span>Keine Daten für die aktuelle Auswahl. Klicke auf "Aktualisieren", um den Cache zu füllen.</span>
            </div>
          ) : chartData().length === 0 && isBuilding ? (
            <div className="flex items-center justify-center py-12 text-blue-500">
              <Loader2 className="w-8 h-8 mr-2 animate-spin" />
              <span>Cache wird aufgebaut – Daten erscheinen automatisch…</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              {chartMode === 'staffing' ? (
                <BarChart data={chartData()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="pflege_tag"
                    name="Pflegekräfte (Tag)"
                    fill={CHART_COLORS.pflegekraefte}
                    radius={[2, 2, 0, 0]}
                  />
                  <Bar
                    dataKey="hilfe_tag"
                    name="Hilfskräfte (Tag)"
                    fill={CHART_COLORS.hilfskraefte}
                    radius={[2, 2, 0, 0]}
                  />
                  <Bar
                    dataKey="hebamme_tag"
                    name="Hebammen (Tag)"
                    fill={CHART_COLORS.hebammen}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              ) : (
                <LineChart data={chartData()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="patienten_tag"
                    name="Patienten (Tag)"
                    stroke={CHART_COLORS.patienten}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="belegung_tag"
                    name="Belegung (Tag)"
                    stroke={CHART_COLORS.belegung}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Datentabelle */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Monatsdaten
          </CardTitle>
          <CardDescription>
            {data?.count ?? 0} Datensätze – Tag- und Nachtschicht pro Station und Monat
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            </div>
          ) : rows.length === 0 && isBuilding ? (
            <div className="text-center py-8 text-blue-500 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Cache wird im Hintergrund aufgebaut. Bitte warten…</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>Keine gecachten PPUGV-Daten vorhanden.</p>
              <p className="text-sm mt-1">Klicke auf "Aktualisieren", um den Cache im Hintergrund zu füllen.<br />
              Der Abruf aus der ppugv-Datenbank kann bis zu 15 Minuten dauern – CuraFlow bleibt dabei voll nutzbar.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Station</TableHead>
                    <TableHead>Monat</TableHead>
                    <TableHead>Schicht</TableHead>
                    <TableHead className="text-right">Patienten</TableHead>
                    <TableHead className="text-right">Belegung %</TableHead>
                    <TableHead className="text-right">Pflegekräfte (VK)</TableHead>
                    <TableHead className="text-right">Hebammen (VK)</TableHead>
                    <TableHead className="text-right">Hilfskräfte (VK)</TableHead>
                    <TableHead>Frostung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, idx) => (
                    <TableRow key={row.id || idx}>
                      <TableCell className="font-medium whitespace-nowrap">{row.stationsname}</TableCell>
                      <TableCell>{row.monat}</TableCell>
                      <TableCell>
                        <Badge variant={row.schicht === 'Nacht' ? 'secondary' : 'default'} className="text-xs">
                          {row.schicht}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{row.patienten}</TableCell>
                      <TableCell className="text-right">{formatDecimal(row.belegung)}</TableCell>
                      <TableCell className="text-right">{formatDecimal(row.pflegekraefte_ist)}</TableCell>
                      <TableCell className="text-right">{formatDecimal(row.hebammen_ist)}</TableCell>
                      <TableCell className="text-right">{formatDecimal(row.hilfskraefte_ist)}</TableCell>
                      <TableCell>
                        {row.frostung === 'ja' ? (
                          <Badge variant="outline" className="text-green-700 bg-green-50 text-xs border-green-200">
                            ✓ Frostung
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">–</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
