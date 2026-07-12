import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import SharedTimeslotEditor from '@/components/admin/SharedTimeslotEditor';
import SharedWorkplaceQualificationsDialog from '@/components/admin/SharedWorkplaceQualificationsDialog';
import { SERVICE_TYPES } from '@/components/settings/serviceTypes';
import { ArrowsUpFromLine, Building2, Clock, Globe2, Loader2, Pencil, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';

const DEFAULT_GROUP_FORM = {
    name: '',
    description: '',
    is_active: true,
};

const DEFAULT_WORKPLACE_FORM = {
    name: '',
    active_days: [1, 2, 3, 4, 5],
    service_type: '1',
    auto_off: false,
    allows_rotation_concurrently: false,
    allows_absence_overlap: false,
    consecutive_days_mode: 'allowed',
    allows_multiple: false,
    min_staff: '1',
    optimal_staff: '1',
    default_overlap_tolerance_minutes: '15',
    work_time_percentage: '100',
    affects_availability: true,
    timeslots_enabled: false,
    is_active: true,
};

const DEFAULT_ROTATION_WORKPLACE_FORM = {
    name: '',
    ward_tenant_id: '',
    timeslots_enabled: false,
    is_active: true,
};

function normalizeGroup(group) {
    return {
        ...group,
        id: Number(group.id),
        is_active: Boolean(group.is_active),
    };
}

function normalizeWorkplace(workplace) {
    return {
        ...workplace,
        allows_multiple: workplace.allows_multiple == null ? null : Boolean(workplace.allows_multiple),
        auto_off: Boolean(workplace.auto_off),
        allows_rotation_concurrently: Boolean(workplace.allows_rotation_concurrently),
        affects_availability: Boolean(workplace.affects_availability),
        allows_absence_overlap: Boolean(workplace.allows_absence_overlap),
        timeslots_enabled: Boolean(workplace.timeslots_enabled),
        is_active: Boolean(workplace.is_active),
        active_days: Array.isArray(workplace.active_days) ? workplace.active_days : [1, 2, 3, 4, 5],
    };
}

function serviceTypeLabel(value) {
    return SERVICE_TYPES.find((entry) => entry.value === Number(value))?.label || 'Kein Typ';
}

function toggleDay(days, dayIndex) {
    return days.includes(dayIndex)
        ? days.filter((entry) => entry !== dayIndex)
        : [...days, dayIndex].sort((left, right) => left - right);
}

/** Composite key to distinguish dienst vs rotation groups */
function groupKey(type, id) {
    return `${type}:${id}`;
}

export default function TenantGroupManagement() {
    const queryClient = useQueryClient();
    const [selectedKey, setSelectedKey] = useState(null);
    const [showGroupDialog, setShowGroupDialog] = useState(false);
    const [editingGroup, setEditingGroup] = useState(null);
    const [groupForm, setGroupForm] = useState(DEFAULT_GROUP_FORM);
    const [newGroupType, setNewGroupType] = useState('dienst');

    // ——— dienst: workplace dialog state ———
    const [showWorkplaceDialog, setShowWorkplaceDialog] = useState(false);
    const [editingWorkplace, setEditingWorkplace] = useState(null);
    const [workplaceForm, setWorkplaceForm] = useState(DEFAULT_WORKPLACE_FORM);
    const [qualificationsWorkplace, setQualificationsWorkplace] = useState(null);
    const [tenantToAdd, setTenantToAdd] = useState('');

    // ——— rotation: workplace dialog state ———
    const [showRotationWorkplaceDialog, setShowRotationWorkplaceDialog] = useState(false);
    const [editingRotationWorkplace, setEditingRotationWorkplace] = useState(null);
    const [rotationWorkplaceForm, setRotationWorkplaceForm] = useState(DEFAULT_ROTATION_WORKPLACE_FORM);
    const [rotationTenantToAdd, setRotationTenantToAdd] = useState('');
    const [rotationTenantRole, setRotationTenantRole] = useState('ward');
    const [timeslotWorkplace, setTimeslotWorkplace] = useState(null);

    // ===================== DATA FETCHING =====================

    // ——— dienst groups ———
    const { data: groupsResponse, isLoading: groupsLoading } = useQuery({
        queryKey: ['admin', 'tenant-groups'],
        queryFn: () => api.listGroups(),
        staleTime: 30_000,
    });

    const groups = useMemo(
        () => (Array.isArray(groupsResponse?.groups) ? groupsResponse.groups.map(normalizeGroup) : []),
        [groupsResponse]
    );

    // ——— rotation groups ———
    const { data: rotationGroupsResponse, isLoading: rotationGroupsLoading } = useQuery({
        queryKey: ['admin', 'rotation-groups'],
        queryFn: () => api.listRotationGroups(),
        staleTime: 30_000,
    });

    const rotationGroups = useMemo(
        () => (Array.isArray(rotationGroupsResponse?.groups) ? rotationGroupsResponse.groups.map(normalizeGroup) : []),
        [rotationGroupsResponse]
    );

    // ——— unified group list ———
    const unifiedGroups = useMemo(() => {
        const dienst = groups.map((g) => ({ ...g, _type: 'dienst' }));
        const rotation = rotationGroups.map((g) => ({ ...g, _type: 'rotation' }));
        return [...dienst, ...rotation];
    }, [groups, rotationGroups]);

    // ——— derive selected group ———
    useEffect(() => {
        if (unifiedGroups.length === 0) {
            setSelectedKey(null);
            return;
        }
        if (!selectedKey) {
            setSelectedKey(groupKey(unifiedGroups[0]._type, unifiedGroups[0].id));
            return;
        }
        const exists = unifiedGroups.some((g) => groupKey(g._type, g.id) === selectedKey);
        if (!exists) {
            setSelectedKey(groupKey(unifiedGroups[0]._type, unifiedGroups[0].id));
        }
    }, [unifiedGroups, selectedKey]);

    const selectedGroup = useMemo(
        () => unifiedGroups.find((g) => groupKey(g._type, g.id) === selectedKey) || null,
        [unifiedGroups, selectedKey]
    );

    const selectedType = selectedGroup?._type;
    const selectedGroupId = selectedGroup?.id;

    // ——— tenants list (shared) ———
    const { data: tenants = [] } = useQuery({
        queryKey: ['serverDbTokens'],
        queryFn: () => api.request('/api/admin/db-tokens'),
        staleTime: 30_000,
    });

    // ===================== DIENST QUERIES =====================

    const { data: membersResponse, isLoading: membersLoading } = useQuery({
        queryKey: ['admin', 'tenant-group-members', selectedGroupId],
        queryFn: () => api.listGroupMembers(selectedGroupId),
        enabled: !!selectedGroupId && selectedType === 'dienst',
        staleTime: 10_000,
    });

    const { data: workplacesResponse, isLoading: workplacesLoading } = useQuery({
        queryKey: ['admin', 'tenant-group-workplaces', selectedGroupId],
        queryFn: () => api.listSharedWorkplaces(selectedGroupId),
        enabled: !!selectedGroupId && selectedType === 'dienst',
        staleTime: 10_000,
    });

    const members = Array.isArray(membersResponse?.members) ? membersResponse.members : [];
    const workplaces = useMemo(
        () => (Array.isArray(workplacesResponse?.workplaces) ? workplacesResponse.workplaces.map(normalizeWorkplace) : []),
        [workplacesResponse]
    );

    const availableTenants = useMemo(() => {
        const memberIds = new Set(members.map((member) => String(member.tenant_id)));
        return tenants.filter((tenant) => !memberIds.has(String(tenant.id)));
    }, [members, tenants]);

    // ===================== ROTATION QUERIES =====================

    const { data: rotationMembersResponse, isLoading: rotationMembersLoading } = useQuery({
        queryKey: ['admin', 'rotation-group-members', selectedGroupId],
        queryFn: () => api.listRotationGroupMembers(selectedGroupId),
        enabled: !!selectedGroupId && selectedType === 'rotation',
        staleTime: 10_000,
    });

    const { data: rotationWorkplacesResponse, isLoading: rotationWorkplacesLoading } = useQuery({
        queryKey: ['admin', 'rotation-group-workplaces', selectedGroupId],
        queryFn: () => api.listRotationWorkplaces(selectedGroupId),
        enabled: !!selectedGroupId && selectedType === 'rotation',
        staleTime: 10_000,
    });

    const rotationMembers = Array.isArray(rotationMembersResponse?.members) ? rotationMembersResponse.members : [];
    const rotationWorkplaces = useMemo(
        () => (Array.isArray(rotationWorkplacesResponse?.workplaces) ? rotationWorkplacesResponse.workplaces : []),
        [rotationWorkplacesResponse]
    );

    const availableRotationTenants = useMemo(() => {
        const memberIds = new Set(rotationMembers.map((member) => String(member.tenant_id)));
        return tenants.filter((tenant) => !memberIds.has(String(tenant.id)));
    }, [rotationMembers, tenants]);

    const wardMembers = useMemo(
        () => rotationMembers.filter((m) => m.role === 'ward'),
        [rotationMembers]
    );

    // ===================== INVALIDATION =====================

    const invalidateDienstGroups = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'tenant-groups'] });
        queryClient.invalidateQueries({ queryKey: ['users'] });
    };

    const invalidateDienstDetail = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'tenant-group-members', selectedGroupId] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'tenant-group-workplaces', selectedGroupId] });
        queryClient.invalidateQueries({ queryKey: ['pool', 'visible-shifts'] });
        queryClient.invalidateQueries({ queryKey: ['users'] });
    };

    const invalidateRotationGroups = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'rotation-groups'] });
        queryClient.invalidateQueries({ queryKey: ['users'] });
    };

    const invalidateRotationDetail = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'rotation-group-members', selectedGroupId] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'rotation-group-workplaces', selectedGroupId] });
        queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
        queryClient.invalidateQueries({ queryKey: ['users'] });
    };

    const removeMemberFromCache = (groupId, tenantId) => {
        queryClient.setQueryData(['admin', 'tenant-group-members', groupId], (current) => {
            const membersList = Array.isArray(current?.members) ? current.members : [];
            return {
                ...current,
                members: membersList.filter((member) => String(member.tenant_id) !== String(tenantId)),
            };
        });
    };

    const removeWorkplaceFromCache = (groupId, workplaceId) => {
        queryClient.setQueryData(['admin', 'tenant-group-workplaces', groupId], (current) => {
            const workplaceList = Array.isArray(current?.workplaces) ? current.workplaces : [];
            return {
                ...current,
                workplaces: workplaceList.filter((workplace) => String(workplace.id) !== String(workplaceId)),
            };
        });
    };

    // ===================== DIENST MUTATIONS =====================

    const createGroupMutation = useMutation({
        mutationFn: (payload) => api.createGroup(payload),
        onSuccess: (response) => {
            invalidateDienstGroups();
            const groupId = Number(response?.group?.id);
            if (Number.isInteger(groupId)) {
                setSelectedKey(groupKey('dienst', groupId));
            }
            setShowGroupDialog(false);
            setEditingGroup(null);
            setGroupForm(DEFAULT_GROUP_FORM);
            toast.success('Verbund erstellt');
        },
        onError: (error) => toast.error(error.message || 'Verbund konnte nicht erstellt werden'),
    });

    const updateGroupMutation = useMutation({
        mutationFn: ({ groupId, payload }) => api.updateGroup(groupId, payload),
        onSuccess: () => {
            invalidateDienstGroups();
            setShowGroupDialog(false);
            setEditingGroup(null);
            setGroupForm(DEFAULT_GROUP_FORM);
            toast.success('Verbund aktualisiert');
        },
        onError: (error) => toast.error(error.message || 'Verbund konnte nicht aktualisiert werden'),
    });

    const deleteGroupMutation = useMutation({
        mutationFn: (groupId) => api.deleteGroup(groupId),
        onSuccess: () => {
            invalidateDienstGroups();
            setSelectedKey(null);
            toast.success('Verbund gelöscht');
        },
        onError: (error) => toast.error(error.message || 'Verbund konnte nicht gelöscht werden'),
    });

    const addMemberMutation = useMutation({
        mutationFn: ({ groupId, tenantId }) => api.addGroupMember(groupId, tenantId),
        onSuccess: () => {
            invalidateDienstDetail();
            setTenantToAdd('');
            toast.success('Mandant hinzugefügt');
        },
        onError: (error) => toast.error(error.message || 'Mandant konnte nicht hinzugefügt werden'),
    });

    const removeMemberMutation = useMutation({
        mutationFn: ({ groupId, tenantId }) => api.removeGroupMember(groupId, tenantId),
        onSuccess: (_, variables) => {
            removeMemberFromCache(variables.groupId, variables.tenantId);
            invalidateDienstDetail();
            toast.success('Mandant entfernt');
        },
        onError: (error) => toast.error(error.message || 'Mandant konnte nicht entfernt werden'),
    });

    const createWorkplaceMutation = useMutation({
        mutationFn: ({ groupId, payload }) => api.createSharedWorkplace(groupId, payload),
        onSuccess: () => {
            invalidateDienstDetail();
            setShowWorkplaceDialog(false);
            setEditingWorkplace(null);
            setWorkplaceForm(DEFAULT_WORKPLACE_FORM);
            toast.success('Gemeinsamer Dienst erstellt');
        },
        onError: (error) => toast.error(error.message || 'Dienst konnte nicht erstellt werden'),
    });

    const updateWorkplaceMutation = useMutation({
        mutationFn: ({ groupId, workplaceId, payload }) => api.updateSharedWorkplace(groupId, workplaceId, payload),
        onSuccess: () => {
            invalidateDienstDetail();
            setShowWorkplaceDialog(false);
            setEditingWorkplace(null);
            setWorkplaceForm(DEFAULT_WORKPLACE_FORM);
            toast.success('Gemeinsamer Dienst aktualisiert');
        },
        onError: (error) => toast.error(error.message || 'Dienst konnte nicht aktualisiert werden'),
    });

    const deleteWorkplaceMutation = useMutation({
        mutationFn: ({ groupId, workplaceId }) => api.deleteSharedWorkplace(groupId, workplaceId),
        onSuccess: (_, variables) => {
            removeWorkplaceFromCache(variables.groupId, variables.workplaceId);
            if (editingWorkplace && String(editingWorkplace.id) === String(variables.workplaceId)) {
                setShowWorkplaceDialog(false);
                setEditingWorkplace(null);
                setWorkplaceForm(DEFAULT_WORKPLACE_FORM);
            }
            invalidateDienstDetail();
            toast.success('Gemeinsamer Dienst gelöscht');
        },
        onError: (error) => toast.error(error.message || 'Dienst konnte nicht gelöscht werden'),
    });

    // ===================== ROTATION MUTATIONS =====================

    const createRotationGroupMutation = useMutation({
        mutationFn: (payload) => api.createRotationGroup(payload),
        onSuccess: (response) => {
            invalidateRotationGroups();
            const groupId = Number(response?.group?.id);
            if (Number.isInteger(groupId)) {
                setSelectedKey(groupKey('rotation', groupId));
            }
            setShowGroupDialog(false);
            setEditingGroup(null);
            setGroupForm(DEFAULT_GROUP_FORM);
            toast.success('Rotationsverbund erstellt');
        },
        onError: (error) => toast.error(error.message || 'Rotationsverbund konnte nicht erstellt werden'),
    });

    const updateRotationGroupMutation = useMutation({
        mutationFn: ({ groupId, payload }) => api.updateRotationGroup(groupId, payload),
        onSuccess: () => {
            invalidateRotationGroups();
            setShowGroupDialog(false);
            setEditingGroup(null);
            setGroupForm(DEFAULT_GROUP_FORM);
            toast.success('Rotationsverbund aktualisiert');
        },
        onError: (error) => toast.error(error.message || 'Rotationsverbund konnte nicht aktualisiert werden'),
    });

    const deleteRotationGroupMutation = useMutation({
        mutationFn: (groupId) => api.deleteRotationGroup(groupId),
        onSuccess: () => {
            invalidateRotationGroups();
            setSelectedKey(null);
            toast.success('Rotationsverbund gelöscht');
        },
        onError: (error) => toast.error(error.message || 'Rotationsverbund konnte nicht gelöscht werden'),
    });

    const addRotationMemberMutation = useMutation({
        mutationFn: ({ groupId, tenantId, role }) => api.addRotationGroupMember(groupId, tenantId, role),
        onSuccess: () => {
            invalidateRotationDetail();
            setRotationTenantToAdd('');
            setRotationTenantRole('ward');
            toast.success('Mandant hinzugefügt');
        },
        onError: (error) => toast.error(error.message || 'Mandant konnte nicht hinzugefügt werden'),
    });

    const removeRotationMemberMutation = useMutation({
        mutationFn: ({ groupId, tenantId }) => api.removeRotationGroupMember(groupId, tenantId),
        onSuccess: () => {
            invalidateRotationDetail();
            toast.success('Mandant entfernt');
        },
        onError: (error) => toast.error(error.message || 'Mandant konnte nicht entfernt werden'),
    });

    const createRotationWorkplaceMutation = useMutation({
        mutationFn: ({ groupId, payload }) => api.createRotationWorkplace(groupId, payload),
        onSuccess: () => {
            invalidateRotationDetail();
            setShowRotationWorkplaceDialog(false);
            setEditingRotationWorkplace(null);
            setRotationWorkplaceForm(DEFAULT_ROTATION_WORKPLACE_FORM);
            toast.success('Rotation erstellt');
        },
        onError: (error) => toast.error(error.message || 'Rotation konnte nicht erstellt werden'),
    });

    const updateRotationWorkplaceMutation = useMutation({
        mutationFn: ({ groupId, workplaceId, payload }) => api.updateRotationWorkplace(groupId, workplaceId, payload),
        onSuccess: () => {
            invalidateRotationDetail();
            setShowRotationWorkplaceDialog(false);
            setEditingRotationWorkplace(null);
            setRotationWorkplaceForm(DEFAULT_ROTATION_WORKPLACE_FORM);
            toast.success('Rotation aktualisiert');
        },
        onError: (error) => toast.error(error.message || 'Rotation konnte nicht aktualisiert werden'),
    });

    const deleteRotationWorkplaceMutation = useMutation({
        mutationFn: ({ groupId, workplaceId }) => api.deleteRotationWorkplace(groupId, workplaceId),
        onSuccess: () => {
            invalidateRotationDetail();
            toast.success('Rotation gelöscht');
        },
        onError: (error) => toast.error(error.message || 'Rotation konnte nicht gelöscht werden'),
    });

    // ===================== HANDLERS: GROUP =====================

    const handleOpenCreateGroup = () => {
        setEditingGroup(null);
        setGroupForm(DEFAULT_GROUP_FORM);
        setNewGroupType('dienst');
        setShowGroupDialog(true);
    };

    const handleOpenEditGroup = (group) => {
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
        const payload = {
            name: groupForm.name.trim(),
            description: groupForm.description.trim() || null,
            is_active: Boolean(groupForm.is_active),
        };
        if (editingGroup) {
            const type = editingGroup._type || 'dienst';
            if (type === 'rotation') {
                updateRotationGroupMutation.mutate({ groupId: editingGroup.id, payload });
            } else {
                updateGroupMutation.mutate({ groupId: editingGroup.id, payload });
            }
            return;
        }
        // Create — use selected type
        if (newGroupType === 'rotation') {
            createRotationGroupMutation.mutate(payload);
        } else {
            createGroupMutation.mutate(payload);
        }
    };

    const handleDeleteGroup = (group) => {
        const label = group._type === 'rotation' ? 'Rotationsverbund' : 'Verbund';
        if (!window.confirm(`${label} "${group.name}" wirklich löschen?`)) {
            return;
        }
        if (group._type === 'rotation') {
            deleteRotationGroupMutation.mutate(group.id);
        } else {
            deleteGroupMutation.mutate(group.id);
        }
    };

    // ===================== HANDLERS: DIENST =====================

    const handleAddTenant = () => {
        if (!selectedGroupId || !tenantToAdd) {
            toast.error('Bitte zuerst einen Mandanten wählen');
            return;
        }
        addMemberMutation.mutate({ groupId: selectedGroupId, tenantId: tenantToAdd });
    };

    const handleOpenCreateWorkplace = () => {
        setEditingWorkplace(null);
        setWorkplaceForm(DEFAULT_WORKPLACE_FORM);
        setShowWorkplaceDialog(true);
    };

    const handleOpenEditWorkplace = (workplace) => {
        setEditingWorkplace(workplace);
        setWorkplaceForm({
            name: workplace.name || '',
            active_days: Array.isArray(workplace.active_days) ? workplace.active_days : [1, 2, 3, 4, 5],
            service_type: workplace.service_type ? String(workplace.service_type) : '1',
            auto_off: Boolean(workplace.auto_off),
            allows_rotation_concurrently: Boolean(workplace.allows_rotation_concurrently),
            allows_absence_overlap: Boolean(workplace.allows_absence_overlap),
            consecutive_days_mode: workplace.consecutive_days_mode || 'allowed',
            allows_multiple: workplace.allows_multiple ?? false,
            min_staff: String(workplace.min_staff ?? 1),
            optimal_staff: String(workplace.optimal_staff ?? 1),
            default_overlap_tolerance_minutes: String(workplace.default_overlap_tolerance_minutes ?? 15),
            work_time_percentage: String(workplace.work_time_percentage ?? 100),
            affects_availability: Boolean(workplace.affects_availability),
            timeslots_enabled: Boolean(workplace.timeslots_enabled),
            is_active: Boolean(workplace.is_active),
        });
        setShowWorkplaceDialog(true);
    };

    const buildWorkplacePayload = () => {
        const payload = {
            name: workplaceForm.name.trim(),
            category: 'Dienste',
            start_time: null,
            end_time: null,
            active_days: Array.isArray(workplaceForm.active_days) ? workplaceForm.active_days : [1, 2, 3, 4, 5],
            service_type: Number.parseInt(workplaceForm.service_type, 10) || null,
            auto_off: Boolean(workplaceForm.auto_off),
            allows_rotation_concurrently: Boolean(workplaceForm.allows_rotation_concurrently),
            allows_absence_overlap: Boolean(workplaceForm.allows_absence_overlap),
            consecutive_days_mode: workplaceForm.consecutive_days_mode || 'allowed',
            allows_multiple: Boolean(workplaceForm.allows_multiple),
            default_overlap_tolerance_minutes: Math.max(0, Number.parseInt(workplaceForm.default_overlap_tolerance_minutes, 10) || 0),
            work_time_percentage: Math.min(100, Math.max(0, Number.parseFloat(workplaceForm.work_time_percentage) || 100)),
            affects_availability: Boolean(workplaceForm.affects_availability),
            timeslots_enabled: Boolean(workplaceForm.timeslots_enabled),
            is_active: Boolean(workplaceForm.is_active),
        };
        if (payload.allows_multiple) {
            const minStaff = Math.max(0, Number.parseInt(workplaceForm.min_staff, 10) || 0);
            const optimalStaff = Math.max(minStaff, Number.parseInt(workplaceForm.optimal_staff, 10) || Math.max(minStaff, 1));
            payload.min_staff = minStaff;
            payload.optimal_staff = optimalStaff;
        }
        return payload;
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
        const payload = buildWorkplacePayload();
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

    const handleDeleteWorkplace = (workplace) => {
        if (!selectedGroupId) return;
        if (!window.confirm(`Gemeinsamen Dienst "${workplace.name}" wirklich löschen?`)) {
            return;
        }
        deleteWorkplaceMutation.mutate({ groupId: selectedGroupId, workplaceId: workplace.id });
    };

    // ===================== HANDLERS: ROTATION =====================

    const handleAddRotationTenant = () => {
        if (!selectedGroupId || !rotationTenantToAdd) {
            toast.error('Bitte zuerst einen Mandanten wählen');
            return;
        }
        addRotationMemberMutation.mutate({ groupId: selectedGroupId, tenantId: rotationTenantToAdd, role: rotationTenantRole });
    };

    const handleOpenCreateRotationWorkplace = () => {
        setEditingRotationWorkplace(null);
        setRotationWorkplaceForm(DEFAULT_ROTATION_WORKPLACE_FORM);
        setShowRotationWorkplaceDialog(true);
    };

    const handleOpenEditRotationWorkplace = (workplace) => {
        setEditingRotationWorkplace(workplace);
        setRotationWorkplaceForm({
            name: workplace.name || '',
            ward_tenant_id: workplace.ward_tenant_id || '',
            timeslots_enabled: Boolean(workplace.timeslots_enabled),
            is_active: Boolean(workplace.is_active),
        });
        setShowRotationWorkplaceDialog(true);
    };

    const handleSaveRotationWorkplace = () => {
        if (!selectedGroupId) {
            toast.error('Bitte zuerst einen Verbund wählen');
            return;
        }
        if (!rotationWorkplaceForm.name.trim()) {
            toast.error('Name ist erforderlich');
            return;
        }
        if (!rotationWorkplaceForm.ward_tenant_id) {
            toast.error('Bitte eine Station (Mandant) wählen');
            return;
        }
        const payload = {
            name: rotationWorkplaceForm.name.trim(),
            ward_tenant_id: rotationWorkplaceForm.ward_tenant_id,
            timeslots_enabled: Boolean(rotationWorkplaceForm.timeslots_enabled),
            is_active: Boolean(rotationWorkplaceForm.is_active),
        };
        if (editingRotationWorkplace) {
            updateRotationWorkplaceMutation.mutate({
                groupId: selectedGroupId,
                workplaceId: editingRotationWorkplace.id,
                payload,
            });
            return;
        }
        createRotationWorkplaceMutation.mutate({ groupId: selectedGroupId, payload });
    };

    const handleDeleteRotationWorkplace = (workplace) => {
        if (!selectedGroupId) return;
        if (!window.confirm(`Rotation "${workplace.name}" wirklich löschen?`)) {
            return;
        }
        deleteRotationWorkplaceMutation.mutate({ groupId: selectedGroupId, workplaceId: workplace.id });
    };

    // ===================== RENDER HELPERS =====================

    const typeLabel = (type) => (type === 'rotation' ? 'Rotationsverbund' : 'Dienst-Verbund');

    const isLoading =
        groupsLoading || rotationGroupsLoading;

    // ===================== RENDER =====================

    return (
        <div className="space-y-6" data-testid="admin-tenant-group-management">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900">Verbünde</h2>
                    <p className="text-sm text-slate-500">
                        Übersicht über Dienst-Verbünde und Rotationsverbünde. Beim Anlegen wählst du den Typ.
                    </p>
                </div>
                <Button onClick={handleOpenCreateGroup} className="bg-indigo-600 hover:bg-indigo-700" data-testid="admin-group-create-button">
                    <Plus className="mr-2 h-4 w-4" />
                    Verbund anlegen
                </Button>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_1.9fr]">
                {/* ============ SIDEBAR: UNIFIED GROUP LIST ============ */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Globe2 className="h-5 w-5 text-indigo-600" />
                            Verbünde
                        </CardTitle>
                        <CardDescription>Wähle einen Verbund aus oder lege einen neuen an.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-8 text-sm text-slate-500">
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Verbünde …
                            </div>
                        ) : unifiedGroups.length === 0 ? (
                            <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">
                                Noch kein Verbund vorhanden.
                            </div>
                        ) : (
                            unifiedGroups.map((group) => {
                                const key = groupKey(group._type, group.id);
                                const isSelected = key === selectedKey;
                                return (
                                    <div
                                        key={key}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setSelectedKey(key)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setSelectedKey(key);
                                            }
                                        }}
                                        className={`w-full rounded-lg border p-4 text-left transition ${
                                            isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                        }`}
                                        data-testid={`admin-group-card-${group._type}-${group.id}`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="font-medium text-slate-900 truncate">{group.name}</div>
                                                    {group._type === 'rotation' ? (
                                                        <Badge variant="secondary" className="shrink-0 bg-indigo-100 text-[10px] font-normal text-indigo-700">
                                                            <ArrowsUpFromLine className="mr-0.5 h-3 w-3" /> Rotation
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="secondary" className="shrink-0 bg-teal-100 text-[10px] font-normal text-teal-700">
                                                            <Globe2 className="mr-0.5 h-3 w-3" /> Dienst
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="mt-1 text-sm text-slate-500 truncate">{group.description || 'Keine Beschreibung'}</div>
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
                                                onClick={(event) => {
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
                                                onClick={(event) => {
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

                {/* ============ RIGHT: DETAIL VIEW ============ */}
                <div className="space-y-6">
                    {selectedType === 'dienst' ? (
                        <>
                            {/* ——— DIENST: Members ——— */}
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
                                            <div className="flex flex-col gap-3 md:flex-row">
                                                <Select value={tenantToAdd} onValueChange={setTenantToAdd}>
                                                    <SelectTrigger className="md:max-w-sm" data-testid="admin-group-add-tenant-select">
                                                        <SelectValue placeholder="Mandant wählen" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {availableTenants.length === 0 ? (
                                                            <SelectItem value="__none__" disabled>Keine weiteren Mandanten verfügbar</SelectItem>
                                                        ) : (
                                                            availableTenants.map((tenant) => (
                                                                <SelectItem key={tenant.id} value={String(tenant.id)}>
                                                                    {tenant.name || tenant.id}
                                                                </SelectItem>
                                                            ))
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                                <Button onClick={handleAddTenant} disabled={!tenantToAdd || addMemberMutation.isPending} data-testid="admin-group-add-tenant-submit">
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
                                                            <TableHead>Datenbank</TableHead>
                                                            <TableHead className="text-right">Aktion</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {members.map((member) => (
                                                            <TableRow key={member.tenant_id} data-testid={`admin-group-member-${member.tenant_id}`}>
                                                                <TableCell className="font-medium">{member.name || member.tenant_id}</TableCell>
                                                                <TableCell className="text-slate-500">{member.host}/{member.db_name}</TableCell>
                                                                <TableCell className="text-right">
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                                                        onClick={() => removeMemberMutation.mutate({ groupId: selectedGroupId, tenantId: member.tenant_id })}
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

                            {/* ——— DIENST: Workplaces ——— */}
                            <Card>
                                <CardHeader>
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <CardTitle className="flex items-center gap-2">
                                                <Building2 className="h-5 w-5 text-indigo-600" />
                                                Gemeinsame Dienste
                                            </CardTitle>
                                            <CardDescription>
                                                {selectedGroup ? `Pool-Dienste für ${selectedGroup.name}` : 'Bitte zuerst einen Verbund wählen.'}
                                            </CardDescription>
                                        </div>
                                        <Button onClick={handleOpenCreateWorkplace} disabled={!selectedGroup} data-testid="admin-group-workplace-create-button">
                                            <Plus className="mr-2 h-4 w-4" /> Dienst anlegen
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {!selectedGroup ? (
                                        <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Bitte links einen Verbund auswählen.</div>
                                    ) : workplacesLoading ? (
                                        <div className="flex items-center justify-center py-6 text-sm text-slate-500">
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Dienste …
                                        </div>
                                    ) : workplaces.length === 0 ? (
                                        <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Noch kein gemeinsamer Dienst angelegt.</div>
                                    ) : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Name</TableHead>
                                                    <TableHead>Status</TableHead>
                                                    <TableHead className="text-right">Aktionen</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {workplaces.map((workplace) => (
                                                    <TableRow key={workplace.id} data-testid={`admin-group-workplace-${workplace.id}`}>
                                                        <TableCell>
                                                            <div className="font-medium">{workplace.name}</div>
                                                            <div className="mt-1 flex flex-wrap gap-1">
                                                                <Badge variant="secondary" className="text-[10px] font-normal">{serviceTypeLabel(workplace.service_type)}</Badge>
                                                                {workplace.auto_off ? <Badge variant="secondary" className="bg-blue-100 text-[10px] font-normal text-blue-700">Auto-Frei</Badge> : null}
                                                                {workplace.allows_rotation_concurrently ? <Badge variant="secondary" className="bg-green-100 text-[10px] font-normal text-green-700">Rotation OK</Badge> : null}
                                                                {workplace.allows_absence_overlap ? <Badge variant="secondary" className="bg-violet-100 text-[10px] font-normal text-violet-700">Abwesenheit OK</Badge> : null}
                                                                {workplace.timeslots_enabled ? <Badge variant="secondary" className="bg-indigo-100 text-[10px] font-normal text-indigo-700">Zeitfenster</Badge> : null}
                                                                {workplace.allows_multiple ? <Badge variant="secondary" className="bg-teal-100 text-[10px] font-normal text-teal-700">Mehrfachbesetzung</Badge> : null}
                                                                {workplace.allows_multiple && (workplace.min_staff > 0 || workplace.optimal_staff > 1) ? (
                                                                    <Badge variant="secondary" className="bg-amber-100 text-[10px] font-normal text-amber-700">
                                                                        {workplace.min_staff ?? 1}–{workplace.optimal_staff ?? 1}
                                                                    </Badge>
                                                                ) : null}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex flex-col gap-1">
                                                                <Badge variant="outline" className={workplace.is_active ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-300 bg-slate-100 text-slate-600'}>
                                                                    {workplace.is_active ? 'Aktiv' : 'Inaktiv'}
                                                                </Badge>
                                                                <span className="text-xs text-slate-500">
                                                                    {workplace.affects_availability ? 'Blockiert Verfügbarkeit' : 'Nicht verfügbarkeitsrelevant'}
                                                                </span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <Button variant="outline" size="sm" onClick={() => handleOpenEditWorkplace(workplace)}>
                                                                    <Pencil className="mr-1 h-3.5 w-3.5" /> Bearbeiten
                                                                </Button>
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => setQualificationsWorkplace(workplace)}
                                                                    title="Pflicht-Qualifikationen verwalten"
                                                                >
                                                                    <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Qualifikationen
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
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    ) : selectedType === 'rotation' ? (
                        <>
                            {/* ——— ROTATION: Info box ——— */}
                            <div className="rounded-lg bg-indigo-50 p-3 text-xs text-indigo-700 space-y-1">
                                <p><strong>Aufbau eines Rotationsverbunds:</strong></p>
                                <ol className="list-decimal pl-4 space-y-0.5">
                                    <li><strong>Springerpool-Mandant</strong> als Mitglied mit Rolle <code>pool</code> hinzufügen (genau einer).</li>
                                    <li><strong>Stations-Mandanten</strong> als Mitglieder mit Rolle <code>ward</code> hinzufügen (z. B. Gyn1, Gyn2, Gyn3).</li>
                                    <li><strong>Rotationen</strong> (Arbeitsplätze) pro Station anlegen — z. B. „Gyn 1", „Gyn 2", „Gyn 3".</li>
                                    <li><strong>Zeitfenster</strong> pro Rotation aktivieren (Früh-/Mittel-/Spätdienst).</li>
                                </ol>
                            </div>

                            {/* ——— ROTATION: Members ——— */}
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
                                                <Select value={rotationTenantToAdd} onValueChange={setRotationTenantToAdd}>
                                                    <SelectTrigger className="md:max-w-sm" data-testid="admin-rotation-add-tenant-select">
                                                        <SelectValue placeholder="Mandant wählen" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {availableRotationTenants.length === 0 ? (
                                                            <SelectItem value="__none__" disabled>Keine weiteren Mandanten verfügbar</SelectItem>
                                                        ) : (
                                                            availableRotationTenants.map((tenant) => (
                                                                <SelectItem key={tenant.id} value={String(tenant.id)}>
                                                                    {tenant.name || tenant.id}
                                                                </SelectItem>
                                                            ))
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                                <Select value={rotationTenantRole} onValueChange={setRotationTenantRole}>
                                                    <SelectTrigger className="md:max-w-[180px]" data-testid="admin-rotation-add-tenant-role">
                                                        <SelectValue placeholder="Rolle" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="pool">Springerpool</SelectItem>
                                                        <SelectItem value="ward">Station</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <Button onClick={handleAddRotationTenant} disabled={!rotationTenantToAdd || addRotationMemberMutation.isPending} data-testid="admin-rotation-add-tenant-submit">
                                                    {addRotationMemberMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                                    Mandant hinzufügen
                                                </Button>
                                            </div>

                                            {rotationMembersLoading ? (
                                                <div className="flex items-center justify-center py-6 text-sm text-slate-500">
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Mitglieder …
                                                </div>
                                            ) : rotationMembers.length === 0 ? (
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
                                                        {rotationMembers.map((member) => (
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
                                                                        onClick={() => removeRotationMemberMutation.mutate({ groupId: selectedGroupId, tenantId: member.tenant_id })}
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

                            {/* ——— ROTATION: Workplaces ——— */}
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
                                        <Button onClick={handleOpenCreateRotationWorkplace} disabled={!selectedGroup} data-testid="admin-rotation-workplace-create-button">
                                            <Plus className="mr-2 h-4 w-4" /> Rotation anlegen
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {!selectedGroup ? (
                                        <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Bitte links einen Verbund auswählen.</div>
                                    ) : rotationWorkplacesLoading ? (
                                        <div className="flex items-center justify-center py-6 text-sm text-slate-500">
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Rotationen …
                                        </div>
                                    ) : rotationWorkplaces.length === 0 ? (
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
                                                {rotationWorkplaces.map((workplace) => {
                                                    const wardName = rotationMembers.find((m) => String(m.tenant_id) === String(workplace.ward_tenant_id))?.name || workplace.ward_tenant_id;
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
                                                                    <Button variant="outline" size="sm" onClick={() => handleOpenEditRotationWorkplace(workplace)}>
                                                                        <Pencil className="mr-1 h-3.5 w-3.5" /> Bearbeiten
                                                                    </Button>
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                                                        onClick={() => handleDeleteRotationWorkplace(workplace)}
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
                        </>
                    ) : (
                        <div className="rounded-lg border border-dashed p-6 text-sm text-slate-500 text-center">
                            Bitte links einen Verbund auswählen.
                        </div>
                    )}
                </div>
            </div>

            {/* ================================================================ */}
            {/* GROUP DIALOG (shared for dienst + rotation) */}
            {/* ================================================================ */}
            <Dialog open={showGroupDialog} onOpenChange={setShowGroupDialog}>
                <DialogContent className="flex flex-col max-h-[85vh] min-h-[380px] !gap-0 p-0">
                    <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
                        <DialogTitle>{editingGroup ? 'Verbund bearbeiten' : 'Verbund anlegen'}</DialogTitle>
                        <DialogDescription>
                            {editingGroup
                                ? `Bearbeite den ${typeLabel(editingGroup._type || 'dienst')}.`
                                : 'Wähle den Typ und gib einen Namen für den Verbund ein.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                        {/* Type selector — only when creating new */}
                        {!editingGroup && (
                            <div className="space-y-2">
                                <Label>Verbund-Typ</Label>
                                <RadioGroup
                                    value={newGroupType}
                                    onValueChange={(value) => setNewGroupType(value)}
                                    className="flex gap-4"
                                >
                                    <label className={`flex flex-1 cursor-pointer items-center gap-3 rounded-lg border p-4 transition ${newGroupType === 'dienst' ? 'border-teal-300 bg-teal-50' : 'border-slate-200 hover:border-slate-300'}`}>
                                        <RadioGroupItem value="dienst" className="text-teal-600" />
                                        <div>
                                            <div className="flex items-center gap-1.5 font-medium text-slate-900">
                                                <Globe2 className="h-4 w-4 text-teal-600" /> Dienst-Verbund
                                            </div>
                                            <div className="text-xs text-slate-500 mt-0.5">
                                                Mehrere Mandanten teilen sich gemeinsame Dienste (Pool-Dienstplan).
                                            </div>
                                        </div>
                                    </label>
                                    <label className={`flex flex-1 cursor-pointer items-center gap-3 rounded-lg border p-4 transition ${newGroupType === 'rotation' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                                        <RadioGroupItem value="rotation" className="text-indigo-600" />
                                        <div>
                                            <div className="flex items-center gap-1.5 font-medium text-slate-900">
                                                <ArrowsUpFromLine className="h-4 w-4 text-indigo-600" /> Rotationsverbund
                                            </div>
                                            <div className="text-xs text-slate-500 mt-0.5">
                                                Springerpool rotiert durch mehrere Stationen.
                                            </div>
                                        </div>
                                    </label>
                                </RadioGroup>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="group-name">Name</Label>
                            <Input
                                id="group-name"
                                value={groupForm.name}
                                onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                                data-testid="admin-group-name-input"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="group-description">Beschreibung</Label>
                            <Textarea
                                id="group-description"
                                value={groupForm.description}
                                onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))}
                                rows={3}
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                                <div className="font-medium text-slate-900">Aktiv</div>
                                <div className="text-sm text-slate-500">Nur aktive Verbünde erscheinen in der Auswahl.</div>
                            </div>
                            <Switch checked={groupForm.is_active} onCheckedChange={(checked) => setGroupForm((current) => ({ ...current, is_active: checked }))} />
                        </div>
                    </div>
                    <DialogFooter className="bg-white border-t shrink-0 px-6 py-4">
                        <Button variant="outline" onClick={() => setShowGroupDialog(false)}>Abbrechen</Button>
                        <Button onClick={handleSaveGroup} disabled={createGroupMutation.isPending || updateGroupMutation.isPending || createRotationGroupMutation.isPending || updateRotationGroupMutation.isPending} data-testid="admin-group-save-button">
                            {(createGroupMutation.isPending || updateGroupMutation.isPending || createRotationGroupMutation.isPending || updateRotationGroupMutation.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Speichern
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ================================================================ */}
            {/* DIENST WORKPLACE DIALOG */}
            {/* ================================================================ */}
            <Dialog open={showWorkplaceDialog} onOpenChange={setShowWorkplaceDialog}>
                <DialogContent className="flex flex-col max-h-[85vh] min-h-[420px] !gap-0 p-0">
                    <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
                        <DialogTitle>{editingWorkplace ? 'Gemeinsamen Dienst bearbeiten' : 'Gemeinsamen Dienst anlegen'}</DialogTitle>
                        <DialogDescription>Dieser Dienst erscheint später im Cross-Department-Pool des Dienstplans.</DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                        <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="workplace-name">Name</Label>
                            <Input
                                id="workplace-name"
                                value={workplaceForm.name}
                                onChange={(event) => setWorkplaceForm((current) => ({ ...current, name: event.target.value }))}
                                data-testid="admin-group-workplace-name-input"
                            />
                        </div>
                        <div className="rounded-lg border bg-indigo-50 p-3 space-y-2">
                            <div className="space-y-0.5">
                                <Label className="text-base">Diensttyp</Label>
                                <div className="text-xs text-slate-500">Bestimmt die Limit-Prüfung und Autofill-Verteilung.</div>
                            </div>
                            <Select value={workplaceForm.service_type} onValueChange={(value) => setWorkplaceForm((current) => ({ ...current, service_type: value }))}>
                                <SelectTrigger className="bg-white" data-testid="admin-group-workplace-service-type">
                                    <SelectValue placeholder="Diensttyp wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {SERVICE_TYPES.map((serviceType) => (
                                        <SelectItem key={serviceType.value} value={String(serviceType.value)}>
                                            <span className="font-medium">{serviceType.label}</span>
                                            <span className="ml-2 text-xs text-slate-500">({serviceType.description})</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border bg-slate-50 p-3">
                            <div>
                                <div className="font-medium text-slate-900">Autom. Freistellen</div>
                                <div className="text-sm text-slate-500">Mitarbeiter erhält am folgenden Werktag automatisch „Frei“.</div>
                            </div>
                            <Switch checked={workplaceForm.auto_off} onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, auto_off: checked }))} data-testid="admin-group-workplace-auto-off" />
                        </div>

                        <div className="flex items-center justify-between rounded-lg border bg-slate-50 p-3">
                            <div>
                                <div className="font-medium text-slate-900">Rotation erlaubt</div>
                                <div className="text-sm text-slate-500">Kann parallel zu einer Tagesrotation zugewiesen werden.</div>
                            </div>
                            <Switch checked={workplaceForm.allows_rotation_concurrently} onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, allows_rotation_concurrently: checked }))} data-testid="admin-group-workplace-rotation" />
                        </div>

                        <div className="flex items-center justify-between rounded-lg border bg-slate-50 p-3">
                            <div>
                                <div className="font-medium text-slate-900">Gleichzeitige Abwesenheit erlauben</div>
                                <div className="text-sm text-slate-500">Dieser Dienst darf trotz Abwesenheit am selben Tag zugewiesen werden.</div>
                            </div>
                            <Switch checked={workplaceForm.allows_absence_overlap} onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, allows_absence_overlap: checked }))} data-testid="admin-group-workplace-absence-overlap" />
                        </div>

                        <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
                            <div className="space-y-0.5">
                                <Label className="text-base">Aufeinanderfolgende Tage</Label>
                                <div className="text-xs text-slate-500">Darf dem gleichen Arzt an aufeinanderfolgenden Tagen zugewiesen werden?</div>
                            </div>
                            <ToggleGroup
                                type="single"
                                value={workplaceForm.consecutive_days_mode}
                                onValueChange={(value) => {
                                    if (value) {
                                        setWorkplaceForm((current) => ({ ...current, consecutive_days_mode: value }));
                                    }
                                }}
                                className="justify-start"
                            >
                                <ToggleGroupItem value="forbidden" className="px-3 text-xs data-[state=on]:bg-red-100 data-[state=on]:text-red-700">Verboten</ToggleGroupItem>
                                <ToggleGroupItem value="allowed" className="px-3 text-xs data-[state=on]:bg-green-100 data-[state=on]:text-green-700">Erlaubt</ToggleGroupItem>
                                <ToggleGroupItem value="preferred" className="px-3 text-xs data-[state=on]:bg-blue-100 data-[state=on]:text-blue-700">Bevorzugt</ToggleGroupItem>
                            </ToggleGroup>
                            <div className="mt-1 text-xs text-slate-400">
                                {workplaceForm.consecutive_days_mode === 'forbidden' && 'Gleicher Arzt darf nicht an aufeinanderfolgenden Tagen eingeteilt werden.'}
                                {workplaceForm.consecutive_days_mode === 'allowed' && 'Aufeinanderfolgende Tage sind möglich, werden aber weder angestrebt noch vermieden.'}
                                {workplaceForm.consecutive_days_mode === 'preferred' && 'Aufeinanderfolgende Tage werden aktiv bevorzugt, z. B. ein ganzes Wochenende am Stück.'}
                            </div>
                        </div>

                        <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
                            <div className="space-y-0.5">
                                <Label htmlFor="workplace-work-time" className="text-base">Arbeitszeit-Anteil</Label>
                                <div className="text-xs text-slate-500">Prozentsatz der Arbeitszeit für Statistik, z. B. Rufbereitschaft = 70%.</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Input
                                    id="workplace-work-time"
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="5"
                                    value={workplaceForm.work_time_percentage}
                                    onChange={(event) => setWorkplaceForm((current) => ({ ...current, work_time_percentage: event.target.value }))}
                                    className="w-20"
                                />
                                <span className="text-sm text-slate-500">%</span>
                            </div>
                        </div>

                        <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
                            <div className="space-y-0.5">
                                <Label className="text-base">Aktive Tage</Label>
                                <div className="text-xs text-slate-500">An welchen Wochentagen kann dieser Dienst besetzt werden?</div>
                            </div>
                            <div className="flex gap-1">
                                {['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].map((day, index) => (
                                    <button
                                        key={day}
                                        type="button"
                                        onClick={() => setWorkplaceForm((current) => ({ ...current, active_days: toggleDay(current.active_days || [], index) }))}
                                        data-testid={`admin-group-workplace-day-${index}`}
                                        className={`h-8 w-8 rounded-full text-xs font-medium transition-colors ${(workplaceForm.active_days || []).includes(index) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                    >
                                        {day[0]}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border bg-slate-50 p-3">
                            <div>
                                <div className="font-medium text-slate-900">Mehrfachbesetzung</div>
                                <div className="text-sm text-slate-500">Mehrere Mitarbeiter können gleichzeitig pro Tag eingeteilt werden, z. B. für Ausbildung.</div>
                            </div>
                            <Switch checked={workplaceForm.allows_multiple} onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, allows_multiple: checked }))} data-testid="admin-group-workplace-allows-multiple" />
                        </div>

                        {workplaceForm.allows_multiple ? (
                            <div className="grid gap-3 rounded-lg border bg-amber-50 p-3 md:grid-cols-2">
                                <div className="space-y-1">
                                    <Label htmlFor="workplace-min" className="text-sm">Min. Besetzung</Label>
                                    <div className="text-xs text-slate-500">0 = kann leer bleiben</div>
                                    <Input
                                        id="workplace-min"
                                        type="number"
                                        min="0"
                                        max="20"
                                        value={workplaceForm.min_staff}
                                        onChange={(event) => setWorkplaceForm((current) => ({ ...current, min_staff: event.target.value }))}
                                        className="h-8 w-20"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="workplace-optimal" className="text-sm">Opt. Besetzung</Label>
                                    <div className="text-xs text-slate-500">Zielanzahl für Auto-Fill</div>
                                    <Input
                                        id="workplace-optimal"
                                        type="number"
                                        min="0"
                                        max="20"
                                        value={workplaceForm.optimal_staff}
                                        onChange={(event) => setWorkplaceForm((current) => ({ ...current, optimal_staff: event.target.value }))}
                                        className="h-8 w-20"
                                    />
                                </div>
                            </div>
                        ) : null}

                        <div className="grid gap-4 md:grid-cols-1">
                            <div className="space-y-2">
                                <Label htmlFor="workplace-tolerance">Pause / Toleranz (Min.)</Label>
                                <Input
                                    id="workplace-tolerance"
                                    type="number"
                                    min="0"
                                    max="60"
                                    value={workplaceForm.default_overlap_tolerance_minutes}
                                    onChange={(event) => setWorkplaceForm((current) => ({ ...current, default_overlap_tolerance_minutes: event.target.value }))}
                                    className="w-24"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border bg-indigo-50 p-3">
                            <div>
                                <div className="flex items-center gap-2 font-medium text-slate-900"><Clock className="h-4 w-4" /> Zeitfenster aktivieren</div>
                                <div className="text-sm text-slate-500">Ermöglicht die Besetzung mit wechselnden Teams über den Tag, z. B. Früh-/Spätdienst.</div>
                            </div>
                            <Switch checked={workplaceForm.timeslots_enabled} onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, timeslots_enabled: checked }))} data-testid="admin-group-workplace-timeslots-enabled" />
                        </div>

                        {workplaceForm.timeslots_enabled ? (
                            editingWorkplace ? (
                                <div className="rounded-lg border p-3">
                                    <SharedTimeslotEditor
                                        groupId={selectedGroupId}
                                        workplaceId={editingWorkplace.id}
                                        defaultTolerance={Number.parseInt(workplaceForm.default_overlap_tolerance_minutes, 10) || 15}
                                    />
                                </div>
                            ) : (
                                <div className="rounded bg-amber-50 p-2 text-xs text-amber-700">Speichern Sie zuerst, um Zeitfenster hinzuzufügen.</div>
                            )
                        ) : null}

                        <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
                            <div>
                                <div className="font-medium text-slate-900">Verfügbarkeit blockieren</div>
                                <div className="text-sm text-slate-500">Der Dienst beeinflusst Folge- und Ruhezeiten im Mandantenplan.</div>
                            </div>
                            <Switch
                                checked={workplaceForm.affects_availability}
                                onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, affects_availability: checked }))}
                                data-testid="admin-group-workplace-affects-availability"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
                            <div>
                                <div className="font-medium text-slate-900">Aktiv</div>
                                <div className="text-sm text-slate-500">Inaktive Dienste bleiben historisch erhalten, erscheinen aber nicht neu.</div>
                            </div>
                            <Switch
                                checked={workplaceForm.is_active}
                                onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, is_active: checked }))}
                                data-testid="admin-group-workplace-is-active"
                            />
                        </div>
                    </div>
                    <DialogFooter className="bg-white border-t shrink-0 px-6 py-4">
                        <Button variant="outline" onClick={() => setShowWorkplaceDialog(false)}>Abbrechen</Button>
                        <Button onClick={handleSaveWorkplace} disabled={createWorkplaceMutation.isPending || updateWorkplaceMutation.isPending} data-testid="admin-group-workplace-save-button">
                            {(createWorkplaceMutation.isPending || updateWorkplaceMutation.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Speichern
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ——— ROTATION WORKPLACE DIALOG ——— */}
            <Dialog open={showRotationWorkplaceDialog} onOpenChange={setShowRotationWorkplaceDialog}>
                <DialogContent className="flex flex-col max-h-[85vh] min-h-[420px] !gap-0 p-0">
                    <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
                        <DialogTitle>{editingRotationWorkplace ? 'Rotation bearbeiten' : 'Rotation anlegen'}</DialogTitle>
                        <DialogDescription>
                            Eine Rotation ist eine Arbeitsplatzzeile im Springerpool-Dienstplan (z. B. „Gyn 1").
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="rotation-workplace-name">Name</Label>
                            <Input
                                id="rotation-workplace-name"
                                value={rotationWorkplaceForm.name}
                                onChange={(event) => setRotationWorkplaceForm((current) => ({ ...current, name: event.target.value }))}
                                data-testid="admin-rotation-workplace-name-input"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="rotation-workplace-ward">Station (Mandant)</Label>
                            <div className="text-xs text-slate-500">Welcher Station gehört diese Rotation? Nur Stations-Mandanten (role=ward) sind wählbar.</div>
                            <Select
                                value={rotationWorkplaceForm.ward_tenant_id}
                                onValueChange={(value) => setRotationWorkplaceForm((current) => ({ ...current, ward_tenant_id: value }))}
                            >
                                <SelectTrigger id="rotation-workplace-ward" data-testid="admin-rotation-workplace-ward-select">
                                    <SelectValue placeholder="Station wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {wardMembers.length === 0 ? (
                                        <SelectItem value="__none__" disabled>Keine Stations-Mandanten — zuerst hinzufügen</SelectItem>
                                    ) : (
                                        wardMembers.map((member) => (
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
                                checked={rotationWorkplaceForm.timeslots_enabled}
                                onCheckedChange={(checked) => setRotationWorkplaceForm((current) => ({ ...current, timeslots_enabled: checked }))}
                                data-testid="admin-rotation-workplace-timeslots-enabled"
                            />
                        </div>
                        {rotationWorkplaceForm.timeslots_enabled && editingRotationWorkplace && (
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
                                checked={rotationWorkplaceForm.is_active}
                                onCheckedChange={(checked) => setRotationWorkplaceForm((current) => ({ ...current, is_active: checked }))}
                            />
                        </div>
                    </div>
                    <DialogFooter className="bg-white border-t shrink-0 px-6 py-4">
                        <Button variant="outline" onClick={() => setShowRotationWorkplaceDialog(false)}>Abbrechen</Button>
                        <Button onClick={handleSaveRotationWorkplace} disabled={createRotationWorkplaceMutation.isPending || updateRotationWorkplaceMutation.isPending} data-testid="admin-rotation-workplace-save-button">
                            {(createRotationWorkplaceMutation.isPending || updateRotationWorkplaceMutation.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Speichern
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ——— ROTATION TIMESLOT EDITOR ——— */}
            {timeslotWorkplace && (
                <RotationTimeslotEditor
                    groupId={selectedGroupId}
                    workplace={timeslotWorkplace}
                    onClose={() => setTimeslotWorkplace(null)}
                />
            )}

            {/* ——— DIENST QUALIFICATIONS ——— */}
            <SharedWorkplaceQualificationsDialog
                open={!!qualificationsWorkplace}
                onOpenChange={(next) => { if (!next) setQualificationsWorkplace(null); }}
                groupId={selectedGroupId}
                workplace={qualificationsWorkplace}
            />
        </div>
    );
}

// ============================================================
//  RotationTimeslotEditor — inline sub-component
// ============================================================
function RotationTimeslotEditor({ groupId, workplace, onClose }) {
    const queryClient = useQueryClient();
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ label: '', start_time: '07:00', end_time: '15:00', order: 0 });

    const { data: timeslotsResponse, isLoading } = useQuery({
        queryKey: ['admin', 'rotation-timeslots', groupId, workplace.id],
        queryFn: () => api.listRotationTimeslots(groupId, workplace.id),
        staleTime: 10_000,
    });

    const timeslots = Array.isArray(timeslotsResponse?.timeslots) ? timeslotsResponse.timeslots : [];

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'rotation-timeslots', groupId, workplace.id] });
        queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
    };

    const createMutation = useMutation({
        mutationFn: (data) => api.createRotationTimeslot(groupId, workplace.id, data),
        onSuccess: () => {
            invalidate();
            setForm({ label: '', start_time: '07:00', end_time: '15:00', order: timeslots.length });
            setShowForm(false);
            toast.success('Zeitfenster erstellt');
        },
        onError: (error) => toast.error(error.message || 'Zeitfenster konnte nicht erstellt werden'),
    });

    const deleteMutation = useMutation({
        mutationFn: (timeslotId) => api.deleteRotationTimeslot(groupId, workplace.id, timeslotId),
        onSuccess: () => {
            invalidate();
            toast.success('Zeitfenster gelöscht');
        },
        onError: (error) => toast.error(error.message || 'Zeitfenster konnte nicht gelöscht werden'),
    });

    return (
        <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
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
                                {timeslots.map((ts) => (
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
                                        onChange={(e) => setForm((c) => ({ ...c, label: e.target.value }))}
                                        placeholder="z. B. Frühdienst"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-sm">Reihenfolge</Label>
                                    <Input
                                        type="number"
                                        min="0"
                                        value={form.order}
                                        onChange={(e) => setForm((c) => ({ ...c, order: Number(e.target.value) || 0 }))}
                                        className="w-24"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-sm">Start</Label>
                                    <Input
                                        type="time"
                                        value={form.start_time}
                                        onChange={(e) => setForm((c) => ({ ...c, start_time: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-sm">Ende</Label>
                                    <Input
                                        type="time"
                                        value={form.end_time}
                                        onChange={(e) => setForm((c) => ({ ...c, end_time: e.target.value }))}
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
