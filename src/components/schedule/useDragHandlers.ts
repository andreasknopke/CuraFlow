/* eslint-disable @typescript-eslint/no-explicit-any -- Extraction-only step: the
   body is moved verbatim from ScheduleBoard.tsx and preserves the original `any`
   propagation. Typing happens in a follow-up commit (plan step 6). */
import { format, addDays, startOfWeek } from 'date-fns';
import { toast } from 'sonner';
import type { DropResult } from '@hello-pangea/dnd';
import { db, api } from '@/api/client';
import type { Doctor, ShiftEntry, Workplace, SystemSetting } from '@/types';
import {
  stripPanelPrefix,
  normalizeDraggableId,
  parseAvailableDoctorId,
  normalizeTimeslotSelection,
  applyTimeslotSelectionToCreateData,
  applyTimeslotSelectionToUpdateData,
} from './scheduleBoardHelpers';
import { getWorkplaceCategoriesFromSettings, workplaceAllowsMultiple } from '@/utils/workplaceCategoryUtils';

// Re-using the mutations result type via structural typing. We import the
// hook's return type indirectly by typing the deps below.
import type { useScheduleMutations as UseScheduleMutations } from './useScheduleMutations';
type Mutations = ReturnType<typeof UseScheduleMutations>;

export interface DragHandlersDeps {
  // State values read
  isReadOnly: boolean;
  user: any;
  isDraggingFromGrid: boolean;
  isCtrlPressed: boolean;
  previewShifts: ShiftEntry[] | null;
  currentDate: Date;

  // State setters
  setIsDraggingFromGrid: (value: boolean) => void;
  setDraggingDoctorId: (value: string | null) => void;
  setDraggingShiftId: (value: string | null) => void;
  setHiddenSpringerChipIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setHiddenJokerDoctorIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setPreviewShifts: React.Dispatch<React.SetStateAction<ShiftEntry[] | null>>;
  setPreviewCategories: React.Dispatch<React.SetStateAction<string[] | null>>;
  setUndoStack: React.Dispatch<React.SetStateAction<any[]>>;
  setTimeslotSelectionDialog: React.Dispatch<React.SetStateAction<any>>;

  // Query data / computed values
  doctors: Doctor[];
  allShifts: any;
  workplaces: Workplace[];
  systemSettings: SystemSetting[];
  fetchRange: { start: string; end: string };
  currentWeekShifts: any;
  sidebarDoctors: Doctor[];
  doctorById: Map<any, Doctor>;
  workplaceByName: Map<any, Workplace>;
  springerDoctorById: Map<any, any>;
  allDisplayDocsByDate: Map<any, any>;
  workplaceTimeslotsByWorkplaceId: Map<any, any>;
  rotationWorkplaces: any[];
  rotationAssignments: any[];
  queryClient: import('@tanstack/react-query').QueryClient;

  // Component-level functions
  lockCell: (date: string, position: string, timeslotId?: string) => boolean;
  getScheduleBlock: (dateStr: string, position: string, timeslotId?: string) => any;
  checkStaffing: (dateStr: string, doctorId: string) => string | null;
  checkLimits: (doctorId: string, dateStr: string, position: string) => string | null;
  checkAbsenceDropConflicts: (doctorId: string, dateStr: string, position: string, onProceed: () => void, excludeShiftId?: string | null) => boolean;
  checkConflictsWithOverride: (doctorId: string, dateStr: string, newPosition: string, excludeShiftId?: string | null, onProceed?: (() => void) | null) => Promise<boolean>;
  resolveTimeslotSelection: (config: any) => any;
  deleteShiftWithCleanup: (shift: ShiftEntry) => void;
  cleanupAutoFreiOnly: (doctorId: any, dateStr: any, position: any) => any;
  shouldCreateAutoFrei: (position: string, dateStr: string, isPublicHoliday: any) => string | null;
  isAutoOffPosition: (position: string) => boolean;
  validate: (doctorId: string, dateStr: string, position: string, options: Record<string, unknown>) => any;
  addPreviewAutoFrei: (doctorId: string, dateStr: string, positionName: string, currentPreviews: ShiftEntry[]) => ShiftEntry[];
  removePreviewAutoFrei: (doctorId: string, dateStr: string, positionName: string, currentPreviews: ShiftEntry[]) => ShiftEntry[];
  requestOverride: (params: any) => Promise<any>;
  isPublicHoliday: (date: Date) => any;

  // Mutations
  mutations: Mutations;

  // Refs
  pendingTimeslotSelectionRef: React.MutableRefObject<any>;
}

