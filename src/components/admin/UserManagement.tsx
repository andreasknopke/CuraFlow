import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, db } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2,
  Shield,
  ShieldAlert,
  UserCog,
  UserPlus,
  Trash2,
  Database,
  Check,
  Mail,
  MailCheck,
  MailX,
  Send,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/components/AuthProvider';
import {
  isAlphabeticalDoctorSortingEnabled,
  sortDoctorsAlphabetically,
} from '@/utils/doctorSorting';

interface AppUser {
  id: string | number;
  email: string;
  full_name?: string;
  role: string;
  doctor_id?: string | number | null;
  allowed_tenants?: string | string[] | null;
  email_verified?: boolean;
}

interface Doctor {
  id: string;
  name: string;
  initials: string;
}

interface Tenant {
  id: string | number;
  name: string;
  description?: string;
  host?: string;
  db_name?: string;
}

interface NewUserForm {
  email: string;
  full_name: string;
  password: string;
  role: string;
}

interface TenantSelectorProps {
  user: AppUser;
  tenants: Tenant[];
  adminHasFullAccess: boolean;
  onSave: (allowedTenants: string[] | number[] | null) => void;
  onClose: () => void;
  isLoading: boolean;
}

export default function UserManagement() {
  const queryClient = useQueryClient();
  const { token: _token, user } = useAuth();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showTenantDialog, setShowTenantDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [newUser, setNewUser] = useState<NewUserForm>({
    email: '',
    full_name: '',
    password: '',
    role: 'user',
  });
  const [createError, setCreateError] = useState('');
  const [sendPasswordEmail, setSendPasswordEmail] = useState(true);
  const [passwordEmailSending, setPasswordEmailSending] = useState<
    Record<string | number, boolean>
  >({});

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.listUsers()) as AppUser[],
    staleTime: 5 * 60 * 1000, // 5 Minuten
    gcTime: 10 * 60 * 1000, // 10 Minuten
    refetchOnWindowFocus: false,
  });

  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: async () => (await db.Doctor.list()) as Doctor[],
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const doctorsForSelection = React.useMemo(() => {
    return isAlphabeticalDoctorSortingEnabled(user) ? sortDoctorsAlphabetically(doctors) : doctors;
  }, [doctors, user]);

  // Fetch available tenants (db tokens)
  const { data: tenants = [] } = useQuery({
    queryKey: ['serverDbTokens'],
    queryFn: async () => {
      try {
        const response = await api.request('/api/admin/db-tokens');
        return response as Tenant[];
      } catch (e) {
        console.error('Failed to load tenants:', e);
        return [] as Tenant[];
      }
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string | number; data: Record<string, unknown> }) => {
      console.log('[UserManagement] Updating user:', { id, data });
      const result = await api.updateUser(String(id), data);
      console.log('[UserManagement] Update result:', result);
      return result;
    },
    onSuccess: (data) => {
      console.log('[UserManagement] Update success:', data);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => {
      console.error('[UserManagement] Update error:', err);
      alert('Fehler beim Aktualisieren: ' + err.message);
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (userData: Record<string, unknown>) => api.register(userData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowCreateDialog(false);
      setNewUser({ email: '', full_name: '', password: '', role: 'user' });
      setSendPasswordEmail(true);
      setCreateError('');
    },
    onError: (err: Error) => {
      setCreateError(err.message);
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string | number) => api.deleteUser(String(userId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => {
      alert('Fehler beim Löschen: ' + err.message);
    },
  });

  const handleCreateUser = () => {
    if (!newUser.email || !newUser.password) {
      setCreateError('E-Mail und Passwort sind erforderlich');
      return;
    }
    createUserMutation.mutate({ ...newUser, sendPasswordEmail });
  };

  const handleSendPasswordEmail = async (userId: string | number) => {
    setPasswordEmailSending((prev) => ({ ...prev, [userId]: true }));
    try {
      await api.sendPasswordEmail(String(userId));
      alert('Passwort-Email wurde erfolgreich gesendet!');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err: unknown) {
      alert('Fehler beim Senden der Passwort-Email: ' + (err as Error).message);
    } finally {
      setPasswordEmailSending((prev) => ({ ...prev, [userId]: false }));
    }
  };

  if (isLoading)
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin" />
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <UserCog className="w-6 h-6 text-indigo-600" />
          <h2 className="text-xl font-semibold">Benutzerverwaltung</h2>
        </div>
        <Button
          onClick={() => setShowCreateDialog(true)}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Neuer Benutzer
        </Button>
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
              <TableHead>E-Mail Status</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const userTenants = user.allowed_tenants
                ? typeof user.allowed_tenants === 'string'
                  ? JSON.parse(user.allowed_tenants)
                  : user.allowed_tenants
                : null;
              const tenantCount = userTenants?.length || 0;
              const hasAllAccess = !userTenants || userTenants.length === 0;

              return (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.full_name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {user.role === 'admin' ? (
                        <ShieldAlert className="w-4 h-4 text-red-600" />
                      ) : (
                        <Shield className="w-4 h-4 text-slate-400" />
                      )}
                      <span
                        className={
                          user.role === 'admin' ? 'text-red-700 font-medium' : 'text-slate-600'
                        }
                      >
                        {user.role === 'admin' ? 'Administrator' : 'Benutzer'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      defaultValue={user.doctor_id != null ? String(user.doctor_id) : 'none'}
                      onValueChange={(val) =>
                        updateUserMutation.mutate({
                          id: user.id,
                          data: { doctor_id: val === 'none' ? null : val },
                        })
                      }
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Keine Person" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Keine Person</SelectItem>
                        {doctorsForSelection.map((doc) => (
                          <SelectItem key={doc.id} value={doc.id}>
                            {doc.name} ({doc.initials})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => {
                        setSelectedUser(user);
                        setShowTenantDialog(true);
                      }}
                    >
                      <Database className="w-3 h-3" />
                      {hasAllAccess ? (
                        <span className="text-green-600">Alle</span>
                      ) : (
                        <span>
                          {tenantCount} von {tenants.length}
                        </span>
                      )}
                    </Button>
                  </TableCell>
                  <TableCell>
                    {user.email_verified ? (
                      <Badge
                        variant="outline"
                        className="bg-green-50 text-green-700 border-green-200 gap-1"
                      >
                        <MailCheck className="w-3 h-3" />
                        Verifiziert
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="bg-amber-50 text-amber-700 border-amber-200 gap-1"
                      >
                        <MailX className="w-3 h-3" />
                        Offen
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="bg-green-50 text-green-700 border-green-200"
                    >
                      Aktiv
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50"
                        disabled={passwordEmailSending[user.id]}
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
                        onValueChange={(val) =>
                          updateUserMutation.mutate({ id: user.id, data: { role: val } })
                        }
                      >
                        <SelectTrigger className="w-32">
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
                        onClick={() => {
                          if (
                            confirm(`Benutzer "${user.full_name || user.email}" wirklich löschen?`)
                          ) {
                            deleteUserMutation.mutate(user.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
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
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="name@beispiel.de"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="full_name">Name</Label>
              <Input
                id="full_name"
                value={newUser.full_name}
                onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                placeholder="Max Mustermann"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort *</Label>
              <Input
                id="password"
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="Mindestens 6 Zeichen"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Rolle</Label>
              <Select
                value={newUser.role}
                onValueChange={(val) => setNewUser({ ...newUser, role: val })}
              >
                <SelectTrigger>
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
                checked={sendPasswordEmail}
                onCheckedChange={(checked) => setSendPasswordEmail(!!checked)}
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
                Ein neues Passwort wird generiert und zusammen mit einem E-Mail-Verifizierungslink
                an die angegebene Adresse gesendet.
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
      <Dialog
        open={showTenantDialog}
        onOpenChange={(open) => {
          setShowTenantDialog(open);
          if (!open) setSelectedUser(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              Mandanten-Zuordnung
            </DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <TenantSelector
              user={selectedUser}
              tenants={tenants}
              adminHasFullAccess={
                tenants.length === 0 ||
                !user?.allowed_tenants ||
                (Array.isArray(user.allowed_tenants) && user.allowed_tenants.length === 0)
              }
              onSave={(allowedTenants) => {
                updateUserMutation.mutate(
                  {
                    id: selectedUser.id,
                    data: { allowed_tenants: allowedTenants },
                  },
                  {
                    onSuccess: () => setShowTenantDialog(false),
                  },
                );
              }}
              onClose={() => setShowTenantDialog(false)}
              isLoading={updateUserMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Separate component for tenant selection
function TenantSelector({
  user,
  tenants,
  adminHasFullAccess,
  onSave,
  onClose,
  isLoading,
}: TenantSelectorProps) {
  const currentTenants: Array<string | number> = user.allowed_tenants
    ? typeof user.allowed_tenants === 'string'
      ? JSON.parse(user.allowed_tenants)
      : user.allowed_tenants
    : [];

  const [selectedTenants, setSelectedTenants] = useState<Array<string | number>>(
    currentTenants || [],
  );
  // Only allow "All Access" if admin has full access themselves
  const [allAccess, setAllAccess] = useState(
    adminHasFullAccess && (!currentTenants || currentTenants.length === 0),
  );

  const toggleTenant = (tenantId: string | number) => {
    console.log('[TenantSelector] toggleTenant:', tenantId);
    setSelectedTenants((prev) => {
      const newValue = prev.includes(tenantId)
        ? prev.filter((id) => id !== tenantId)
        : [...prev, tenantId];
      console.log('[TenantSelector] New selectedTenants:', newValue);
      return newValue;
    });
  };

  const handleSave = () => {
    // If "All Access" is selected, save null or empty array
    const valueToSave = allAccess ? null : selectedTenants;
    console.log('[TenantSelector] handleSave called:', { allAccess, selectedTenants, valueToSave });
    onSave(valueToSave as string[] | number[] | null);
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-600">
        Benutzer: <span className="font-medium">{user.full_name || user.email}</span>
      </div>

      {/* All Access Toggle - only show if admin has full access */}
      {adminHasFullAccess && (
        <div className="flex items-center space-x-2 p-3 bg-slate-50 rounded-lg border">
          <Checkbox
            id="all-access"
            checked={allAccess}
            onCheckedChange={(checked) => {
              setAllAccess(checked as boolean);
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
            tenants.map((tenant) => {
              const isSelected = selectedTenants.includes(tenant.id);
              return (
                <div
                  key={tenant.id}
                  className={`flex items-center space-x-2 p-2 rounded border cursor-pointer hover:bg-slate-50 ${
                    isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'
                  }`}
                  onClick={() => {
                    console.log('[TenantSelector] Row clicked for tenant:', tenant.id);
                    toggleTenant(tenant.id);
                  }}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => {
                      console.log('[TenantSelector] Checkbox changed for tenant:', tenant.id);
                      toggleTenant(tenant.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{tenant.name}</div>
                    {tenant.description && (
                      <div className="text-xs text-slate-500">{tenant.description}</div>
                    )}
                    <div className="text-xs text-slate-400">
                      {tenant.host}/{tenant.db_name}
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-indigo-600" />}
                </div>
              );
            })
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
        <Button
          onClick={handleSave}
          disabled={isLoading}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Speichern
        </Button>
      </DialogFooter>
    </div>
  );
}
