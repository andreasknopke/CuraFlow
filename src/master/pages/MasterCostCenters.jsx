import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Building2, Search, Download, Loader2, Hash, MapPin,
  Check, X, Database,
} from 'lucide-react';

function StatCard({ icon: Icon, label, value, color, variant = 'default' }) {
  const variants = {
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

export default function MasterCostCenters() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState('__all__');
  const [pendingLinks, setPendingLinks] = useState({});

  // Fetch cost centers with optional tenant filter
  const { data, isLoading } = useQuery({
    queryKey: ['master-cost-centers', search, selectedTenantId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (selectedTenantId !== '__all__') params.set('tenant_id', selectedTenantId);
      const qs = params.toString();
      return api.request(`/api/master/cost-centers${qs ? '?' + qs : ''}`);
    },
  });

  const costCenters = data?.cost_centers || [];
  const tenants = data?.tenants || [];

  // Selected tenant's currently linked cost center codes
  const selectedTenantCodes = new Set(
    selectedTenantId !== '__all__'
      ? costCenters.filter(cc => cc.tenants.some(t => String(t.tenant_id) === String(selectedTenantId))).map(cc => cc.code)
      : []
  );

  // Init pendingLinks when tenant selection changes
  useEffect(() => {
    if (selectedTenantId !== '__all__') {
      const initial = {};
      for (const code of selectedTenantCodes) {
        initial[code] = true;
      }
      setPendingLinks(initial);
    } else {
      setPendingLinks({});
    }
  }, [selectedTenantId, data]);

  // Import mutation
  const importMutation = useMutation({
    mutationFn: () => api.request('/api/master/cost-centers/import', { method: 'POST' }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['master-cost-centers'] });
      toast.success(`${result.imported} Kostenstellen importiert`);
    },
    onError: (err) => {
      toast.error(`Import fehlgeschlagen: ${err.message}`);
    },
  });

  // Save links mutation
  const saveLinksMutation = useMutation({
    mutationFn: (codes) =>
      api.request(`/api/master/tenants/${selectedTenantId}/cost-centers`, {
        method: 'PUT',
        body: JSON.stringify({ cost_center_codes: codes }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-cost-centers'] });
      toast.success('Kostenstellen verknüpft');
    },
    onError: (err) => {
      toast.error(`Speichern fehlgeschlagen: ${err.message}`);
    },
  });

  const handleToggleLink = (code) => {
    setPendingLinks(prev => {
      const next = { ...prev };
      if (next[code]) {
        delete next[code];
      } else {
        next[code] = true;
      }
      return next;
    });
  };

  const handleSave = () => {
    const codes = Object.keys(pendingLinks).filter(k => pendingLinks[k]);
    saveLinksMutation.mutate(codes);
  };

  const selectedTenantName = tenants.find(t => String(t.id) === String(selectedTenantId))?.name;
  const changed = selectedTenantId !== '__all__' && (
    Object.keys(pendingLinks).length !== selectedTenantCodes.size ||
    [...selectedTenantCodes].some(c => !pendingLinks[c]) ||
    Object.keys(pendingLinks).some(k => pendingLinks[k] && !selectedTenantCodes.has(k))
  );

  return (
    <div className="space-y-6">
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

      {/* Stats */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Hash} label="Kostenstellen" value={costCenters.length} color="bg-indigo-100 text-indigo-600" variant="info" />
          <StatCard icon={Building2} label="Mandanten" value={tenants.length} color="bg-slate-100 text-slate-600" />
          <StatCard
            icon={MapPin}
            label="Verknüpft"
            value={costCenters.filter(cc => cc.tenants.length > 0).length}
            color="bg-emerald-100 text-emerald-600"
            variant="success"
          />
          <StatCard
            icon={Database}
            label="Quelle"
            value="Stammdaten"
            color="bg-amber-100 text-amber-600"
            variant="warning"
          />
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Code oder Bezeichnung suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-500 whitespace-nowrap">Mandant:</Label>
          <select
            value={selectedTenantId}
            onChange={(e) => {
              setSelectedTenantId(e.target.value);
              setPendingLinks({});
            }}
            className="text-sm border rounded px-3 py-1.5 bg-white"
          >
            <option value="__all__">Alle Mandanten</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        <Button
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending}
          variant="outline"
          className="gap-2"
        >
          {importMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Aus Stammdaten importieren
        </Button>
      </div>

      {/* Tenant info */}
      {selectedTenantId !== '__all__' && selectedTenantName && (
        <Card className="border-indigo-200 bg-indigo-50/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-indigo-800">
                Verknüpfungen für: {selectedTenantName}
              </p>
              <p className="text-xs text-indigo-600">
                {Object.keys(pendingLinks).filter(k => pendingLinks[k]).length} Kostenstellen ausgewählt
              </p>
            </div>
            {changed && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saveLinksMutation.isPending}
                className="gap-1.5"
              >
                {saveLinksMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Verknüpfungen speichern
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-3" />
          Kostenstellen werden geladen…
        </div>
      )}

      {/* Cost center list */}
      {!isLoading && costCenters.length === 0 && (
        <Card className="border-dashed border-2 border-slate-200 bg-slate-50">
          <CardContent className="p-12 text-center">
            <Hash className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-slate-600 mb-2">Keine Kostenstellen</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Bitte führe zuerst den Import aus der Stammdaten-Datenbank durch.
            </p>
            <Button className="mt-4 gap-2" onClick={() => importMutation.mutate()}>
              <Download className="w-4 h-4" />
              Aus Stammdaten importieren
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && costCenters.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Hash className="w-5 h-5 text-indigo-600" />
              Kostenstellen ({costCenters.length})
            </CardTitle>
            <CardDescription>
              {selectedTenantId === '__all__'
                ? 'Liste aller Kostenstellen aus der Stammdaten-Datenbank.'
                : `Wähle Kostenstellen aus, die dem Mandanten "${selectedTenantName}" zugeordnet werden sollen.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[calc(100vh-500px)]">
              <div className="divide-y divide-slate-100">
                {costCenters.map(cc => {
                  const isChecked = selectedTenantId === '__all__'
                    ? cc.tenants.length > 0
                    : pendingLinks[cc.code] || false;

                  return (
                    <div
                      key={cc.code}
                      className="flex items-center gap-4 px-4 py-2.5 hover:bg-slate-50 transition-colors"
                    >
                      {selectedTenantId !== '__all__' && (
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => handleToggleLink(cc.code)}
                        />
                      )}
                      {selectedTenantId === '__all__' && (
                        <div className="w-5 flex-shrink-0">
                          {cc.tenants.length > 0 ? (
                            <Check className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <X className="w-4 h-4 text-slate-300" />
                          )}
                        </div>
                      )}
                      <div className="flex-1 min-w-0 flex items-center gap-4">
                        <code className="text-sm font-mono font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded whitespace-nowrap">
                          {cc.code}
                        </code>
                        <span className="text-sm text-slate-700 truncate">{cc.name}</span>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {cc.tenants.length === 0 && (
                          <Badge variant="outline" className="text-xs text-slate-400">Kein Mandant</Badge>
                        )}
                        {cc.tenants.map(t => (
                          <Badge key={t.tenant_id} variant="secondary" className="text-xs">
                            {t.tenant_name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
