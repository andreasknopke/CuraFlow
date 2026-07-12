import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Building2, Clock, Globe2, Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react';

// ——— local interfaces ———

interface GroupForm {
    name: string;
    description: string;
    is_active: boolean;
}

interface WorkplaceForm {
    name: string;
    ward_tenant_id: string;
    timeslots_enabled: boolean;
    is_active: boolean;
}

interface NormalizedGroup {
    id: number;
    name: string;
    description?: string;
    is_active: boolean;
    [key: string]: unknown;
}

interface TenantRecord {
    id: number;
    name?: string;
    host?: string;
    db_name?: string;
    [key: string]: unknown;
}

interface MemberRecord {
    tenant_id: number;
    name?: string;
    role?: string;
    host?: string;
    db_name?: string;
    [key: string]: unknown;
}

interface RotationWorkplace {
    id: number;
    name: string;
    ward_tenant_id?: number;
    timeslots_enabled?: boolean;
    is_active?: boolean;
    [key: string]: unknown;
}

interface RotationGroupsResponse {
    groups: NormalizedGroup[];
}

interface MembersResponse {
    members: MemberRecord[];
}

interface WorkplacesResponse {
    workplaces: RotationWorkplace[];
}

interface Timeslot {
    id: number;
    label: string;
    start_time?: string;
    end_time?: string;
    [key: string]: unknown;
}

interface TimeslotsResponse {
    timeslots: Timeslot[];
}

interface RotationTimeslotEditorProps {
    groupId: number | null;
    workplace: RotationWorkplace;
    onClose: () => void;
}

interface TimeslotForm {
    label: string;
    start_time: string;
    end_time: string;
    order: number;
}

// ——— defaults ———

const DEFAULT_GROUP_FORM: GroupForm = {
    name: '',
    description: '',
    is_active: true,
};

const DEFAULT_WORKPLACE_FORM: WorkplaceForm = {
    name: '',
    ward_tenant_id: '',
    timeslots_enabled: false,
    is_active: true,
};

function normalizeGroup(group: Record<string, unknown>): NormalizedGroup {
    return {
        ...group,
        id: Number(group.id),
        name: String(group.name ?? ''),
        description: String(group.description ?? ''),
        is_active: Boolean(group.is_active),
    } as NormalizedGroup;
}

