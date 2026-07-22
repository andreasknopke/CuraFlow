import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { api } from '@/api/client';
import {
  Search, Upload, Eye, Play, Loader2, Users, Link2,
  CalendarClock, AlertTriangle, CheckCircle2, XCircle,
  Download, Clock, UserCheck,
} from 'lucide-react';
import type {
  TisowareImportEmployee,
  TisowareImportPreview,
  TisowareImportResult,
} from '@/types/master';

// ============ TYPES ============

type MatchStatus = TisowareImportEmployee['match_status'];

const matchStatusConfig: Record<MatchStatus, { label: string; variant: 'default' | 'success' | 'warning' }> = {
  matched: { label: 'Verknüpft', variant: 'success' },
  unmatched: { label: 'Nicht gefunden', variant: 'warning' },
  no_pspersnr: { label: 'Keine PSPERSNR', variant: 'default' },
};

// ============ COMPONENTS ============

function StatCard({ icon: Icon, label, value, variant = 'default' }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  variant?: 'default' | 'success' | 'warning' | 'info' | 'danger';
}) {
  const variants = {
    default: 'bg-white border-slate-200',
    success: 'bg-emerald-50 border-emerald-200',
    warning: 'bg-amber-50 border-amber-200',
    info: 'bg-indigo-50 border-indigo-200',
    danger: 'bg-red-50 border-red-200',
  };

  const iconColors = {
    default: 'bg-slate-100 text-slate-600',
    success: 'bg-emerald-100 text-emerald-600',
    warning: 'bg-amber-100 text-amber-600',
    info: 'bg-indigo-100 text-indigo-600',
    danger: 'bg-red-100 text-red-600',
  };

  return (
    <Card className={variants[variant]}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${iconColors[variant]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          <p className="text-xs text-slate-500">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmployeeRow({ employee, isChecked, onToggle }: {
  employee: TisowareImportEmployee;
  isChecked: boolean;
  onToggle: (psPersNr: string, checked: boolean) => void;
}) {
  const config = matchStatusConfig[employee.match_status];
  const statusIcon = employee.match_status === 'matched'
    ? <Link2 className="w-3.5 h-3.5" />
    : employee.match_status === 'unmatched'
      ? <AlertTriangle className="w-3.5 h-3.5" />
      : <XCircle className="w-3.5 h-3.5" />;

  const variantMap = {
    success: 'bg-emerald-100 text-emerald-800',
    warning: 'bg-amber-100 text-amber-800',
    default: 'bg-slate-100 text-slate-600',
  } as const;

  return (
    <div className="flex items-center gap-4 p-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
      <Checkbox
        checked={isChecked}
        disabled={employee.match_status !== 'matched'}
        onCheckedChange={(checked) => onToggle(employee.PSPERSNR, !!checked)}
      />
      <span className="text-sm text-slate-500 w-20">{employee.PSPERSNR}</span>
      <span className="font-medium text-slate-900 flex-1">
        {employee.PSNACHNA}, {employee.PSVORNA}
      </span>
      <span className="text-sm text-slate-400">{employee.employee_name || '—'}</span>
      <Badge className={`flex items-center gap-1 text-xs ${variantMap[config.variant]}`}>
        {statusIcon}
        {config.label}
      </Badge>
    </div>
  );
}

function SelectAllBar({ items, checkedIds, onToggleAll, label }: {
  items: TisowareImportEmployee[];
  checkedIds: Set<string>;
  onToggleAll: (checked: boolean) => void;
  label: string;
}) {
  const selectable = items.filter(e => e.match_status === 'matched');
  const allChecked = selectable.length > 0 && selectable.every(e => checkedIds.has(e.PSPERSNR));
  const someChecked = selectable.some(e => checkedIds.has(e.PSPERSNR));
  const isIndeterminate = someChecked && !allChecked;

  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <Checkbox
        checked={allChecked}
        data-state={isIndeterminate ? 'indeterminate' : undefined}
        onCheckedChange={(checked) => onToggleAll(!!checked)}
      />
      <span className="text-xs text-slate-500">
        {allChecked ? `${label} abwählen` : `${label} auswählen`} ({selectable.length})
      </span>
    </div>
  );
}

// ============ MAIN PAGE ============

export default function MasterTisowareImport() {

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [resolveConflicts, setResolveConflicts] = useState(false);

  const [employees, setEmployees] = useState<TisowareImportEmployee[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [searchStats, setSearchStats] = useState<{ total: number; matched: number; unmatched: number; no_pspersnr: number } | null>(null);

  const [preview, setPreview] = useState<TisowareImportPreview | null>(null);
  const [importResult, setImportResult] = useState<TisowareImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ============ SEARCH ============

  const handleSearch = useCallback(async () => {
    setSearching(true);
    setError(null);
    setPreview(null);
    setImportResult(null);
    setCheckedIds(new Set());

    try {
      const { employees: empList, stats } = await api.request(
        '/api/master/tisoware/import/employee-search',
        {
          method: 'POST',
          body: JSON.stringify({ q: searchQuery || undefined }),
        },
      ) as { employees: TisowareImportEmployee[]; stats: { total: number; matched: number; unmatched: number; no_pspersnr: number } };

      setEmployees(empList);
      setSearchStats(stats);

      // Auto-check all matched employees
      const autoChecked = new Set<string>();
      for (const e of empList) {
        if (e.match_status === 'matched') autoChecked.add(e.PSPERSNR);
      }
      setCheckedIds(autoChecked);

      toast.success(`${stats.total} Mitarbeiter gefunden, ${stats.matched} verknüpft`);
    } catch (err) {
      const message = (err as Error)?.message || 'Unbekannter Fehler';
      setError(message);
      toast.error(`Suche fehlgeschlagen: ${message}`);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  // ============ SEARCH ALL ACTIVE ============

  const handleSearchAllActive = useCallback(async () => {
    setSearching(true);
    setError(null);
    setPreview(null);
    setImportResult(null);
    setCheckedIds(new Set());

    try {
      const { employees: empList, stats } = await api.request(
        '/api/master/tisoware/import/employee-search',
        {
          method: 'POST',
          body: JSON.stringify({ allActive: true }),
        },
      ) as { employees: TisowareImportEmployee[]; stats: { total: number; matched: number; unmatched: number; no_pspersnr: number } };

      setEmployees(empList);
      setSearchStats(stats);

      // Auto-check all matched employees
      const autoChecked = new Set<string>();
      for (const e of empList) {
        if (e.match_status === 'matched') autoChecked.add(e.PSPERSNR);
      }
      setCheckedIds(autoChecked);

      toast.success(`${stats.total} aktive Mitarbeiter gefunden, ${stats.matched} verknüpft`);
    } catch (err) {
      const message = (err as Error)?.message || 'Unbekannter Fehler';
      setError(message);
      toast.error(`Suche fehlgeschlagen: ${message}`);
    } finally {
      setSearching(false);
    }
  }, []);

  // ============ PREVIEW ============

  const handlePreview = useCallback(async () => {
    const selectedPsPersNr = Array.from(checkedIds);
    if (selectedPsPersNr.length === 0) {
      toast.warning('Bitte mindestens einen verknüpften Mitarbeiter auswählen.');
      return;
    }

    setPreviewing(true);
    setError(null);
    setImportResult(null);

    try {
      const result = await api.request('/api/master/tisoware/import/preview', {
        method: 'POST',
        body: JSON.stringify({
          psPersNr: selectedPsPersNr,
          resolveConflicts,
        }),
      }) as TisowareImportPreview;

      setPreview(result);

      toast.success(
        `Vorschau: ${result.new_absences.length} neue Abwesenheiten, ` +
        `${result.conflicts.length} Konflikte, ${result.already_exists.length} bereits vorhanden`
      );
    } catch (err) {
      const message = (err as Error)?.message || 'Unbekannter Fehler';
      setError(message);
      toast.error(`Vorschau fehlgeschlagen: ${message}`);
    } finally {
      setPreviewing(false);
    }
  }, [checkedIds, resolveConflicts]);

  // ============ IMPORT ============

  const handleImport = useCallback(async () => {
    const selectedPsPersNr = Array.from(checkedIds);
    if (selectedPsPersNr.length === 0) {
      toast.warning('Bitte mindestens einen verknüpften Mitarbeiter auswählen.');
      return;
    }

    setImporting(true);
    setError(null);
    setImportResult(null);

    try {
      const result = await api.request('/api/master/tisoware/import/run', {
        method: 'POST',
        body: JSON.stringify({
          psPersNr: selectedPsPersNr,
          resolveConflicts,
        }),
      }) as TisowareImportResult;

      setImportResult(result);

      const parts = [`${result.imported} importiert, ${result.skipped_existing} bereits vorhanden`];
      if (result.resolved_conflicts > 0) parts.push(`${result.resolved_conflicts} Konflikte gelöst`);
      if (result.unresolved_conflicts > 0) parts.push(`${result.unresolved_conflicts} Konflikte ungelöst`);
      if (result.errors_count > 0) parts.push(`${result.errors_count} Fehler`);
      toast.success(`Import abgeschlossen — ${parts.join(', ')}`);

      // Refresh preview after import
      handlePreview();
    } catch (err) {
      const message = (err as Error)?.message || 'Unbekannter Fehler';
      setError(message);
      toast.error(`Import fehlgeschlagen: ${message}`);
    } finally {
      setImporting(false);
    }
  }, [checkedIds, resolveConflicts, handlePreview]);

  // ============ HELPERS ============

  const toggleEmployee = useCallback((psPersNr: string, _checked: boolean) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(psPersNr)) next.delete(psPersNr);
      else next.add(psPersNr);
      return next;
    });
  }, []);

  const toggleAll = useCallback((checked: boolean) => {
    if (checked) {
      const all = new Set<string>();
      for (const e of employees) {
        if (e.match_status === 'matched') all.add(e.PSPERSNR);
      }
      setCheckedIds(all);
    } else {
      setCheckedIds(new Set());
    }
  }, [employees]);

  const conflictPreviews = preview?.conflicts || [];
  const unresolvedConflicts = conflictPreviews.filter(c => c.resolution === 'unresolved');
  const resolvedConflicts = conflictPreviews.filter(c => c.resolution !== 'unresolved');

  // ============ RENDER ============

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Tisoware-Import</h1>
        <p className="text-sm text-slate-500 mt-1">
          Abwesenheiten aus Tisoware in die zentralen Abwesenheiten importieren.
          Mitarbeiter werden über PSPERSNR (aus Stammdat-Import) verknüpft.
        </p>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                placeholder="Name, PSPERSNR oder Mitarbeiter-ID suchen..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              />
            </div>
            <Button onClick={handleSearch} disabled={searching}>
              {searching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Suchen
            </Button>
            <Button onClick={handleSearchAllActive} disabled={searching} variant="outline">
              {searching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Users className="w-4 h-4 mr-2" />}
              Alle aktiven
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <p className="text-red-700 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Search Stats */}
      {searchStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Users} label="Gefunden" value={searchStats.total} variant="info" />
          <StatCard icon={Link2} label="Verknüpft" value={searchStats.matched} variant="success" />
          <StatCard icon={AlertTriangle} label="Nicht gefunden" value={searchStats.unmatched} variant="warning" />
          <StatCard icon={XCircle} label="Keine PSPERSNR" value={searchStats.no_pspersnr} variant="default" />
        </div>
      )}

      {/* Employee List */}
      {employees.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="p-3 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between">
                <SelectAllBar
                  items={employees}
                  checkedIds={checkedIds}
                  onToggleAll={toggleAll}
                  label="Alle verknüpften"
                />
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <Checkbox
                      checked={resolveConflicts}
                      onCheckedChange={(c) => setResolveConflicts(!!c)}
                    />
                    Konflikte automatisch lösen
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePreview}
                    disabled={previewing || checkedIds.size === 0}
                  >
                    {previewing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
                    Vorschau
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleImport}
                    disabled={importing || checkedIds.size === 0}
                  >
                    {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                    Importieren
                  </Button>
                </div>
              </div>
            </div>

            {/* Column headers */}
            <div className="flex items-center gap-4 px-3 py-2 bg-slate-50 border-b border-slate-100 text-xs font-medium text-slate-400 uppercase">
              <span className="w-10"></span>
              <span className="w-20">PSPERSNR</span>
              <span className="flex-1">Name (Tisoware)</span>
              <span className="flex-1">CuraFlow</span>
              <span className="w-32">Status</span>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {employees.map((emp) => (
                <EmployeeRow
                  key={emp.PSPERSNR || String(emp.PSNR)}
                  employee={emp}
                  isChecked={checkedIds.has(emp.PSPERSNR)}
                  onToggle={toggleEmployee}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview / Import Results */}
      {(preview || importResult) && (
        <Card>
          <CardContent className="p-0">
            <Tabs defaultValue="overview">
              <div className="border-b border-slate-200 px-4 pt-4">
                <TabsList>
                  <TabsTrigger value="overview">Übersicht</TabsTrigger>
                  <TabsTrigger value="new">
                    Neu ({preview?.new_absences.length || 0})
                  </TabsTrigger>
                  <TabsTrigger value="conflicts">
                    Konflikte ({preview?.conflicts.length || 0})
                  </TabsTrigger>
                  <TabsTrigger value="existing">
                    Vorhanden ({preview?.already_exists.length || 0})
                  </TabsTrigger>
                  {preview?.unparseable_dates && preview.unparseable_dates.length > 0 && (
                    <TabsTrigger value="errors">
                      Fehler ({preview.unparseable_dates.length})
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>

              {/* Overview Tab */}
              <TabsContent value="overview" className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard
                    icon={Upload} label="Neu zu importieren"
                    value={preview?.new_absences.length ?? (importResult?.imported || 0)}
                    variant="info"
                  />
                  <StatCard
                    icon={CheckCircle2} label="Bereits vorhanden"
                    value={preview?.already_exists.length ?? (importResult?.skipped_existing || 0)}
                    variant="success"
                  />
                  <StatCard
                    icon={AlertTriangle} label="Konflikte"
                    value={preview?.conflicts.length ?? ((importResult?.resolved_conflicts || 0) + (importResult?.unresolved_conflicts || 0))}
                    variant="warning"
                  />
                  <StatCard
                    icon={XCircle} label="Datum-Fehler / Sonstige"
                    value={(preview?.unparseable_dates.length ?? 0) + (importResult?.errors_count || 0)}
                    variant="danger"
                  />
                </div>

                {importResult && (
                  <div className="mt-4 p-4 bg-slate-50 rounded-lg">
                    <h3 className="text-sm font-medium text-slate-700 mb-2">Import-Details</h3>
                    <div className="grid grid-cols-3 gap-2 text-sm text-slate-600">
                      <div>Importiert: <strong>{importResult.imported}</strong></div>
                      <div>Übersprungen: <strong>{importResult.skipped_existing}</strong></div>
                      <div>Gelöste Konflikte: <strong>{importResult.resolved_conflicts}</strong></div>
                      <div>Ungelöste Konflikte: <strong>{importResult.unresolved_conflicts}</strong></div>
                      <div>Datum-Fehler: <strong>{importResult.unparseable_dates}</strong></div>
                      <div>Sonstige Fehler: <strong>{importResult.errors_count}</strong></div>
                    </div>
                  </div>
                )}

                {/* Match details */}
                {preview?.unmatched_details && preview.unmatched_details.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-medium text-slate-700 mb-2">
                      Nicht verknüpfte Mitarbeiter ({preview.unmatched_details.length})
                    </h3>
                    <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                            <th className="p-2 text-left">PSPERSNR</th>
                            <th className="p-2 text-left">Name</th>
                            <th className="p-2 text-left">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.unmatched_details.map((u, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="p-2 font-mono text-xs">{u.PSPERSNR}</td>
                              <td className="p-2">{u.PSNACHNA}, {u.PSVORNA}</td>
                              <td className="p-2">
                                <Badge variant="outline" className="text-xs">
                                  {matchStatusConfig[u.match_status as MatchStatus]?.label || u.match_status}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* New Absences Tab */}
              <TabsContent value="new" className="p-4">
                {!preview?.new_absences.length ? (
                  <p className="text-sm text-slate-400 py-8 text-center">Keine neuen Abwesenheiten.</p>
                ) : (
                  <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
                          <th className="p-2 text-left">Mitarbeiter</th>
                          <th className="p-2 text-left">Datum</th>
                          <th className="p-2 text-left">Position</th>
                          <th className="p-2 text-left">Notiz</th>
                          <th className="p-2 text-left">LOANR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.new_absences.map((a, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="p-2">{a.employee_id}</td>
                            <td className="p-2 font-mono text-xs">{a.date}</td>
                            <td className="p-2">
                              <Badge variant="outline" className="text-xs">{a.position}</Badge>
                            </td>
                            <td className="p-2 max-w-48 truncate text-slate-500">{a.notePrefix}</td>
                            <td className="p-2 font-mono text-xs text-slate-400">{a.loanr}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>

              {/* Conflicts Tab */}
              <TabsContent value="conflicts" className="p-4">
                {!preview?.conflicts.length ? (
                  <p className="text-sm text-slate-400 py-8 text-center">Keine Konflikte.</p>
                ) : (
                  <div className="space-y-4">
                    {resolvedConflicts.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium text-slate-700 mb-2">
                          Gelöst ({resolvedConflicts.length})
                        </h3>
                        <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
                                <th className="p-2 text-left">Mitarbeiter</th>
                                <th className="p-2 text-left">Datum</th>
                                <th className="p-2 text-left">Tisoware</th>
                                <th className="p-2 text-left">Vorhanden</th>
                                <th className="p-2 text-left">Ergebnis</th>
                              </tr>
                            </thead>
                            <tbody>
                              {resolvedConflicts.map((c, i) => (
                                <tr key={i} className="border-t border-slate-100">
                                  <td className="p-2">{c.employee_id}</td>
                                  <td className="p-2 font-mono text-xs">{c.date}</td>
                                  <td className="p-2">
                                    <Badge variant="outline" className="text-xs">{c.tisoware_position}</Badge>
                                  </td>
                                  <td className="p-2">
                                    <Badge variant="outline" className="text-xs">{c.existing_position}</Badge>
                                  </td>
                                  <td className="p-2">
                                    <Badge className={c.resolution === 'tisoware_wins' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}>
                                      {c.resolution === 'tisoware_wins' ? 'Tisoware gewinnt' : 'Zentral gewinnt'}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {unresolvedConflicts.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium text-red-600 mb-2 flex items-center gap-1">
                          <AlertTriangle className="w-4 h-4" />
                          Ungelöst ({unresolvedConflicts.length})
                        </h3>
                        <div className="max-h-48 overflow-y-auto border border-red-200 rounded-lg">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-red-50 text-red-600 text-xs uppercase sticky top-0">
                                <th className="p-2 text-left">Mitarbeiter</th>
                                <th className="p-2 text-left">Datum</th>
                                <th className="p-2 text-left">Tisoware</th>
                                <th className="p-2 text-left">Vorhanden</th>
                              </tr>
                            </thead>
                            <tbody>
                              {unresolvedConflicts.map((c, i) => (
                                <tr key={i} className="border-t border-red-100">
                                  <td className="p-2">{c.employee_id}</td>
                                  <td className="p-2 font-mono text-xs">{c.date}</td>
                                  <td className="p-2">
                                    <Badge variant="outline" className="text-xs">{c.tisoware_position}</Badge>
                                  </td>
                                  <td className="p-2">
                                    <Badge variant="outline" className="text-xs">{c.existing_position}</Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* Already Exists Tab */}
              <TabsContent value="existing" className="p-4">
                {!preview?.already_exists.length ? (
                  <p className="text-sm text-slate-400 py-8 text-center">Keine bereits vorhandenen Einträge.</p>
                ) : (
                  <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
                          <th className="p-2 text-left">Mitarbeiter</th>
                          <th className="p-2 text-left">Datum</th>
                          <th className="p-2 text-left">Position</th>
                          <th className="p-2 text-left">LOANR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.already_exists.map((a, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="p-2">{a.employee_id}</td>
                            <td className="p-2 font-mono text-xs">{a.date}</td>
                            <td className="p-2">
                              <Badge variant="outline" className="text-xs">{a.position}</Badge>
                            </td>
                            <td className="p-2 font-mono text-xs text-slate-400">{a.loanr}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>

              {/* Unparseable Dates Tab */}
              {preview?.unparseable_dates && preview.unparseable_dates.length > 0 && (
                <TabsContent value="errors" className="p-4">
                  <div className="max-h-96 overflow-y-auto border border-red-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-red-50 text-red-600 text-xs uppercase sticky top-0">
                          <th className="p-2 text-left">PSPERSNR</th>
                          <th className="p-2 text-left">LOANR</th>
                          <th className="p-2 text-left">Von</th>
                          <th className="p-2 text-left">Bis</th>
                          <th className="p-2 text-left">Grund</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.unparseable_dates.map((u, i) => (
                          <tr key={i} className="border-t border-red-100">
                            <td className="p-2 font-mono text-xs">{u.psPersNr}</td>
                            <td className="p-2 font-mono text-xs">{u.loanr}</td>
                            <td className="p-2 font-mono text-xs">{u.rawFrom}</td>
                            <td className="p-2 font-mono text-xs">{u.rawTo || '—'}</td>
                            <td className="p-2 text-red-500 text-xs">{u.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
