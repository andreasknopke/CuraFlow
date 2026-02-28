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
} from 'lucide-react';

export default function MasterEmployeeList() {
  const navigate = useNavigate();
  const [selectedTenant, setSelectedTenant] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

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

  // Mitarbeiterdaten laden
  const { data: staffData, isLoading } = useQuery({
    queryKey: ['master-employees', selectedTenant],
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

  const staffList = staffData?.staff ?? [];

  // Suche filtern
  const filteredStaff = useMemo(() => {
    if (!searchQuery.trim()) return staffList;
    const q = searchQuery.toLowerCase();
    return staffList.filter((s) =>
      s.name?.toLowerCase().includes(q) ||
      s.tenantName?.toLowerCase().includes(q) ||
      s.role?.toLowerCase().includes(q)
    );
  }, [staffList, searchQuery]);

  // KPI-Statistiken
  const stats = useMemo(() => ({
    total: filteredStaff.length,
    active: filteredStaff.filter((s) => s.is_active).length,
    inactive: filteredStaff.filter((s) => !s.is_active).length,
    tenantCount: new Set(filteredStaff.map((s) => s.tenantName)).size,
  }), [filteredStaff]);

  return (
    <div className="space-y-6">
      {/* Seitenkopf */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Mitarbeiterverwaltung</h1>
        <p className="text-slate-500 mt-1">
          Zentrale Verwaltung aller Mitarbeiter über alle Mandanten – Verträge, Arbeitsmodelle, Urlaub und Zeitkonten
        </p>
      </div>

      {/* KPI-Karten */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Gesamt" value={stats.total} />
        <StatCard icon={Users} label="Aktiv" value={stats.active} color="emerald" />
        <StatCard icon={Users} label="Inaktiv" value={stats.inactive} color="slate" />
        <StatCard icon={Building2} label="Mandanten" value={stats.tenantCount} color="indigo" />
      </div>

      {/* Filter & Suche */}
      <div className="flex flex-wrap items-center gap-3">
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
          {filteredStaff.length} Ergebnis{filteredStaff.length !== 1 ? 'se' : ''}
        </Badge>
      </div>

      {/* Mitarbeiter-Tabelle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Mitarbeiterverzeichnis
          </CardTitle>
          <CardDescription>
            Klicken Sie auf einen Mitarbeiter, um Details zu Vertrag, Arbeitsmodell, Urlaub und Zeitkonto einzusehen
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Mitarbeiterdaten werden geladen…
            </div>
          ) : filteredStaff.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">Keine Mitarbeiter gefunden</p>
              <p className="text-sm mt-1">
                {searchQuery
                  ? 'Passen Sie Ihre Suche an.'
                  : 'Stellen Sie sicher, dass Mandanten konfiguriert sind.'}
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mandant</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Funktion / Rolle</TableHead>
                    <TableHead>Arbeitsmodell</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Resturlaub</TableHead>
                    <TableHead className="text-right">Überstunden</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStaff.map((staff, i) => (
                    <TableRow
                      key={`${staff.tenantId}-${staff.id}-${i}`}
                      className="cursor-pointer hover:bg-indigo-50/50 transition-colors"
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
                      <TableCell className="text-right text-sm">
                        <span className="flex items-center justify-end gap-1">
                          <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                          {staff.remaining_vacation != null ? `${staff.remaining_vacation} T` : '–'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        <OvertimeBadge hours={staff.overtime_balance} />
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

function OvertimeBadge({ hours }) {
  if (hours == null) return <span className="text-slate-400">–</span>;
  const isPositive = hours > 0;
  const isNegative = hours < 0;
  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  const color = isPositive ? 'text-emerald-600' : isNegative ? 'text-red-600' : 'text-slate-500';
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${color}`}>
      <Icon className="w-3.5 h-3.5" />
      {isPositive ? '+' : ''}{hours}h
    </span>
  );
}