export default function RotationGroupManagement() {
    const queryClient = useQueryClient();
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
    const [showGroupDialog, setShowGroupDialog] = useState(false);
    const [editingGroup, setEditingGroup] = useState<NormalizedGroup | null>(null);
    const [groupForm, setGroupForm] = useState<GroupForm>(DEFAULT_GROUP_FORM);
    const [showWorkplaceDialog, setShowWorkplaceDialog] = useState(false);
    const [editingWorkplace, setEditingWorkplace] = useState<RotationWorkplace | null>(null);
    const [workplaceForm, setWorkplaceForm] = useState<WorkplaceForm>(DEFAULT_WORKPLACE_FORM);
    const [timeslotWorkplace, setTimeslotWorkplace] = useState<RotationWorkplace | null>(null);
    const [tenantToAdd, setTenantToAdd] = useState('');
    const [tenantRole, setTenantRole] = useState('ward');

    const { data: groupsResponse, isLoading: groupsLoading } = useQuery<RotationGroupsResponse>({
        queryKey: ['admin', 'rotation-groups'],
        queryFn: () => api.listRotationGroups() as Promise<RotationGroupsResponse>,
        staleTime: 30_000,
    });

    const groups = useMemo(
        () => (Array.isArray(groupsResponse?.groups) ? groupsResponse.groups.map(normalizeGroup) : []),
        [groupsResponse]
    );

    useEffect(() => {
        if (groups.length === 0) {
            setSelectedGroupId(null);
            return;
        }
        const exists = groups.some((group: NormalizedGroup) => group.id === selectedGroupId);
        if (!exists) {
            setSelectedGroupId(groups[0].id);
        }
    }, [groups, selectedGroupId]);

    const selectedGroup = useMemo(
        () => groups.find((group: NormalizedGroup) => group.id === selectedGroupId) || null,
        [groups, selectedGroupId]
    );

    const { data: tenants = [] } = useQuery<TenantRecord[]>({
        queryKey: ['serverDbTokens'],
        queryFn: () => api.request('/api/admin/db-tokens') as Promise<TenantRecord[]>,
        staleTime: 30_000,
    });

    const { data: membersResponse, isLoading: membersLoading } = useQuery<MembersResponse>({
        queryKey: ['admin', 'rotation-group-members', selectedGroupId],
        queryFn: () => api.listRotationGroupMembers(String(selectedGroupId!)) as Promise<MembersResponse>,
        enabled: !!selectedGroupId,
        staleTime: 10_000,
    });

    const { data: workplacesResponse, isLoading: workplacesLoading } = useQuery<WorkplacesResponse>({
        queryKey: ['admin', 'rotation-group-workplaces', selectedGroupId],
        queryFn: () => api.listRotationWorkplaces(String(selectedGroupId!)) as Promise<WorkplacesResponse>,
        enabled: !!selectedGroupId,
        staleTime: 10_000,
    });

    const members = Array.isArray(membersResponse?.members) ? membersResponse.members : [];
    const workplaces = useMemo(
        () => (Array.isArray(workplacesResponse?.workplaces) ? workplacesResponse.workplaces : []),
        [workplacesResponse]
    );

    const availableTenants = useMemo(() => {
        const memberIds = new Set(members.map((member: MemberRecord) => String(member.tenant_id)));
        return tenants.filter((tenant: TenantRecord) => !memberIds.has(String(tenant.id)));
    }, [members, tenants]);

    const invalidateGroups = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'rotation-groups'] });
        queryClient.invalidateQueries({ queryKey: ['users'] });
    };

    const invalidateSelectedGroup = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'rotation-group-members', selectedGroupId] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'rotation-group-workplaces', selectedGroupId] });
        queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
        queryClient.invalidateQueries({ queryKey: ['users'] });
    };

    const createGroupMutation = useMutation({
        mutationFn: (payload: Record<string, unknown>) => api.createRotationGroup(payload),
        onSuccess: (response: unknown) => {
            invalidateGroups();
            const groupId = Number((response as { group?: { id?: number } })?.group?.id);
            if (Number.isInteger(groupId)) {
                setSelectedGroupId(groupId);
            }
            setShowGroupDialog(false);
            setEditingGroup(null);
            setGroupForm(DEFAULT_GROUP_FORM);
            toast.success('Rotationsverbund erstellt');
        },
        onError: (error: Error) => toast.error(error.message || 'Rotationsverbund konnte nicht erstellt werden'),
    });

    const updateGroupMutation = useMutation({
        mutationFn: ({ groupId, payload }: { groupId: number; payload: Record<string, unknown> }) => api.updateRotationGroup(String(groupId), payload),
        onSuccess: () => {
            invalidateGroups();
            setShowGroupDialog(false);
            setEditingGroup(null);
            setGroupForm(DEFAULT_GROUP_FORM);
            toast.success('Rotationsverbund aktualisiert');
        },
        onError: (error: Error) => toast.error(error.message || 'Rotationsverbund konnte nicht aktualisiert werden'),
    });

    const deleteGroupMutation = useMutation({
        mutationFn: (groupId: number) => api.deleteRotationGroup(String(groupId)),
        onSuccess: () => {
            invalidateGroups();
            setSelectedGroupId(null);
            toast.success('Rotationsverbund gelöscht');
        },
        onError: (error: Error) => toast.error(error.message || 'Rotationsverbund konnte nicht gelöscht werden'),
    });

    const addMemberMutation = useMutation({
        mutationFn: ({ groupId, tenantId, role }: { groupId: number; tenantId: string; role: string }) => api.addRotationGroupMember(String(groupId), tenantId, role),
        onSuccess: () => {
            invalidateSelectedGroup();
            setTenantToAdd('');
            setTenantRole('ward');
            toast.success('Mandant hinzugefügt');
        },
        onError: (error: Error) => toast.error(error.message || 'Mandant konnte nicht hinzugefügt werden'),
    });

    const removeMemberMutation = useMutation({
        mutationFn: ({ groupId, tenantId }: { groupId: number; tenantId: number }) => api.removeRotationGroupMember(String(groupId), String(tenantId)),
        onSuccess: () => {
            invalidateSelectedGroup();
            toast.success('Mandant entfernt');
        },
        onError: (error: Error) => toast.error(error.message || 'Mandant konnte nicht entfernt werden'),
    });

    const createWorkplaceMutation = useMutation({
        mutationFn: ({ groupId, payload }: { groupId: number; payload: Record<string, unknown> }) => api.createRotationWorkplace(String(groupId), payload),
        onSuccess: () => {
            invalidateSelectedGroup();
            setShowWorkplaceDialog(false);
            setEditingWorkplace(null);
            setWorkplaceForm(DEFAULT_WORKPLACE_FORM);
            toast.success('Rotation erstellt');
        },
        onError: (error: Error) => toast.error(error.message || 'Rotation konnte nicht erstellt werden'),
    });

    const updateWorkplaceMutation = useMutation({
        mutationFn: ({ groupId, workplaceId, payload }: { groupId: number; workplaceId: number; payload: Record<string, unknown> }) => api.updateRotationWorkplace(String(groupId), String(workplaceId), payload),
        onSuccess: () => {
            invalidateSelectedGroup();
            setShowWorkplaceDialog(false);
            setEditingWorkplace(null);
            setWorkplaceForm(DEFAULT_WORKPLACE_FORM);
            toast.success('Rotation aktualisiert');
        },
        onError: (error: Error) => toast.error(error.message || 'Rotation konnte nicht aktualisiert werden'),
    });

    const deleteWorkplaceMutation = useMutation({
        mutationFn: ({ groupId, workplaceId }: { groupId: number; workplaceId: number }) => api.deleteRotationWorkplace(String(groupId), String(workplaceId)),
        onSuccess: () => {
            invalidateSelectedGroup();
            toast.success('Rotation gelöscht');
        },
        onError: (error: Error) => toast.error(error.message || 'Rotation konnte nicht gelöscht werden'),
    });

    const handleOpenCreateGroup = () => {
        setEditingGroup(null);
        setGroupForm(DEFAULT_GROUP_FORM);
        setShowGroupDialog(true);
    };

    const handleOpenEditGroup = (group: NormalizedGroup) => {
        setEditingGroup(group);
        setGroupForm({
            name: group.name || '',
            description: group.description || '',
            is_active: Boolean(group.is_active),
        });
        setShowGroupDialog(true);
    };

    const handleSaveGroup = () => {
        if (!groupForm.name.trim()) {
            toast.error('Name ist erforderlich');
            return;
        }
        const payload: Record<string, unknown> = {
            name: groupForm.name.trim(),
            description: groupForm.description.trim() || null,
            is_active: Boolean(groupForm.is_active),
        };
        if (editingGroup) {
            updateGroupMutation.mutate({ groupId: editingGroup.id, payload });
            return;
        }
        createGroupMutation.mutate(payload);
    };

    const handleDeleteGroup = (group: NormalizedGroup) => {
        if (!window.confirm(`Rotationsverbund "${group.name}" wirklich löschen?`)) {
            return;
        }
        deleteGroupMutation.mutate(group.id);
    };

    const handleAddTenant = () => {
        if (!selectedGroupId || !tenantToAdd) {
            toast.error('Bitte zuerst einen Mandanten wählen');
            return;
        }
        addMemberMutation.mutate({ groupId: selectedGroupId, tenantId: tenantToAdd, role: tenantRole });
    };

    const handleOpenCreateWorkplace = () => {
        setEditingWorkplace(null);
        setWorkplaceForm(DEFAULT_WORKPLACE_FORM);
        setShowWorkplaceDialog(true);
    };

    const handleOpenEditWorkplace = (workplace: RotationWorkplace) => {
        setEditingWorkplace(workplace);
        setWorkplaceForm({
            name: workplace.name || '',
            ward_tenant_id: workplace.ward_tenant_id ? String(workplace.ward_tenant_id) : '',
            timeslots_enabled: Boolean(workplace.timeslots_enabled),
            is_active: Boolean(workplace.is_active),
        });
        setShowWorkplaceDialog(true);
    };

    const handleSaveWorkplace = () => {
        if (!selectedGroupId) {
            toast.error('Bitte zuerst einen Verbund wählen');
            return;
        }
        if (!workplaceForm.name.trim()) {
            toast.error('Name ist erforderlich');
            return;
        }
        if (!workplaceForm.ward_tenant_id) {
            toast.error('Bitte eine Station (Mandant) wählen');
            return;
        }
        const payload: Record<string, unknown> = {
            name: workplaceForm.name.trim(),
            ward_tenant_id: workplaceForm.ward_tenant_id,
            timeslots_enabled: Boolean(workplaceForm.timeslots_enabled),
            is_active: Boolean(workplaceForm.is_active),
        };
        if (editingWorkplace) {
            updateWorkplaceMutation.mutate({
                groupId: selectedGroupId,
                workplaceId: editingWorkplace.id,
                payload,
            });
            return;
        }
        createWorkplaceMutation.mutate({ groupId: selectedGroupId, payload });
    };

    const handleDeleteWorkplace = (workplace: RotationWorkplace) => {
        if (!selectedGroupId) return;
        if (!window.confirm(`Rotation "${workplace.name}" wirklich löschen?`)) {
            return;
        }
        deleteWorkplaceMutation.mutate({ groupId: selectedGroupId, workplaceId: workplace.id });
    };

    // Ward members for the workplace ward_tenant_id select
    const wardMembers = useMemo(
        () => members.filter((m: MemberRecord) => m.role === 'ward'),
        [members]
    );

    return (
        <div className="space-y-6" data-testid="admin-rotation-group-management">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900">Springerpool-Rotationsverbünde</h2>
                    <p className="text-sm text-slate-500">
                        Rotationsverbünde verwalten Springerpool-Rotationen. Getrennt von Cross-Mandanten-Diensten.
                    </p>
                </div>
                <Button onClick={handleOpenCreateGroup} className="bg-indigo-600 hover:bg-indigo-700" data-testid="admin-rotation-group-create-button">
                    <Plus className="mr-2 h-4 w-4" />
                    Verbund anlegen
                </Button>
            </div>

            <div className="rounded-lg bg-indigo-50 p-3 text-xs text-indigo-700 space-y-1">
                <p><strong>Aufbau eines Rotationsverbunds:</strong></p>
                <ol className="list-decimal pl-4 space-y-0.5">
                    <li><strong>Springerpool-Mandant</strong> als Mitglied mit Rolle <code>pool</code> hinzufügen (genau einer).</li>
                    <li><strong>Stations-Mandanten</strong> als Mitglieder mit Rolle <code>ward</code> hinzufügen (z. B. Gyn1, Gyn2, Gyn3).</li>
                    <li><strong>Rotationen</strong> (Arbeitsplätze) pro Station anlegen — z. B. „Gyn 1", „Gyn 2", „Gyn 3".</li>
                    <li><strong>Zeitfenster</strong> pro Rotation aktivieren (Früh-/Mittel-/Spätdienst).</li>
                </ol>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_1.9fr]">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Globe2 className="h-5 w-5 text-indigo-600" />
                            Rotationsverbünde
                        </CardTitle>
                        <CardDescription>Wähle einen Verbund aus oder lege einen neuen an.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {groupsLoading ? (
                            <div className="flex items-center justify-center py-8 text-sm text-slate-500">
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Verbünde …
                            </div>
                        ) : groups.length === 0 ? (
                            <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">
                                Noch kein Rotationsverbund vorhanden.
                            </div>
                        ) : (
                            groups.map((group: NormalizedGroup) => {
                                const isSelected = group.id === selectedGroupId;
                                return (
                                    <div
                                        key={group.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setSelectedGroupId(group.id)}
                                        onKeyDown={(event: React.KeyboardEvent) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setSelectedGroupId(group.id);
                                            }
                                        }}
                                        className={`w-full rounded-lg border p-4 text-left transition ${
                                            isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                        }`}
                                        data-testid={`admin-rotation-group-card-${group.id}`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="font-medium text-slate-900">{group.name}</div>
                                                <div className="mt-1 text-sm text-slate-500">{group.description || 'Keine Beschreibung'}</div>
                                            </div>
                                            <Badge variant="outline" className={group.is_active ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-300 bg-slate-100 text-slate-600'}>
                                                {group.is_active ? 'Aktiv' : 'Inaktiv'}
                                            </Badge>
                                        </div>
                                        <div className="mt-3 flex items-center gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={(event: React.MouseEvent) => {
                                                    event.stopPropagation();
                                                    handleOpenEditGroup(group);
                                                }}
                                            >
                                                <Pencil className="mr-1 h-3.5 w-3.5" /> Bearbeiten
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                                onClick={(event: React.MouseEvent) => {
                                                    event.stopPropagation();
                                                    handleDeleteGroup(group);
                                                }}
                                            >
                                                <Trash2 className="mr-1 h-3.5 w-3.5" /> Löschen
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </CardContent>
                </Card>

                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-indigo-600" />
                                Mandanten im Verbund
                            </CardTitle>
                            <CardDescription>
                                {selectedGroup ? `Mitglieder von ${selectedGroup.name}` : 'Bitte zuerst einen Verbund wählen.'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {selectedGroup ? (
                                <>
                                    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap">
                                        <Select value={tenantToAdd} onValueChange={setTenantToAdd}>
                                            <SelectTrigger className="md:max-w-sm" data-testid="admin-rotation-add-tenant-select">
                                                <SelectValue placeholder="Mandant wählen" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {availableTenants.length === 0 ? (
                                                    <SelectItem value="__none__" disabled>Keine weiteren Mandanten verfügbar</SelectItem>
                                                ) : (
                                                    availableTenants.map((tenant: TenantRecord) => (
                                                        <SelectItem key={tenant.id} value={String(tenant.id)}>
                                                            {tenant.name || tenant.id}
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                        <Select value={tenantRole} onValueChange={setTenantRole}>
                                            <SelectTrigger className="md:max-w-[180px]" data-testid="admin-rotation-add-tenant-role">
                                                <SelectValue placeholder="Rolle" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="pool">Springerpool</SelectItem>
                                                <SelectItem value="ward">Station</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Button onClick={handleAddTenant} disabled={!tenantToAdd || addMemberMutation.isPending} data-testid="admin-rotation-add-tenant-submit">
                                            {addMemberMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                            Mandant hinzufügen
                                        </Button>
                                    </div>

                                    {membersLoading ? (
                                        <div className="flex items-center justify-center py-6 text-sm text-slate-500">
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Mitglieder …
                                        </div>
                                    ) : members.length === 0 ? (
                                        <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Noch keine Mandanten zugeordnet.</div>
                                    ) : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Mandant</TableHead>
                                                    <TableHead>Rolle</TableHead>
                                                    <TableHead className="text-right">Aktion</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {members.map((member: MemberRecord) => (
                                                    <TableRow key={member.tenant_id} data-testid={`admin-rotation-group-member-${member.tenant_id}`}>
                                                        <TableCell className="font-medium">{member.name || member.tenant_id}</TableCell>
                                                        <TableCell>
                                                            <Badge variant="outline" className={member.role === 'pool' ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-slate-100 text-slate-600'}>
                                                                {member.role === 'pool' ? 'Springerpool' : 'Station'}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                                                onClick={() => removeMemberMutation.mutate({ groupId: selectedGroupId!, tenantId: member.tenant_id })}
                                                            >
                                                                <Trash2 className="mr-1 h-3.5 w-3.5" /> Entfernen
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </>
                            ) : (
                                <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Bitte links einen Verbund auswählen.</div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <CardTitle className="flex items-center gap-2">
                                        <Building2 className="h-5 w-5 text-indigo-600" />
                                        Rotationen
                                    </CardTitle>
                                    <CardDescription>
                                        {selectedGroup ? `Arbeitsplatzzeilen für ${selectedGroup.name}` : 'Bitte zuerst einen Verbund wählen.'}
                                    </CardDescription>
                                </div>
                                <Button onClick={handleOpenCreateWorkplace} disabled={!selectedGroup} data-testid="admin-rotation-workplace-create-button">
                                    <Plus className="mr-2 h-4 w-4" /> Rotation anlegen
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {!selectedGroup ? (
                                <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Bitte links einen Verbund auswählen.</div>
                            ) : workplacesLoading ? (
                                <div className="flex items-center justify-center py-6 text-sm text-slate-500">
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Rotationen …
                                </div>
                            ) : workplaces.length === 0 ? (
                                <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Noch keine Rotation angelegt.</div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Name</TableHead>
                                            <TableHead>Station</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="text-right">Aktionen</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {workplaces.map((workplace: RotationWorkplace) => {
                                            const wardName = members.find((m: MemberRecord) => String(m.tenant_id) === String(workplace.ward_tenant_id))?.name || String(workplace.ward_tenant_id);
                                            return (
                                                <TableRow key={workplace.id} data-testid={`admin-rotation-workplace-${workplace.id}`}>
                                                    <TableCell>
                                                        <div className="font-medium">{workplace.name}</div>
                                                        <div className="mt-1 flex flex-wrap gap-1">
                                                            {workplace.timeslots_enabled ? <Badge variant="secondary" className="bg-indigo-100 text-[10px] font-normal text-indigo-700">Zeitfenster</Badge> : null}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-slate-600">{wardName}</TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className={workplace.is_active ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-300 bg-slate-100 text-slate-600'}>
                                                            {workplace.is_active ? 'Aktiv' : 'Inaktiv'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <Button variant="outline" size="sm" onClick={() => setTimeslotWorkplace(workplace)} title="Zeitfenster verwalten">
                                                                <Clock className="mr-1 h-3.5 w-3.5" /> Zeitfenster
                                                            </Button>
                                                            <Button variant="outline" size="sm" onClick={() => handleOpenEditWorkplace(workplace)}>
                                                                <Pencil className="mr-1 h-3.5 w-3.5" /> Bearbeiten
                                                            </Button>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                                                onClick={() => handleDeleteWorkplace(workplace)}
                                                            >
                                                                <Trash2 className="mr-1 h-3.5 w-3.5" /> Löschen
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Group Dialog */}
            <Dialog open={showGroupDialog} onOpenChange={setShowGroupDialog}>
                <DialogContent className="flex flex-col max-h-[85vh] min-h-[300px] !gap-0 p-0">
                    <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
                        <DialogTitle>{editingGroup ? 'Rotationsverbund bearbeiten' : 'Rotationsverbund anlegen'}</DialogTitle>
                        <DialogDescription>Ein Verbund verbindet einen Springerpool mit mehreren Stationen.</DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="rotation-group-name">Name</Label>
                            <Input
                                id="rotation-group-name"
                                value={groupForm.name}
                                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setGroupForm((current: GroupForm) => ({ ...current, name: event.target.value }))}
                                data-testid="admin-rotation-group-name-input"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="rotation-group-description">Beschreibung</Label>
                            <Textarea
                                id="rotation-group-description"
                                value={groupForm.description}
                                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setGroupForm((current: GroupForm) => ({ ...current, description: event.target.value }))}
                                rows={3}
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                                <div className="font-medium text-slate-900">Aktiv</div>
                                <div className="text-sm text-slate-500">Nur aktive Verbünde erscheinen in der Auswahl.</div>
                            </div>
                            <Switch checked={groupForm.is_active} onCheckedChange={(checked: boolean) => setGroupForm((current: GroupForm) => ({ ...current, is_active: checked }))} />
                        </div>
                    </div>
                    <DialogFooter className="bg-white border-t shrink-0 px-6 py-4">
                        <Button variant="outline" onClick={() => setShowGroupDialog(false)}>Abbrechen</Button>
                        <Button onClick={handleSaveGroup} disabled={createGroupMutation.isPending || updateGroupMutation.isPending} data-testid="admin-rotation-group-save-button">
                            {(createGroupMutation.isPending || updateGroupMutation.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Speichern
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Workplace Dialog */}
            <Dialog open={showWorkplaceDialog} onOpenChange={setShowWorkplaceDialog}>
                <DialogContent className="flex flex-col max-h-[85vh] min-h-[420px] !gap-0 p-0">
                    <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
                        <DialogTitle>{editingWorkplace ? 'Rotation bearbeiten' : 'Rotation anlegen'}</DialogTitle>
                        <DialogDescription>
                            Eine Rotation ist eine Arbeitsplatzzeile im Springerpool-Dienstplan (z. B. „Gyn 1").
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="rotation-workplace-name">Name</Label>
                            <Input
                                id="rotation-workplace-name"
                                value={workplaceForm.name}
                                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setWorkplaceForm((current: WorkplaceForm) => ({ ...current, name: event.target.value }))}
                                data-testid="admin-rotation-workplace-name-input"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="rotation-workplace-ward">Station (Mandant)</Label>
                            <div className="text-xs text-slate-500">Welcher Station gehört diese Rotation? Nur Stations-Mandanten (role=ward) sind wählbar.</div>
                            <Select
                                value={workplaceForm.ward_tenant_id}
                                onValueChange={(value: string) => setWorkplaceForm((current: WorkplaceForm) => ({ ...current, ward_tenant_id: value }))}
                            >
                                <SelectTrigger id="rotation-workplace-ward" data-testid="admin-rotation-workplace-ward-select">
                                    <SelectValue placeholder="Station wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {wardMembers.length === 0 ? (
                                        <SelectItem value="__none__" disabled>Keine Stations-Mandanten — zuerst hinzufügen</SelectItem>
                                    ) : (
                                        wardMembers.map((member: MemberRecord) => (
                                            <SelectItem key={member.tenant_id} value={String(member.tenant_id)}>
                                                {member.name || member.tenant_id}
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-center justify-between rounded-lg border bg-indigo-50 p-3">
                            <div>
                                <div className="flex items-center gap-2 font-medium text-slate-900"><Clock className="h-4 w-4" /> Zeitfenster aktivieren</div>
                                <div className="text-sm text-slate-500">Ermöglicht Früh-/Mittel-/Spätdienst-Unterteilung.</div>
                            </div>
                            <Switch
                                checked={workplaceForm.timeslots_enabled}
                                onCheckedChange={(checked: boolean) => setWorkplaceForm((current: WorkplaceForm) => ({ ...current, timeslots_enabled: checked }))}
                                data-testid="admin-rotation-workplace-timeslots-enabled"
                            />
                        </div>
                        {workplaceForm.timeslots_enabled && editingWorkplace && (
                            <div className="rounded bg-amber-50 p-2 text-xs text-amber-700">
                                Speichern Sie, dann nutzen Sie den „Zeitfenster"-Button, um Slots anzulegen.
                            </div>
                        )}
                        <div className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                                <div className="font-medium text-slate-900">Aktiv</div>
                                <div className="text-sm text-slate-500">Inaktive Rotationen bleiben historisch erhalten, erscheinen aber nicht neu.</div>
                            </div>
                            <Switch
                                checked={workplaceForm.is_active}
                                onCheckedChange={(checked: boolean) => setWorkplaceForm((current: WorkplaceForm) => ({ ...current, is_active: checked }))}
                            />
                        </div>
                    </div>
                    <DialogFooter className="bg-white border-t shrink-0 px-6 py-4">
                        <Button variant="outline" onClick={() => setShowWorkplaceDialog(false)}>Abbrechen</Button>
                        <Button onClick={handleSaveWorkplace} disabled={createWorkplaceMutation.isPending || updateWorkplaceMutation.isPending} data-testid="admin-rotation-workplace-save-button">
                            {(createWorkplaceMutation.isPending || updateWorkplaceMutation.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Speichern
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Timeslot Editor Dialog */}
            {timeslotWorkplace && (
                <RotationTimeslotEditor
                    groupId={selectedGroupId}
                    workplace={timeslotWorkplace}
                    onClose={() => setTimeslotWorkplace(null)}
                />
            )}
        </div>
    );
}

// ============================================================
//  RotationTimeslotEditor — inline sub-component
// ============================================================
function RotationTimeslotEditor({ groupId, workplace, onClose }: RotationTimeslotEditorProps) {
    const queryClient = useQueryClient();
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<TimeslotForm>({ label: '', start_time: '07:00', end_time: '15:00', order: 0 });

    const { data: timeslotsResponse, isLoading } = useQuery<TimeslotsResponse>({
        queryKey: ['admin', 'rotation-timeslots', groupId, workplace.id],
        queryFn: () => api.listRotationTimeslots(String(groupId!), String(workplace.id)) as Promise<TimeslotsResponse>,
        staleTime: 10_000,
    });

    const timeslots: Timeslot[] = Array.isArray(timeslotsResponse?.timeslots) ? timeslotsResponse.timeslots : [];

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'rotation-timeslots', groupId, workplace.id] });
        queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
    };

    const createMutation = useMutation({
        mutationFn: (data: TimeslotForm) => api.createRotationTimeslot(String(groupId!), String(workplace.id), data as unknown as Record<string, unknown>),
        onSuccess: () => {
            invalidate();
            setForm({ label: '', start_time: '07:00', end_time: '15:00', order: timeslots.length });
            setShowForm(false);
            toast.success('Zeitfenster erstellt');
        },
        onError: (error: Error) => toast.error(error.message || 'Zeitfenster konnte nicht erstellt werden'),
    });

    const deleteMutation = useMutation({
        mutationFn: (timeslotId: number) => api.deleteRotationTimeslot(String(groupId!), String(workplace.id), String(timeslotId)),
        onSuccess: () => {
            invalidate();
            toast.success('Zeitfenster gelöscht');
        },
        onError: (error: Error) => toast.error(error.message || 'Zeitfenster konnte nicht gelöscht werden'),
    });

    return (
        <Dialog open={true} onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
            <DialogContent className="!gap-0 p-0">
                <DialogHeader className="px-6 pt-6 pb-0">
                    <DialogTitle>Zeitfenster für „{workplace.name}"</DialogTitle>
                    <DialogDescription>Früh-/Mittel-/Spätdienst für diese Rotation.</DialogDescription>
                </DialogHeader>
                <div className="px-6 py-4 space-y-3">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-4 text-sm text-slate-500">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Zeitfenster …
                        </div>
                    ) : timeslots.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-3 text-sm text-slate-500">Noch keine Zeitfenster angelegt.</div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Label</TableHead>
                                    <TableHead>Zeit</TableHead>
                                    <TableHead className="text-right">Aktion</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {timeslots.map((ts: Timeslot) => (
                                    <TableRow key={ts.id}>
                                        <TableCell className="font-medium">{ts.label}</TableCell>
                                        <TableCell className="text-slate-600">{ts.start_time?.slice(0, 5)}–{ts.end_time?.slice(0, 5)}</TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                                onClick={() => deleteMutation.mutate(ts.id)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}

                    {showForm ? (
                        <div className="rounded-lg border p-3 space-y-3">
                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1">
                                    <Label className="text-sm">Bezeichnung</Label>
                                    <Input
                                        value={form.label}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((c: TimeslotForm) => ({ ...c, label: e.target.value }))}
                                        placeholder="z. B. Frühdienst"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-sm">Reihenfolge</Label>
                                    <Input
                                        type="number"
                                        min="0"
                                        value={form.order}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((c: TimeslotForm) => ({ ...c, order: Number(e.target.value) || 0 }))}
                                        className="w-24"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-sm">Start</Label>
                                    <Input
                                        type="time"
                                        value={form.start_time}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((c: TimeslotForm) => ({ ...c, start_time: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-sm">Ende</Label>
                                    <Input
                                        type="time"
                                        value={form.end_time}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((c: TimeslotForm) => ({ ...c, end_time: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        if (!form.label.trim()) {
                                            toast.error('Bezeichnung erforderlich');
                                            return;
                                        }
                                        createMutation.mutate(form);
                                    }}
                                    disabled={createMutation.isPending}
                                >
                                    {createMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
                                    Hinzufügen
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Abbrechen</Button>
                            </div>
                        </div>
                    ) : (
                        <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
                            <Plus className="mr-1 h-3.5 w-3.5" /> Zeitfenster hinzufügen
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