export function useDragHandlers(deps: DragHandlersDeps) {
  const {
    isReadOnly,
    user,
    isDraggingFromGrid,
    isCtrlPressed,
    previewShifts,
    currentDate,
    setIsDraggingFromGrid,
    setDraggingDoctorId,
    setDraggingShiftId,
    setHiddenSpringerChipIds,
    setHiddenJokerDoctorIds,
    setPreviewShifts,
    setPreviewCategories,
    setUndoStack,
    setTimeslotSelectionDialog,
    doctors,
    allShifts,
    workplaces,
    systemSettings,
    fetchRange,
    currentWeekShifts,
    sidebarDoctors,
    doctorById,
    workplaceByName,
    springerDoctorById,
    allDisplayDocsByDate,
    workplaceTimeslotsByWorkplaceId,
    rotationWorkplaces,
    rotationAssignments,
    queryClient,
    lockCell,
    getScheduleBlock,
    checkStaffing,
    checkLimits,
    checkAbsenceDropConflicts,
    checkConflictsWithOverride,
    resolveTimeslotSelection,
    deleteShiftWithCleanup,
    cleanupAutoFreiOnly,
    shouldCreateAutoFrei,
    isAutoOffPosition,
    validate,
    addPreviewAutoFrei,
    removePreviewAutoFrei,
    requestOverride,
    isPublicHoliday,
    pendingTimeslotSelectionRef,
  } = deps;

  const mutations = deps.mutations;
  const createShiftMutation = mutations.createShiftMutation;
  const updateShiftMutation = mutations.updateShiftMutation;
  const deleteShiftMutation = mutations.deleteShiftMutation;
  const bulkDeleteMutation = mutations.bulkDeleteMutation;
  const bulkCreateShiftsMutation = mutations.bulkCreateShiftsMutation;
  const createAutoFreiMutation = mutations.createAutoFreiMutation;
  const updateAutoFreiMutation = mutations.updateAutoFreiMutation;
  const updateDoctorMutation = mutations.updateDoctorMutation;

  const handleDragEnd = async (result: DropResult): Promise<void> => {
    setIsDraggingFromGrid(false);
    console.log('DEBUG: Drag Operation Ended', { 
        draggableId: result.draggableId,
        source: result.source,
        destination: result.destination,
        reason: result.reason 
    });
    
    setDraggingDoctorId(null);
    setDraggingShiftId(null);
    const { source, destination, draggableId } = result;

    // Permission guard: admin without can_edit_schedule cannot modify Dienste positions
    if (!isReadOnly && user?.role === 'admin') {
      const perms = user.permissions;
      const canEditSchedule = !perms || typeof perms !== 'object' || perms.can_edit_schedule !== false;
      if (!canEditSchedule) {
        // Only block if the target/modified position is a "Dienste" workplace
        const destPos = destination ? stripPanelPrefix(destination.droppableId).split('__')[1] : null;
        const srcPos = source.droppableId !== 'sidebar' && source.droppableId !== 'available__' && !source.droppableId.startsWith('available__')
          ? stripPanelPrefix(source.droppableId).split('__')[1] : null;
        const checkPos = destPos || srcPos;
        const isDienste = checkPos && workplaces.some((w: any) => w.name === checkPos && w.category === 'Dienste');
        if (isDienste) {
          console.warn('[Permissions] Admin ohne can_edit_schedule, Dienste-Drag blockiert:', user.email, 'position:', checkPos);
          alert('Ihre Berechtigung "Dienstplan bearbeiten" ist deaktiviert. Bitte wenden Sie sich an einen Super-Admin.');
          return;
        }
      }
    }

    const normalizedDraggableId = normalizeDraggableId(draggableId);
    const sourceDroppableId = stripPanelPrefix(source.droppableId);
    const destinationDroppableId = destination ? stripPanelPrefix(destination.droppableId) : null;

    // ============================================================
    //  SPRINGER HIDE-ON-TRASH (Ward-Tenant Rotation Network)
    //  A Springer chip dragged to the trash / sidebar is merely hidden
    //  from the Verfügbar row. The rotation assignment is NOT deleted.
    //  Grid-drops on station workplaces are handled by the regular
    //  available-doc handler below (same draggableId format).
    // ============================================================
    if ((destinationDroppableId! === 'trash' || destinationDroppableId! === 'trash-overlay' || destinationDroppableId! === 'sidebar') && sourceDroppableId.startsWith('available__')) {
        const hideDateStr = sourceDroppableId.replace('available__', '');
        const hideDoc = (allDisplayDocsByDate.get(hideDateStr) || [])[source.index];
        if (hideDoc?._isSpringer) {
            setHiddenSpringerChipIds((prev) => new Set([...prev, hideDoc._assignmentId]));
            toast.success('Springer aus Verfügbar entfernt');
            return;
        }
    }

    // ============================================================
    //  ROTATION ASSIGNMENT DRAG-OUT (Pool-Rotationen)
    //  Detect rotation-assignment-* dragged to trash or available.
    // ============================================================
    if (normalizedDraggableId.startsWith('rotation-assignment-')) {
        const assignmentId = normalizedDraggableId.replace('rotation-assignment-', '');
        const assignment = rotationAssignments.find((a: any) => String(a.id) === String(assignmentId));
        if (!assignment) return;

        // Dropped outside or to Verfügbar/sidebar/trash → delete
        if (!destination || destinationDroppableId! === 'sidebar' || destinationDroppableId!.startsWith('available__') || destinationDroppableId!.endsWith('__Verfügbar') || destinationDroppableId! === 'trash' || destinationDroppableId! === 'trash-overlay') {
            try {
                await api.deleteRotationAssignment(String(assignment.group_id), assignmentId);
                queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
                queryClient.invalidateQueries({ queryKey: ['rotations', 'demands'] });
                toast.success('Einteilung entfernt');
            } catch (err) {
                toast.error('Fehler beim Entfernen: ' + (err instanceof Error ? err.message : ''));
            }
        }
        return;
    }

    // ============================================================
    //  ROTATION CELL DROP (Pool-Rotationen)
    //  Timeslot-Auswahl wie bei normalen Rotationen.
    //  Für Ward-Tenants: Springer-Chip → Rückgabe an den Pool anfordern.
    // ============================================================
    if (destinationDroppableId && (destinationDroppableId.startsWith('rotationCell__') || destinationDroppableId.startsWith('rotationCellTslot__'))) {
        const isTimeslotCell = destinationDroppableId.startsWith('rotationCellTslot__');
        const parts = destinationDroppableId.split('__');
        const wpId = isTimeslotCell ? parts[1] : parts[1];
        const destDate = isTimeslotCell ? parts[2] : parts[2];
        const tsId = isTimeslotCell ? parts[3] : null;
        if (!wpId || !destDate) return;

        // Resolve doctor from sidebar, available, or shift drag
        let doctorId = null;
        if (normalizedDraggableId.startsWith('sidebar-doc-')) {
            doctorId = normalizedDraggableId.replace('sidebar-doc-', '');
        } else if (normalizedDraggableId.startsWith('available-doc-')) {
            doctorId = parseAvailableDoctorId(normalizedDraggableId);
        } else if (normalizedDraggableId.startsWith('shift-')) {
            const shift = currentWeekShifts.find((s: any) => s.id === normalizedDraggableId.replace('shift-', ''));
            if (shift) doctorId = shift.doctor_id;
        }

        if (!doctorId) return;

        // Find the rotation workplace
        const wp = rotationWorkplaces.find((w: any) => String(w.id) === String(wpId));
        if (!wp) return;

        // ────────────────────────────────────────────────────────────
        //  WARD-TENANT: Springer zurück an den Pool anfordern
        //  Im Ward-Tenant (wp.canWrite === false) gibt es keine
        //  createRotationAssignment-Berechtigung. Statt dessen kann
        //  ein Springer-Chip aus der Verfügbar-Reihe auf die
        //  Pool-Tageszelle gezogen werden, um eine Rückgabe-Anfrage
        //  (Demand mit return_requested_assignment_id) zu stellen.
        // ────────────────────────────────────────────────────────────
        if (wp.canWrite === false && normalizedDraggableId.startsWith('available-doc-')) {
            const springerDoc = (allDisplayDocsByDate.get(sourceDroppableId.replace('available__', '')) || [])
                .find((d: any) => d._isSpringer && d.id === doctorId);
            if (springerDoc?._assignmentId) {
                const assignmentId = springerDoc._assignmentId;
                const confirmed = window.confirm('Wollen Sie den Springer an den Pool zurückgeben?');
                if (!confirmed) return;
                // Optimistically hide the chip so the user can't re-trigger
                // the request while the network round-trip is in flight (which
                // would otherwise produce a 409 "already requested").
                setHiddenSpringerChipIds((prev) => new Set([...prev, assignmentId]));
                api.createRotationDemand({
                    rotation_workplace_id: wp.id,
                    date: destDate,
                    timeslot_id: tsId || null,
                    return_requested_assignment_id: assignmentId,
                    note: 'Rückgabe an den Pool angefordert',
                }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ['rotations', 'demands'] });
                    queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
                    toast.success('Rückgabe angefordert — Pool wurde benachrichtigt.');
                }).catch((err) => {
                    // On error: re-show the chip so the user can retry.
                    setHiddenSpringerChipIds((prev) => {
                        const next = new Set(prev);
                        next.delete(assignmentId);
                        return next;
                    });
                    const msg = err?.status === 409
                        ? 'Für diesen Springer wurde bereits eine Rückgabe angefordert.'
                        : 'Fehler beim Anfordern der Rückgabe: ' + (err?.message || '');
                    toast.error(msg);
                });
                return;
            }
        }

        // ────────────────────────────────────────────────────────────
        //  WARD-TENANT: Joker an den Pool übergeben
        //  Ein regulärer Mitarbeiter (kein Springer) wird aus der
        //  Verfügbar-Leiste auf eine Pool-Timeslot-Zelle gezogen,
        //  um ihn dem Springerpool als "Joker" anzubieten.
        // ────────────────────────────────────────────────────────────
        if (wp.canWrite === false && normalizedDraggableId.startsWith('available-doc-')) {
            // Only regular doctors (not Springer chips) can be offered as Joker
            const isSpringer = (allDisplayDocsByDate.get(sourceDroppableId.replace('available__', '')) || [])
                .some((d: any) => d._isSpringer && d.id === doctorId);
            if (!isSpringer) {
                const doctor = doctorById.get(doctorId);
                const doctorName = doctor?.name || doctorId;
                const centralEmployeeId = doctor?.central_employee_id;
                if (!centralEmployeeId) {
                    toast.error('Dieser Mitarbeiter hat keine zentrale Verknüpfung und kann nicht an den Pool übergeben werden.');
                    return;
                }
                const confirmed = window.confirm(
                    `Wollen Sie ${doctorName} an den Springerpool übergeben?`
                );
                if (!confirmed) return;
                // Hide the doctor chip from Verfügbar for this date so the
                // ward can't accidentally re-offer the same person.
                const sourceDateKey = sourceDroppableId.replace('available__', '');
                const hideKey = `${doctorId}|${sourceDateKey}`;
                setHiddenJokerDoctorIds((prev) => new Set([...prev, hideKey]));
                api.createRotationDemand({
                    rotation_workplace_id: wp.id,
                    date: destDate,
                    timeslot_id: tsId || null,
                    offered_employee_id: centralEmployeeId,
                    note: `Übergabe von ${doctorName} an den Pool gewünscht`,
                }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ['rotations', 'demands'] });
                    queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
                    toast.success(`${doctorName} wurde dem Pool angeboten.`);
                }).catch((err) => {
                    // Re-show the chip so the user can retry
                    setHiddenJokerDoctorIds((prev) => {
                        const next = new Set(prev);
                        next.delete(hideKey);
                        return next;
                    });
                    const msg = err?.status === 409
                        ? 'Für diesen Mitarbeiter existiert bereits ein Angebot in dieser Zelle.'
                        : 'Fehler bei der Joker-Übergabe: ' + (err?.message || '');
                    toast.error(msg);
                });
                return;
            }
        }

        const hasTimeslots = Boolean(wp.timeslots_enabled) && (wp.timeslots?.length ?? 0) > 0;

        // Build callback for timeslot selection (or direct creation)
        const doCreate = (timeslotId: string | null) => {
            api.createRotationAssignment(String(wp.group_id), {
                rotation_workplace_id: wp.id,
                date: destDate,
                employee_id: doctorId,
                timeslot_id: timeslotId || null,
            }).then(() => {
                queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
                queryClient.invalidateQueries({ queryKey: ['rotations', 'demands'] });
                toast.success('Springer eingeteilt');
            }).catch((err) => {
                toast.error('Fehler: ' + (err?.message || ''));
            });
        };

        // Drop on a specific timeslot cell → no dialog, create directly
        if (isTimeslotCell) {
            doCreate(tsId);
            return;
        }

        if (hasTimeslots) {
            const options = (wp.timeslots ?? []).map((ts: any) => ({
                id: ts.id,
                label: ts.label,
                start_time: ts.start_time,
                end_time: ts.end_time,
                canCustomize: false,
            }));
            pendingTimeslotSelectionRef.current = doCreate;
            (setTimeslotSelectionDialog as any)({
                open: true,
                workplaceName: wp.name,
                description: `${wp.name} am ${format(new Date(destDate + 'T00:00:00'), 'dd.MM.yyyy')} hat mehrere Zeitfenster.`,
                options,
                allowCustomEditing: false,
                customEndMinutesByOptionId: {},
            });
        } else {
            doCreate(null);
        }
        return;
    }

    // ============================================================
    //  PREVIEW SHIFT DRAG HANDLING
    //  Preview shifts are modified in-memory (no DB operations)
    // ============================================================
    if (normalizedDraggableId.startsWith('shift-preview-')) {
        const shiftId = normalizedDraggableId.replace('shift-', '');
        const previewShift = previewShifts?.find((s: any) => s.id === shiftId);
        if (!previewShift || !previewShifts) return;

        // Dropped outside or to trash/sidebar → remove from preview
        if (!destination || destinationDroppableId! === 'sidebar' || destinationDroppableId! === 'trash' || destinationDroppableId! === 'trash-overlay' || destinationDroppableId!.startsWith('available__') || destinationDroppableId!.endsWith('__Verfügbar')) {
            let remaining = previewShifts.filter((s) => s.id !== shiftId);
            // Auto-Frei cleanup: if removed shift was on an auto-off position, remove its auto-frei too
            if (isAutoOffPosition(previewShift.position)) {
                remaining = removePreviewAutoFrei(previewShift.doctor_id!, previewShift.date, previewShift.position, remaining);
            }
            if (remaining.length === 0) {
                setPreviewShifts(null);
                setPreviewCategories(null);
            } else {
                setPreviewShifts(remaining);
            }
            toast.info('Vorschlag entfernt');
            return;
        }

        // Dropped on row header → assign Mo-Fr (skip for preview)
        if (destinationDroppableId!.startsWith('rowHeader__')) {
            return;
        }

        // Dropped to same position → no change
        if (sourceDroppableId === destinationDroppableId && source.index === destination.index) return;

        // Dropped to a grid cell → move preview entry
        const destParts = destinationDroppableId!.split('__');
        const newDateStr = destParts[0];
        const newPosition = destParts[1];
        const rawNewTimeslotId = destParts[2] || null;
        if (!newDateStr || !newPosition) return;

        const executePreviewMove = (selection: any) => {
            const normalizedSelection = normalizeTimeslotSelection(selection);
            const resolvedPreviewTimeslotId = normalizedSelection.timeslotId;
            const absencePositions = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];
            if (!absencePositions.includes(newPosition)) {
                const wp = workplaces.find((w: any) => w.name === newPosition);
                if (wp) {
                    const activeDays = (wp.active_days && wp.active_days.length > 0) ? wp.active_days : [1, 2, 3, 4, 5];
                    const date = new Date(newDateStr + 'T00:00:00');
                    const dayOfWeek = date.getDay();
                    const isActive = isPublicHoliday(date)
                        ? activeDays.some((d: any) => Number(d) === 0)
                        : activeDays.some((d: any) => Number(d) === dayOfWeek);
                    if (!isActive) {
                        toast.error('Diese Position ist an diesem Tag nicht aktiv.');
                        return;
                    }
                }
            }

            const previewBlock = getScheduleBlock(newDateStr, newPosition, resolvedPreviewTimeslotId ?? undefined);
            if (previewBlock) {
                toast.error('Zelle gesperrt' + (previewBlock.reason ? `: ${previewBlock.reason}` : ''));
                return;
            }

            const allMerged = [...(currentWeekShifts || [])];
            const duplicate = allMerged.find((s: any) => 
                s.id !== shiftId &&
                s.date === newDateStr && 
                s.position === newPosition && 
                s.doctor_id === previewShift.doctor_id &&
                (resolvedPreviewTimeslotId ? s.timeslot_id === resolvedPreviewTimeslotId : !s.timeslot_id)
            );
            if (duplicate) {
                toast.error('Arzt ist dort bereits eingeteilt.');
                return;
            }

            let updated = previewShifts.map((s: any) => {
                if (s.id !== shiftId) return s;
                const nextShift = applyTimeslotSelectionToUpdateData(
                    { ...s, date: newDateStr, position: newPosition },
                    normalizedSelection
                );
                if (resolvedPreviewTimeslotId) {
                    nextShift.timeslot_id = resolvedPreviewTimeslotId;
                } else {
                    delete nextShift.timeslot_id;
                }
                return nextShift;
            });

            if (isAutoOffPosition(previewShift.position)) {
                updated = removePreviewAutoFrei(previewShift.doctor_id!, previewShift.date, previewShift.position, updated);
            }
            if (isAutoOffPosition(newPosition)) {
                updated = addPreviewAutoFrei(previewShift.doctor_id!, newDateStr, newPosition, updated);
            }

            setPreviewShifts(updated);
        };

        if (!resolveTimeslotSelection({
            positionName: newPosition,
            dateStr: newDateStr,
            requestedTimeslotId: rawNewTimeslotId,
            onResolved: executePreviewMove,
            doctorId: previewShift.doctor_id,
        })) {
            return;
        }
        return;
    }

    // Dropped outside any droppable (e.g. locked/blocked cell, or empty area).
    // The chip should snap back to its original position — never delete it.
    // Users can remove a shift by dragging it to the sidebar/available area,
    // which is handled separately.
    if (!destination) {
        return;
    }

      const absencePositions = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];

      // Helper: Check if workplace is active on a given date (active_days + holiday check)
      // Feiertage verhalten sich wie Sonntag (Index 0)
      // Default active_days (wenn nicht gesetzt): Mo-Fr [1,2,3,4,5]
      const isWorkplaceActiveOnDate = (positionName: any, dateStr: any) => {
          const wp = workplaces.find((w: any) => w.name === positionName);
          if (!wp) return true;
          const activeDays = (wp.active_days && wp.active_days.length > 0) ? wp.active_days : [1, 2, 3, 4, 5];
          const date = new Date(dateStr + 'T00:00:00');
          const dayOfWeek = date.getDay(); // 0=So, 1=Mo, ..., 6=Sa
          // Feiertag = wie Sonntag behandeln: An Feiertagen zählt nur, ob Sonntag (0) aktiv ist
          if (isPublicHoliday(date)) {
              return activeDays.some((d: any) => Number(d) === 0);
          }
          return activeDays.some((d: any) => Number(d) === dayOfWeek);
      };

      // Helper to find occupying shift for services or demos (for replacement)
      const findOccupyingShift = (dateStr: any, position: any, ignoreShiftId: any = null, timeslotId: any = null) => {
          const targetWorkplace = workplaces.find((w: any) => w.name === position);
          if (!targetWorkplace) return null;

          // Prüfe allows_multiple direkt am Workplace (mit Kategorie-Fallback)
          const customCategories = getWorkplaceCategoriesFromSettings(systemSettings);
          const allowsMultiple = workplaceAllowsMultiple(targetWorkplace, customCategories);

          if (allowsMultiple) return null;

          return currentWeekShifts.find((shift: any) => {
               if (shift.date !== dateStr || shift.position !== position || shift.id === ignoreShiftId) {
                   return false;
               }

               if (targetWorkplace.timeslots_enabled) {
                   if (timeslotId) return shift.timeslot_id === timeslotId;
                   return !shift.timeslot_id;
               }

               return true;
          });
      };

      // Helper to cleanup other shifts when becoming absent
      const cleanupOtherShifts = (doctorId: any, dateStr: any, currentShiftId: any = null) => {
        const shiftsToDelete = currentWeekShifts.filter((s: any) => 
            s.doctor_id === doctorId && 
            s.date === dateStr && 
            s.id !== currentShiftId
        );
        shiftsToDelete.forEach((s: any) => { deleteShiftMutation.mutate(s.id); });
    };

    // Helper to handle automatic "Frei" after "Dienst Vordergrund" or other auto-off shifts
    const handlePostShiftOff = (doctorId: string, dateStr: string, positionName: string): void => {
        // Zentrale Logik: Prüft ob Auto-Frei erstellt werden soll (inkl. Feiertag-Check, ohne Wochenend-Block)
        const autoFreiDateStr = shouldCreateAutoFrei(positionName, dateStr, isPublicHoliday as any);
        
        if (!autoFreiDateStr) return;

        const nextDay = new Date(autoFreiDateStr);

        // Staffing Check for the auto-off day
        const warning = checkStaffing(autoFreiDateStr, doctorId);
        if (warning) {
            alert(`${warning}\n\n(Durch automatischen Freizeitausgleich am ${format(nextDay, 'dd.MM.')})`);
        }

        const existingShift = allShifts.find((s: any) => s.date === autoFreiDateStr && s.doctor_id === doctorId);

        if (!existingShift) {
            createAutoFreiMutation.mutate({ 
                date: autoFreiDateStr, 
                position: 'Frei', 
                doctor_id: doctorId,
                note: 'Autom. Freizeitausgleich'
            });
        } else if (existingShift.position !== 'Frei') {
             if (window.confirm(`Für den Folgetag (${format(nextDay, 'dd.MM.')}) existiert bereits ein Eintrag "${existingShift.position}". Soll dieser durch "Frei" ersetzt werden?`)) {
                 updateAutoFreiMutation.mutate({
                     id: existingShift.id,
                     data: { position: 'Frei', note: 'Autom. Freizeitausgleich' }
                 });
             }
        }
    };

    // Handle Drop on Row Header (Assign Mo-Fr)
    if (destinationDroppableId!.startsWith('rowHeader__')) {
        // Format: rowHeader__position oder rowHeader__position__timeslotId
        const headerParts = destinationDroppableId!.replace('rowHeader__', '').split('__');
        const rowName = headerParts[0];
        const rawHeaderTimeslotId = headerParts[1] || null;
        const rowHeaderTimeslotId = rawHeaderTimeslotId;

        // Springer chips cannot be assigned Mo-Fr — they apply to one day only
        if (sourceDroppableId.startsWith('available__')) {
            const springerSourceDate = sourceDroppableId.replace('available__', '');
            const springerDoc = (allDisplayDocsByDate.get(springerSourceDate) || [])[source.index];
            if (springerDoc?._isSpringer) {
                toast.error('Springer kann nicht für die ganze Woche eingeteilt werden');
                return;
            }
        }

        let doctorId = null;

           if (sourceDroppableId === 'sidebar') {
               doctorId = normalizedDraggableId.replace('sidebar-doc-', '');
           } else if (normalizedDraggableId.startsWith('shift-')) {
               const shift = currentWeekShifts.find((s: any) => s.id === normalizedDraggableId.replace('shift-', ''));
             doctorId = shift?.doctor_id;
           } else if (normalizedDraggableId.startsWith('available-doc-')) {
               doctorId = parseAvailableDoctorId(normalizedDraggableId);
        }

        if (!doctorId) return;

        const assignWeekdaysToTimeslot = async (selection: any) => {
            const normalizedSelection = normalizeTimeslotSelection(selection);
            const resolvedTimeslotId = normalizedSelection.timeslotId;
            const monday = startOfWeek(currentDate, { weekStartsOn: 1 });
            const allWeekDays = [0, 1, 2, 3, 4, 5, 6].map((offset: any) => addDays(monday, offset));
            const daysToAssign = allWeekDays.filter((day: any) => isWorkplaceActiveOnDate(rowName, format(day, 'yyyy-MM-dd')));

            // ── Phase 1: Pre-validate ALL days, collect blockers/warnings ──
            const scheduleBlockedDays: string[] = [];
            const validatedDays: { dateStr: string; day: Date; blockers: string[]; warnings: string[] }[] = [];
            let allBlockers: string[] = [];
            const allWarnings: string[] = [];

            for (const day of daysToAssign) {
                const dateStr = format(day, 'yyyy-MM-dd');

                if (getScheduleBlock(dateStr, rowName, resolvedTimeslotId ?? undefined)) {
                    scheduleBlockedDays.push(dateStr);
                    continue;
                }

                const result = validate(doctorId, dateStr, rowName, {});
                if (result.blockers.length > 0 || result.warnings.length > 0) {
                    validatedDays.push({ dateStr, day, blockers: result.blockers, warnings: result.warnings });
                    allBlockers = [...allBlockers, ...result.blockers.map((b: string) => `${format(day, 'dd.MM.')}: ${b}`)];
                    allWarnings.push(...result.warnings.map((w: string) => `${format(day, 'dd.MM.')}: ${w}`));
                } else {
                    // No issues → can proceed directly, still track for batch create
                    validatedDays.push({ dateStr, day, blockers: [], warnings: [] });
                }
            }

            const effectiveDateStrs = validatedDays.map((d) => d.dateStr);

            // ── Phase 2: If blockers, show ONE override dialog ──
            if (allBlockers.length > 0) {
                const doctor = doctors.find((d) => d.id === doctorId);
                return new Promise<void>((resolve) => {
                    requestOverride({
                        blockers: allBlockers,
                        warnings: allWarnings,
                        doctorId,
                        doctorName: doctor?.name,
                        date: format(monday, 'yyyy-MM-dd'),
                        position: `${rowName} (Mo–Fr Batch)`,
                        onConfirm: () => {
                            void batchCreateShifts(
                                effectiveDateStrs,
                                normalizedSelection,
                                resolvedTimeslotId,
                                scheduleBlockedDays.length,
                            ).then(() => { resolve(); });
                        },
                    });
                });
            }

            // ── Phase 3: Warnings only or no issues → warn as toasts, then create ──
            if (allWarnings.length > 0) {
                toast.warning(allWarnings.join('\n'));
            }

            if (effectiveDateStrs.length === 0) {
                toast.error('Keine Tage zum Zuweisen (alle gesperrt oder inaktiv).');
                return;
            }

            await batchCreateShifts(
                effectiveDateStrs,
                normalizedSelection,
                resolvedTimeslotId,
                scheduleBlockedDays.length,
            );
        };

        const batchCreateShifts = async (
            dateStrs: string[],
            normalizedSelection: any,
            resolvedTimeslotId: string | null,
            scheduleBlockedCount: number,
        ) => {
            const toCreate: any[] = [];
            const toDelete: any[] = [];
            let successCount = 0;
            let skippedCount = 0;

            for (const dateStr of dateStrs) {
                const limitWarning = checkLimits(doctorId, dateStr, rowName);
                if (limitWarning) {
                    toast.warning(`Limit Warnung (${dateStr}): ${limitWarning}`);
                }

                if (absencePositions.includes(rowName)) {
                    const staffingWarn = checkStaffing(dateStr, doctorId);
                    if (staffingWarn) toast.warning(staffingWarn);

                    currentWeekShifts
                        .filter((s: any) => s.doctor_id === doctorId && s.date === dateStr)
                        .forEach((s: any) => toDelete.push(s.id));
                } else {
                    const occupying = findOccupyingShift(dateStr, rowName, null, resolvedTimeslotId);
                    if (occupying) {
                        toDelete.push(occupying.id);
                    }
                }

                const effectiveTsId = resolvedTimeslotId === '__unassigned__' ? null : resolvedTimeslotId;
                
                const existingShift = currentWeekShifts.find((s: any) => {
                    if (s.date !== dateStr || s.position !== rowName || s.doctor_id !== doctorId) return false;
                    if (effectiveTsId) return s.timeslot_id === effectiveTsId;
                    return !s.timeslot_id;
                });
                if (existingShift) {
                    skippedCount++;
                    continue;
                }

                const cellShifts = currentWeekShifts.filter((s: any) => {
                    if (s.date !== dateStr || s.position !== rowName) return false;
                    if (effectiveTsId) return s.timeslot_id === effectiveTsId;
                    return !s.timeslot_id;
                });
                const pendingInCell = toCreate.filter((s: any) =>
                    s.date === dateStr && s.position === rowName && s.timeslot_id === effectiveTsId,
                );

                const maxOrder = Math.max(
                    cellShifts.reduce((max: any, s: any) => Math.max(max, s.order || 0), -1),
                    pendingInCell.reduce((max: any, s: any) => Math.max(max, s.order || 0), -1),
                );

                toCreate.push(applyTimeslotSelectionToCreateData(
                    { date: dateStr, position: rowName, doctor_id: doctorId, order: maxOrder + 1 },
                    { ...normalizedSelection, timeslotId: effectiveTsId },
                ));
                successCount++;
            }

            if (toDelete.length > 0) {
                await bulkDeleteMutation.mutateAsync(toDelete);
            }
            if (toCreate.length > 0) {
                const created = await db.ShiftEntry.bulkCreate(toCreate);
                if (created && Array.isArray(created)) {
                    setUndoStack((prev) => [...prev, { type: 'BULK_DELETE', ids: created.map((c: any) => c.id) }]);
                }
                setTimeout(() => queryClient.invalidateQueries({ queryKey: ['shifts', fetchRange.start, fetchRange.end] }), 100);
            }

            if (successCount > 0) toast.success(`${successCount} Tage zugewiesen (Mo–Fr)`);
            const skippedReasons: string[] = [];
            if (skippedCount > 0) skippedReasons.push(`${skippedCount} bereits vorhanden`);
            if (scheduleBlockedCount > 0) skippedReasons.push(`${scheduleBlockedCount} gesperrt`);
            if (skippedReasons.length > 0) toast.warning(`${skippedReasons.join(', ')} übersprungen`);
        };

        const onRowHeaderResolved = (selection: any) => {
            void assignWeekdaysToTimeslot(selection).catch((err) => {
                console.error('[RowHeader Drop] assignWeekdaysToTimeslot failed', err);
                toast.error('Fehler beim Zuweisen der Wochentage');
            });
        };

        resolveTimeslotSelection({
            positionName: rowName,
            requestedTimeslotId: rowHeaderTimeslotId,
            onResolved: onRowHeaderResolved,
            doctorId,
        });
        return;
    }

    // 1. Reordering in Sidebar
    if (sourceDroppableId === 'sidebar' && destinationDroppableId! === 'sidebar') {
        if (source.index === destination.index) return;

        const newDoctors = Array.from(sidebarDoctors);
        const [movedDoctor] = newDoctors.splice(source.index, 1);
        newDoctors.splice(destination.index, 0, movedDoctor);

        newDoctors.forEach((doc: any, index: any) => {
            if (doc.order !== index) {
                updateDoctorMutation.mutate({ id: doc.id, data: { order: index } });
            }
        });
        return;
    }

    // Dragged from Grid to Available or Sidebar (Delete/Return)
    // Note: Available droppableId format is `available__${dateStr)}
    const isDestAvailable = destinationDroppableId!.startsWith('available__') || destinationDroppableId!.endsWith('__Verfügbar');
    const isSourceFromGrid = sourceDroppableId !== 'sidebar' && !sourceDroppableId.startsWith('available__');

    if (isSourceFromGrid && (isDestAvailable || destinationDroppableId! === 'sidebar')) {
         const shiftId = normalizedDraggableId.replace('shift-', '');

         // Preview shift → remove from preview state (not DB)
         if (shiftId.startsWith('preview-') && previewShifts) {
             const removedShift = previewShifts.find((s) => s.id === shiftId);
             let remaining = previewShifts.filter((s) => s.id !== shiftId);
             // Auto-Frei cleanup: if removed shift was on an auto-off position, remove its auto-frei too
             if (removedShift && isAutoOffPosition(removedShift.position)) {
                 remaining = removePreviewAutoFrei(removedShift.doctor_id!, removedShift.date, removedShift.position, remaining);
             }
             if (remaining.length === 0) {
                 setPreviewShifts(null);
                 setPreviewCategories(null);
             } else {
                 setPreviewShifts(remaining);
             }
             toast.info('Vorschlag entfernt');
             return;
         }

         const shift = currentWeekShifts.find((s: any) => s.id === shiftId);

         console.log(`[DEBUG-LOG] Drop to Trash/Sidebar. ShiftID: ${shiftId}, Found: ${!!shift}`);

         if (shift) {
             // If this is a springer shift, unhide the Verfügbar chip
             const springerDoc = springerDoctorById.get(shift.doctor_id);
	             if (springerDoc?._isSpringer) {
	                 setHiddenSpringerChipIds((prev) => {
	                     const next = new Set(prev);
	                     next.delete(springerDoc._assignmentId);
	                     return next;
	                 });
	             }
	             deleteShiftWithCleanup(shift);
	         } else {
	             console.error(`[DEBUG-LOG] Shift ${shiftId} not found in currentWeekShifts! Available IDs:`, currentWeekShifts.map((s: any) => s.id));
	             // Fallback: Try finding in allShifts directly as safety net
	             const fallbackShift = allShifts.find((s: any) => s.id === shiftId);
	             if (fallbackShift) {
	                 console.log(`[DEBUG-LOG] Found shift in allShifts fallback. Deleting.`);
	                 const fallbackSpringerDoc = springerDoctorById.get(fallbackShift.doctor_id);
	                 if (fallbackSpringerDoc?._isSpringer) {
	                     setHiddenSpringerChipIds((prev) => {
	                         const next = new Set(prev);
	                         next.delete(fallbackSpringerDoc._assignmentId);
	                         return next;
	                     });
                 }
                 deleteShiftWithCleanup(fallbackShift);
             }
         }
         return;
    }

    // 2. Dragged from Sidebar OR Available to Grid (Create)
    if (sourceDroppableId === 'sidebar' || sourceDroppableId.startsWith('available__')) {
        // Ignore dragging to trash, unknown destinations, available lists, or back to sidebar
        if (destinationDroppableId! === 'trash' || destinationDroppableId! === 'trash-overlay' || destinationDroppableId! === 'sidebar' || !destinationDroppableId!.includes('__') || destinationDroppableId!.endsWith('__Verfügbar') || destinationDroppableId!.startsWith('available__')) return;

        let doctorId;
        if (sourceDroppableId === 'sidebar') {
            doctorId = normalizedDraggableId.replace('sidebar-doc-', '');
        } else {
            doctorId = parseAvailableDoctorId(normalizedDraggableId);
        }
        if (!doctorId) return;

        const dropParts = destinationDroppableId!.split('__');
        const dateStr = dropParts[0];
        const position = dropParts[1];
        const rawTimeslotId = dropParts[2] || null;
        if (!dateStr || !position) return;

        // Springer chips are only valid on the day they come from.
        // Also capture the assignment ID so we can hide the chip on success.
        let springerAssignmentId = null;
        if (sourceDroppableId.startsWith('available__')) {
            const springerSourceDate = sourceDroppableId.replace('available__', '');
            const springerDoc = (allDisplayDocsByDate.get(springerSourceDate) || [])[source.index];
            if (springerDoc?._isSpringer) {
                if (springerSourceDate !== dateStr) {
                    toast.error('Springer kann nur am selben Tag eingeteilt werden');
                    return;
                }
                springerAssignmentId = springerDoc._assignmentId;
            }
        }

        // PREVIEW MODE: Add to previewShifts instead of creating DB entry
        if (previewShifts) {
            const executePreviewCreate = (selection: any) => {
                const normalizedSelection = normalizeTimeslotSelection(selection);
                const resolvedPreviewTimeslotId = normalizedSelection.timeslotId;
                const duplicate = currentWeekShifts.find((shift: any) => {
                    if (shift.date !== dateStr || shift.position !== position || shift.doctor_id !== doctorId) return false;
                    if (resolvedPreviewTimeslotId) return shift.timeslot_id === resolvedPreviewTimeslotId;
                    return !shift.timeslot_id;
                });
                if (duplicate) {
                    toast.error('Arzt ist dort bereits eingeteilt.');
                    return;
                }

                const newId = `preview-add-${Date.now()}`;
                const newPreviewShift = {
                    ...applyTimeslotSelectionToCreateData(
                        { id: newId, date: dateStr, position, doctor_id: doctorId },
                        normalizedSelection
                    ),
                    isPreview: true,
                };

                let updatedPreviews: any = [...previewShifts, newPreviewShift];
                if (isAutoOffPosition(position)) {
                    updatedPreviews = addPreviewAutoFrei(doctorId, dateStr, position, updatedPreviews) as any;
                }
                setPreviewShifts(updatedPreviews);
                toast.info('Vorschlag hinzugefügt');
            };

            if (!resolveTimeslotSelection({
                positionName: position,
                dateStr,
                requestedTimeslotId: rawTimeslotId,
                onResolved: executePreviewCreate,
                doctorId,
            })) {
                return;
            }
            return;
        }

        const executeCreateDrop = async (selection: any) => {
            const normalizedSelection = normalizeTimeslotSelection(selection);
            const timeslotId = normalizedSelection.timeslotId;
            console.log('Dropping Doctor:', doctorId, 'to', dateStr, position, 'timeslotId:', timeslotId);

            const dropBlock = getScheduleBlock(dateStr, position, timeslotId ?? undefined);
            if (dropBlock) {
                toast.error('Zelle gesperrt' + (dropBlock.reason ? `: ${dropBlock.reason}` : ''));
                return;
            }

            if (!absencePositions.includes(position) && !isWorkplaceActiveOnDate(position, dateStr)) {
                toast.error('Diese Position ist an diesem Tag nicht aktiv.');
                return;
            }

            if (absencePositions.includes(position)) {
                const executeAbsenceCreation = () => {
                    cleanupOtherShifts(doctorId, dateStr);

                    const existing = currentWeekShifts.find((s: any) => 
                        s.date === dateStr && s.doctor_id === doctorId && s.position === position
                    );
                    if (existing) {
                        console.log('DEBUG: Absence already exists');
                        return;
                    }

                    const existingInCell = currentWeekShifts.filter((s: any) => s.date === dateStr && s.position === position);
                    const maxOrder = existingInCell.reduce((max: any, s: any) => Math.max(max, s.order || 0), -1);
                    const newOrder = maxOrder + 1;

                    createShiftMutation.mutate({ date: dateStr, position, doctor_id: doctorId, order: newOrder });
                };

                const hasConflicts = checkAbsenceDropConflicts(doctorId, dateStr, position, executeAbsenceCreation);
                if (hasConflicts) {
                    console.log('Absence drop conflicts - waiting for override decision');
                    return;
                }

                executeAbsenceCreation();
                return;
            }

            const limitWarning = checkLimits(doctorId, dateStr, position);
            if (limitWarning) alert(limitWarning);

            {
                const effectiveTimeslotId = timeslotId === '__unassigned__' ? null : timeslotId;
                const exists = currentWeekShifts.some((s: any) => {
                    if (s.date !== dateStr || s.position !== position || s.doctor_id !== doctorId) return false;
                    if (effectiveTimeslotId) return s.timeslot_id === effectiveTimeslotId;
                    return !s.timeslot_id;
                });

                if (exists) {
                    console.log('DEBUG: Blocked - Shift already exists for this doctor/date/position/timeslot');
                    alert('Mitarbeiter ist in dieser Position bereits eingeteilt.');
                    return;
                }
            }

            const occupyingShift = findOccupyingShift(dateStr, position, null, timeslotId);

            if (!occupyingShift) {
                const effectiveLockTs = timeslotId === '__unassigned__' ? null : timeslotId;
                if (!lockCell(dateStr, position, effectiveLockTs ?? undefined)) {
                    console.warn('[CellLock] Blocked rapid duplicate drop:', dateStr, position);
                    return;
                }
            }

            const executeShiftCreation = () => {
                if (occupyingShift) {
                    deleteShiftWithCleanup(occupyingShift);
                }

                const shiftsToCreate = [];
                const slotsToProcess = [timeslotId];

                for (const tsId of slotsToProcess) {
                    const effectiveTsId = tsId === '__unassigned__' ? null : tsId;

                    const existsForSlot = currentWeekShifts.some((s: any) => {
                        if (s.date !== dateStr || s.position !== position || s.doctor_id !== doctorId) return false;
                        if (effectiveTsId) return s.timeslot_id === effectiveTsId;
                        return !s.timeslot_id;
                    });
                    if (existsForSlot) {
                        console.log('DEBUG: Skipping - Shift already exists for timeslot:', effectiveTsId);
                        continue;
                    }

                    const existingInCell = currentWeekShifts.filter((s: any) => {
                        if (s.date !== dateStr || s.position !== position) return false;
                        if (effectiveTsId) return s.timeslot_id === effectiveTsId;
                        return !s.timeslot_id;
                    });
                    const maxOrder = existingInCell.reduce((max: any, s: any) => Math.max(max, s.order || 0), -1);
                    const newOrder = maxOrder + 1;

                    const newShiftData = applyTimeslotSelectionToCreateData(
                        { date: dateStr, position, doctor_id: doctorId, order: newOrder },
                        {
                            ...normalizedSelection,
                            timeslotId: effectiveTsId,
                        }
                    );
                    shiftsToCreate.push(newShiftData);
                }

                const autoFreiDateStr = shouldCreateAutoFrei(position, dateStr, isPublicHoliday as any);
                let updateAutoFreiNeeded = false;
                let existingAutoFreiShift = null;

                if (autoFreiDateStr) {
                    const warning = checkStaffing(autoFreiDateStr, doctorId);
                    if (warning) {
                        toast.warning(`${warning}\n(Durch automatischen Freizeitausgleich am ${format(new Date(autoFreiDateStr), 'dd.MM.')})`);
                    }

                    existingAutoFreiShift = allShifts.find((s: any) => s.date === autoFreiDateStr && s.doctor_id === doctorId);

                    if (!existingAutoFreiShift) {
                        shiftsToCreate.push({
                            date: autoFreiDateStr,
                            position: 'Frei',
                            doctor_id: doctorId,
                            note: 'Autom. Freizeitausgleich'
                        });
                    } else if (existingAutoFreiShift.position !== 'Frei') {
                        updateAutoFreiNeeded = true;
                    }
                }

                console.log('DEBUG: Creating shifts (Bulk)', shiftsToCreate);

                if (shiftsToCreate.length > 0) {
                    bulkCreateShiftsMutation.mutate(shiftsToCreate, {
                        onSuccess: () => {
                            console.log('DEBUG: Bulk Create Success');
                            if (springerAssignmentId) {
                                setHiddenSpringerChipIds((prev) => new Set([...prev, springerAssignmentId]));
                            }
                            if (updateAutoFreiNeeded && existingAutoFreiShift) {
                                if (window.confirm(`Für den Folgetag (${format(new Date(autoFreiDateStr!), 'dd.MM.')}) existiert bereits ein Eintrag "${existingAutoFreiShift.position}". Soll dieser durch "Frei" ersetzt werden?`)) {
                                    updateAutoFreiMutation.mutate({
                                        id: existingAutoFreiShift.id,
                                        data: { position: 'Frei', note: 'Autom. Freizeitausgleich' }
                                    });
                                }
                            }
                        },
                        onError: (err: Error) => {
                            console.error('DEBUG: Error creating shifts:', err);
                            toast.error('Fehler beim Erstellen: ' + err.message);
                        }
                    });
                }
            };

            // Springer chips from rotation networks use the central employee ID
            // as doctor_id. The local doctors table doesn't know them, so the
            // "Person nicht gefunden" validator check would block. Skip validation
            // for springer drops — the backend shift_entry table accepts any
            // doctor_id (no FK constraint in the MySQL schema).
            const springerSourceDate = sourceDroppableId.startsWith('available__')
                ? sourceDroppableId.replace('available__', '')
                : '';
            const isSpringerDrop = springerSourceDate
                && ((allDisplayDocsByDate.get(springerSourceDate) || [])[source.index] || {})._isSpringer;

            if (!isSpringerDrop) {
                const hasConflict = await checkConflictsWithOverride(doctorId, dateStr, position, null, executeShiftCreation);
                if (hasConflict) {
                    console.log('Conflict detected - waiting for override decision');
                    return;
                }
            }

            executeShiftCreation();
        };

        if (!resolveTimeslotSelection({
            positionName: position,
            dateStr,
            requestedTimeslotId: rawTimeslotId,
            onResolved: executeCreateDrop,
            doctorId,
        })) {
            return;
        }

        return;
    }

    // Dragged from Grid to Grid
    if (sourceDroppableId !== 'sidebar' && !sourceDroppableId.startsWith('available__') && destinationDroppableId !== 'sidebar' && destinationDroppableId !== 'trash' && destinationDroppableId !== 'trash-overlay' && !destinationDroppableId!.endsWith('__Verfügbar') && !destinationDroppableId!.startsWith('available__')) {
        const shiftId = normalizedDraggableId.replace('shift-', '');
        const movingShift = currentWeekShifts.find((s: any) => s.id === shiftId);
        // Format: date__position oder date__position__timeslotId
        const destParts = destinationDroppableId!.split('__');
        const newDateStr = destParts[0];
        const newPosition = destParts[1];
        const rawNewTimeslotId = destParts[2] || null;
        const executeGridDrop = async (selection: any) => {
            const normalizedSelection = normalizeTimeslotSelection(selection);
            const newTimeslotId = normalizedSelection.timeslotId;
            if (!absencePositions.includes(newPosition) && !isWorkplaceActiveOnDate(newPosition, newDateStr)) {
                toast.error('Diese Position ist an diesem Tag nicht aktiv.');
                return;
            }

            const moveBlock = getScheduleBlock(newDateStr, newPosition, newTimeslotId ?? undefined);
            if (moveBlock) {
                toast.error('Zelle gesperrt' + (moveBlock.reason ? `: ${moveBlock.reason}` : ''));
                return;
            }

            if (sourceDroppableId === destinationDroppableId) {
                if (source.index === destination.index) return;

                const targetWorkplace = workplaceByName.get(newPosition) as any;
                const targetAllTimeslotIds = targetWorkplace?.timeslots_enabled
                    ? ((workplaceTimeslotsByWorkplaceId as any).get(targetWorkplace.id) || []).map((timeslot: any) => timeslot.id)
                    : [];
                const cellShifts = currentWeekShifts
                    .filter((s: any) => {
                        if (s.date !== newDateStr || s.position !== newPosition) return false;
                        if (!newTimeslotId && targetAllTimeslotIds.length > 1) {
                            return targetAllTimeslotIds.includes(s.timeslot_id) || !s.timeslot_id;
                        }
                        if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                        return !s.timeslot_id;
                    })
                    .sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

                const newShifts = Array.from(cellShifts);
                const [movedShift] = newShifts.splice(source.index, 1);
                newShifts.splice(destination.index, 0, movedShift);

                newShifts.forEach((s: any, index: any) => {
                    if (s.order !== index) {
                        updateShiftMutation.mutate({ id: s.id, data: { order: index } });
                    }
                });
                return;
            }

            const shift = currentWeekShifts.find((s: any) => s.id === shiftId);
            if (!shift) return;

            if (isCtrlPressed && sourceDroppableId !== destinationDroppableId) {
                const alreadyInTarget = currentWeekShifts.some((s: any) => {
                    if (s.date !== newDateStr || s.position !== newPosition || s.doctor_id !== shift.doctor_id) return false;
                    if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                    return !s.timeslot_id;
                });
                if (alreadyInTarget) {
                    alert('Mitarbeiter ist in dieser Position bereits eingeteilt.');
                    return;
                }

                if (absencePositions.includes(newPosition)) {
                    const executeCopyAbsence = () => {
                        cleanupOtherShifts(shift.doctor_id, newDateStr);

                        const existingInNewCell = currentWeekShifts.filter((s: any) => {
                            if (s.date !== newDateStr || s.position !== newPosition) return false;
                            if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                            return !s.timeslot_id;
                        });
                        const maxOrder = existingInNewCell.reduce((max: any, s: any) => Math.max(max, s.order || 0), -1);
                        const newOrder = maxOrder + 1;

                        const copyData = applyTimeslotSelectionToCreateData(
                            { date: newDateStr, position: newPosition, doctor_id: shift.doctor_id, order: newOrder },
                            normalizedSelection
                        );

                        createShiftMutation.mutate(copyData, {
                            onSuccess: () => {
                                handlePostShiftOff(shift.doctor_id, newDateStr, newPosition);
                            }
                        });
                    };

                    const hasConflicts = checkAbsenceDropConflicts(shift.doctor_id, newDateStr, newPosition, executeCopyAbsence);
                    if (hasConflicts) return;

                    executeCopyAbsence();
                    return;
                }

                const limitWarning = checkLimits(shift.doctor_id, newDateStr, newPosition);
                if (limitWarning) toast.warning(limitWarning);

                const occupyingShift = findOccupyingShift(newDateStr, newPosition, null, newTimeslotId);
                if (occupyingShift) {
                    if (isAutoOffPosition(occupyingShift.position)) {
                        cleanupAutoFreiOnly(occupyingShift.doctor_id, occupyingShift.date, occupyingShift.position);
                    }
                    deleteShiftMutation.mutate(occupyingShift.id);
                }

                const executeCopy = async () => {
                    const existingInNewCell = currentWeekShifts.filter((s: any) => {
                        if (s.date !== newDateStr || s.position !== newPosition) return false;
                        if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                        return !s.timeslot_id;
                    });
                    const maxOrder = existingInNewCell.reduce((max: any, s: any) => Math.max(max, s.order || 0), -1);
                    const newOrder = maxOrder + 1;

                    const copyData = applyTimeslotSelectionToCreateData(
                        { date: newDateStr, position: newPosition, doctor_id: shift.doctor_id, order: newOrder },
                        normalizedSelection
                    );

                    createShiftMutation.mutate(copyData, {
                        onSuccess: () => {
                            handlePostShiftOff(shift.doctor_id, newDateStr, newPosition);
                        }
                    });
                };

                const hasConflict = await checkConflictsWithOverride(shift.doctor_id, newDateStr, newPosition, null, executeCopy);
                if (hasConflict) return;

                executeCopy();
                return;
            }

            const wasAutoOff = isAutoOffPosition(shift.position);
            if (wasAutoOff && (newPosition !== shift.position || newDateStr !== shift.date)) {
                cleanupAutoFreiOnly(shift.doctor_id, shift.date, shift.position);
            }

            const positionOrTimeslotChanged = newPosition !== shift.position || newTimeslotId !== shift.timeslot_id;
            if (positionOrTimeslotChanged) {
                const alreadyInTarget = currentWeekShifts.some((s: any) => {
                    if (s.date !== newDateStr || s.position !== newPosition || s.doctor_id !== shift.doctor_id || s.id === shiftId) return false;
                    if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                    return !s.timeslot_id;
                });
                if (alreadyInTarget) {
                    alert('Mitarbeiter ist in dieser Position bereits eingeteilt.');
                    return;
                }
            }

            if (absencePositions.includes(newPosition)) {
                const executeMoveToAbsence = () => {
                    cleanupOtherShifts(shift.doctor_id, newDateStr, shiftId);

                    const existingInNewCell = currentWeekShifts.filter((s: any) => {
                        if (s.date !== newDateStr || s.position !== newPosition) return false;
                        if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                        return !s.timeslot_id;
                    });
                    const maxOrder = existingInNewCell.reduce((max: any, s: any) => Math.max(max, s.order || 0), -1);
                    const newOrder = maxOrder + 1;

                    const updateData = applyTimeslotSelectionToUpdateData(
                        { date: newDateStr, position: newPosition, order: newOrder },
                        normalizedSelection
                    );

                    updateShiftMutation.mutate(
                        { id: shiftId, data: updateData },
                        {
                            onSuccess: () => {
                                handlePostShiftOff(shift.doctor_id, newDateStr, newPosition);
                            }
                        }
                    );
                };

                const hasConflicts = checkAbsenceDropConflicts(shift.doctor_id, newDateStr, newPosition, executeMoveToAbsence, shiftId);
                if (hasConflicts) return;

                executeMoveToAbsence();
                return;
            }

            const limitWarning = checkLimits(shift.doctor_id, newDateStr, newPosition);
            if (limitWarning) toast.warning(limitWarning);

            const occupyingShift = findOccupyingShift(newDateStr, newPosition, shiftId, newTimeslotId);
            if (occupyingShift) {
                deleteShiftWithCleanup(occupyingShift);
            }

            const executeMove = async () => {
                const existingInNewCell = currentWeekShifts.filter((s: any) => {
                    if (s.date !== newDateStr || s.position !== newPosition) return false;
                    if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                    return !s.timeslot_id;
                });
                const maxOrder = existingInNewCell.reduce((max: any, s: any) => Math.max(max, s.order || 0), -1);
                const newOrder = maxOrder + 1;

                const updateData = applyTimeslotSelectionToUpdateData(
                    { date: newDateStr, position: newPosition, order: newOrder },
                    normalizedSelection
                );

                updateShiftMutation.mutate(
                    { id: shiftId, data: updateData },
                    {
                        onSuccess: () => {
                            handlePostShiftOff(shift.doctor_id, newDateStr, newPosition);
                        }
                    }
                );
            };

            const hasConflict = await checkConflictsWithOverride(shift.doctor_id, newDateStr, newPosition, shiftId, executeMove);
            if (hasConflict) return;

            executeMove();
        };

        if (!resolveTimeslotSelection({
            positionName: newPosition,
            dateStr: newDateStr,
            requestedTimeslotId: rawNewTimeslotId,
            onResolved: executeGridDrop,
            doctorId: movingShift?.doctor_id || null,
        })) {
            return;
        }
        return;
    }
  };

  return { handleDragEnd };
}
