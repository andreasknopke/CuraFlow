import { format } from 'date-fns';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { db } from '@/api/client';
import type { Doctor, ShiftEntry, ScheduleBlock, ScheduleNote, SystemSetting, WishRequest } from '@/types';

interface UndoAction {
  type: string;
  id?: string;
  ids?: string[];
  data?: unknown;
}

type UndoStackEntry = UndoAction | UndoAction[];

interface PartialBulkError extends Error {
  failedIds?: string[];
  partial?: boolean;
}

interface ScheduleMutationsDeps {
  user: { role?: string; doctor_id?: string } | null | undefined;
  doctors: Doctor[];
  allShifts: ShiftEntry[];
  wishes: WishRequest[];
  fetchRange: { start: string; end: string };
  setUndoStack: React.Dispatch<React.SetStateAction<UndoStackEntry[]>>;
  unlockCell: (date: string, position: string, timeslotId?: string) => void;
  systemSettings: SystemSetting[];
  queryClient: ReturnType<typeof import('@tanstack/react-query').useQueryClient>;
}

interface ShiftOptimisticContext {
  previousShifts?: ShiftEntry[] | undefined;
}

interface CreateShiftContext extends ShiftOptimisticContext {
}

interface UpdateShiftContext extends ShiftOptimisticContext {
  oldShift?: ShiftEntry;
  newData?: Partial<ShiftEntry>;
}

interface DeleteShiftContext extends ShiftOptimisticContext {
  shift?: ShiftEntry;
}

interface BulkDeleteContext extends ShiftOptimisticContext {
  shifts?: ShiftEntry[];
}

interface AutoFreiContext {
  oldShift?: ShiftEntry;
}

