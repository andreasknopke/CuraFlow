import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { api } from '@/api/client';
import {
  Database, Download, Search, CheckCircle2,
  AlertTriangle, UserPlus, Loader2, ChevronDown,
  ChevronRight, Users, Link2,
} from 'lucide-react';
import EmployeeSelect from '@/components/staff/EmployeeSelect';
import type { StammdatEmployee, StammdatImportDecision } from '@/types/master';

// ============ TYPES ============

type AnalysisResult = {
  exact_matches: StammdatEmployee[];
  ambiguous: StammdatEmployee[];
  no_match: StammdatEmployee[];
  total_source_employees: number;
  total_source_rows: number;
  unmatched_in_curaflow?: Array<{
    id: string;
    last_name: string;
    first_name?: string | null;
    payroll_id?: string | null;
    email?: string | null;
    has_stammdat_id?: boolean;
  }>;
};

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: { name: string; personalnummer: string; error: string }[];
  dry_run?: boolean;
  preview?: {
    creates: Array<{
      data?: Record<string, unknown> | null;
      personalnummer?: string | number;
    }>;
    updates: Array<{
      name?: string;
      personalnummer?: string | number;
      existing_name?: string;
      changes?: Record<string, { old: unknown; new: unknown }>;
      cost_centers?: number;
    }>;
    skips: Array<{ name: string }>;
    cost_center_changes?: Array<{
      name: string;
      personalnummer: string | number;
      cost_center_count: number;
      splits: Array<{
        number: string | number;
        share: string | number;
        code: string;
        name: string;
      }>;
    }>;
  };
};

// ============ COMPONENTS ============

