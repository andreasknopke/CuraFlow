import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Doctor } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Check, ChevronsUpDown, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { getActiveTokenId } from '@/components/dbTokenStorage';

interface BulkLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctors: Doctor[];
}

export default function BulkLoginDialog({ open, onOpenChange, doctors }: BulkLoginDialogProps) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Fetch existing users to exclude already-registered emails
  const { data: existingUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.listUsers() as Promise<{ email: string }[]>,
    enabled: open,
    staleTime: 2 * 60 * 1000,
  });

  const existingEmails = useMemo(
    () => new Set(existingUsers.map((u) => (u.email ?? '').toLowerCase().trim()).filter(Boolean)),
    [existingUsers],
  );

  // Only doctors with a notification email that is NOT already a registered account
  const eligibleDoctors = doctors.filter(
    (d) => d.email && d.email.trim().length > 0 && !existingEmails.has(d.email.trim().toLowerCase()),
  );

  const toggleDoctor = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const resetState = () => {
    setSelectedIds([]);
    setPassword('');
    setPopoverOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) resetState();
  };

  const createLoginsMutation = useMutation({
    mutationFn: async () => {
      const selected = eligibleDoctors.filter((d) => selectedIds.includes(d.id));
      const results: { name: string; success: boolean; error?: string }[] = [];

      for (const doctor of selected) {
        try {
          const result = await api.register({
            email: doctor.email!.trim(),
            password,
            full_name: doctor.name,
            role: 'user',
            doctor_id: doctor.id,
          }) as { user: { id: string } };

          // Scope the new login to the active tenant only
          const activeTokenId = getActiveTokenId();
          if (activeTokenId && result?.user?.id) {
            await api.updateUser(result.user.id, {
              allowed_tenants: [activeTokenId],
            });
          }

          results.push({ name: doctor.name, success: true });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
          results.push({ name: doctor.name, success: false, error: message });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      if (succeeded.length > 0) {
        toast.success(`${succeeded.length} Login${succeeded.length === 1 ? '' : 's'} erfolgreich angelegt.`);
      }
      if (failed.length > 0) {
        toast.error(
          `${failed.length} fehlgeschlagen: ${failed.map((f) => `${f.name} (${f.error})`).join(', ')}`,
        );
      }

      void queryClient.invalidateQueries({ queryKey: ['users'] });
      handleOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(`Fehler beim Anlegen der Logins: ${err.message}`);
    },
  });

  const canSubmit = selectedIds.length > 0 && password.trim().length > 0 && !createLoginsMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="bulk-login-dialog">
        <DialogHeader>
          <DialogTitle>Logins anlegen</DialogTitle>
          <DialogDescription>
            Wählen Sie die Mitarbeiter aus, die ein Login erhalten sollen. Nur Mitarbeiter mit
            hinterlegter Benachrichtigungs-E-Mail können ausgewählt werden.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Multiselect for eligible doctors */}
          <div className="space-y-2">
            <Label>Mitarbeiter</Label>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={popoverOpen}
                  className="w-full justify-between"
                  data-testid="bulk-login-doctor-select"
                >
                  <span className="truncate text-left">
                    {selectedIds.length > 0
                      ? `${selectedIds.length} Mitarbeiter ausgewählt`
                      : 'Mitarbeiter auswählen'}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Mitarbeiter suchen..." aria-label="Mitarbeiter suchen" />
                  <CommandList>
                    <CommandEmpty>Keine passenden Mitarbeiter gefunden.</CommandEmpty>
                    {eligibleDoctors.map((doctor) => {
                      const isSelected = selectedIds.includes(doctor.id);
                      return (
                        <CommandItem
                          key={doctor.id}
                          value={doctor.name}
                          onSelect={() => { toggleDoctor(doctor.id); }}
                        >
                          <div
                            className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                              isSelected
                                ? 'border-indigo-600 bg-indigo-600 text-white'
                                : 'border-slate-300 text-transparent'
                            }`}
                          >
                            <Check className="h-3 w-3" />
                          </div>
                          <span className="truncate">{doctor.name}</span>
                          <span className="ml-auto truncate text-xs text-slate-400">{doctor.email}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {eligibleDoctors.length === 0 && (
              <p className="text-xs text-amber-600">
                Kein Mitarbeiter hat eine Benachrichtigungs-E-Mail hinterlegt.
              </p>
            )}
          </div>

          {/* Default password field */}
          <div className="space-y-2">
            <Label htmlFor="bulk-login-password">Default-Passwort</Label>
            <Input
              id="bulk-login-password"
              type="password"
              data-testid="bulk-login-password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); }}
              placeholder="Passwort für alle ausgewählten Mitarbeiter"
            />
            <p className="text-xs text-slate-500">
              Dieses Passwort wird für alle ausgewählten Mitarbeiter als Registrierungs-Passwort gesetzt.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { handleOpenChange(false); }}>
            Abbrechen
          </Button>
          <Button
            onClick={() => { createLoginsMutation.mutate(); }}
            disabled={!canSubmit}
            className="bg-indigo-600 hover:bg-indigo-700"
            data-testid="bulk-login-submit"
          >
            {createLoginsMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-2 h-4 w-4" />
            )}
            {selectedIds.length > 0 ? `${selectedIds.length} Login${selectedIds.length === 1 ? '' : 's'} anlegen` : 'Logins anlegen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
