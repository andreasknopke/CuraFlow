import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import UserPermissionsDialog from '@/components/admin/UserPermissionsDialog';
import { useMasterAuth } from '@/master/MasterAuthProvider';
import { hasPermission } from '@/lib/permissions';

export default function MasterAdminPermissions() {
  const { user: currentUser } = useMasterAuth();
  const [showPermissionsDialog, setShowPermissionsDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: () => api.listUsers(),
    staleTime: 30 * 1000,
  });

  const admins = users.filter((u) => u.role === 'admin');

  const canEdit = currentUser?.role === 'admin' && hasPermission(currentUser, 'can_manage_users');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-center gap-3">
        <div className="p-3 bg-indigo-600 rounded-lg shadow-lg">
          <ShieldCheck className="w-8 h-8 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Admin-Rechte</h1>
          <p className="text-slate-500">
            {admins.length} Administrator{admins.length !== 1 ? 'en' : ''} — Berechtigungen pro Admin festlegen
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>E-Mail</TableHead>
              <TableHead>Super-Admin</TableHead>
              <TableHead className="text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-slate-400 py-8">
                  Keine Administratoren gefunden.
                </TableCell>
              </TableRow>
            ) : (
              admins.map((admin) => {
                const isSuper = admin.is_super_admin;
                return (
                  <TableRow key={admin.id}>
                    <TableCell className="font-medium">{admin.full_name || '—'}</TableCell>
                    <TableCell>{admin.email}</TableCell>
                    <TableCell>
                      {isSuper ? (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1">
                          <ShieldAlert className="w-3 h-3" />
                          Super-Admin
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
                          Nein
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        disabled={!canEdit}
                        onClick={() => {
                          setSelectedUser(admin);
                          setShowPermissionsDialog(true);
                        }}
                      >
                        <ShieldCheck className="w-3 h-3" />
                        Rechte bearbeiten
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <UserPermissionsDialog
        open={showPermissionsDialog}
        onOpenChange={setShowPermissionsDialog}
        user={selectedUser}
        currentUser={currentUser}
      />
    </div>
  );
}
