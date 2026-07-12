import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Link2, Loader2, Plus, Trash2 } from 'lucide-react';

const DEFAULT_GROUP_FORM = { name: '', description: '' };

export default function WorkplaceLinkManagement() {
    const queryClient = useQueryClient();

    const [showGroupDialog, setShowGroupDialog] = useState(false);
    const [groupForm, setGroupForm] = useState(DEFAULT_GROUP_FORM);
    const [memberTenantId, setMemberTenantId] = useState('');
    const [memberWorkplaceName, setMemberWorkplaceName] = useState('');
    const [addingToGroupId, setAddingToGroupId] = useState(null);

    const { data: tenants = [] } = useQuery({
        queryKey: ['serverDbTokens'],
        queryFn: () => api.request('/api/admin/db-tokens'),
        staleTime: 30_000,
    });

    const { data: groupsResponse, isLoading: groupsLoading } = useQuery({
        queryKey: ['admin', 'workplace-link-groups'],
        queryFn: () => api.listWorkplaceLinkGroups(),
        staleTime: 10_000,
    });

    const groups = useMemo(
        () => (Array.isArray(groupsResponse?.groups) ? groupsResponse.groups : []),
        [groupsResponse]
    );

    const { data: tenantWorkplacesResponse, isFetching: tenantWorkplacesLoading } = useQuery({
        queryKey: ['admin', 'tenant-workplace-names', memberTenantId],
        queryFn: () => api.getTenantWorkplaceNames(memberTenantId),
        enabled: !!memberTenantId,
        staleTime: 10_000,
    });

    const tenantWorkplaceNames = Array.isArray(tenantWorkplacesResponse?.names) ? tenantWorkplacesResponse.names : [];

    const invalidateGroups = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'workplace-link-groups'] });
        queryClient.invalidateQueries({ queryKey: ['workplace-links', 'visible-links'] });
    };

    const createGroupMutation = useMutation({
        mutationFn: (data) => api.createWorkplaceLinkGroup(data),
        onSuccess: () => {
            invalidateGroups();
            setShowGroupDialog(false);
            setGroupForm(DEFAULT_GROUP_FORM);
            toast.success('Verknüpfung erstellt');
        },
        onError: (err) => toast.error(err?.message || 'Fehler beim Erstellen'),
    });

    const deleteGroupMutation = useMutation({
        mutationFn: (groupId) => api.deleteWorkplaceLinkGroup(groupId),
        onSuccess: () => {
            invalidateGroups();
            toast.success('Verknüpfung gelöscht');
        },
        onError: (err) => toast.error(err?.message || 'Fehler beim Löschen'),
    });

    const addMemberMutation = useMutation({
        mutationFn: ({ groupId, tenantId, workplaceName }) =>
            api.addWorkplaceLinkMember(groupId, tenantId, workplaceName),
        onSuccess: () => {
            invalidateGroups();
            setMemberTenantId('');
            setMemberWorkplaceName('');
            setAddingToGroupId(null);
            toast.success('Arbeitsplatz hinzugefügt');
        },
        onError: (err) => toast.error(err?.message || 'Fehler beim Hinzufügen'),
    });

    const removeMemberMutation = useMutation({
        mutationFn: ({ groupId, memberId }) => api.removeWorkplaceLinkMember(groupId, memberId),
        onSuccess: () => {
            invalidateGroups();
            toast.success('Arbeitsplatz entfernt');
        },
        onError: (err) => toast.error(err?.message || 'Fehler beim Entfernen'),
    });

    const tenantName = (tenantId) => tenants.find((t) => String(t.id) === String(tenantId))?.name || tenantId;

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Link2 className="w-5 h-5 text-indigo-600" />
                            Arbeitsplatz-Verknüpfungen
                        </CardTitle>
                        <CardDescription>
                            Verknüpft Arbeitsplätze über Mandantengrenzen hinweg rein lesend — z.B. das ärztliche
                            „CT" mit den MTR-Arbeitsplätzen „CT1"/„CT2". In der Tagesansicht wird dann die Besetzung
                            der verknüpften Gegenseite zusätzlich angezeigt. Es findet keine Übertragung von
                            Zugriffsrechten oder Schreibzugriffen statt.
                        </CardDescription>
                    </div>
                    <Button onClick={() => setShowGroupDialog(true)} size="sm">
                        <Plus className="w-4 h-4 mr-1" /> Neue Verknüpfung
                    </Button>
                </CardHeader>
                <CardContent>
                    {groupsLoading ? (
                        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
                    ) : groups.length === 0 ? (
                        <p className="text-sm text-slate-500 py-4 text-center">Noch keine Verknüpfungen angelegt.</p>
                    ) : (
                        <div className="space-y-4">
                            {groups.map((group) => (
                                <div key={group.id} className="border border-slate-200 rounded-lg p-4">
                                    <div className="flex items-start justify-between mb-3">
                                        <div>
                                            <h3 className="font-semibold text-slate-800">{group.name}</h3>
                                            {group.description && (
                                                <p className="text-xs text-slate-500 mt-0.5">{group.description}</p>
                                            )}
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-red-500 hover:bg-red-50"
                                            onClick={() => {
                                                if (window.confirm(`Verknüpfung „${group.name}" wirklich löschen?`)) {
                                                    deleteGroupMutation.mutate(group.id);
                                                }
                                            }}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>

                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {group.members.map((member) => (
                                            <Badge key={member.id} variant="secondary" className="flex items-center gap-1.5 py-1">
                                                <span className="font-medium">{tenantName(member.tenant_id)}</span>
                                                <span className="text-slate-400">/</span>
                                                <span>{member.workplace_name}</span>
                                                <button
                                                    type="button"
                                                    className="ml-1 text-slate-400 hover:text-red-600"
                                                    onClick={() => removeMemberMutation.mutate({ groupId: group.id, memberId: member.id })}
                                                    title="Entfernen"
                                                >
                                                    ×
                                                </button>
                                            </Badge>
                                        ))}
                                        {group.members.length === 0 && (
                                            <span className="text-xs text-slate-400">Noch keine Arbeitsplätze verknüpft.</span>
                                        )}
                                    </div>

                                    {addingToGroupId === group.id ? (
                                        <div className="flex flex-wrap items-end gap-2 bg-slate-50 rounded-md p-3">
                                            <div className="min-w-[180px]">
                                                <Label className="text-xs">Mandant</Label>
                                                <Select value={memberTenantId} onValueChange={setMemberTenantId}>
                                                    <SelectTrigger className="h-8"><SelectValue placeholder="Mandant wählen" /></SelectTrigger>
                                                    <SelectContent>
                                                        {tenants.map((tenant) => (
                                                            <SelectItem key={tenant.id} value={String(tenant.id)}>{tenant.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="min-w-[200px]">
                                                <Label className="text-xs">Arbeitsplatz</Label>
                                                {tenantWorkplaceNames.length > 0 ? (
                                                    <Select value={memberWorkplaceName} onValueChange={setMemberWorkplaceName}>
                                                        <SelectTrigger className="h-8">
                                                            <SelectValue placeholder={tenantWorkplacesLoading ? 'Lädt…' : 'Arbeitsplatz wählen'} />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {tenantWorkplaceNames.map((name) => (
                                                                <SelectItem key={name} value={name}>{name}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <Input
                                                        className="h-8"
                                                        placeholder="Name eingeben"
                                                        value={memberWorkplaceName}
                                                        onChange={(e) => setMemberWorkplaceName(e.target.value)}
                                                        disabled={!memberTenantId}
                                                    />
                                                )}
                                            </div>
                                            <Button
                                                size="sm"
                                                disabled={!memberTenantId || !memberWorkplaceName.trim() || addMemberMutation.isPending}
                                                onClick={() => addMemberMutation.mutate({
                                                    groupId: group.id,
                                                    tenantId: memberTenantId,
                                                    workplaceName: memberWorkplaceName.trim(),
                                                })}
                                            >
                                                Hinzufügen
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => {
                                                    setAddingToGroupId(null);
                                                    setMemberTenantId('');
                                                    setMemberWorkplaceName('');
                                                }}
                                            >
                                                Abbrechen
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button size="sm" variant="outline" onClick={() => setAddingToGroupId(group.id)}>
                                            <Plus className="w-3.5 h-3.5 mr-1" /> Arbeitsplatz hinzufügen
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={showGroupDialog} onOpenChange={setShowGroupDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Neue Arbeitsplatz-Verknüpfung</DialogTitle>
                        <DialogDescription>
                            Lege einen Namen fest, z.B. „CT – ärztlich/MTR". Arbeitsplätze fügst du danach hinzu.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div>
                            <Label>Name</Label>
                            <Input
                                value={groupForm.name}
                                onChange={(e) => setGroupForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="z.B. CT – ärztlich/MTR"
                            />
                        </div>
                        <div>
                            <Label>Beschreibung (optional)</Label>
                            <Input
                                value={groupForm.description}
                                onChange={(e) => setGroupForm((f) => ({ ...f, description: e.target.value }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowGroupDialog(false)}>Abbrechen</Button>
                        <Button
                            disabled={!groupForm.name.trim() || createGroupMutation.isPending}
                            onClick={() => createGroupMutation.mutate(groupForm)}
                        >
                            Erstellen
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
