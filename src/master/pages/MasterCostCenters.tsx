import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import {
  Building2, Search, Download, Loader2, Hash, MapPin,
  Check, X, Database, Plus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CostCenterTenantLink, Tenant, CostCenterData } from '@/types/master';

function StatCard({ icon: Icon, label, value, color, variant = 'default' }: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  color: string;
  variant?: 'default' | 'info' | 'success' | 'warning';
}) {
  const variants: Record<string, string> = {
    default: 'bg-white border-slate-200',
    info: 'bg-indigo-50 border-indigo-200',
    success: 'bg-emerald-50 border-emerald-200',
    warning: 'bg-amber-50 border-amber-200',
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

function TenantPopover({ costCenterCode, linkedTenants, allTenants, onToggle }: {
  costCenterCode: string;
  linkedTenants: CostCenterTenantLink[];
  allTenants: Tenant[];
  onToggle: (costCenterCode: string, tenantId: string, linked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 flex-shrink-0 focus:outline-none group min-w-0"
          title="Mandanten zuordnen"
        >
          {linkedTenants.length === 0 ? (
            <Badge variant="outline" className="text-xs text-slate-400 hover:text-indigo-600 hover:border-indigo-300 cursor-pointer transition-colors whitespace-nowrap">
              Kein Mandant
              <Plus className="w-3 h-3 ml-0.5 opacity-50 group-hover:opacity-100" />
            </Badge>
          ) : (
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {linkedTenants.map(t => (
                <Badge key={t.tenant_id} variant="secondary" className="text-xs cursor-pointer hover:bg-slate-200 transition-colors whitespace-nowrap">
                  {t.tenant_name}
                </Badge>
              ))}
              <span className="text-slate-300 group-hover:text-indigo-400 transition-colors flex-shrink-0">
                <Plus className="w-3.5 h-3.5" />
              </span>
            </div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="px-3 py-2 border-b shrink-0">
          <p className="text-xs font-medium text-slate-700">
            Mandanten für <code className="text-indigo-600">{costCenterCode}</code>
          </p>
        </div>
        <div className="overflow-y-auto max-h-64">
          <div className="p-2 space-y-0.5">
            {allTenants.length === 0 && (
              <p className="text-xs text-slate-400 px-2 py-2">Keine Mandanten verfügbar</p>
            )}
            {allTenants.map(tenant => {
              const isLinked = linkedTenants.some(t => String(t.tenant_id) === String(tenant.id));
              return (
                <label
                  key={tenant.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-100 cursor-pointer"
                >
                  <Checkbox
                    checked={isLinked}
                    onCheckedChange={() => { onToggle(costCenterCode, tenant.id, !isLinked); }}
                  />
                  <span className="text-sm text-slate-700">{tenant.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function MasterCostCenters() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<CostCenterData>({
    queryKey: ['master-cost-centers', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const qs = params.toString();
      return api.request(`/api/master/cost-centers${qs ? '?' + qs : ''}`) as Promise<CostCenterData>;
    },
  });

  const costCenters = data?.cost_centers || [];
  const tenants = data?.tenants || [];

  const importMutation = useMutation({
    mutationFn: () => api.request('/api/master/cost-centers/import', { method: 'POST' }),
    onSuccess: (result: unknown) => {
      queryClient.invalidateQueries({ queryKey: ['master-cost-centers'] });
      toast.success(`${(result as { imported: number }).imported} Kostenstellen importiert`);
    },
    onError: (err: Error) => toast.error(`Import fehlgeschlagen: ${err.message}`),
  });

  const toggleTenantMutation = useMutation({
    mutationFn: ({ costCenterCode, tenantId, linked }: { costCenterCode: string; tenantId: string; linked: boolean }) =>
      api.request(`/api/master/cost-centers/${encodeURIComponent(costCenterCode)}/tenants/${encodeURIComponent(tenantId)}`, {
        method: linked ? 'PUT' : 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-cost-centers'] });
    },
    onError: (err: Error) => toast.error(`Verknüpfung fehlgeschlagen: ${err.message}`),
  });

  const handleToggleTenant = (costCenterCode: string, tenantId: string, linked: boolean) => {
    toggleTenantMutation.mutate({ costCenterCode, tenantId, linked });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Building2 className="w-6 h-6 text-indigo-600" />
          Kostenstellen
        </h1>
        <p className="text-slate-500 mt-1">
          Verwaltung von Kostenstellen und deren Zuordnung zu Mandanten.
          Die Daten stammen aus der externen Stammdaten-Datenbank.
        </p>
      </div>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Hash} label="Kostenstellen" value={costCenters.length} color="bg-indigo-100 text-indigo-600" variant="info" />
          <StatCard icon={Building2} label="Mandanten" value={tenants.length} color="bg-slate-100 text-slate-600" />
          <StatCard icon={MapPin} label="Verknüpft" value={costCenters.filter(cc => cc.tenants.length > 0).length} color="bg-emerald-100 text-emerald-600" variant="success" />
          <StatCard icon={Database} label="Quelle" value="Stammdaten" color="bg-amber-100 text-amber-600" variant="warning" />
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Code oder Bezeichnung suchen…" value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); }} className="pl-8" />
        </div>
        <div className="flex-1" />
        <Button onClick={() => { importMutation.mutate(); }} disabled={importMutation.isPending} variant="outline" className="gap-2">
          {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Aus Stammdaten importieren
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-3" />
          Kostenstellen werden geladen…
        </div>
      )}

      {!isLoading && costCenters.length === 0 && (
        <Card className="border-dashed border-2 border-slate-200 bg-slate-50">
          <CardContent className="p-12 text-center">
            <Hash className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-slate-600 mb-2">Keine Kostenstellen</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Bitte führe zuerst den Import aus der Stammdaten-Datenbank durch.
            </p>
            <Button className="mt-4 gap-2" onClick={() => { importMutation.mutate(); }}>
              <Download className="w-4 h-4" /> Aus Stammdaten importieren
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && costCenters.length > 0 && (
        <Card className="flex flex-col overflow-hidden">
          <CardHeader className="pb-3 shrink-0">
            <CardTitle className="flex items-center gap-2">
              <Hash className="w-5 h-5 text-indigo-600" />
              Kostenstellen ({costCenters.length})
            </CardTitle>
            <CardDescription>
              Klicke auf einen Mandanten-Badge oder „Kein Mandant", um Mandanten per Checkbox zuzuordnen.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0">
            <ScrollArea className="h-[calc(100vh-440px)]">
              <div className="divide-y divide-slate-100">
                <div className="flex items-center gap-4 px-4 py-2 bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wider sticky top-0">
                  <div className="w-5" />
                  <div className="flex-1 flex items-center gap-4">
                    <span className="w-24">Code</span>
                    <span>Bezeichnung</span>
                  </div>
                  <div className="w-64 text-right">Mandanten</div>
                </div>
                {costCenters.map(cc => (
                  <div key={cc.code} className="flex items-center gap-4 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                    <div className="w-5 flex-shrink-0">
                      {cc.tenants.length > 0 ? (
                        <Check className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <X className="w-4 h-4 text-slate-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex items-center gap-4">
                      <code className="text-sm font-mono font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded w-24 text-center flex-shrink-0">
                        {cc.code}
                      </code>
                      <span className="text-sm text-slate-700 truncate">{cc.name}</span>
                    </div>
                    <div className="w-64 flex justify-end flex-shrink-0">
                      <TenantPopover
                        costCenterCode={cc.code}
                        linkedTenants={cc.tenants}
                        allTenants={tenants}
                        onToggle={handleToggleTenant}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
