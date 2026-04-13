import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Users, Loader2, Building2, Search, ChevronRight,
  Clock, CalendarDays, FileText, TrendingUp, TrendingDown, Minus,
  UserCheck, UserX, Plus,
} from 'lucide-react';

export default function MasterEmployeeList() {
  const navigate = useNavigate();
  const [selectedTenant, setSelectedTenant] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('central'); // 'central' | 'legacy'

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

  // Zentrale Mitarbeiter laden (Employee-Tabelle)
  const { data: centralData, isLoading: centralLoading } = useQuery({
    queryKey: ['master-central-employees'],
    queryFn: async () => {
      try {
        return await api.request('/api/master/employees?active=true');
      } catch {
        return { employees: [] };
      }
    },
  });

  // Legacy-Mitarbeiterdaten laden (Tenant Doctor-Tabelle, Backward-Kompatibilität)
  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ['master-legacy-staff', selectedTenant],
    queryFn: async () => {
      try {
        const params = selectedTenant !== 'all'
          ? `?tenantId=${selectedTenant}`
          : '';
        return await api.request(`/api/master/staff${params}`);
      } catch {
        return { staff: [] };
      }
    },
  });

  const centralEmployees = centralData?.employees ?? [];
  const legacyStaff = staffData?.staff ?? [];
  const isLoading = centralLoading || staffLoading;

  // Nicht-verlinkte Legacy-Mitarbeiter (haben kein central_employee_id)
  const unlinkedStaff = useMemo(() => {
    return legacyStaff.filter(s => !s.central_employee_id);
  }, [legacyStaff]);

  // Aktive Liste je nach Ansicht
  const activeList = viewMode === 'central' ? centralEmployees : unlinkedStaff;

  // Suche filtern
  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return activeList;
    const q = searchQuery.toLowerCase();
    if (viewMode === 'central') {
      return activeList.filter((e) =>
        e.last_name?.toLowerCase().includes(q) ||
        e.first_name?.toLowerCase().includes(q) ||
        e.payroll_id?.toLowerCase().includes(q) ||
        e.work_time_model_name?.toLowerCase().includes(q)
      );
    }
    return activeList.filter((s) =>
      s.name?.toLowerCase().includes(q) ||
      s.tenantName?.toLowerCase().includes(q) ||
      s.role?.toLowerCase().includes(q)
    );
  }, [activeList, searchQuery, viewMode]);

  // KPI-Statistiken
  const stats = useMemo(() => ({
    centralTotal: centralEmployees.length,
    centralActive: centralEmployees.filter((e) => e.is_active).length,
    unlinked: unlinkedStaff.length,
    tenantCount: new Set([
      ...centralEmployees.flatMap(e => (e.assignments || []).map(a => a.tenant_name)),
      ...legacyStaff.map(s => s.tenantName),
    ].filter(Boolean)).size,
  }), [centralEmployees, unlinkedStaff, legacyStaff]);

  const displayName = (emp) => {
    if (emp.first_name && emp.last_name) return `${emp.first_name} ${emp.last_name}`;
    if (emp.last_name) return emp.last_name;
    return emp.name || '–';
  };

  return (
    <div className="space-y-6">
      {/* Seitenkopf */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mitarbeiterverwaltung</h1>
          <p className="text-slate-500 mt-1">
            Zentrale Verwaltung aller Mitarbeiter – Verträge, Arbeitsmodelle, Urlaub und Zeitkonten
          </p>
        </div>
        <Button onClick={() => navigate('/mitarbeiter/neu')} size="sm">
          <Plus className="w-4 h-4 mr-2" />
          Neuer Mitarbeiter
        </Button>
      </div>

      {/* KPI-Karten */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Zentral erfasst" value={stats.centralTotal} />
        <StatCard icon={UserCheck} label="Aktiv" value={stats.centralActive} color="emerald" />
        <StatCard icon={UserX} label="Nur lokal" value={stats.unlinked} color="amber" />
        <StatCard icon={Building2} label="Mandanten" value={stats.tenantCount} color="indigo" />
      </div>

      {/* Ansichtswechsel + Filter & Suche */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border bg-white overflow-hidden">
          <button
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === 'central' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setViewMode('central')}
          >
            Zentral ({centralEmployees.length})
          </button>
          <button
            className={`px-3 py-1.5 text-sm font-medium transition-colors border-l ${viewMode === 'legacy' ? 'bg-amber-50 text-amber-700' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setViewMode('legacy')}
          >
            Nur lokal ({unlinkedStaff.length})
          </button>
        </div>

        {viewMode === 'legacy' && (
          <Select value={selectedTenant} onValueChange={setSelectedTenant}>
            <SelectTrigger className="w-52">
              <Building2 className="w-4 h-4 mr-2 text-slate-400" />
              <SelectValue placeholder="Mandant wählen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Mandanten</SelectItem>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Mitarbeiter suchen…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Badge variant="outline" className="text-xs">
          {filteredList.length} Ergebnis{filteredList.length !== 1 ? 'se' : ''}
        </Badge>
      </div>

      {/* Mitarbeiter-Tabelle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            {viewMode === 'central' ? 'Zentrale Mitarbeiter' : 'Nur lokal erfasste Mitarbeiter'}
          </CardTitle>
          <CardDescription>
            {viewMode === 'central'
              ? 'In der zentralen Employee-Tabelle erfasste Mitarbeiter mit Mandantenzuordnungen'
              : 'Mitarbeiter die nur in Mandanten-Datenbanken existieren (z.B. Externe, Studenten). Können mit zentralen Einträgen verknüpft werden.'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Mitarbeiterdaten werden geladen…
            </div>
          ) : filteredList.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">Keine Mitarbeiter gefunden</p>
              <p className="text-sm mt-1">
                {searchQuery
                  ? 'Passen Sie Ihre Suche an.'
                  : viewMode === 'central'
                    ? 'Noch keine zentralen Mitarbeiter angelegt. Erstellen Sie einen neuen Eintrag oder führen Sie die Datenmigration durch.'
                    : 'Alle Mandanten-Mitarbeiter sind bereits zentral verknüpft.'}
              </p>
            </div>
          ) : viewMode === 'central' ? (
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Arbeitszeitmodell</TableHead>
                    <TableHead>Vertragsart</TableHead>
                    <TableHead>Mandanten</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredList.map((emp) => (
                    <TableRow
                      key={emp.id}
                      className="cursor-pointer hover:bg-indigo-50/50 transition-colors"
                      onClick={() => navigate(`/mitarbeiter/central/${emp.id}`)}
                    >
                      <TableCell>
                        <div>
                          <span className="font-medium">{displayName(emp)}</span>
                          {emp.former_name && (
                            <span className="text-xs text-slate-400 ml-1">(geb. {emp.former_name})</span>
                          )}
                          {(!emp.first_name) && (
                            <Badge variant="outline" className="ml-2 text-[10px] text-amber-600 border-amber-200">
                              Name prüfen
                            </Badge>
                          )}
                        </div>
                        {emp.payroll_id && (
                          <span className="text-xs text-slate-400">#{emp.payroll_id}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {emp.work_time_model_name || (
                            emp.target_hours_per_week
                              ? `${emp.target_hours_per_week}h / Woche`
                              : '–'
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {emp.contract_type ? (
                          <Badge variant="secondary" className="text-xs capitalize">
                            {emp.contract_type}
                          </Badge>
                        ) : (
                          <span className="text-slate-400">–</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(emp.assignments || []).length > 0 ? (
                            emp.assignments.map((a) => (
                              <Badge key={a.tenant_id} variant="outline" className="text-[10px]">
                                <Building2 className="w-2.5 h-2.5 mr-0.5" />
                                {a.tenant_name || a.tenant_id}
                                {a.fte_share < 1 && ` (${Math.round(a.fte_share * 100)}%)`}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-slate-400">Keine Zuordnung</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${emp.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>
                          <span className={`w-2 h-2 rounded-full ${emp.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          {emp.is_active ? 'Aktiv' : 'Inaktiv'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="w-4 h-4 text-slate-300" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            /* Legacy / Nur-lokal Ansicht */
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mandant</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Funktion / Rolle</TableHead>
                    <TableHead>Arbeitsmodell</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredList.map((staff, i) => (
                    <TableRow
                      key={`${staff.tenantId}-${staff.id}-${i}`}
                      className="cursor-pointer hover:bg-amber-50/50 transition-colors"
                      onClick={() => navigate(`/mitarbeiter/${staff.tenantId || 'default'}/${staff.id}`)}
                    >
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          <Building2 className="w-3 h-3 mr-1" />
                          {staff.tenantName || '–'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{staff.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {staff.role || '–'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {staff.target_hours_per_week
                            ? `${staff.target_hours_per_week}h / Woche`
                            : '–'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${staff.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>
                          <span className={`w-2 h-2 rounded-full ${staff.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          {staff.is_active ? 'Aktiv' : 'Inaktiv'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="w-4 h-4 text-slate-300" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Hilfskomponenten ── */

function StatCard({ icon: Icon, label, value, color = 'slate' }) {
  const colorMap = {
    slate: 'text-slate-900 bg-white',
    emerald: 'text-emerald-700 bg-emerald-50',
    amber: 'text-amber-700 bg-amber-50',
    indigo: 'text-indigo-700 bg-indigo-50',
    red: 'text-red-700 bg-red-50',
  };
  return (
    <div className={`p-4 rounded-xl border ${colorMap[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 opacity-50" />
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
