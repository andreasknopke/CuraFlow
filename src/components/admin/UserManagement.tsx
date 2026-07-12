import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, db } from "@/api/client";
import type { ApiError } from "@/api/client";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Shield, ShieldAlert, ShieldCheck, UserCog, UserPlus, Trash2, Database, Check, Mail, MailCheck, MailX, Send, Globe2, PenSquare } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/components/AuthProvider';
import type { AppUser } from '@/types/auth';
import type { Doctor } from '@/types/models';
import EmployeeSelect from '@/components/staff/EmployeeSelect';
import { isAlphabeticalDoctorSortingEnabled, sortDoctorsAlphabetically } from '@/utils/doctorSorting';
import UserPermissionsDialog from '@/components/admin/UserPermissionsDialog';

// ── Local interfaces for API response shapes ──────────────────────────────────

/** User shape returned by api.listUsers() — broader than AppUser to include admin fields */
interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  doctor_id?: string | null;
  is_active: boolean;
  email_verified: boolean;
  allowed_tenants?: string[] | string | null;
  allowed_groups?: string[] | string | null;
  group_admin_groups?: string[] | string | null;
  permissions?: Record<string, boolean> | null;
  is_super_admin?: boolean;
}

/** Tenant / DB-token shape returned by /api/admin/db-tokens */
interface DbToken {
  id: string;
  name?: string | null;
  description?: string | null;
  host?: string | null;
  db_name?: string | null;
}

/** Group shape returned by api.listGroups() */
interface TenantGroup {
  id: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
}

interface GroupListResponse {
  groups?: TenantGroup[];
}

interface NewUserData {
  email: string;
  full_name: string;
  password: string;
  role: string;
  sendPasswordEmail: boolean;
}