export function useScheduleMutations({
  user,
  doctors,
  allShifts,
  wishes,
  fetchRange,
  setUndoStack,
  unlockCell,
  systemSettings,
  queryClient,
}: ScheduleMutationsDeps) {
  const shiftsQueryKey = ['shifts', fetchRange.start, fetchRange.end];

  const updateDoctorMutation = useMutation<Doctor, Error, { id: string; data: Partial<Doctor> }>({
    mutationFn: ({ id, data }: { id: string; data: Partial<Doctor> }) => db.Doctor.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['doctors'] }),
  });

  const updateSystemSettingMutation = useMutation<SystemSetting, Error, { key: string; value: string }>({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const existing = systemSettings.find((s) => s.key === key);
      if (existing) {
        return db.SystemSetting.update(existing.id, { value });
      }
      return db.SystemSetting.create({ key, value });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['systemSettings'] })
  });

  const createShiftMutation = useMutation<ShiftEntry, Error, Partial<ShiftEntry>, CreateShiftContext>({
    mutationFn: (data: Partial<ShiftEntry>) => db.ShiftEntry.create(data),
    onMutate: async (newData) => {
        await queryClient.cancelQueries({ queryKey: shiftsQueryKey });
        const previousShifts = queryClient.getQueryData<ShiftEntry[]>(shiftsQueryKey);

        const tempShift = { ...newData, id: `temp-${Date.now()}` };
        if (previousShifts) {
            queryClient.setQueryData(shiftsQueryKey, (old: ShiftEntry[] | undefined) => [...(old ?? []), tempShift]);
        }
        return { previousShifts };
    },
    onSuccess: (data, newData, _context) => {
        setUndoStack((prev) => [...prev, { type: 'DELETE', id: data.id }]);
        queryClient.invalidateQueries({ queryKey: shiftsQueryKey });

        if (user?.role === 'admin' && newData.doctor_id) {
            const doc = doctors.find((d) => d.id === newData.doctor_id);
            if (doc && doc.id !== user.doctor_id) {
                db.ShiftNotification.create({
                    doctor_id: newData.doctor_id,
                    date: newData.date,
                    type: 'create',
                    message: `Neuer Dienst eingetragen: ${newData.position}`,
                    acknowledged: false,
                }).catch((err) => { console.warn('[ScheduleBoard] Notification create failed:', err?.message); });
            }
        }

        const matchingWish = wishes.find((w) =>
            w.doctor_id === newData.doctor_id &&
            w.date === newData.date &&
            w.type === 'service' &&
            w.status === 'pending' &&
            (!w.position || w.position === newData.position)
        );
        if (matchingWish) {
            db.WishRequest.update(matchingWish.id, {
                status: 'approved',
                user_viewed: false,
                admin_comment: 'Automatisch genehmigt durch Diensteinteilung',
            })
                .then(() => queryClient.invalidateQueries({ queryKey: ['wishes'] }))
                .catch((err) => {
                    console.warn('[ScheduleBoard] Wunsch-Auto-Genehmigung fehlgeschlagen:', err?.message);
                    toast.warning('Dienst wurde gespeichert, aber der zugehörige Wunsch konnte nicht automatisch genehmigt werden.');
                });
        }
    },
    onSettled: (_data, _error, newData) => {
        if (newData?.date && newData?.position) {
            unlockCell(newData.date, newData.position, newData.timeslot_id as string | undefined);
        }
    },
    onError: (error, newData, context) => {
        console.error('DEBUG: Create Mutation Failed', error);
        if (context?.previousShifts) {
            queryClient.setQueryData(shiftsQueryKey, context.previousShifts);
        }
        if (error.message?.includes('Position bereits besetzt') || error.message?.includes('409')) {
            console.warn('[Sentinel] Duplicate blocked by server, refreshing data');
            queryClient.invalidateQueries({ queryKey: shiftsQueryKey });
            return;
        }
        if (error.message?.includes('403') || error.message?.includes('fehlt die Berechtigung') || error.message?.includes('missingPermission')) {
            console.warn('[ScheduleBoard] Create mutation denied by permission');
            return;
        }
        toast.error(`Fehler beim Erstellen: ${error.message}`);
    }
  });

  const bulkCreateShiftsMutation = useMutation<ShiftEntry[], Error, Partial<ShiftEntry>[], CreateShiftContext>({
    mutationFn: (shiftsData: Partial<ShiftEntry>[]) => db.ShiftEntry.bulkCreate(shiftsData),
    onMutate: async (newShifts) => {
        await queryClient.cancelQueries({ queryKey: shiftsQueryKey });
        const previousShifts = queryClient.getQueryData<ShiftEntry[]>(shiftsQueryKey);

        const tempShifts = newShifts.map((s: Partial<ShiftEntry>, i: number) => ({ ...s, id: `temp-bulk-${Date.now()}-${i}` }));

        if (previousShifts) {
            queryClient.setQueryData(shiftsQueryKey, (old: ShiftEntry[] | undefined) => [...(old ?? []), ...tempShifts]);
        }
        return { previousShifts };
    },
    onSuccess: (data, _variables, _context) => {
        if (Array.isArray(data)) {
             setUndoStack((prev) => [...prev, { type: 'BULK_DELETE', ids: data.map((s) => s.id) }]);
             for (const shift of data) {
                 if (user?.role === 'admin' && shift.doctor_id) {
                     const doc = doctors.find((d) => d.id === shift.doctor_id);
                     if (doc && doc.id !== user.doctor_id) {
                         db.ShiftNotification.create({
                             doctor_id: shift.doctor_id,
                             date: shift.date,
                             type: 'create',
                             message: `Neuer Dienst eingetragen: ${shift.position}`,
                             acknowledged: false,
                         }).catch((err) => { console.warn('[ScheduleBoard] Bulk notification failed:', err?.message); });
                     }
                 }
                 const matchingWish = wishes.find((w) =>
                     w.doctor_id === shift.doctor_id &&
                     w.date === shift.date &&
                     w.type === 'service' &&
                     w.status === 'pending' &&
                     (!w.position || w.position === shift.position)
                 );
                 if (matchingWish) {
                     db.WishRequest.update(matchingWish.id, {
                         status: 'approved',
                         user_viewed: false,
                         admin_comment: 'Automatisch genehmigt durch Diensteinteilung',
                     })
                         .then(() => queryClient.invalidateQueries({ queryKey: ['wishes'] }))
                         .catch((err) => { console.warn('[ScheduleBoard] Bulk wish approval failed:', err?.message); });
                 }
             }
        }
        queryClient.invalidateQueries({ queryKey: shiftsQueryKey });
    },
    onError: (error, _variables, context) => {
        console.error('DEBUG: Bulk Create Failed', error);
        if (context?.previousShifts) {
            queryClient.setQueryData(shiftsQueryKey, context.previousShifts);
        }
        if (error.message?.includes('Position bereits besetzt') || error.message?.includes('409')) {
            console.warn('[Sentinel] Bulk duplicate blocked by server, refreshing data');
            queryClient.invalidateQueries({ queryKey: shiftsQueryKey });
            return;
        }
        if (error.message?.includes('403') || error.message?.includes('fehlt die Berechtigung') || error.message?.includes('missingPermission')) {
            console.warn('[ScheduleBoard] BulkCreate mutation denied by permission');
            return;
        }
        toast.error(`Fehler beim Erstellen (Bulk): ${error.message}`);
    }
  });

  const updateShiftMutation = useMutation<ShiftEntry, Error, { id: string; data: Partial<ShiftEntry> }, UpdateShiftContext>({
    mutationFn: ({ id, data }: { id: string; data: Partial<ShiftEntry> }) => db.ShiftEntry.update(id, data),
    onMutate: async ({ id, data }) => {
        await queryClient.cancelQueries({ queryKey: shiftsQueryKey });

        const previousShifts = queryClient.getQueryData<ShiftEntry[]>(shiftsQueryKey);
        const oldShift = previousShifts?.find((s) => s.id === id);

        if (previousShifts) {
            queryClient.setQueryData(shiftsQueryKey, (old: ShiftEntry[] | undefined) =>
                (old ?? []).map((s) => s.id === id ? { ...s, ...data } : s)
            );
        }

        return { previousShifts, oldShift, newData: data };
    },
    onSuccess: (data, { id, data: inputData }, context) => {
        if (context.oldShift) {
            const { id: _, created_date: _createdDate, updated_date: _updatedDate, created_by: _createdBy, ...oldData } = context.oldShift;
            setUndoStack((prev) => [...prev, { type: 'UPDATE', id, data: oldData }]);

            const fullShift = { ...context.oldShift, ...inputData };
            const matchingWish = wishes.find((w) =>
                w.doctor_id === fullShift.doctor_id &&
                w.date === fullShift.date &&
                w.type === 'service' &&
                w.status === 'pending' &&
                (!w.position || w.position === fullShift.position)
            );
            if (matchingWish) {
                db.WishRequest.update(matchingWish.id, {
                    status: 'approved',
                    user_viewed: false,
                    admin_comment: 'Automatisch genehmigt durch Diensteinteilung',
                })
                    .then(() => queryClient.invalidateQueries({ queryKey: ['wishes'] }))
                    .catch((err) => {
                        console.warn('[ScheduleBoard] Wunsch-Auto-Genehmigung fehlgeschlagen:', err?.message);
                        toast.warning('Dienst wurde aktualisiert, aber der zugehörige Wunsch konnte nicht automatisch genehmigt werden.');
                    });
            }

            if (user?.role === 'admin') {
                const newShift = { ...context.oldShift, ...inputData };
                const docId = newShift.doctor_id;

                if (context.oldShift.doctor_id !== docId) {
                    if (context.oldShift.doctor_id !== user.doctor_id) {
                        db.ShiftNotification.create({
                            doctor_id: context.oldShift.doctor_id,
                            date: context.oldShift.date,
                            type: 'delete',
                            message: `Dienst entfernt: ${context.oldShift.position}`,
                            acknowledged: false
                        });
                    }
                    if (docId && docId !== user.doctor_id) {
                        db.ShiftNotification.create({
                            doctor_id: docId,
                            date: newShift.date,
                            type: 'create',
                            message: `Neuer Dienst zugewiesen: ${newShift.position}`,
                            acknowledged: false
                        });
                    }
                } else if (docId && docId !== user.doctor_id) {
                    const changes = [];
                    if (context.oldShift.date !== newShift.date) changes.push(`Datum: ${format(new Date(context.oldShift.date), 'dd.MM')} -> ${format(new Date(newShift.date), 'dd.MM')}`);
                    if (context.oldShift.position !== newShift.position) changes.push(`Position: ${context.oldShift.position} -> ${newShift.position}`);

                    if (changes.length > 0) {
                        db.ShiftNotification.create({
                            doctor_id: docId,
                            date: newShift.date,
                            type: 'update',
                            message: `Dienständerung: ${changes.join(', ')}`,
                            acknowledged: false
                        });
                    }
                }
            }
        }
        setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: shiftsQueryKey });
        }, 100);
    },
    onError: (error, _variables, context) => {
        console.error('DEBUG: Update Mutation Failed', error);
        if (context?.previousShifts) {
            queryClient.setQueryData(shiftsQueryKey, context.previousShifts);
        }
        if (error.message?.includes('403') || error.message?.includes('fehlt die Berechtigung') || error.message?.includes('missingPermission')) {
            console.warn('[ScheduleBoard] Update mutation denied by permission');
            return;
        }
        toast.error(`Fehler beim Aktualisieren: ${error.message}`);
    }
  });

  // Dedicated mutations for automatic background operations
  const createAutoFreiMutation = useMutation<ShiftEntry, Error, Partial<ShiftEntry>>({
    mutationFn: (data: Partial<ShiftEntry>) => db.ShiftEntry.create(data),
    onSuccess: (data) => {
        setUndoStack((prev) => {
            const undoAction = { type: 'DELETE', id: data.id };
            if (prev.length === 0) return [...prev, undoAction];
            const last = prev[prev.length - 1] as UndoAction | UndoAction[];
            const newGroup: UndoAction[] = Array.isArray(last) ? [...last, undoAction] : [last, undoAction];
            return [...prev.slice(0, -1), newGroup];
        });
        setTimeout(() => queryClient.invalidateQueries({ queryKey: shiftsQueryKey }), 100);
    },
    onError: (error) => { console.error('Auto-Frei creation failed:', error); }
  });

  const updateAutoFreiMutation = useMutation<ShiftEntry, Error, { id: string; data: Partial<ShiftEntry> }, AutoFreiContext>({
    mutationFn: ({ id, data }: { id: string; data: Partial<ShiftEntry> }) => db.ShiftEntry.update(id, data),
    onMutate: async ({ id }) => {
        const oldShift = allShifts.find((s: ShiftEntry) => s.id === id);
        return { oldShift };
    },
    onSuccess: (data, { id }, context) => {
        if (context.oldShift) {
            const { id: _, created_date: _createdDate, updated_date: _updatedDate, created_by: _createdBy, ...oldData } = context.oldShift;
            const undoAction = { type: 'UPDATE', id, data: oldData };

            setUndoStack((prev) => {
                if (prev.length === 0) return [...prev, undoAction];
                const last = prev[prev.length - 1] as UndoAction | UndoAction[];
                const newGroup: UndoAction[] = Array.isArray(last) ? [...last, undoAction] : [last, undoAction];
                return [...prev.slice(0, -1), newGroup];
            });
        }
        setTimeout(() => queryClient.invalidateQueries({ queryKey: shiftsQueryKey }), 100);
    },
    onError: (error) => { console.error('Auto-Frei update failed:', error); }
  });

  const deleteShiftMutation = useMutation<ShiftEntry, Error, string, DeleteShiftContext>({
    mutationFn: async (id: string) => {
        const shiftToDelete = allShifts.find((s: ShiftEntry) => s.id === id);

        if (shiftToDelete) {
            const matchingWish = wishes.find((w) =>
                w.doctor_id === shiftToDelete.doctor_id &&
                w.date === shiftToDelete.date &&
                w.status === 'approved' &&
                w.type === 'service' &&
                (!w.position || w.position === shiftToDelete.position)
            );

            if (matchingWish) {
                await db.WishRequest.update(matchingWish.id, { status: 'pending' });
            }
        }

        return db.ShiftEntry.delete(id);
    },
    onMutate: async (id) => {
        await queryClient.cancelQueries({ queryKey: shiftsQueryKey });
        const previousShifts = queryClient.getQueryData<ShiftEntry[]>(shiftsQueryKey);

        if (previousShifts) {
            queryClient.setQueryData(shiftsQueryKey, (old: ShiftEntry[] | undefined) => (old ?? []).filter((s) => s.id !== id));
        }

        const shift = allShifts.find((s: ShiftEntry) => s.id === id);
        return { shift, previousShifts };
    },
    onSuccess: (_data, id, context) => {
        if (context.shift) {
            const { id: _, created_date: _createdDate, updated_date: _updatedDate, created_by: _createdBy, ...shiftData } = context.shift;
            setUndoStack((prev) => [...prev, { type: 'CREATE', data: shiftData }]);

            if (user?.role === 'admin' && context.shift.doctor_id && context.shift.doctor_id !== user.doctor_id) {
                db.ShiftNotification.create({
                    doctor_id: context.shift.doctor_id,
                    date: context.shift.date,
                    type: 'delete',
                    message: `Dienst gestrichen: ${context.shift.position}`,
                    acknowledged: false
                });
            }
        }
        setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: shiftsQueryKey });
        }, 100);
    },
    onError: (error, id, context) => {
        console.error('DEBUG: Delete Mutation Failed', { id, error });
        if (context?.previousShifts) {
            queryClient.setQueryData(shiftsQueryKey, context.previousShifts);
        }
        if (error.message?.includes('403') || error.message?.includes('fehlt die Berechtigung') || error.message?.includes('missingPermission')) {
            console.warn('[ScheduleBoard] Delete mutation denied by permission');
            return;
        }
        toast.error(`Fehler beim Löschen: ${error.message}`);
    }
  });

  const bulkDeleteMutation = useMutation<void, Error, string[], BulkDeleteContext>({
    mutationFn: async (ids: string[]) => {
        const results = await Promise.allSettled(ids.map((id) => db.ShiftEntry.delete(id)));
        const failures = results
            .map((r, idx) => ({ r, id: ids[idx] }))
            .filter(({ r }) => r.status === 'rejected');
        if (failures.length > 0) {
            const firstError = failures[0].r.status === 'rejected' ? failures[0].r.reason : undefined;
            const err = new Error(
                `${failures.length} von ${ids.length} Löschvorgängen sind fehlgeschlagen: ${firstError?.message || 'Unbekannter Fehler'}`,
            ) as PartialBulkError;
            err.failedIds = failures.map((f) => f.id);
            err.partial = failures.length < ids.length;
            throw err;
        }
    },
    onMutate: async (ids) => {
        await queryClient.cancelQueries({ queryKey: shiftsQueryKey });
        const previousShifts = queryClient.getQueryData<ShiftEntry[]>(shiftsQueryKey);

        if (previousShifts) {
            queryClient.setQueryData(shiftsQueryKey, (old: ShiftEntry[] | undefined) => (old ?? []).filter((s) => !ids.includes(s.id)));
        }

        const shifts = allShifts.filter((s: ShiftEntry) => ids.includes(s.id));
        return { shifts, previousShifts };
    },
    onError: (err, _ids, context) => {
         const partialErr = err as PartialBulkError;
         if (partialErr.partial && context?.previousShifts) {
             queryClient.invalidateQueries({ queryKey: shiftsQueryKey });
             toast.error(`Teilweiser Löschfehler: ${partialErr.message}`, {
                 description: 'Die Daten wurden vom Server neu geladen, damit die Anzeige korrekt ist.',
             });
             return;
         }
         if (context?.previousShifts) {
             queryClient.setQueryData(shiftsQueryKey, context.previousShifts);
         }
         toast.error(`Fehler beim Löschen: ${err.message}`);
    },
    onSuccess: (_data, _ids, context) => {
        if (context.shifts && context.shifts.length > 0) {
            const shiftsData = context.shifts.map((s: ShiftEntry) => {
                const { id: _id, created_date: _createdDate, updated_date: _updatedDate, created_by: _createdBy, ...rest } = s;
                return rest;
            });
            setUndoStack((prev) => [...prev, { type: 'BULK_CREATE', data: shiftsData }]);
        }
        setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: shiftsQueryKey });
        }, 100);
    }
  });

  const createNoteMutation = useMutation<ScheduleNote, Error, Partial<ScheduleNote>>({
    mutationFn: (data: Partial<ScheduleNote>) => db.ScheduleNote.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduleNotes'] }),
  });

  const updateNoteMutation = useMutation<ScheduleNote, Error, { id: string; data: Partial<ScheduleNote> }>({
    mutationFn: ({ id, data }: { id: string; data: Partial<ScheduleNote> }) => db.ScheduleNote.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduleNotes'] }),
  });

  const deleteNoteMutation = useMutation<ScheduleNote, Error, string>({
    mutationFn: (id: string) => db.ScheduleNote.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduleNotes'] }),
  });

  // ScheduleBlock mutations (type='block')
  const createBlockMutation = useMutation<ScheduleBlock, Error, Partial<ScheduleBlock>>({
    mutationFn: (data: Partial<ScheduleBlock>) => db.ScheduleBlock.create({ ...data, type: 'block' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduleBlocks'] });
      toast.success('Zelle gesperrt');
    },
  });

  const deleteBlockMutation = useMutation<ScheduleBlock, Error, string>({
    mutationFn: (id: string) => db.ScheduleBlock.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduleBlocks'] });
      toast.success('Sperrung aufgehoben');
    },
  });

  // ScheduleBlock mutations (type='info')
  const createInfoMutation = useMutation<ScheduleBlock, Error, Partial<ScheduleBlock>>({
    mutationFn: (data: Partial<ScheduleBlock>) => db.ScheduleBlock.create({ ...data, type: 'info' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduleBlocks'] });
      toast.success('Info hinterlegt');
    },
  });

  const deleteInfoMutation = useMutation<ScheduleBlock, Error, string>({
    mutationFn: (id: string) => db.ScheduleBlock.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduleBlocks'] });
      toast.success('Info entfernt');
    },
  });

  return {
    updateDoctorMutation,
    updateSystemSettingMutation,
    createShiftMutation,
    bulkCreateShiftsMutation,
    updateShiftMutation,
    createAutoFreiMutation,
    updateAutoFreiMutation,
    deleteShiftMutation,
    bulkDeleteMutation,
    createNoteMutation,
    updateNoteMutation,
    deleteNoteMutation,
    createBlockMutation,
    deleteBlockMutation,
    createInfoMutation,
    deleteInfoMutation,
  };
}
