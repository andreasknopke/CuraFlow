import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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

  TrendingUp,
  Building2,
  Table2,
  Download,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  AlertTriangle,
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
  linie1: '#6366f1',
  linie2: '#f59e0b',
  linie3: '#10b981',
  linie4: '#ec4899',
  linie5: '#8b5cf6',
};

const TABS = [
  { key: 'stations', label: 'Stationen', icon: Activity },
  { key: 'fab', label: 'Fachabteilungen', icon: Building2 },
  { key: 'trends', label: 'Jahresvergleich', icon: TrendingUp },
  { key: 'table', label: 'Detailtabelle', icon: Table2 },
];

const YEAR_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4'];

function formatDecimal(value) {
  return Number(value || 0).toFixed(2);
}

export default function MasterPPUGV() {
  const queryClient = useQueryClient();
  const [selectedStation, setSelectedStation] = useState('all');
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [chartMode, setChartMode] = useState('staffing');
  const [refreshStarted, setRefreshStarted] = useState(false);
  const [activeTab, setActiveTab] = useState('stations');
  const [selectedFab, setSelectedFab] = useState('all');
  const [trendMetric, setTrendMetric] = useState('belegung');
  const [compareYears] = useState([
    String(new Date().getFullYear() - 2),
    String(new Date().getFullYear() - 1),
    String(new Date().getFullYear()),
  ]);
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
      queryClient.invalidateQueries({ queryKey: ['ppugv-meta'] });
    },
  });

  // FAB-Daten (Fachabteilungs-Aggregation)
  const { data: fabData } = useQuery({
    queryKey: ['ppugv-fab', selectedYear],
    queryFn: async () => {
      return await api.request(`/api/master/ppugv/fabstats?jahr=${selectedYear}`);
    },
    enabled: activeTab === 'fab',
  });

  // Trend-Daten (Jahresvergleich)
  const { data: trendData, isLoading: trendLoading } = useQuery({
    queryKey: ['ppugv-trends', selectedStation, compareYears],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedStation && selectedStation !== 'all') params.set('station', selectedStation);
      params.set('jahre', compareYears.join(','));
      return await api.request(`/api/master/ppugv/trends?${params.toString()}`);
    },
    enabled: activeTab === 'trends',
  });

  // Datenqualitaets-Check
  const { data: qualityData } = useQuery({
    queryKey: ['ppugv-quality'],
    queryFn: async () => await api.request('/api/master/ppugv/quality'),
  });

  // Export-Download
  const downloadExport = useCallback(async (format) => {
    try {
      const url = `/api/master/ppugv/export/${format}?jahr=${selectedYear}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (!response.ok) throw new Error(`Export fehlgeschlagen: HTTP ${response.status}`);
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const fileName = match?.[1] || `PPUGV_${selectedYear}.${format === 'inek' ? 'xlsx' : 'csv'}`;
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('[PPUGV-Export]', err.message);
      alert('Export fehlgeschlagen: ' + err.message);
    }
  }, [selectedYear]);

  const [exportLoading, setExportLoading] = useState(null);

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

  // ===== FAB-Aufbereitung =====
  const fabRows = useMemo(() => {
    if (!fabData?.fabs) return [];
    if (selectedFab === 'all') return fabData.fabs;
    return fabData.fabs.filter(f => String(f.fabschluessel) === String(selectedFab));
  }, [fabData, selectedFab]);

  const fabOptions = useMemo(() => {
    if (!fabData?.fabs) return [];
    return fabData.fabs.map(f => ({
      value: String(f.fabschluessel),
      label: `${f.fabschluessel} – ${f.fabname}`,
    }));
  }, [fabData]);

  // ===== Trend-Aufbereitung =====
  const trendLines = useMemo(() => {
    if (!trendData?.monate) return [];
    const data = trendData.monate;
    const yrs = trendData.years || [];
    return data.map(m => {
      const entry = { monat: m.monat };
      yrs.forEach(y => { entry[`${y}`] = Number(m[`${trendMetric}_${y}`] || 0); });
      return entry;
    });
  }, [trendData, trendMetric]);

  const trendYears = trendData?.years || [];

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
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Badge variant="outline" className={`text-xs ${statusInfo.color} flex items-center gap-1`}>
            <StatusIcon className={`w-3 h-3 ${isBuilding || meta?.status === 'running' ? 'animate-spin' : ''}`} />
            {statusInfo.label}
          </Badge>
          {/* Datenqualitaets-Badge */}
          {qualityData?.years?.length > 0 && (() => {
            const y = qualityData.years.find(y => y.jahr === Number(selectedYear));
            if (!y) return null;
            const isComplete = y.komplett;
            return (
              <Badge variant="outline" className={`text-xs flex items-center gap-1 ${
                isComplete ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'
              }`} title={`Erwartet: ${y.erwartet} Zeilen (14 Stationen × 12 Monate × 2 Schichten)`}>
                {isComplete ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                {y.rowCount}/{y.erwartet} Datensätze ({y.abdeckung}%)
              </Badge>
            );
          })()}
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
          {/* Export-Buttons */}
          <Button
            variant="outline"
            size="sm"
            onClick={async () => { setExportLoading('inek'); await downloadExport('inek'); setExportLoading(null); }}
            disabled={exportLoading !== null || rows.length === 0}
            title="InEK-Excel-Meldung (formatiert wie PHP-Original)"
          >
            {exportLoading === 'inek' ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 mr-1" />
            )}
            InEK-Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => { setExportLoading('csv'); await downloadExport('csv'); setExportLoading(null); }}
            disabled={exportLoading !== null || rows.length === 0}
            title="CSV-Export für externe Systeme"
          >
            {exportLoading === 'csv' ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 mr-1" />
            )}
            CSV
          </Button>
        </div>
      </div>

      {/* Datenqualitaets-Warnung bei unvollstaendigen Daten */}
      {qualityData?.years?.length > 0 && (() => {
        const y = qualityData.years.find(y => y.jahr === Number(selectedYear));
        if (!y || y.komplett) return null;
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-amber-900 text-sm">
                Möglicherweise unvollständige Daten für {selectedYear}
              </p>
              <p className="text-amber-700 text-sm mt-1">
                Gefunden: {y.rowCount} von erwarteten {y.erwartet} Datensätzen ({y.abdeckung}%).
                Stationen: {y.stationen}/14, Monate: {y.monate}/12.
                {' '}
                {y.stationen < 14 && 'Einige Stationen fehlen. '}
                {y.monate < 12 && 'Nicht alle Monate sind vorhanden. '}
                Bitte ggf. im PHP-System den Export für das Quartal aktualisieren und CuraFlow-Refresh erneut auslösen.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Building-Banner */}
      {isBuilding && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-blue-900 text-sm">PPUGV-Cache wird im Hintergrund aufgebaut</p>
            <p className="text-blue-700 text-sm mt-1">
              Die Daten werden aus der ppugv-Datenbank abgerufen.
              Die Seite lädt automatisch neu, sobald die Daten verfügbar sind.
            </p>
          </div>
        </div>
      )}

      {/* Tab-Navigation – wie das PHP-Frontend */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.key
                  ? 'bg-white text-indigo-700 border border-b-0 border-slate-200 -mb-px'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ===== TAB 1: Stationen (Charts + Detailtabelle) ===== */}
      {activeTab === 'stations' && (
        <>
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
                    <SelectItem key={s.stationsname} value={s.stationsname}>{s.stationsname}</SelectItem>
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
                  {years.map((y) => (<SelectItem key={y} value={y}>{y}</SelectItem>))}
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {chartMode === 'staffing' ? 'Durchschnittliche Personalbesetzung (VK)' : 'Belegungstage & Patientenzahlen'}
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
                  <span>Keine Daten. Klicke auf "Aktualisieren", um den Cache zu füllen.</span>
                </div>
              ) : chartData().length === 0 && isBuilding ? (
                <div className="flex items-center justify-center py-12 text-blue-500">
                  <Loader2 className="w-8 h-8 mr-2 animate-spin" />
                  <span>Cache wird aufgebaut…</span>
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
                      <Bar dataKey="pflege_tag" name="Pflegekräfte (Tag)" fill={CHART_COLORS.pflegekraefte} radius={[2, 2, 0, 0]} />
                      <Bar dataKey="hilfe_tag" name="Hilfskräfte (Tag)" fill={CHART_COLORS.hilfskraefte} radius={[2, 2, 0, 0]} />
                      <Bar dataKey="hebamme_tag" name="Hebammen (Tag)" fill={CHART_COLORS.hebammen} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  ) : (
                    <LineChart data={chartData()}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="patienten_tag" name="Patienten (Tag)" stroke={CHART_COLORS.patienten} strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="belegung_tag" name="Belegung (Tag)" stroke={CHART_COLORS.belegung} strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Table2 className="w-5 h-5" />
                Monatsdaten pro Station
              </CardTitle>
              <CardDescription>
                {data?.count ?? 0} Datensätze – Tag- und Nachtschicht pro Station und Monat
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 && !isBuilding ? (
                <div className="text-center py-8 text-slate-400">
                  <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Keine gecachten PPUGV-Daten vorhanden.</p>
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
                            <Badge variant={row.schicht === 'Nacht' ? 'secondary' : 'default'} className="text-xs">{row.schicht}</Badge>
                          </TableCell>
                          <TableCell className="text-right">{row.patienten}</TableCell>
                          <TableCell className="text-right">{formatDecimal(row.belegung)}</TableCell>
                          <TableCell className="text-right">{formatDecimal(row.pflegekraefte_ist)}</TableCell>
                          <TableCell className="text-right">{formatDecimal(row.hebammen_ist)}</TableCell>
                          <TableCell className="text-right">{formatDecimal(row.hilfskraefte_ist)}</TableCell>
                          <TableCell>
                            {row.frostung === 'ja' ? (
                              <Badge variant="outline" className="text-green-700 bg-green-50 text-xs border-green-200">✓ Frostung</Badge>
                            ) : (<span className="text-xs text-slate-400">–</span>)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ===== TAB 2: Fachabteilungen ===== */}
      {activeTab === 'fab' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-24">
                  <SelectValue placeholder="Jahr" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (<SelectItem key={y} value={y}>{y}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400" />
              <Select value={selectedFab} onValueChange={setSelectedFab}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Fachabteilung" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Fachabteilungen</SelectItem>
                  {fabOptions.map(f => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Personalbesetzung nach Fachabteilungen (VK)</CardTitle>
              <CardDescription>{selectedYear} – Ø VK über das Jahr</CardDescription>
            </CardHeader>
            <CardContent>
              {!fabData ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
              ) : fabRows.length === 0 ? (
                <div className="text-center py-8 text-slate-400">Keine FAB-Daten für dieses Jahr.</div>
              ) : (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={fabRows.map(fab => ({
                    name: fab.fabname,
                    pflege: fab.monate.reduce((s, m) => s + m.tag.pflege + m.nacht.pflege, 0) / Math.max(fab.monate.length, 1),
                    hilfe: fab.monate.reduce((s, m) => s + m.tag.hilfe + m.nacht.hilfe, 0) / Math.max(fab.monate.length, 1),
                    hebamme: fab.monate.reduce((s, m) => s + m.tag.hebamme + m.nacht.hebamme, 0) / Math.max(fab.monate.length, 1),
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="pflege" name="Pflegekräfte (Ø VK)" fill={CHART_COLORS.pflegekraefte} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="hilfe" name="Hilfskräfte (Ø VK)" fill={CHART_COLORS.hilfskraefte} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="hebamme" name="Hebammen (Ø VK)" fill={CHART_COLORS.hebammen} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {fabRows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="w-5 h-5" />
                  Fachabteilungen – Monatsdaten (Tag)
                </CardTitle>
                <CardDescription>Pflege, Hilfskräfte, Hebammen im Tagdienst pro FAB</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>FAB</TableHead>
                        <TableHead>Monat</TableHead>
                        <TableHead className="text-right">Patienten</TableHead>
                        <TableHead className="text-right">Belegung %</TableHead>
                        <TableHead className="text-right">Pflege (Tag)</TableHead>
                        <TableHead className="text-right">Hilfe (Tag)</TableHead>
                        <TableHead className="text-right">Hebamme (Tag)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fabRows.flatMap(fab =>
                        fab.monate.map((m, mi) => (
                          <TableRow key={`${fab.fabschluessel}-${mi}`}>
                            <TableCell className="font-medium">{fab.fabname}</TableCell>
                            <TableCell>{m.monat}</TableCell>
                            <TableCell className="text-right">{m.tag.patienten}</TableCell>
                            <TableCell className="text-right">{formatDecimal(m.tag.belegung)}</TableCell>
                            <TableCell className="text-right">{formatDecimal(m.tag.pflege)}</TableCell>
                            <TableCell className="text-right">{formatDecimal(m.tag.hilfe)}</TableCell>
                            <TableCell className="text-right">{formatDecimal(m.tag.hebamme)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ===== TAB 3: Jahresvergleich ===== */}
      {activeTab === 'trends' && (
        <>
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
                    <SelectItem key={s.stationsname} value={s.stationsname}>{s.stationsname}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-slate-400" />
              <Select value={trendMetric} onValueChange={setTrendMetric}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Kennzahl" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="belegung">Belegung (%)</SelectItem>
                  <SelectItem value="patienten">Patienten</SelectItem>
                  <SelectItem value="pflege">Pflegekräfte (VK)</SelectItem>
                  <SelectItem value="hilfe">Hilfskräfte (VK)</SelectItem>
                  <SelectItem value="hebamme">Hebammen (VK)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Jahresvergleich – {trendMetric === 'belegung' ? 'Belegung (%)' : trendMetric === 'patienten' ? 'Patienten' : trendMetric === 'pflege' ? 'Pflegekräfte (VK)' : trendMetric === 'hilfe' ? 'Hilfskräfte (VK)' : 'Hebammen (VK)'}</CardTitle>
              <CardDescription>{selectedStation !== 'all' ? selectedStation : 'Alle Stationen'} – {trendYears.join(', ')}</CardDescription>
            </CardHeader>
            <CardContent>
              {trendLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
              ) : !trendData ? (
                <div className="text-center py-8 text-slate-400">Bitte Tab auswählen.</div>
              ) : trendLines.length === 0 ? (
                <div className="text-center py-8 text-slate-400">Keine Trenddaten.</div>
              ) : (
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={trendLines}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="monat" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    {trendYears.map((y, i) => (
                      <Line key={y} type="monotone" dataKey={y} name={String(y)}
                        stroke={YEAR_COLORS[i % YEAR_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ===== TAB 4: InEK-Export-Tabelle ===== */}
      {activeTab === 'table' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Table2 className="w-5 h-5" />
              Meldeformular InEK (nach Upload-Vorlage PPUGV)
            </CardTitle>
            <CardDescription>
              Standortnummer 771003000 – {selectedYear} – Wie die InEK-Meldetabelle im PHP-Frontend
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>Keine Daten vorhanden. Bitte zuerst Cache füllen (Tab "Stationen").</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs whitespace-nowrap">Pflegesensitiver Bereich</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">FAB-Schlüssel (§21)</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Fachabteilung</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Station</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Standort-Nr.</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Monat</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Schicht</TableHead>
                      <TableHead className="text-xs text-right whitespace-nowrap">Betten</TableHead>
                      <TableHead className="text-xs text-right whitespace-nowrap">Schichten (Σ)</TableHead>
                      <TableHead className="text-xs text-right whitespace-nowrap">Patienten (Σ)</TableHead>
                      <TableHead className="text-xs text-right whitespace-nowrap">Pflege (VK Ø)</TableHead>
                      <TableHead className="text-xs text-right whitespace-nowrap">Hilfe (VK Ø)</TableHead>
                      <TableHead className="text-xs text-right whitespace-nowrap">Hebammen (VK Ø)</TableHead>
                      <TableHead className="text-xs text-right whitespace-nowrap">Belegung (Ø %)</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Frostung</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, idx) => (
                      <TableRow key={row.id || idx} className="text-xs">
                        <TableCell className="text-xs max-w-[120px]">{row.pfl_sen_ber || row.fabname}</TableCell>
                        <TableCell className="text-xs">{row.fabschluessel}</TableCell>
                        <TableCell className="text-xs">{row.fabname}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{row.stationsname}</TableCell>
                        <TableCell className="text-xs">771003000</TableCell>
                        <TableCell className="text-xs">{row.monat}</TableCell>
                        <TableCell className="text-xs">{row.schicht}</TableCell>
                        <TableCell className="text-xs text-right">{row.betten}</TableCell>
                        <TableCell className="text-xs text-right">{row.anzahl}</TableCell>
                        <TableCell className="text-xs text-right">{row.patienten}</TableCell>
                        <TableCell className="text-xs text-right">{formatDecimal(row.pflegekraefte_ist)}</TableCell>
                        <TableCell className="text-xs text-right">{formatDecimal(row.hilfskraefte_ist)}</TableCell>
                        <TableCell className="text-xs text-right">{formatDecimal(row.hebammen_ist)}</TableCell>
                        <TableCell className="text-xs text-right">{formatDecimal(row.belegung)}</TableCell>
                        <TableCell className="text-xs">
                          {row.frostung === 'ja' ? (
                            <Badge variant="outline" className="text-green-700 bg-green-50 text-xs border-green-200">✓ Frostung</Badge>
                          ) : (<span className="text-xs text-slate-400">–</span>)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
