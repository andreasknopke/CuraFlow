import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { PERMISSION_KEYS, PERMISSION_LABELS, hasPermission } from '@/lib/permissions';
import { Loader2, ShieldAlert } from 'lucide-react';

interface UserPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: {
    id: string;
    email: string;
    full_name?: string;
    role: string;
    permissions?: Record<string, boolean> | null;
    is_super_admin?: boolean;
  } | null;
  currentUser: {
    id: string;
    email: string;
    role: string;
    permissions?: Record<string, boolean> | null;
    is_super_admin?: boolean;
  } | null;
}

export default function UserPermissionsDialog({ open, onOpenChange, user, currentUser }: UserPermissionsDialogProps) {
  const queryClient = useQueryClient();
  const [localPerms, setLocalPerms] = useState<Record<string, boolean>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const canEdit = currentUser?.role === 'admin'
    && hasPermission(currentUser, 'can_manage_users')
    && !user?.is_super_admin;

  useEffect(() => {
    if (user) {
      const perms: Record<string, boolean> = {};
      for (const key of PERMISSION_KEYS) {
        if (user.permissions?.[key] === false) {
          perms[key] = false;
        } else {
          perms[key] = true;
        }
      }
      setLocalPerms(perms);
      setHasChanges(false);
    }
  }, [user]);

  function togglePermission(key: string) {
    setLocalPerms((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      setHasChanges(true);
      return next;
    });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) return;
      await api.updateUser(user.id, { permissions: localPerms });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      alert('Fehler beim Speichern: ' + err.message);
    },
  });

  if (!user) return null;

  const isSuperAdmin = user.is_super_admin;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Admin-Rechte bearbeiten</DialogTitle>
          <DialogDescription>
            {user.full_name || user.email}
            {isSuperAdmin && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-600 font-medium">
                <ShieldAlert className="w-4 h-4" />
                Super-Admin (nicht einschränkbar)
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-slate-500">
            Wählen Sie aus, welche Bereiche dieser Administrator bearbeiten darf.
            Nicht gesetzte Berechtigungen sind deaktiviert.
          </p>

          {PERMISSION_KEYS.map((key) => {
            const checked = localPerms[key] !== false;
            const disabled = !canEdit || isSuperAdmin;

            return (
              <div key={key} className="flex items-start gap-3">
                <Checkbox
                  id={key}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => togglePermission(key)}
                  className="mt-0.5"
                />
                <div className="grid gap-0.5">
                  <Label
                    htmlFor={key}
                    className={`text-sm font-medium leading-none ${disabled ? 'text-slate-400' : ''} ${checked ? '' : 'text-slate-400'}`}
                  >
                    {PERMISSION_LABELS[key as keyof typeof PERMISSION_LABELS]}
                  </Label>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Abbrechen
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!canEdit || !hasChanges || saveMutation.isPending}
          >
            {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
