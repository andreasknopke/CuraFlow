import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useMasterAuth } from '@/master/MasterAuthProvider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Users, Clock, CalendarX2, Database, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function MasterDashboard() {
  const { user } = useMasterAuth();

  // Mandanten (DB-Tokens) laden
  const { data: tenants = [], isLoading: tenantsLoading } = useQuery({
    queryKey: ['master-tenants'],
    queryFn: async () => {
      try {
        const response = await api.request('/api/admin/db-tokens');
        return response;
      } catch {
        return [];
      }
    },
  });

  // Aggregierte Daten von der Master-API laden
  const { data: masterStats, isLoading: statsLoading } = useQuery({
    queryKey: ['master-stats'],
    queryFn: async () => {
      try {
        const response = await api.request('/api/master/stats');
        return response;
      } catch {
        return null;
      }
    },
  });

  const activeTenants = tenants.filter(t => t.is_active);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">
          Willkommen, {user?.full_name || user?.email}. Überblick über alle Mandanten.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={Building2}
          label="Mandanten"
          value={tenantsLoading ? '…' : tenants.length}
          sub={`${activeTenants.length} aktiv`}
          color="indigo"
        />
        <SummaryCard
          icon={Users}
          label="Mitarbeiter gesamt"
          value={statsLoading ? '…' : (masterStats?.totalStaff ?? '–')}
          sub="Über alle Mandanten"
          color="emerald"
        />
        <SummaryCard
          icon={Clock}
          label="Zeiterfassung"
          value="–"
          sub="Noch nicht konfiguriert"
          color="amber"
        />
        <SummaryCard
          icon={CalendarX2}
          label="Fehlzeiten heute"
          value={statsLoading ? '…' : (masterStats?.absencesToday ?? '–')}
          sub="Krank + Urlaub + Frei"
          color="red"
        />
      </div>

      {/* Mandanten-Übersicht */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Mandanten
          </CardTitle>
          <CardDescription>
            Übersicht aller verbundenen Mandanten-Datenbanken
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tenantsLoading ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Mandanten werden geladen…
            </div>
          ) : tenants.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Keine Mandanten konfiguriert.</p>
              <p className="text-sm mt-1">DB-Tokens können im CuraFlow Admin-Bereich angelegt werden.</p>
            </div>
          ) : (
            <div className="divide-y">
              {tenants.map((tenant) => (
                <div key={tenant.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${tenant.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <div>
                      <p className="font-medium text-slate-900">{tenant.name}</p>
                      <p className="text-xs text-slate-500">
                        {tenant.host} / {tenant.db_name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {tenant.description && (
                      <span className="text-xs text-slate-400 max-w-[200px] truncate">
                        {tenant.description}
                      </span>
                    )}
                    <Badge variant={tenant.is_active ? 'default' : 'secondary'} className="text-xs">
                      {tenant.is_active ? 'Aktiv' : 'Inaktiv'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, sub, color }) {
  const colorMap = {
    indigo: 'bg-indigo-50 text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-slate-500">{label}</p>
            <p className="text-3xl font-bold text-slate-900 mt-1">{value}</p>
            <p className="text-xs text-slate-400 mt-1">{sub}</p>
          </div>
          <div className={`p-2.5 rounded-lg ${colorMap[color]}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
