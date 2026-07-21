import { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { TisowareConnectionStatus, TisowareTable, TisowareColumn, TisowareSampleResult } from '@/types/master';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Database,
  Table2,
  Columns3,
  Play,
  Loader2,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  FileText,
  Terminal,
  RefreshCw,
  Unplug,
  Wifi,
} from 'lucide-react';

const PAGE_SIZE = 50;

type QueryResultData = {
  rowCount: number;
  columns: Array<{ name: string; type: string }>;
  rows: Record<string, unknown>[];
};

type PhpCheckData = {
  php_version?: string;
  odbc_drivers?: string[];
  error?: string;
};

export default function MasterTisoware() {
  const [activeTab, setActiveTab] = useState('browse');
  const [sqlQuery, setSqlQuery] = useState('SELECT TOP 50 * FROM dbo.PERSTAMM');
  const [expandedTable, setExpandedTable] = useState<TisowareTable | null>(null);
  const [previewTable, setPreviewTable] = useState<TisowareTable | null>(null);
  const [samplePage, setSamplePage] = useState(0);

  // ── Connection status ──
  const { data: status, isLoading: statusLoading, isError: statusError, error: statusFetchError } = useQuery({
    queryKey: ['tisoware-status'],
    queryFn: () => api.request('/api/master/tisoware/status', { skipDbToken: true }) as Promise<TisowareConnectionStatus>,
    refetchInterval: 30_000,
    retry: false,
  });

  // ── Table list ──
  const { data: tablesData, isLoading: tablesLoading, isError: tablesError, error: tablesQueryError, refetch: refetchTables } = useQuery({
    queryKey: ['tisoware-tables'],
    queryFn: () => api.request('/api/master/tisoware/tables', { skipDbToken: true }) as Promise<{ tables: TisowareTable[] }>,
    enabled: activeTab === 'browse',
    retry: false,
  });
  const tables = tablesData?.tables ?? [];

  // ── Columns for expanded table ──
  const { data: columnsData, isLoading: columnsLoading } = useQuery({
    queryKey: ['tisoware-columns', expandedTable],
    queryFn: () => {
      if (!expandedTable) return { columns: [] as TisowareColumn[] };
      return api.request(`/api/master/tisoware/tables/${expandedTable.schema_name}/${expandedTable.table_name}/columns`, { skipDbToken: true }) as Promise<{ columns: TisowareColumn[] }>;
    },
    enabled: !!expandedTable,
  });
  const columns = columnsData?.columns ?? [];

  // ── Sample preview ──
  const { data: sampleData, isLoading: sampleLoading, refetch: refetchSample } = useQuery({
    queryKey: ['tisoware-sample', previewTable?.full_name, samplePage],
    queryFn: () => {
      if (!previewTable) return { rows: [] as Record<string, unknown>[], columns: [] as Array<{ name: string }>, rowCount: 0, totalCount: 0, offset: 0, limit: PAGE_SIZE } as TisowareSampleResult;
      return api.request(`/api/master/tisoware/tables/${previewTable.schema_name}/${previewTable.table_name}/sample?offset=${samplePage * PAGE_SIZE}&limit=${PAGE_SIZE}`, { skipDbToken: true }) as Promise<TisowareSampleResult>;
    },
    enabled: !!previewTable,
  });

  // ── Custom query ──
  const queryMutation = useMutation({
    mutationFn: (q: string) => api.request('/api/master/tisoware/query', {
      method: 'POST',
      body: { query: q },
      skipDbToken: true,
    }) as Promise<QueryResultData>,
  });

  // ── PHP / ODBC availability ──
  const phpCheck = useQuery({
    queryKey: ['tisoware-php-check'],
    queryFn: () => api.request('/api/master/tisoware/php-check', { skipDbToken: true }) as Promise<PhpCheckData>,
    retry: false,
  });

  const handleRunQuery = useCallback(() => {
    if (sqlQuery.trim()) {
      queryMutation.mutate(sqlQuery.trim());
    }
  }, [sqlQuery, queryMutation]);

  const handleTableClick = useCallback((table: TisowareTable) => {
    if (expandedTable?.full_name === table.full_name) {
      setExpandedTable(null);
    } else {
      setExpandedTable(table);
    }
  }, [expandedTable]);

  const handlePreview = useCallback((table: TisowareTable) => {
    setPreviewTable(table);
    setSamplePage(0);
    setActiveTab('preview');
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRunQuery();
    }
  }, [handleRunQuery]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tisoware DB-Explorer</h1>
          <p className="text-slate-500 mt-1">
            Datenbank-Explorer für das Tisoware Zeiterfassungssystem
          </p>
        </div>

        {/* Connection status badge */}
        <div className="flex items-center gap-2">
          {statusLoading ? (
            <Badge variant="outline" className="text-slate-400">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Verbindung prüfen…
            </Badge>
          ) : status?.connected ? (
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
              <Wifi className="w-3 h-3 mr-1" />
              {status.mock ? 'Mock-Modus' : 'Verbunden'}
            </Badge>
          ) : (
            <Badge variant="destructive">
              <Unplug className="w-3 h-3 mr-1" />
              {status?.message || 'Keine Verbindung'}
            </Badge>
          )}
        </div>
      </div>

      {!!status?.mock && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm text-amber-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Mock-Modus aktiv — Tisoware ist nicht erreichbar. Zeige Platzhalterdaten.
              Setze <code className="bg-amber-100 px-1 rounded text-xs">TISO_MOCK=false</code> und konfiguriere
              TISO_SERVER, TISO_USER, TISO_PASS für echte Verbindung.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Connection error diagnosis card — shown when not connected and not in mock mode */}
      {/* Also shown when status fetch itself failed (503/502 from Express) */}
      {!statusLoading && statusError && !status?.mock && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4 pb-3 space-y-2">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                  <Unplug className="w-4 h-4 text-red-600" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-red-900 mb-1">
                  ⚠ Tisoware nicht verbunden
                </h3>
                <p className="text-sm text-red-800 font-medium mb-1">
                  {(status?.diagnosis as string | undefined) || statusFetchError?.message || 'Server nicht erreichbar'}
                </p>
                {!!status?.detail && (
                  <p className="text-xs text-red-600 font-mono mt-1 mb-1 bg-red-100/50 p-1.5 rounded">
                    {status.detail as React.ReactNode}
                  </p>
                )}
                {!!status?.hint && (
                  <p className="text-xs text-red-700 mt-1 flex items-start gap-1">
                    <span className="font-medium">Lösungsansatz:</span>
                    <span>{status.hint as React.ReactNode}</span>
                  </p>
                )}
                {!!status?.code && (
                  <p className="text-xs text-red-500 mt-1">
                    Fehlercode: <code className="bg-red-100 px-1 rounded">{status.code as React.ReactNode}</code>
                  </p>
                )}
                {!!status?.odbcState && (
                  <p className="text-xs text-slate-500 mt-1">
                    ODBC State: <code className="bg-slate-100 px-1 rounded">{status.odbcState as React.ReactNode}</code>
                    {status.odbcNativeCode ? ` | Native: ${status.odbcNativeCode as React.ReactNode}` : ''}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!statusLoading && status && !status.connected && !status.mock && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4 pb-3 space-y-2">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                  <Unplug className="w-4 h-4 text-red-600" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-red-900 mb-1">
                  ⚠ Tisoware nicht verbunden
                </h3>
                <p className="text-sm text-red-800 font-medium mb-1">
                  {(status.diagnosis as string | undefined) || (status.message as string | undefined) || 'Unbekannter Fehler'}
                </p>
                {!!status.detail && (
                  <p className="text-xs text-red-600 font-mono mt-1 mb-1 bg-red-100/50 p-1.5 rounded">
                    {status.detail as React.ReactNode}
                  </p>
                )}
                {!!status.hint && (
                  <p className="text-xs text-red-700 mt-1 flex items-start gap-1">
                    <span className="font-medium">Lösungsansatz:</span>
                    <span>{status.hint as React.ReactNode}</span>
                  </p>
                )}
                {!!status.code && (
                  <p className="text-xs text-red-500 mt-1">
                    Fehlercode: <code className="bg-red-100 px-1 rounded">{status.code as React.ReactNode}</code>
                  </p>
                )}
                {!!status.odbcState && (
                  <p className="text-xs text-slate-500 mt-1">
                    ODBC State: <code className="bg-slate-100 px-1 rounded">{status.odbcState as React.ReactNode}</code>
                    {status.odbcNativeCode ? ` | Native: ${status.odbcNativeCode as React.ReactNode}` : ''}
                  </p>
                )}
                {!!status.passwordDiag && (
                  <div className="mt-2 text-xs text-slate-600 font-mono space-y-0.5">
                    <p>Passwort: {(status.passwordDiag as Record<string, unknown>).rawLength as React.ReactNode} Zeichen</p>
                    {!!(status.passwordDiag as Record<string, unknown>).surroundedByQuotes && (
                      <p className="text-amber-600">⚠ Von Anführungszeichen umschlossen — effektiv {(status.passwordDiag as Record<string, unknown>).effectiveLength as React.ReactNode} Zeichen</p>
                    )}
                    {!!(status.passwordDiag as Record<string, unknown>).effectiveContainsHash && (
                      <p className="text-amber-600">⚠ Enthält # — prüfe ob es in Coolify ankommt</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* PHP / ODBC availability card */}
      {!statusLoading && status && (
        <Card className="border-slate-200 bg-white">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                  <Terminal className={`w-4 h-4 ${phpCheck.data?.php_version ? 'text-green-600' : 'text-slate-400'}`} />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-slate-800 mb-1">
                  PHP / ODBC Proxy
                </h3>
                {phpCheck.isLoading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Prüfe PHP-Verfügbarkeit…
                  </div>
                ) : phpCheck.error ? (
                  <div className="space-y-1">
                    <p className="text-xs text-red-600 font-medium">
                      ⚠ PHP-Proxy nicht verfügbar
                    </p>
                    <p className="text-xs text-slate-500 font-mono">
                      {phpCheck.error?.message || 'Unbekannter Fehler'}
                    </p>
                    <p className="text-xs text-amber-700">
                      Tisoware-Abfragen werden nicht funktionieren — MS ODBC Driver 18 oder php-cli fehlt im Container.
                    </p>
                  </div>
                ) : phpCheck.data?.php_version ? (
                  <div className="space-y-1">
                    <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                      PHP {phpCheck.data.php_version} verfügbar
                    </Badge>
                    {(phpCheck.data.odbc_drivers?.length ?? 0) > 0 ? (
                      <div className="mt-2">
                        <p className="text-xs text-slate-500 font-medium mb-0.5">Installierte ODBC-Treiber:</p>
                        <ul className="text-xs text-slate-600 font-mono space-y-0.5">
                          {(phpCheck.data.odbc_drivers as string[]).map((driver: string, i: number) => (
                            <li key={i} className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                              {driver}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-700 mt-1">⚠ Keine ODBC-Treiber installiert</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs text-amber-700 font-medium">
                      ⚠ PHP nicht verfügbar
                    </p>
                    {phpCheck.data?.error ? (
                      <p className="text-xs text-red-600 font-mono bg-red-50 p-1.5 rounded">
                        {phpCheck.data.error}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Weder php-cli noch ODBC Driver 18 sind im Container installiert.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="browse" className="flex items-center gap-1.5">
            <Database className="w-4 h-4" />
            Tabellen durchsuchen
          </TabsTrigger>
          <TabsTrigger value="query" className="flex items-center gap-1.5">
            <Terminal className="w-4 h-4" />
            SQL-Abfrage
          </TabsTrigger>
          <TabsTrigger value="preview" className="flex items-center gap-1.5" disabled={!previewTable}>
            <FileText className="w-4 h-4" />
            {previewTable ? `Vorschau: ${previewTable.table_name}` : 'Vorschau'}
          </TabsTrigger>
        </TabsList>

        {/* ── BROWSE TAB ── */}
        <TabsContent value="browse" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Table2 className="w-5 h-5" />
                  Tabellen
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => refetchTables()}>
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Aktualisieren
                </Button>
              </div>
              <CardDescription>
                {tables.length > 0
                  ? `${tables.length} Tabellen mit Daten (leere ausgeblendet)`
                  : 'Lade Tabellen…'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {tablesLoading ? (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin mr-2" />
                  Lade Tabellen…
                </div>
              ) : tablesError ? (
                <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
                  <Unplug className="w-8 h-8 text-red-400 mb-3" />
                  <p className="text-sm font-medium text-red-700 mb-1">
                    Tisoware nicht verbunden
                  </p>
                  <p className="text-xs text-red-500 max-w-md">
                    {((tablesQueryError as unknown as Record<string, unknown>)?.detail
                      || (tablesQueryError as unknown as Record<string, unknown>)?.diagnosis
                      || tablesQueryError?.message
                      || 'Verbindung zum Tisoware-Server fehlgeschlagen.') as string}
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchTables()}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />
                    Erneut versuchen
                  </Button>
                </div>
              ) : tables.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <Database className="w-6 h-6 mr-2 opacity-50" />
                  Keine Tabellen gefunden
                </div>
              ) : (
                <div className="divide-y">
                  {tables.map((t: TisowareTable) => (
                    <Collapsible
                      key={t.full_name as React.Key}
                      open={expandedTable?.full_name === t.full_name}
                      onOpenChange={() => { handleTableClick(t); }}
                    >
                      <div className="flex items-center px-4 py-2 hover:bg-slate-50 transition-colors">
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="p-1 mr-2">
                            {expandedTable?.full_name === t.full_name
                              ? <ChevronDown className="w-4 h-4" />
                              : <ChevronRight className="w-4 h-4" />
                            }
                          </Button>
                        </CollapsibleTrigger>
                        <span className="text-sm font-mono flex-1">
                          <span className="text-slate-400">{t.schema_name}.</span>
                          <span className="font-semibold">{t.table_name}</span>
                          <span className="ml-2 text-xs text-slate-400">
                            ({t.row_count?.toLocaleString() ?? '?'} Zeilen)
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-indigo-600 hover:text-indigo-800"
                          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.stopPropagation();
                            handlePreview(t);
                          }}
                        >
                          <FileText className="w-3.5 h-3.5 mr-1" />
                          Vorschau
                        </Button>
                      </div>
                      <CollapsibleContent>
                        <div className="px-8 pb-3">
                          {columnsLoading && expandedTable?.full_name === t.full_name ? (
                            <div className="text-xs text-slate-400 flex items-center gap-1 py-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Lade Spalten…
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              {columns.length === 0 ? (
                                <div className="text-xs text-slate-400 italic py-1">Keine Spalteninformationen</div>
                              ) : (
                                columns.map((col: TisowareColumn) => (
                                  <div key={col.column_name} className="flex items-center gap-2 text-xs py-0.5">
                                    <Columns3 className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                                    <code className="font-mono font-medium text-slate-800">{col.column_name}</code>
                                    <span className="text-slate-400">{col.data_type}</span>
                                    {(col.max_length as number) > 0 && (col.max_length as number) !== 255 && (
                                      <span className="text-slate-400">({col.max_length as React.ReactNode})</span>
                                    )}
                                    {!!(col.is_nullable as boolean) ? (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-slate-400">NULL</Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-emerald-600 border-emerald-200">NOT NULL</Badge>
                                    )}
                                    {!!(col.is_identity as boolean) && (
                                      <Badge className="text-[10px] px-1 py-0 h-4 bg-blue-100 text-blue-700 border-blue-200">IDENTITY</Badge>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── QUERY TAB ── */}
        <TabsContent value="query" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                SQL-Abfrage
              </CardTitle>
              <CardDescription>
                Schreibe eine SELECT / WITH Abfrage. Nur lesende Abfragen sind erlaubt.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <textarea
                  value={sqlQuery}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setSqlQuery(e.target.value); }}
                  onKeyDown={handleKeyDown}
                  className="w-full h-32 p-3 font-mono text-sm border rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-y"
                  placeholder="SELECT TOP 100 * FROM dbo.PERSTAMM"
                  spellCheck={false}
                />
                <div className="absolute bottom-3 right-3 text-xs text-slate-400">
                  Strg+Enter zum Ausführen
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleRunQuery}
                  disabled={queryMutation.isPending || !sqlQuery.trim()}
                >
                  {queryMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-1.5" />
                  )}
                  Ausführen
                </Button>
                {queryMutation.data && (
                  <span className="text-xs text-slate-500">
                    {queryMutation.data.rowCount} Zeilen
                  </span>
                )}
              </div>

              {/* Error */}
              {queryMutation.isError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-red-700 font-mono whitespace-pre-wrap">
                    {queryMutation.error?.message || 'Unbekannter Fehler'}
                  </div>
                </div>
              )}

              {/* Results */}
              {queryMutation.data && (
                <div className="border rounded-lg overflow-hidden">
                  <ScrollArea className="max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {queryMutation.data.columns?.map((col: { name: string; type: string }) => (
                            <TableHead key={col.name} className="font-mono text-xs whitespace-nowrap">
                              {col.name}
                              <span className="text-slate-400 font-normal ml-1">({col.type})</span>
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {queryMutation.data.rows?.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={queryMutation.data.columns?.length || 1}
                              className="text-center text-slate-400 py-8 italic"
                            >
                              Keine Ergebnisse
                            </TableCell>
                          </TableRow>
                        ) : (
                          queryMutation.data.rows?.map((row: Record<string, unknown>, idx: number) => (
                            <TableRow key={idx}>
                              {queryMutation.data.columns?.map((col: { name: string; type: string }) => (
                                <TableCell key={col.name} className="font-mono text-xs max-w-xs truncate">
                                  {row[col.name] === null || row[col.name] === undefined
                                    ? <span className="text-slate-300 italic">NULL</span>
                                    : String(row[col.name])}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PREVIEW TAB ── */}
        <TabsContent value="preview" className="space-y-4">
          {previewTable ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Vorschau: <span className="font-mono">{previewTable.schema_name}.{previewTable.table_name}</span>
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => refetchSample()}>
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Neu laden
                  </Button>
                </div>
                <CardDescription>
                  {sampleData
                    ? `Zeile ${sampleData.offset + 1}–${Math.min(sampleData.offset + sampleData.limit, sampleData.totalCount)} von ${sampleData.totalCount.toLocaleString()}`
                    : `Lade Daten…`}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {sampleLoading ? (
                  <div className="flex items-center justify-center py-16 text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    Lade Daten…
                  </div>
                ) : (
                  <>
                    <ScrollArea className="max-h-[600px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {sampleData?.columns?.map((col: { name: string }) => (
                              <TableHead key={col.name} className="font-mono text-xs whitespace-nowrap">
                                {col.name}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sampleData?.rows?.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={sampleData?.columns?.length || 1} className="text-center text-slate-400 py-8 italic">
                                Tabelle ist leer
                              </TableCell>
                            </TableRow>
                          ) : (
                            sampleData?.rows?.map((row: Record<string, unknown>, idx: number) => (
                              <TableRow key={idx}>
                                {sampleData.columns?.map((col: { name: string }) => (
                                  <TableCell key={col.name} className="font-mono text-xs max-w-xs truncate">
                                    {row[col.name] === null || row[col.name] === undefined
                                      ? <span className="text-slate-300 italic">NULL</span>
                                      : String(row[col.name])}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                    {/* Pagination */}
                    {sampleData && sampleData.totalCount > PAGE_SIZE && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
                        <span className="text-xs text-slate-500">
                          Seite {samplePage + 1} von {Math.ceil(sampleData.totalCount / PAGE_SIZE)}
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={samplePage === 0}
                            onClick={() => setSamplePage((p) => Math.max(0, p - 1))}
                          >
                            <ChevronLeft className="w-4 h-4 mr-1" />
                            Zurück
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={(samplePage + 1) * PAGE_SIZE >= sampleData.totalCount}
                            onClick={() => setSamplePage((p) => p + 1)}
                          >
                            Weiter
                            <ChevronRight className="w-4 h-4 ml-1" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Table2 className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">Wähle eine Tabelle im Tab "Tabellen durchsuchen" aus</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
