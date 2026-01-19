import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, db, base44 } from "@/api/client";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Shield, ShieldAlert, UserCog, UserPlus, Trash2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from '@/components/AuthProvider';

export default function UserManagement() {
    const queryClient = useQueryClient();
    const { token } = useAuth();
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [newUser, setNewUser] = useState({ email: '', full_name: '', password: '', role: 'user' });
    const [createError, setCreateError] = useState('');

    const { data: users = [], isLoading } = useQuery({
        queryKey: ['users'],
        queryFn: () => api.listUsers(),
    });

    const { data: doctors = [] } = useQuery({
        queryKey: ['doctors'],
        queryFn: () => db.Doctor.list(),
    });

    const updateUserMutation = useMutation({
        mutationFn: async ({ id, data }) => api.updateUser(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries(['users']);
        },
        onError: (err) => {
            alert("Fehler beim Aktualisieren: " + err.message);
        }
    });

    const createUserMutation = useMutation({
        mutationFn: async (userData) => api.register(userData),
        onSuccess: () => {
            queryClient.invalidateQueries(['users']);
            setShowCreateDialog(false);
            setNewUser({ email: '', full_name: '', password: '', role: 'user' });
            setCreateError('');
        },
        onError: (err) => {
            setCreateError(err.message);
        }
    });

    const deleteUserMutation = useMutation({
        mutationFn: async (userId) => api.deleteUser(userId),
        onSuccess: () => {
            queryClient.invalidateQueries(['users']);
        },
        onError: (err) => {
            alert("Fehler beim Löschen: " + err.message);
        }
    });

    const handleCreateUser = () => {
        if (!newUser.email || !newUser.password) {
            setCreateError('E-Mail und Passwort sind erforderlich');
            return;
        }
        createUserMutation.mutate(newUser);
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <UserCog className="w-6 h-6 text-indigo-600" />
                    <h2 className="text-xl font-semibold">Benutzerverwaltung</h2>
                </div>
                <Button onClick={() => setShowCreateDialog(true)} className="bg-indigo-600 hover:bg-indigo-700">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Neuer Benutzer
                </Button>
            </div>

            <div className="bg-white rounded-lg border shadow-sm">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Rolle</TableHead>
                            <TableHead>Zugeordneter Arzt</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Aktionen</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {users.map((user) => (
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
                                        <span className={user.role === 'admin' ? 'text-red-700 font-medium' : 'text-slate-600'}>
                                            {user.role === 'admin' ? 'Administrator' : 'Benutzer'}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Select 
                                        defaultValue={user.doctor_id || "none"} 
                                        onValueChange={(val) => updateUserMutation.mutate({ 
                                            id: user.id, 
                                            data: { doctor_id: val === 'none' ? null : val } 
                                        })}
                                    >
                                        <SelectTrigger className="w-48">
                                            <SelectValue placeholder="Kein Arzt" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Kein Arzt</SelectItem>
                                            {doctors.map(doc => (
                                                <SelectItem key={doc.id} value={doc.id}>
                                                    {doc.name} ({doc.initials})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                        Aktiv
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <Select 
                                            defaultValue={user.role} 
                                            onValueChange={(val) => updateUserMutation.mutate({ id: user.id, data: { role: val } })}
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
                        ))}
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
                            <Select value={newUser.role} onValueChange={(val) => setNewUser({ ...newUser, role: val })}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="user">Benutzer</SelectItem>
                                    <SelectItem value="admin">Administrator</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
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
        </div>
    );
}