interface EditUserData {
  id: string | null;
  email: string;
  full_name: string;
  password: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function parseAllowedTenants(rawAllowedTenants: string[] | string | null | undefined): string[] {
    if (rawAllowedTenants === null || rawAllowedTenants === undefined || rawAllowedTenants === '') {
        return [];
    }

    const parsed = typeof rawAllowedTenants === 'string'
        ? (() => {
            try {
                return JSON.parse(rawAllowedTenants);
            } catch (error) {
                console.error('[UserManagement] Failed to parse allowed_tenants:', rawAllowedTenants, error);
                return [];
            }
        })()
        : rawAllowedTenants;

    return Array.isArray(parsed) ? parsed.map(String) : [];
}

function parseGroupIds(rawValue: string[] | string | null | undefined): string[] {
    if (rawValue === null || rawValue === undefined || rawValue === '') {
        return [];
    }

    const parsed = typeof rawValue === 'string'
        ? (() => {
            try {
                return JSON.parse(rawValue);
            } catch (error) {
                console.error('[UserManagement] Failed to parse group ids:', rawValue, error);
                return [];
            }
        })()
        : rawValue;

    return Array.isArray(parsed) ? parsed.map(String) : [];
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function UserManagement() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const [showCreateDialog, setShowCreateDialog] = useState<boolean>(false);
    const [showTenantDialog, setShowTenantDialog] = useState<boolean>(false);
    const [showGroupDialog, setShowGroupDialog] = useState<boolean>(false);
    const [tenantFilter, setTenantFilter] = useState<string>('');
    const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
    const [newUser, setNewUser] = useState<NewUserData>({ email: '', full_name: '', password: '', role: 'user', sendPasswordEmail: true });
    const [createError, setCreateError] = useState<string>('');
    const [sendPasswordEmail, setSendPasswordEmail] = useState<boolean>(true);
    const [passwordEmailSending, setPasswordEmailSending] = useState<Record<string, boolean>>({});
    const [showEditDialog, setShowEditDialog] = useState<boolean>(false);
    const [editUser, setEditUser] = useState<EditUserData>({ id: null, email: '', full_name: '', password: '' });
    const [editError, setEditError] = useState<string>('');
    const [showPermissionsDialog, setShowPermissionsDialog] = useState<boolean>(false);
    const [permissionsTargetUser, setPermissionsTargetUser] = useState<AdminUser | null>(null);

    const { data: users = [], isLoading } = useQuery<AdminUser[]>({
        queryKey: ['users'],
        queryFn: () => api.listUsers() as Promise<AdminUser[]>,
        staleTime: 5 * 60 * 1000, // 5 Minuten
        refetchOnWindowFocus: false,
    });

    const { data: doctors = [] } = useQuery<Doctor[]>({
        queryKey: ['doctors'],
        queryFn: () => db.Doctor.list(),
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const doctorsForSelection = React.useMemo(() => {
        return isAlphabeticalDoctorSortingEnabled(user) ? sortDoctorsAlphabetically(doctors) : doctors;
    }, [doctors, user]);

    const doctorSelectOptions = React.useMemo(() => (
        [
            {
                value: 'none',
                label: 'Keine Person',
                triggerLabel: 'Keine Person',
                sortLabel: '',
                keywords: ['leer', 'nicht zugeordnet'],
            },
            ...doctorsForSelection.map((doctor: Doctor) => ({
                value: doctor.id,
                label: doctor.name,
                triggerLabel: doctor.name,
                description: doctor.initials ? `${doctor.initials}${doctor.role ? ` · ${doctor.role}` : ''}` : (doctor.role ?? undefined),
                searchText: [doctor.initials, doctor.role].filter(Boolean).join(' '),
                sortLabel: doctor.name,
            })),
        ]
    ), [doctorsForSelection]);

    const filteredUsers = React.useMemo(() => {
        if (!tenantFilter) {
            return users;
        }

        return users.filter((entry: AdminUser) => parseAllowedTenants(entry.allowed_tenants).includes(String(tenantFilter)));
    }, [tenantFilter, users]);

    // Fetch available tenants (db tokens)
    const { data: tenants = [] } = useQuery<DbToken[]>({
        queryKey: ['serverDbTokens'],
        queryFn: async () => {
            try {
                const response = await api.request('/api/admin/db-tokens');
                return response as DbToken[];
            } catch (e: unknown) {
                console.error('Failed to load tenants:', e);
                return [];
            }
        },
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const { data: groupResponse } = useQuery<GroupListResponse>({
        queryKey: ['adminTenantGroupsForUsers'],
        queryFn: () => api.listGroups() as Promise<GroupListResponse>,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const groups = Array.isArray(groupResponse?.groups) ? groupResponse.groups : [];

    const updateUserMutation = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
            console.log('[UserManagement] Updating user:', { id, data });
            const result = await api.updateUser(id, data as unknown as Record<string, unknown>);
            console.log('[UserManagement] Update result:', result);
            return result;
        },
        onSuccess: (data: unknown) => {
            console.log('[UserManagement] Update success:', data);
            queryClient.invalidateQueries({ queryKey: ['users'] });
        },
        onError: (err: Error) => {
            console.error('[UserManagement] Update error:', err);
            alert("Fehler beim Aktualisieren: " + err.message);
        }
    });

    const createUserMutation = useMutation({
        mutationFn: async (userData: Record<string, unknown>) => api.register(userData),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setShowCreateDialog(false);
            setNewUser({ email: '', full_name: '', password: '', role: 'user', sendPasswordEmail: true });
            setSendPasswordEmail(true);
            setCreateError('');
        },
        onError: (err: Error) => {
            setCreateError(err.message);
        }
    });

    const deleteUserMutation = useMutation({
        mutationFn: async (userId: string) => api.deleteUser(userId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
        },
        onError: (err: Error) => {
            alert("Fehler beim Löschen: " + err.message);
        }
    });

    const handleCreateUser = () => {
        if (!newUser.email || !newUser.password) {
            setCreateError('E-Mail und Passwort sind erforderlich');
            return;
        }
        createUserMutation.mutate({ ...newUser, sendPasswordEmail } as unknown as Record<string, unknown>);
    };

    const handleSendPasswordEmail = async (userId: string) => {
        setPasswordEmailSending(prev => ({ ...prev, [userId]: true }));
        try {
            await api.sendPasswordEmail(userId);
            alert('Passwort-Email wurde erfolgreich gesendet!');
            queryClient.invalidateQueries({ queryKey: ['users'] });
        } catch (err: unknown) {
            alert('Fehler beim Senden der Passwort-Email: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setPasswordEmailSending(prev => ({ ...prev, [userId]: false }));
        }
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="space-y-6" data-testid="admin-user-management">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <UserCog className="w-6 h-6 text-indigo-600" />
                    <h2 className="text-xl font-semibold">Benutzerverwaltung</h2>
                </div>
                <Button
                    onClick={() => setShowCreateDialog(true)}
                    className="bg-indigo-600 hover:bg-indigo-700"
                    data-testid="admin-user-create-button"
                >
                    <UserPlus className="w-4 h-4 mr-2" />
                    Neuer Benutzer
                </Button>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                    <Label htmlFor="tenantFilter" className="text-sm">Mandant filtern:</Label>
                    <Select
                        value={tenantFilter || "__all__"}
                        onValueChange={(val: string) => setTenantFilter(val === "__all__" ? "" : val)}
                    >
                        <SelectTrigger id="tenantFilter" className="w-64" data-testid="admin-user-tenant-filter">
                            <SelectValue placeholder="Alle Mandanten" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all__">Alle Mandanten</SelectItem>
                            {tenants.map((tenant: DbToken) => (
                                <SelectItem key={tenant.id} value={String(tenant.id)}>
                                    {tenant.name || tenant.id}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="text-sm text-slate-500">
                    {filteredUsers.length} von {users.length} Nutzern sichtbar
                </div>
            </div>

            <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Rolle</TableHead>
                            <TableHead>Zugeordnete Person</TableHead>
                            <TableHead>Mandanten</TableHead>
                            <TableHead>Verbünde</TableHead>
                            <TableHead>E-Mail Status</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Aktionen</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredUsers.map((user: AdminUser) => {
                            const userTenants = user.allowed_tenants ? 
                                (typeof user.allowed_tenants === 'string' ? JSON.parse(user.allowed_tenants) : user.allowed_tenants) 
                                : null;
                            const allowedGroups = parseGroupIds(user.allowed_groups);
                            const adminGroups = parseGroupIds(user.group_admin_groups);
                            const tenantCount = userTenants?.length || 0;
                            const hasAllAccess = !userTenants || userTenants.length === 0;
                            
                            return (
                            <TableRow key={user.id} data-testid={`admin-user-row-${user.id}`}>
                                <TableCell className="font-medium">{user.full_name}</TableCell>
                                <TableCell>{user.email}</TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        {user.role === 'admin' ? (
                                            <ShieldAlert className="w-4 h-4 text-red-600" />
                                        ) : (
                                            <Shield className="w-4 h-4 text-slate-400" />
                                        )}
                                        <span className={user.role === 'admin' ? 'text-red-700 font-medium' : 'text-slate-600'}>
                                            {user.role === 'admin' ? 'Administrator' : 'Benutzer'}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <EmployeeSelect
                                        value={user.doctor_id || 'none'}
                                        onValueChange={(val: string) => updateUserMutation.mutate({
                                            id: user.id,
                                            data: { doctor_id: val === 'none' ? null : val }
                                        })}
                                        options={doctorSelectOptions}
                                        placeholder="Keine Person"
                                        searchPlaceholder="Person suchen..."
                                        triggerClassName="w-48"
                                        triggerTestId={`admin-user-doctor-${user.id}`}
                                    />
                                </TableCell>
                                <TableCell>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-1"
                                        data-testid={`admin-user-tenants-${user.id}`}
                                        onClick={() => {
                                            setSelectedUser(user);
                                            setShowTenantDialog(true);
                                        }}
                                    >
                                        <Database className="w-3 h-3" />
                                        {hasAllAccess ? (
                                            <span className="text-green-600">Alle</span>
                                        ) : (
                                            <span>{tenantCount} von {tenants.length}</span>
                                        )}
                                    </Button>
                                </TableCell>
                                <TableCell>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-1"
                                        data-testid={`admin-user-groups-${user.id}`}
                                        onClick={() => {
                                            setSelectedUser(user);
                                            setShowGroupDialog(true);
                                        }}
                                    >
                                        <Globe2 className="w-3 h-3" />
                                        {allowedGroups.length === 0 ? (
                                            <span>Keine</span>
                                        ) : (
                                            <span>{allowedGroups.length} / {adminGroups.length} schreibbar</span>
                                        )}
                                    </Button>
                                </TableCell>
                                <TableCell>
                                    {user.email_verified ? (
                                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1" data-testid={`admin-user-email-status-${user.id}`}>
                                            <MailCheck className="w-3 h-3" />
                                            Verifiziert
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1" data-testid={`admin-user-email-status-${user.id}`}>
                                            <MailX className="w-3 h-3" />
                                            Offen
                                        </Badge>
                                    )}
                                </TableCell>
                                <TableCell>
                                    {user.is_active ? (
                                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200" data-testid={`admin-user-active-status-${user.id}`}>
                                            Aktiv
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-300" data-testid={`admin-user-active-status-${user.id}`}>
                                            Inaktiv
                                        </Badge>
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-1"
                                            data-testid={`admin-user-edit-${user.id}`}
                                            onClick={() => {
                                                setEditUser({
                                                    id: user.id,
                                                    email: user.email || '',
                                                    full_name: user.full_name || '',
                                                    password: '',
                                                });
                                                setEditError('');
                                                setShowEditDialog(true);
                                            }}
                                            title="Benutzer bearbeiten"
                                        >
                                            <PenSquare className="w-3 h-3" />
                                        </Button>
                                        {user.role === 'admin' && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50"
                                                data-testid={`admin-user-permissions-${user.id}`}
                                                onClick={() => {
                                                    setPermissionsTargetUser(user);
                                                    setShowPermissionsDialog(true);
                                                }}
                                                title="Admin-Rechte bearbeiten"
                                            >
                                                <ShieldCheck className="w-3 h-3" />
                                                Rechte
                                            </Button>
                                        )}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50"
                                            disabled={passwordEmailSending[user.id] || !user.is_active}
                                            data-testid={`admin-user-send-password-${user.id}`}
                                            onClick={() => {
                                                if (confirm(`Neues Passwort generieren und an "${user.email}" senden?`)) {
                                                    handleSendPasswordEmail(user.id);
                                                }
                                            }}
                                            title="Passwort per E-Mail senden"
                                        >
                                            {passwordEmailSending[user.id] ? (
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <Send className="w-3 h-3" />
                                            )}
                                            Passwort senden
                                        </Button>
                                        <Select 
                                            defaultValue={user.role} 
                                            onValueChange={(val: string) => updateUserMutation.mutate({ id: user.id, data: { role: val } })}
                                        >
                                            <SelectTrigger className="w-32" data-testid={`admin-user-role-${user.id}`}>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="user">Benutzer</SelectItem>
                                                <SelectItem value="admin">Admin</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                            disabled={!user.is_active}
                                            data-testid={`admin-user-delete-${user.id}`}
                                            onClick={() => {
                                                if (confirm(`Benutzer "${user.full_name || user.email}" wirklich löschen?`)) {
                                                    deleteUserMutation.mutate(user.id);
                                                }
                                            }}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )})}
                    </TableBody>
                </Table>
            </div>

            {/* Create User Dialog */}
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                <DialogContent data-testid="admin-user-create-dialog">
                    <DialogHeader>
                        <DialogTitle>Neuen Benutzer anlegen</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {createError && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                                {createError}
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="email">E-Mail *</Label>
                            <Input
                                id="email"
                                type="email"
                                data-testid="admin-user-create-email"
                                value={newUser.email}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewUser({ ...newUser, email: e.target.value })}
                                placeholder="name@beispiel.de"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="full_name">Name</Label>
                            <Input
                                id="full_name"
                                data-testid="admin-user-create-name"
                                value={newUser.full_name}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewUser({ ...newUser, full_name: e.target.value })}
                                placeholder="Max Mustermann"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">Passwort *</Label>
                            <Input
                                id="password"
                                type="password"
                                data-testid="admin-user-create-password"
                                value={newUser.password}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewUser({ ...newUser, password: e.target.value })}
                                placeholder="Mindestens 6 Zeichen"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="role">Rolle</Label>
                            <Select value={newUser.role} onValueChange={(val: string) => setNewUser({ ...newUser, role: val })}>
                                <SelectTrigger data-testid="admin-user-create-role">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="user">Benutzer</SelectItem>
                                    <SelectItem value="admin">Administrator</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-center space-x-2 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                            <Checkbox 
                                id="sendPasswordEmail"
                                data-testid="admin-user-create-send-password-email"
                                checked={sendPasswordEmail}
                                onCheckedChange={(checked: boolean | string) => setSendPasswordEmail(!!checked)}
                            />
                            <label 
                                htmlFor="sendPasswordEmail" 
                                className="text-sm font-medium leading-none cursor-pointer flex items-center gap-2"
                            >
                                <Mail className="w-4 h-4 text-indigo-600" />
                                Zugangsdaten per E-Mail senden
                            </label>
                        </div>
                        {sendPasswordEmail && (
                            <p className="text-xs text-slate-500 pl-1">
                                Ein neues Passwort wird generiert und zusammen mit einem E-Mail-Verifizierungslink an die angegebene Adresse gesendet.
                            </p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                            Abbrechen
                        </Button>
                        <Button 
                            onClick={handleCreateUser} 
                            disabled={createUserMutation.isPending}
                            className="bg-indigo-600 hover:bg-indigo-700"
                            data-testid="admin-user-create-submit"
                        >
                            {createUserMutation.isPending ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <UserPlus className="w-4 h-4 mr-2" />
                            )}
                            Erstellen
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Tenant Assignment Dialog */}
            <Dialog open={showTenantDialog} onOpenChange={(open: boolean) => {
                setShowTenantDialog(open);
                if (!open) setSelectedUser(null);
            }}>
                <DialogContent className="flex flex-col max-h-[85vh] !gap-0 p-0 max-w-md">
                    <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
                        <DialogTitle className="flex items-center gap-2">
                            <Database className="w-5 h-5" />
                            Mandanten-Zuordnung
                        </DialogTitle>
                    </DialogHeader>
                    {selectedUser && (
                        <TenantSelector 
                            user={selectedUser}
                            tenants={tenants}
                            adminHasFullAccess={tenants.length === 0 || !user?.allowed_tenants || (Array.isArray(user.allowed_tenants) && user.allowed_tenants.length === 0)}
                            onSave={(allowedTenants: string[] | null) => {
                                updateUserMutation.mutate({
                                    id: selectedUser.id,
                                    data: { allowed_tenants: allowedTenants }
                                }, {
                                    onSuccess: () => setShowTenantDialog(false)
                                });
                            }}
                            onClose={() => setShowTenantDialog(false)}
                            isLoading={updateUserMutation.isPending}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={showGroupDialog} onOpenChange={(open: boolean) => {
                setShowGroupDialog(open);
                if (!open) setSelectedUser(null);
            }}>
                <DialogContent className="flex flex-col max-h-[85vh] !gap-0 p-0 max-w-2xl">
                    <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
                        <DialogTitle className="flex items-center gap-2">
                            <Globe2 className="w-5 h-5" />
                            Verbund-Rechte
                        </DialogTitle>
                    </DialogHeader>
                    {selectedUser && (
                        <GroupAccessSelector
                            user={selectedUser}
                            groups={groups}
                            onSave={({ allowedGroups, adminGroups }: { allowedGroups: string[]; adminGroups: string[] }) => {
                                updateUserMutation.mutate({
                                    id: selectedUser.id,
                                    data: {
                                        allowed_groups: allowedGroups,
                                        group_admin_groups: adminGroups,
                                    }
                                }, {
                                    onSuccess: () => setShowGroupDialog(false)
                                });
                            }}
                            onClose={() => setShowGroupDialog(false)}
                            isLoading={updateUserMutation.isPending}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* Edit User Dialog */}
            <Dialog open={showEditDialog} onOpenChange={(open: boolean) => {
                setShowEditDialog(open);
                if (!open) setEditUser({ id: null, email: '', full_name: '', password: '' });
            }}>
                <DialogContent data-testid="admin-user-edit-dialog">
                    <DialogHeader>
                        <DialogTitle>Benutzer bearbeiten</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {editError && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                                {editError}
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="edit-email">E-Mail</Label>
                            <Input
                                id="edit-email"
                                type="email"
                                value={editUser.email}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditUser({ ...editUser, email: e.target.value })}
                                placeholder="name@beispiel.de"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-name">Name</Label>
                            <Input
                                id="edit-name"
                                value={editUser.full_name}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditUser({ ...editUser, full_name: e.target.value })}
                                placeholder="Max Mustermann"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-password">Neues Passwort (leer lassen = nicht ändern)</Label>
                            <Input
                                id="edit-password"
                                type="password"
                                value={editUser.password}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditUser({ ...editUser, password: e.target.value })}
                                placeholder="Mindestens 6 Zeichen"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowEditDialog(false)}>
                            Abbrechen
                        </Button>
                        <Button
                            onClick={() => {
                                const data: Record<string, string> = {};
                                if (editUser.email) data.email = editUser.email;
                                if (editUser.full_name) data.full_name = editUser.full_name;
                                if (editUser.password) data.password = editUser.password;
                                if (Object.keys(data).length === 0) {
                                    setEditError('Keine Felder zum Ändern');
                                    return;
                                }
                                updateUserMutation.mutate({
                                    id: editUser.id!,
                                    data,
                                }, {
                                    onSuccess: () => {
                                        setShowEditDialog(false);
                                        setEditUser({ id: null, email: '', full_name: '', password: '' });
                                    },
                                    onError: (err: Error) => {
                                        setEditError(err.message);
                                    }
                                });
                            }}
                            disabled={updateUserMutation.isPending}
                            className="bg-indigo-600 hover:bg-indigo-700"
                            data-testid="admin-user-edit-submit"
                        >
                            {updateUserMutation.isPending ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <PenSquare className="w-4 h-4 mr-2" />
                            )}
                            Speichern
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Admin-Rechte-Dialog */}
            <UserPermissionsDialog
                open={showPermissionsDialog}
                onOpenChange={setShowPermissionsDialog}
                user={permissionsTargetUser}
                currentUser={user}
            />
        </div>
    );
}

// ── Tenant selector sub-component ──────────────────────────────────────────────

interface TenantSelectorProps {
  user: AdminUser;
  tenants: DbToken[];
  adminHasFullAccess: boolean;
  onSave: (allowedTenants: string[] | null) => void;
  onClose: () => void;
  isLoading: boolean;
}

function TenantSelector({ user, tenants, adminHasFullAccess, onSave, onClose, isLoading }: TenantSelectorProps) {
    const currentTenants = parseAllowedTenants(user.allowed_tenants);
    
    const [selectedTenants, setSelectedTenants] = useState<string[]>(currentTenants || []);
    // Only allow "All Access" if admin has full access themselves
    const [allAccess, setAllAccess] = useState<boolean>(
        adminHasFullAccess && (!currentTenants || currentTenants.length === 0)
    );

    const toggleTenant = (tenantId: string) => {
        console.log('[TenantSelector] toggleTenant:', tenantId);
        setSelectedTenants((prev: string[]) => {
            const newValue = prev.includes(tenantId) 
                ? prev.filter((id: string) => id !== tenantId)
                : [...prev, tenantId];
            console.log('[TenantSelector] New selectedTenants:', newValue);
            return newValue;
        });
    };

    const handleSave = () => {
        // If "All Access" is selected, save null or empty array
        const valueToSave = allAccess ? null : selectedTenants;
        console.log('[TenantSelector] handleSave called:', { allAccess, selectedTenants, valueToSave });
        onSave(valueToSave);
    };

    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="text-sm text-slate-600">
                Benutzer: <span className="font-medium">{user.full_name || user.email}</span>
            </div>

            {/* All Access Toggle - only show if admin has full access */}
            {adminHasFullAccess && (
                <div className="flex items-center space-x-2 p-3 bg-slate-50 rounded-lg border">
                            <Checkbox 
                                id="all-access"
                                data-testid="admin-user-tenant-all-access"
                                checked={allAccess}
                                onCheckedChange={(checked: boolean | string) => {
                                    setAllAccess(!!checked);
                            if (checked) setSelectedTenants([]);
                        }}
                    />
                    <label 
                        htmlFor="all-access" 
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                        Zugriff auf alle Mandanten
                    </label>
                </div>
            )}

            {/* Tenant List */}
            {!allAccess && (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                    <Label>Erlaubte Mandanten:</Label>
                    {tenants.length === 0 ? (
                        <p className="text-sm text-slate-500 italic">Keine Mandanten konfiguriert</p>
                    ) : (
                        tenants.map((tenant: DbToken) => {
                            const isSelected = selectedTenants.includes(tenant.id);
                            return (
                            <div 
                                key={tenant.id} 
                                data-testid={`admin-user-tenant-option-${tenant.id}`}
                                className={`flex items-center space-x-2 p-2 rounded border cursor-pointer hover:bg-slate-50 ${
                                    isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'
                                }`}
                                onClick={() => {
                                    console.log('[TenantSelector] Row clicked for tenant:', tenant.id);
                                    toggleTenant(tenant.id);
                                }}
                            >
                                <Checkbox 
                                    data-testid={`admin-user-tenant-checkbox-${tenant.id}`}
                                    checked={isSelected}
                                    onCheckedChange={() => {
                                        console.log('[TenantSelector] Checkbox changed for tenant:', tenant.id);
                                        toggleTenant(tenant.id);
                                    }}
                                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                />
                                <div className="flex-1">
                                    <div className="font-medium text-sm">{tenant.name}</div>
                                    {tenant.description && (
                                        <div className="text-xs text-slate-500">{tenant.description}</div>
                                    )}
                                    <div className="text-xs text-slate-400">{tenant.host}/{tenant.db_name}</div>
                                </div>
                                {isSelected && (
                                    <Check className="w-4 h-4 text-indigo-600" />
                                )}
                            </div>
                        )})
                    )}
                </div>
            )}

            <DialogFooter className="sticky bottom-0 bg-white border-t shrink-0 px-6 py-4">
                <Button variant="outline" onClick={onClose}>
                    Abbrechen
                </Button>
                <Button 
                    onClick={handleSave}
                    disabled={isLoading}
                    className="bg-indigo-600 hover:bg-indigo-700"
                    data-testid="admin-user-tenant-save"
                >
                    {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Speichern
                </Button>
            </DialogFooter>
        </div>
        </div>
    );
}

// ── Group access selector sub-component ───────────────────────────────────────

interface GroupAccessSelectorProps {
  user: AdminUser;
  groups: TenantGroup[];
  onSave: (payload: { allowedGroups: string[]; adminGroups: string[] }) => void;
  onClose: () => void;
  isLoading: boolean;
}

function GroupAccessSelector({ user, groups, onSave, onClose, isLoading }: GroupAccessSelectorProps) {
    const [selectedGroups, setSelectedGroups] = useState<string[]>(parseGroupIds(user.allowed_groups));
    const [adminGroups, setAdminGroups] = useState<string[]>(parseGroupIds(user.group_admin_groups));

    const toggleReadGroup = (groupId: string) => {
        setSelectedGroups((current: string[]) => {
            if (current.includes(groupId)) {
                setAdminGroups((adminCurrent: string[]) => adminCurrent.filter((entry: string) => entry !== groupId));
                return current.filter((entry: string) => entry !== groupId);
            }
            return [...current, groupId];
        });
    };

    const toggleWriteGroup = (groupId: string) => {
        setSelectedGroups((current: string[]) => (current.includes(groupId) ? current : [...current, groupId]));
        setAdminGroups((current: string[]) => (
            current.includes(groupId)
                ? current.filter((entry: string) => entry !== groupId)
                : [...current, groupId]
        ));
    };

    const handleSave = () => {
        const normalizedAllowedGroups = selectedGroups;
        const normalizedAdminGroups = adminGroups.filter((groupId: string) => normalizedAllowedGroups.includes(groupId));
        onSave({
            allowedGroups: normalizedAllowedGroups,
            adminGroups: normalizedAdminGroups,
        });
    };

    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="text-sm text-slate-600">
                Benutzer: <span className="font-medium">{user.full_name || user.email}</span>
            </div>

            {groups.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">
                    Es sind noch keine Verbünde angelegt.
                </div>
            ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                    <Label>Verbundrechte:</Label>
                    {groups.map((group: TenantGroup) => {
                        const groupId = String(group.id);
                        const canRead = selectedGroups.includes(groupId);
                        const canWrite = adminGroups.includes(groupId);
                        return (
                            <div key={groupId} className="rounded-lg border p-3" data-testid={`admin-user-group-option-${groupId}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-1">
                                        <div className="font-medium text-sm">{group.name}</div>
                                        {group.description ? (
                                            <div className="text-xs text-slate-500">{group.description}</div>
                                        ) : null}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                        {group.is_active ? 'Aktiv' : 'Inaktiv'}
                                    </div>
                                </div>
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                                        <Checkbox
                                            checked={canRead}
                                            onCheckedChange={() => toggleReadGroup(groupId)}
                                            data-testid={`admin-user-group-read-${groupId}`}
                                        />
                                        Sichtrecht
                                    </label>
                                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                                        <Checkbox
                                            checked={canWrite}
                                            onCheckedChange={() => toggleWriteGroup(groupId)}
                                            data-testid={`admin-user-group-write-${groupId}`}
                                        />
                                        <PenSquare className="w-3.5 h-3.5 text-indigo-600" /> Schreibrecht
                                    </label>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <DialogFooter className="sticky bottom-0 bg-white border-t shrink-0 px-6 py-4">
                <Button variant="outline" onClick={onClose}>Abbrechen</Button>
                <Button
                    onClick={handleSave}
                    disabled={isLoading}
                    className="bg-indigo-600 hover:bg-indigo-700"
                    data-testid="admin-user-group-save"
                >
                    {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Speichern
                </Button>
            </DialogFooter>
        </div>
        </div>
    );
}