function StatCard({ icon: Icon, label, value, color, variant = 'default' }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  color: string;
  variant?: string;
}) {
  const variants = {
    default: 'bg-white border-slate-200',
    success: 'bg-emerald-50 border-emerald-200',
    warning: 'bg-amber-50 border-amber-200',
    info: 'bg-indigo-50 border-indigo-200',
  };

  return (
    <Card className={variants[variant as keyof typeof variants] || variants.default}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>
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

function EmployeeRow({ employee, category, isChecked, onDecision, selectedCandidateId, onSelectCandidate }: {
  employee: StammdatEmployee;
  category: string;
  isChecked: boolean;
  onDecision?: (decision: StammdatImportDecision) => void;
  selectedCandidateId?: string | null;
  onSelectCandidate?: (stammdatId: number, candidateId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const categoryColors = {
    EXACT_MATCH: 'bg-emerald-100 text-emerald-800',
    AMBIGUOUS: 'bg-amber-100 text-amber-800',
    NO_MATCH: 'bg-indigo-100 text-indigo-800',
  };

  const categoryLabels = {
    EXACT_MATCH: 'Eindeutig',
    AMBIGUOUS: 'Uneindeutig',
    NO_MATCH: 'Neu',
  };

  return (
    <div className="border border-slate-200 rounded-lg bg-white">
      {/* Header row */}
      <div className="flex items-center gap-4 p-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded hover:bg-slate-100 text-slate-400"
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <Checkbox
          checked={isChecked}
          onCheckedChange={(checked) => {
            if (checked) {
              const decision: StammdatImportDecision = { stammdat_id: employee.stammdat_id, action: 'apply' };
              if (category === 'EXACT_MATCH' && employee.existing_employee_id) {
                decision.existing_employee_id = employee.existing_employee_id;
              } else if (category === 'AMBIGUOUS' && selectedCandidateId) {
                decision.existing_employee_id = selectedCandidateId;
              }
              onDecision?.(decision);
            } else {
              onDecision?.({ stammdat_id: employee.stammdat_id, action: 'skip' });
            }
          }}
        />

        <span className="text-sm text-slate-500 w-24">{employee.personalnummer}</span>
        <span className="font-medium text-slate-900 flex-1">
          {employee.last_name}, {employee.first_name}
        </span>
        <span className="text-sm text-slate-500">{employee.position}</span>
        <Badge className={categoryColors[category as keyof typeof categoryColors] || categoryColors.NO_MATCH}>
          {categoryLabels[category as keyof typeof categoryLabels]}
        </Badge>
        {employee.cost_center_splits > 0 && (
          <Badge variant="outline" className="text-xs">
            {employee.cost_center_splits}× KST-Split
          </Badge>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-slate-100">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <div>
              <Label className="text-xs text-slate-400">Kostenstelle</Label>
              <p className="text-sm">{employee.cost_center} — {employee.cost_center_name}</p>
            </div>
            <div>
              <Label className="text-xs text-slate-400">E-Mail</Label>
              <p className="text-sm">{employee.email || '—'}</p>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Vertrag von</Label>
              <p className="text-sm">{employee.contract_start || '—'}</p>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Vertrag bis</Label>
              <p className="text-sm">{employee.contract_end || '—'}</p>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Status</Label>
              <Badge variant={employee.is_active ? 'default' : 'secondary'} className="text-xs mt-0.5">
                {employee.is_active ? 'Aktiv' : 'Inaktiv'}
              </Badge>
            </div>
          </div>

          {/* Existing match info */}
          {category === 'EXACT_MATCH' && employee.existing_employee_id && (
            <div className="mt-3 p-2 bg-emerald-50 rounded text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4 inline mr-1" />
              Existiert bereits: {(employee as any).existing_first_name} {(employee as any).existing_last_name}
            </div>
          )}

          {/* Ambiguous candidates */}
          {category === 'AMBIGUOUS' && (employee.candidates?.length ?? 0) > 0 && (
            <div className="mt-3 p-3 bg-amber-50 rounded">
              <p className="text-sm font-medium text-amber-800 mb-2 flex items-center gap-1">
                <AlertTriangle className="w-4 h-4" />
                Mehrere mögliche Treffer — bitte auswählen:
              </p>
              <div className="space-y-1">
                <label className="flex items-center gap-2 p-2 rounded hover:bg-amber-100 cursor-pointer">
                  <input
                    type="radio"
                    name={`candidate-${employee.stammdat_id}`}
                    checked={!selectedCandidateId}
                    onChange={() => onSelectCandidate?.(employee.stammdat_id, null)}
                  />
                  <span className="text-sm text-amber-700">— Neu anlegen —</span>
                </label>
                 {employee.candidates?.map((candidate) => {
                       const c = candidate as unknown as { id: string; name: string; first_name?: string; last_name?: string; payroll_id?: string; email?: string };
                       return (
                   <label
                     key={c.id}
                     className="flex items-center gap-2 p-2 rounded hover:bg-amber-100 cursor-pointer"
                   >
                     <input
                       type="radio"
                       name={`candidate-${employee.stammdat_id}`}
                       checked={selectedCandidateId === c.id}
                       onChange={() => onSelectCandidate?.(employee.stammdat_id, c.id)}
                     />
                     <span className="text-sm text-amber-800">
                       {c.first_name} {c.last_name}
                       {c.payroll_id && (
                         <span className="text-xs text-amber-600 ml-2">(PNr: {c.payroll_id})</span>
                       )}
                       {c.email && (
                         <span className="text-xs text-amber-600 ml-2">({c.email})</span>
                       )}
                     </span>
                   </label>
                       );
                 })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SelectAllBar({ items, decisions, itemKey, onDecision, label }: {
  items: StammdatEmployee[];
  decisions: Record<number, StammdatImportDecision>;
  itemKey: 'stammdat_id';
  onDecision: (decision: StammdatImportDecision) => void;
  label: string;
}) {
  const allChecked = items.length > 0 && items.every(item => decisions[item[itemKey]]?.action === 'apply');
  const someChecked = items.some(item => decisions[item[itemKey]]?.action === 'apply');
  const isIndeterminate = someChecked && !allChecked;

  const handleToggleAll = () => {
    const newAction = allChecked ? 'skip' : 'apply';
    for (const item of items) {
      onDecision({ [itemKey]: item[itemKey], action: newAction } as StammdatImportDecision);
    }
  };

  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <Checkbox
        checked={allChecked}
        data-state={isIndeterminate ? 'indeterminate' : undefined}
        onCheckedChange={handleToggleAll}
      />
      <span className="text-xs text-slate-500">
        {allChecked ? `${label} abwählen` : `${label} auswählen`}
      </span>
    </div>
  );
}

// ============ MAIN PAGE ============

export default function MasterStammdatImport() {

  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dryRunning, setDryRunning] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [analysis, setAnalysis] = useState<any>(null);
  const [decisions, setDecisions] = useState<Record<number, StammdatImportDecision>>({});
  const [candidateSelections, setCandidateSelections] = useState<Record<number, string | null>>({});
  const [linkSelections, setLinkSelections] = useState<Record<string, number | null>>({});
  const [linking, setLinking] = useState<Record<string, boolean>>({});
  const [importResult, setImportResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState('exact_match');

  // ============ API CALLS ============

  // Analyze
  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    setImportResult(null);
    setDecisions({});
    setCandidateSelections({});
    setLinkSelections({});
    setLinking({});

    try {
      const result = await api.request('/api/master/employees/stammdat/analyze') as AnalysisResult;
      setAnalysis(result);

      // Auto-decide exact matches
      const autoDecisions: Record<number, StammdatImportDecision> = {};
      for (const emp of result.exact_matches) {
        autoDecisions[emp.stammdat_id] = {
          stammdat_id: emp.stammdat_id,
          action: 'apply',
          existing_employee_id: emp.existing_employee_id ?? undefined,
        };
      }
      setDecisions(autoDecisions);

      toast.success(
        `Analyse abgeschlossen — ${result.total_source_employees} MA gefunden: ` +
        `${result.exact_matches.length} eindeutig, ${result.ambiguous.length} uneindeutig, ${result.no_match.length} neu`
      );
    } catch (err) {
      const message = (err as Error)?.message || 'Unbekannter Fehler';
      setError(message);
      toast.error(`Analyse fehlgeschlagen: ${message}`);
    } finally {
      setAnalyzing(false);
    }
  }, []);

  // Shared: build decisions array from UI state
  const buildDecisions = useCallback(() => {
    const decisionEntries = Object.values(decisions);
    const toApply = decisionEntries.filter(d => d.action === 'apply');

    return toApply.map(d => {
      const selection = candidateSelections[d.stammdat_id];
      if (selection) {
        return { ...d, existing_employee_id: selection };
      }
      return d;
    });
  }, [decisions, candidateSelections]);

  // Dry-Run: preview without writing
  const handleDryRun = useCallback(async () => {
    const finalDecisions = buildDecisions();
    if (finalDecisions.length === 0) {
      toast.warning('Bitte mindestens einen Mitarbeiter auswählen.');
      return;
    }

    setDryRunning(true);
    setError(null);
    setImportResult(null);

    try {
      const result = await api.request('/api/master/employees/stammdat/import', {
        method: 'POST',
        body: JSON.stringify({ decisions: finalDecisions, dryRun: true }),
      }) as ImportResult;
      setImportResult(result);

      toast.success(
        `Vorschau: ${result.created} würden erstellt, ${result.updated} aktualisiert, ${result.skipped} übersprungen`
      );
    } catch (err) {
      const message = (err as Error)?.message || 'Unbekannter Fehler';
      setError(message);
      toast.error(`Vorschau fehlgeschlagen: ${message}`);
    } finally {
      setDryRunning(false);
    }
  }, [buildDecisions]);

  // Execute import (live)
  const handleImport = useCallback(async () => {
    const finalDecisions = buildDecisions();
    if (finalDecisions.length === 0) {
      toast.warning('Bitte mindestens einen Mitarbeiter auswählen.');
      return;
    }

    setImporting(true);
    setError(null);
    setImportResult(null);

    try {
      const result = await api.request('/api/master/employees/stammdat/import', {
        method: 'POST',
        body: JSON.stringify({ decisions: finalDecisions, dryRun: false }),
      }) as ImportResult;
      setImportResult(result);

      toast.success(
        `Import abgeschlossen — ${result.created} erstellt, ${result.updated} aktualisiert, ` +
        `${result.skipped} übersprungen, ${result.errors.length} Fehler`
      );
    } catch (err) {
      const message = (err as Error)?.message || 'Unbekannter Fehler';
      setError(message);
      toast.error(`Import fehlgeschlagen: ${message}`);
    } finally {
      setImporting(false);
    }
  }, [buildDecisions]);

  // ============ DECISION HELPERS ============

  const handleDecision = useCallback((decision: StammdatImportDecision) => {
    setDecisions(prev => ({ ...prev, [decision.stammdat_id]: decision }));
  }, []);

  const handleSelectCandidate = useCallback((stammdatId: number, candidateId: string | null) => {
    setCandidateSelections(prev => ({ ...prev, [stammdatId]: candidateId }));
  }, []);

  const handleLinkStammdat = useCallback(async (curaflowEmployeeId: string) => {
    const stammdatId = linkSelections[curaflowEmployeeId];
    if (!stammdatId) {
      toast.warning('Bitte einen Stammdaten-Eintrag auswählen.');
      return;
    }

    setLinking(prev => ({ ...prev, [curaflowEmployeeId]: true }));
    try {
      await api.request('/api/master/employees/stammdat/link', {
        method: 'POST',
        body: JSON.stringify({ employee_id: curaflowEmployeeId, stammdat_id: stammdatId }),
      });
      toast.success('Verknüpfung hergestellt — Mitarbeiter wurde mit Stammdaten aktualisiert.');
      // Re-run analysis to refresh all tabs
      handleAnalyze();
    } catch (err) {
      toast.error(`Verknüpfung fehlgeschlagen: ${(err as Error)?.message || 'Unbekannter Fehler'}`);
    } finally {
      setLinking(prev => ({ ...prev, [curaflowEmployeeId]: false }));
    }
  }, [linkSelections, handleAnalyze]);

  // ============ FILTERING ============

  const stammdatLinkOptions = ((analysis as AnalysisResult | null)?.no_match || []).map((s: StammdatEmployee) => ({
    value: String(s.stammdat_id),
    label: `${s.last_name}, ${s.first_name}`,
    description: `${s.personalnummer} — ${s.position || 'o.A.'}`,
    searchText: `${s.last_name} ${s.first_name} ${s.personalnummer} ${s.position || ''}`,
  }));

  const filterEmployees = (list: StammdatEmployee[] | undefined | null): StammdatEmployee[] => {
    if (!list) return [];
    if (!searchTerm) return list;
    const term = searchTerm.toLowerCase();
    return list.filter((e: StammdatEmployee) =>
      e.last_name?.toLowerCase().includes(term) ||
      e.first_name?.toLowerCase().includes(term) ||
      String(e.personalnummer).includes(term) ||
      e.position?.toLowerCase().includes(term)
    );
  };

  // ============ COUNTS ============

  const exactMatches = filterEmployees(analysis?.exact_matches || []);
  const ambiguous = filterEmployees(analysis?.ambiguous || []);
  const noMatch = filterEmployees(analysis?.no_match || []);

  const totalSelected = Object.values(decisions).filter(d => d.action === 'apply').length;

  // ============ RENDER ============

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Database className="w-6 h-6 text-indigo-600" />
          Stammdaten-Import
        </h1>
        <p className="text-slate-500 mt-1">
          Migration aus der externen Personal-Stammdatenbank (PHP/stammdat).
          Mitarbeiter werden anhand von Vor- und Nachname abgeglichen.
        </p>
      </div>

      {/* Stats row */}
      {analysis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Database} label="Quell-Datensätze" value={analysis.total_source_rows} color="bg-indigo-100 text-indigo-600" variant="info" />
          <StatCard icon={Users} label="Eindeutige MA" value={analysis.exact_matches.length} color="bg-emerald-100 text-emerald-600" variant="success" />
          <StatCard icon={AlertTriangle} label="Uneindeutig" value={analysis.ambiguous.length} color="bg-amber-100 text-amber-600" variant="warning" />
          <StatCard icon={UserPlus} label="Neu anzulegen" value={analysis.no_match.length} color="bg-indigo-100 text-indigo-600" variant="info" />
          {analysis.unmatched_in_curaflow?.length > 0 && (
            <StatCard icon={Users} label="Nur in CuraFlow" value={analysis.unmatched_in_curaflow.length} color="bg-rose-100 text-rose-600" variant="default" />
          )}
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="gap-2"
        >
          {analyzing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          {analysis ? 'Erneut analysieren' : 'Stammdaten analysieren'}
        </Button>

        {analysis && (
          <>
            <Input
              placeholder="Suche nach Name, Personalnummer, Position..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-xs"
            />
            <div className="flex-1" />
            <span className="text-sm text-slate-500">
              {totalSelected} von{' '}
              {exactMatches.length + ambiguous.length + noMatch.length} ausgewählt
            </span>
            <Button
              onClick={handleDryRun}
              disabled={dryRunning || importing || totalSelected === 0}
              variant="outline"
              className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              {dryRunning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Vorschau / Dry Run
            </Button>
            <Button
              onClick={handleImport}
              disabled={importing || dryRunning || totalSelected === 0}
              variant="default"
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Migration ausführen
            </Button>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-red-700 text-sm">{error}</CardContent>
        </Card>
      )}

      {/* Import result */}
      {importResult && !importResult.dry_run && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="p-4">
            <h3 className="font-semibold text-emerald-800 mb-2">Import-Ergebnis</h3>
            <div className="grid grid-cols-4 gap-3 text-sm">
              <div><span className="font-medium text-emerald-700">{importResult.created}</span> neu erstellt</div>
              <div><span className="font-medium text-emerald-700">{importResult.updated}</span> aktualisiert</div>
              <div><span className="font-medium text-slate-600">{importResult.skipped}</span> übersprungen</div>
              <div><span className="font-medium text-red-600">{importResult.errors.length}</span> Fehler</div>
            </div>
            {importResult.errors.length > 0 && (
              <div className="mt-3 pt-3 border-t border-emerald-200">
                <p className="text-xs font-medium text-red-700 mb-1">Fehlerdetails:</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {importResult.errors.map((err: { name: string; personalnummer: string; error: string }, i: number) => (
                    <p key={i} className="text-xs text-red-600">
                      {err.name} (PNr {err.personalnummer}): {err.error}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dry-Run preview */}
      {importResult?.dry_run && importResult.preview && (
        <div className="space-y-4">
          {/* Summary */}
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-4">
              <h3 className="font-semibold text-amber-800 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Vorschau (Dry Run) — keine Daten wurden geschrieben
              </h3>
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div><span className="font-medium text-amber-700">{importResult.created}</span> würden erstellt</div>
                <div><span className="font-medium text-amber-700">{importResult.updated}</span> würden aktualisiert</div>
                <div><span className="font-medium text-slate-600">{importResult.skipped}</span> übersprungen</div>
                <div><span className="font-medium text-red-600">{importResult.errors.length}</span> Fehler</div>
              </div>
            </CardContent>
          </Card>

          {/* Creates */}
          {importResult.preview.creates.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold text-indigo-700 mb-3">
                  🆕 Neu anzulegen ({importResult.preview.creates.length})
                </h3>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {importResult.preview.creates.map((item: { data?: Record<string, any> | null; personalnummer?: string | number }, i: number) => (
                    <div key={i} className="border border-indigo-200 rounded p-3 bg-indigo-50/30">
                      <p className="font-medium text-indigo-900">
                        {item.data?.last_name}, {item.data?.first_name}
                        <span className="text-xs text-indigo-500 ml-2">PNr {item.personalnummer}</span>
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs">
                        <div><span className="text-slate-400">Position:</span> {item.data?.position || '—'}</div>
                        <div><span className="text-slate-400">E-Mail:</span> {item.data?.email || '—'}</div>
                        <div><span className="text-slate-400">KST:</span> {item.data?.cost_center} — {item.data?.cost_center_name}</div>
                        <div><span className="text-slate-400">Vertrag:</span> {item.data?.contract_start || '—'} → {item.data?.contract_end || '—'}</div>
                        <div><span className="text-slate-400">Anrede:</span> {item.data?.salutation || '—'}</div>
                        <div><span className="text-slate-400">Titel:</span> {item.data?.title || '—'}</div>
                        <div><span className="text-slate-400">Aktiv:</span> {item.data?.is_active ? 'Ja' : 'Nein'}</div>
                        <div><span className="text-slate-400">KST-Splits:</span> {item.data?.cost_centers || 0}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Updates */}
          {importResult.preview.updates.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold text-amber-700 mb-3">
                  ✏️ Würden aktualisiert ({importResult.preview.updates.length})
                </h3>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {importResult.preview.updates.map((item: { name?: string; personalnummer?: string | number; existing_name?: string; changes?: Record<string, { old: unknown; new: unknown }>; cost_centers?: number }, i: number) => (
                    <div key={i} className={`border rounded p-3 ${Object.keys(item.changes || {}).length === 0 ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50/30'}`}>
                      <p className="font-medium text-amber-900">
                        {item.name}
                        <span className="text-xs text-amber-500 ml-2">PNr {item.personalnummer}</span>
                        {item.existing_name && (
                          <span className="text-xs text-slate-400 ml-2">→ existiert als: {item.existing_name}</span>
                        )}
                      </p>
                      {Object.keys(item.changes || {}).length === 0 ? (
                        <p className="text-xs text-slate-400 mt-2">Keine Änderungen (bereits aktuell)</p>
                      ) : (
                        <div className="mt-2 space-y-1">
                          {Object.entries(item.changes || {}).map(([field, diff]) => (
                            <div key={field} className="text-xs flex items-start gap-2">
                              <code className="text-slate-500 min-w-[140px]">{field}:</code>
                               <span className="text-red-500 line-through">{String((diff as { old: unknown; new: unknown }).old ?? '—')}</span>
                               <span className="text-slate-300">→</span>
                               <span className="text-emerald-600 font-medium">{String((diff as { old: unknown; new: unknown }).new ?? '—')}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {(item.cost_centers ?? 0) > 1 && (
                        <p className="text-xs text-slate-400 mt-2">+ {item.cost_centers} Kostenstellen</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Skips */}
          {importResult.preview.skips.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold text-slate-600 mb-2">
                  ⊘ Übersprungen ({importResult.preview.skips.length})
                </h3>
                <p className="text-xs text-slate-400">
                  {importResult.preview.skips.map((s: { name: string }) => s.name).join(', ')}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Cost center changes */}
          {importResult.preview.cost_center_changes?.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold text-slate-700 mb-3">
                  📊 Kostenstellen-Änderungen ({importResult.preview.cost_center_changes.length} MA)
                </h3>
                <div className="space-y-2">
                  {importResult.preview.cost_center_changes.map((cc: { name: string; personalnummer: string | number; cost_center_count: number; splits: Array<{ number: string | number; share: string | number; code: string; name: string }> }, i: number) => (
                    <div key={i} className="border border-slate-200 rounded p-2 text-xs">
                      <span className="font-medium">{cc.name}</span> (PNr {cc.personalnummer}): {cc.cost_center_count} KST-Zeilen
                      <div className="mt-1 space-y-0.5">
                        {cc.splits.map((s: { number: string | number; share: string | number; code: string; name: string }, j: number) => (
                          <span key={j} className="inline-block bg-slate-100 rounded px-1.5 py-0.5 mr-1 mb-1">
                            #{s.number}: {s.share}% → {s.code} {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Tabs */}
      {analysis && (
        <>
          <div className="flex gap-2 border-b border-slate-200 pb-2">
            {[
              { key: 'exact_match', label: 'Eindeutige Matches', count: exactMatches.length, color: 'text-emerald-600 border-emerald-600' },
              { key: 'ambiguous', label: 'Uneindeutig (manuell prüfen)', count: ambiguous.length, color: 'text-amber-600 border-amber-600' },
              { key: 'no_match', label: 'Neu anzulegen', count: noMatch.length, color: 'text-indigo-600 border-indigo-600' },
              { key: 'unmatched_curaflow', label: 'Nur in CuraFlow', count: analysis.unmatched_in_curaflow?.length || 0, color: 'text-rose-600 border-rose-600' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium rounded-t transition-colors border-b-2 ${
                  activeTab === tab.key
                    ? `${tab.color}`
                    : 'text-slate-500 border-transparent hover:text-slate-700'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          {/* Employee lists */}
          <div className="space-y-2">
            {activeTab === 'exact_match' && (
              <>
                {exactMatches.length === 0 && (
                  <p className="text-sm text-slate-400 py-8 text-center">Keine eindeutigen Matches</p>
                )}
                {exactMatches.map(emp => (
                  <EmployeeRow
                    key={emp.stammdat_id}
                    employee={emp}
                    category="EXACT_MATCH"
                    isChecked={decisions[emp.stammdat_id]?.action === 'apply'}
                    onDecision={handleDecision}
                  />
                ))}
              </>
            )}

            {activeTab === 'ambiguous' && (
              <>
                {ambiguous.length === 0 && (
                  <p className="text-sm text-slate-400 py-8 text-center">Keine uneindeutigen Einträge</p>
                )}
                {ambiguous.length > 0 && (
                  <SelectAllBar
                    items={ambiguous}
                    decisions={decisions}
                    itemKey="stammdat_id"
                    onDecision={handleDecision}
                    label="Alle uneindeutigen"
                  />
                )}
                {ambiguous.map(emp => (
                  <EmployeeRow
                    key={emp.stammdat_id}
                    employee={emp}
                    category="AMBIGUOUS"
                    isChecked={decisions[emp.stammdat_id]?.action === 'apply'}
                    onDecision={handleDecision}
                    selectedCandidateId={candidateSelections[emp.stammdat_id]}
                    onSelectCandidate={handleSelectCandidate}
                  />
                ))}
              </>
            )}

            {activeTab === 'no_match' && (
              <>
                {noMatch.length === 0 && (
                  <p className="text-sm text-slate-400 py-8 text-center">Keine neuen Mitarbeiter</p>
                )}
                {noMatch.length > 0 && (
                  <SelectAllBar
                    items={noMatch}
                    decisions={decisions}
                    itemKey="stammdat_id"
                    onDecision={handleDecision}
                    label="Alle neuen"
                  />
                )}
                {noMatch.map(emp => (
                  <EmployeeRow
                    key={emp.stammdat_id}
                    employee={emp}
                    category="NO_MATCH"
                    isChecked={decisions[emp.stammdat_id]?.action === 'apply'}
                    onDecision={handleDecision}
                  />
                ))}
              </>
            )}

            {activeTab === 'unmatched_curaflow' && (
              <>
                {(!analysis.unmatched_in_curaflow || analysis.unmatched_in_curaflow.length === 0) && (
                  <p className="text-sm text-slate-400 py-8 text-center">Alle CuraFlow-Mitarbeiter haben eine Entsprechung in den Stammdaten.</p>
                )}
                {((analysis as AnalysisResult | null)?.unmatched_in_curaflow || []).map((emp: { id: string; last_name: string; first_name?: string | null; payroll_id?: string | null; email?: string | null; has_stammdat_id?: boolean }) => {
                  const isLinking = linking[emp.id];
                  const selectedStammdatId = linkSelections[emp.id];

                  return (
                    <div key={emp.id} className="border border-rose-200 rounded-lg bg-white p-3">
                      <div className="flex items-center gap-4">
                        <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
                          <Users className="w-4 h-4 text-rose-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 text-sm">
                            {emp.last_name}{emp.first_name ? `, ${emp.first_name}` : ''}
                          </p>
                          <p className="text-xs text-slate-500">
                            {emp.payroll_id && <span>PNr: {emp.payroll_id}</span>}
                            {emp.email && <span className="ml-3">{emp.email}</span>}
                            {!emp.payroll_id && !emp.email && 'Keine weiteren Daten'}
                          </p>
                        </div>
                        {emp.has_stammdat_id && (
                          <Badge variant="outline" className="text-xs text-rose-600 border-rose-300 whitespace-nowrap">
                            Stammdat-Verknüpfung veraltet
                          </Badge>
                        )}
                        {!emp.has_stammdat_id && (
                          <Badge variant="outline" className="text-xs text-slate-500 whitespace-nowrap">
                            Keine Stammdaten-Verknüpfung
                          </Badge>
                        )}
                      </div>

                      {/* Manual matching searchable combobox */}
                      {(!noMatch || noMatch.length > 0) && (
                        <div className="mt-3 pt-3 border-t border-rose-100 flex items-center gap-3">
                          <Label className="text-xs text-slate-500 whitespace-nowrap">Stammdaten-Eintrag zuordnen:</Label>
                          <div className="flex-1 min-w-0">
                            <EmployeeSelect
                              value={selectedStammdatId ? String(selectedStammdatId) : ''}
                              onValueChange={(v) => setLinkSelections(prev => ({ ...prev, [emp.id]: v ? parseInt(v, 10) : null }))}
                              options={stammdatLinkOptions}
                              placeholder="Stammdaten-Eintrag suchen…"
                              searchPlaceholder="Name oder Personalnummer suchen…"
                              emptyText="Keine passenden Einträge"
                              disabled={isLinking}
                              triggerClassName="h-8 text-xs"
                              contentClassName="w-[380px]"
                            />
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50 h-8 text-xs flex-shrink-0"
                            disabled={!selectedStammdatId || isLinking}
                            onClick={() => handleLinkStammdat(emp.id)}
                          >
                            {isLinking ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Link2 className="w-3.5 h-3.5" />
                            )}
                            Verknüpfen
                          </Button>
                        </div>
                      )}

                      {(!noMatch || noMatch.length === 0) && (
                        <div className="mt-3 pt-3 border-t border-rose-100">
                          <p className="text-xs text-slate-400">
                            Keine offenen Stammdaten-Einträge zum Verknüpfen verfügbar.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}

      {/* Empty state */}
      {!analysis && !analyzing && (
        <Card className="border-dashed border-2 border-slate-200 bg-slate-50">
          <CardContent className="p-12 text-center">
            <Database className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-slate-600 mb-2">Stammdaten-Import</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Klicke auf „Stammdaten analysieren", um die externe Personal-Datenbank
              (<code className="bg-slate-200 px-1 rounded">stammdat</code>) einzulesen und mit
              den bereits in CuraFlow erfassten Mitarbeitern abzugleichen.
            </p>
            <div className="mt-6 p-3 bg-white rounded-lg border border-slate-200 text-left text-sm text-slate-500 max-w-lg mx-auto">
              <p className="font-medium text-slate-700 mb-2">So funktioniert's:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li><strong>Analyse:</strong> Alle Stammdaten-Mitarbeiter werden geladen</li>
                <li><strong>Abgleich:</strong> Vor- und Nachname werden mit der MasterDB verglichen</li>
                <li><strong>Eindeutige Treffer</strong> werden automatisch aktualisiert</li>
                <li><strong>Uneindeutige Treffer</strong> (z.B. „Müller") musst du händisch zuordnen</li>
                <li><strong>Neue Mitarbeiter</strong> werden in der MasterDB angelegt</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}