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
  ChevronRight,
} from 'lucide-react';

// ============ TYPES ============

/**
 * @typedef {Object} StammdatEmployee
 * @property {number} stammdat_id
 * @property {number} personalnummer
 * @property {string} last_name
 * @property {string} first_name
 * @property {string|null} position
 * @property {string|null} cost_center
 * @property {string|null} cost_center_name
 * @property {string|null} email
 * @property {string|null} contract_start
 * @property {string|null} contract_end
 * @property {boolean} is_active
 * @property {number} cost_center_splits
 * @property {Object[]} candidates - only for ambiguous
 */

// ============ COMPONENTS ============

function StatCard({ icon: Icon, label, value, color, variant = 'default' }) {
  const variants = {
    default: 'bg-white border-slate-200',
    success: 'bg-emerald-50 border-emerald-200',
    warning: 'bg-amber-50 border-amber-200',
    info: 'bg-indigo-50 border-indigo-200',
  };

  return (
    <Card className={variants[variant] || variants.default}>
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

function EmployeeRow({ employee, category, isChecked, onDecision, selectedCandidateId, onSelectCandidate }) {
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
              const decision = { stammdat_id: employee.stammdat_id, action: 'apply' };
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
        <Badge className={categoryColors[category] || categoryColors.NO_MATCH}>
          {categoryLabels[category]}
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
              Existiert bereits: {employee.existing_first_name} {employee.existing_last_name}
            </div>
          )}

          {/* Ambiguous candidates */}
          {category === 'AMBIGUOUS' && employee.candidates?.length > 0 && (
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
                {employee.candidates.map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-amber-100 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name={`candidate-${employee.stammdat_id}`}
                      checked={selectedCandidateId === candidate.id}
                      onChange={() => onSelectCandidate?.(employee.stammdat_id, candidate.id)}
                    />
                    <span className="text-sm text-amber-800">
                      {candidate.first_name} {candidate.last_name}
                      {candidate.payroll_id && (
                        <span className="text-xs text-amber-600 ml-2">(PNr: {candidate.payroll_id})</span>
                      )}
                      {candidate.email && (
                        <span className="text-xs text-amber-600 ml-2">({candidate.email})</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ MAIN PAGE ============

export default function MasterStammdatImport() {

  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [analysis, setAnalysis] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [candidateSelections, setCandidateSelections] = useState({});
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState(null);

  const [activeTab, setActiveTab] = useState('exact_match');

  // ============ API CALLS ============

  // Analyze
  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    setImportResult(null);
    setDecisions({});
    setCandidateSelections({});

    try {
      const result = await api.request('/api/master/employees/stammdat/analyze');
      setAnalysis(result);

      // Auto-decide exact matches
      const autoDecisions = {};
      for (const emp of result.exact_matches) {
        autoDecisions[emp.stammdat_id] = {
          stammdat_id: emp.stammdat_id,
          action: 'apply',
          existing_employee_id: emp.existing_employee_id,
        };
      }
      setDecisions(autoDecisions);

      toast.success(
        `Analyse abgeschlossen — ${result.total_source_employees} MA gefunden: ` +
        `${result.exact_matches.length} eindeutig, ${result.ambiguous.length} uneindeutig, ${result.no_match.length} neu`
      );
    } catch (err) {
      setError(err.message);
      toast.error(`Analyse fehlgeschlagen: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  }, []);

  // Execute import
  const handleImport = useCallback(async () => {
    const decisionEntries = Object.values(decisions);
    const toApply = decisionEntries.filter(d => d.action === 'apply');

    // Merge candidate selections for ambiguous entries
    const finalDecisions = toApply.map(d => {
      const selection = candidateSelections[d.stammdat_id];
      if (selection) {
        return { ...d, existing_employee_id: selection };
      }
      return d;
    });

    if (finalDecisions.length === 0) {
      toast.warning('Bitte mindestens einen Mitarbeiter auswählen.');
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const result = await api.request('/api/master/employees/stammdat/import', {
        method: 'POST',
        body: JSON.stringify({ decisions: finalDecisions }),
      });
      setImportResult(result);

      toast.success(
        `Import abgeschlossen — ${result.created} erstellt, ${result.updated} aktualisiert, ` +
        `${result.skipped} übersprungen, ${result.errors.length} Fehler`
      );
    } catch (err) {
      setError(err.message);
      toast.error(`Import fehlgeschlagen: ${err.message}`);
    } finally {
      setImporting(false);
    }
  }, [decisions, candidateSelections]);

  // ============ DECISION HELPERS ============

  const handleDecision = useCallback((decision) => {
    setDecisions(prev => ({ ...prev, [decision.stammdat_id]: decision }));
  }, []);

  const handleSelectCandidate = useCallback((stammdatId, candidateId) => {
    setCandidateSelections(prev => ({ ...prev, [stammdatId]: candidateId }));
  }, []);

  // ============ FILTERING ============

  const filterEmployees = (list) => {
    if (!list) return [];
    if (!searchTerm) return list;
    const term = searchTerm.toLowerCase();
    return list.filter(e =>
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
              onClick={handleImport}
              disabled={importing || totalSelected === 0}
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
      {importResult && (
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
                  {importResult.errors.map((err, i) => (
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

      {/* Tabs */}
      {analysis && (
        <>
          <div className="flex gap-2 border-b border-slate-200 pb-2">
            {[
              { key: 'exact_match', label: 'Eindeutige Matches', count: exactMatches.length, color: 'text-emerald-600 border-emerald-600' },
              { key: 'ambiguous', label: 'Uneindeutig (manuell prüfen)', count: ambiguous.length, color: 'text-amber-600 border-amber-600' },
              { key: 'no_match', label: 'Neu anzulegen', count: noMatch.length, color: 'text-indigo-600 border-indigo-600' },
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