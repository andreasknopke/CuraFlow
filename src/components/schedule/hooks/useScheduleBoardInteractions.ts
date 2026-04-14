// @ts-nocheck
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { addDays, format, startOfWeek } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  normalizeDraggableId,
  parseAvailableDoctorId,
  stripPanelPrefix,
} from '../utils/scheduleFormatters';

const ABSENCE_POSITIONS = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];
const PROTECTED_POSITIONS = ['Frei', 'Krank', 'Urlaub', 'Dienstreise'];

export function useScheduleBoardInteractions({
  isReadOnly,
  currentDate,
  currentWeekShifts,
  allShifts,
  workplaces,
  workplaceTimeslots,
  sidebarDoctors,
  previewShifts,
  setPreviewShifts,
  setPreviewCategories,
  collapsedSections,
  setCollapsedSections,
  collapsedTimeslotGroups,
  setCollapsedTimeslotGroups,
  setUndoStack,
  queryClient,
  fetchRange,
  getScheduleBlock,
  isPublicHoliday,
  isCtrlPressed,
  lockCell,
  createBlockMutation,
  deleteBlockMutation,
  bulkDeleteMutation,
  bulkCreateShiftsMutation,
  createShiftMutation,
  updateShiftMutation,
  updateDoctorMutation,
  updateAutoFreiMutation,
  bulkCreateShifts,
  shouldCreateAutoFrei,
  checkConflicts,
  checkConflictsWithOverride,
  checkAbsenceDropConflicts,
  checkStaffing,
  checkLimits,
  isWorkplaceActiveOnDate,
  findOccupyingShift,
  cleanupOtherShifts,
  handlePostShiftOff,
  deleteShiftWithCleanup,
  cleanupAutoFrei,
  cleanupAutoFreiOnly,
  addPreviewAutoFrei,
  removePreviewAutoFrei,
  isAutoOffPosition,
  sections,
}) {
  const [blockContextMenu, setBlockContextMenu] = useState(null);
  const [blockReasonInput, setBlockReasonInput] = useState('');
  const [draggingDoctorId, setDraggingDoctorId] = useState(null);
  const [draggingShiftId, setDraggingShiftId] = useState(null);
  const [isDraggingFromGrid, setIsDraggingFromGrid] = useState(false);
  const savedCollapsedSectionsRef = useRef(null);
  const savedCollapsedGroupsRef = useRef(null);
  const droppedInTimeslotGroupRef = useRef(null);

  const getWorkplaceNameFromDroppableId = (droppableId) => {
    const normalizedDroppableId = stripPanelPrefix(droppableId || '');
    if (!normalizedDroppableId) return null;

    if (normalizedDroppableId.startsWith('rowHeader__')) {
      const headerParts = normalizedDroppableId.replace('rowHeader__', '').split('__');
      return headerParts[0] || null;
    }

    const parts = normalizedDroppableId.split('__');
    return parts[1] || null;
  };

  const isSpecificTimeslotDestination = (droppableId, workplaceName) => {
    const normalizedDroppableId = stripPanelPrefix(droppableId || '');
    if (!normalizedDroppableId) return false;

    const targetWorkplace = getWorkplaceNameFromDroppableId(normalizedDroppableId);
    if (!targetWorkplace || targetWorkplace !== workplaceName) return false;

    if (normalizedDroppableId.startsWith('rowHeader__')) {
      const headerParts = normalizedDroppableId.replace('rowHeader__', '').split('__');
      const rawTimeslotId = headerParts[1] || null;
      return !!rawTimeslotId && rawTimeslotId !== 'allTimeslots';
    }

    const parts = normalizedDroppableId.split('__');
    const rawTimeslotId = parts[2] || null;
    return !!rawTimeslotId && rawTimeslotId !== 'allTimeslots';
  };

  const handleCellContextMenu = (event, dateStr, position, timeslotId = null) => {
    if (isReadOnly) return;
    event.preventDefault();
    const block = getScheduleBlock(dateStr, position, timeslotId);
    setBlockContextMenu({
      x: event.clientX,
      y: event.clientY,
      dateStr,
      position,
      timeslotId,
      existingBlock: block || null,
    });
    setBlockReasonInput(block?.reason || '');
  };

  const handleBlockCell = () => {
    if (!blockContextMenu) return;
    const { dateStr, position, timeslotId } = blockContextMenu;
    createBlockMutation.mutate({
      date: dateStr,
      position,
      timeslot_id: timeslotId || null,
      reason: blockReasonInput.trim() || null,
    });
    setBlockContextMenu(null);
    setBlockReasonInput('');
  };

  const handleUnblockCell = () => {
    if (!blockContextMenu?.existingBlock) return;
    deleteBlockMutation.mutate(blockContextMenu.existingBlock.id);
    setBlockContextMenu(null);
    setBlockReasonInput('');
  };

  const handleClearWeek = () => {
    const shiftsToDelete = currentWeekShifts.filter(
      (shift) => !PROTECTED_POSITIONS.includes(shift.position),
    );
    if (shiftsToDelete.length === 0) return;

    if (window.confirm('Möchten Sie den Wochenplan bereinigen? (Abwesenheiten bleiben erhalten)')) {
      bulkDeleteMutation.mutate(shiftsToDelete.map((shift) => shift.id));
    }
  };

  const handleClearDay = (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const shiftsToDelete = currentWeekShifts.filter(
      (shift) => shift.date === dateStr && !PROTECTED_POSITIONS.includes(shift.position),
    );
    if (shiftsToDelete.length === 0) return;

    if (
      window.confirm(
        `Möchten Sie die Dienste für ${format(date, 'EEEE', { locale: de })} löschen? (Abwesenheiten bleiben erhalten)`,
      )
    ) {
      bulkDeleteMutation.mutate(shiftsToDelete.map((shift) => shift.id));
    }
  };

  const handleClearRow = (rowName, timeslotId = null) => {
    const shiftsToDelete = currentWeekShifts.filter((shift) => {
      if (shift.position !== rowName) return false;
      if (timeslotId) return shift.timeslot_id === timeslotId;

      const workplace = workplaces.find((candidate) => candidate.name === rowName);
      if (workplace?.timeslots_enabled) return !shift.timeslot_id;
      return true;
    });
    if (shiftsToDelete.length === 0) return;

    const displayName = timeslotId ? `${rowName} (Zeitfenster)` : rowName;
    if (
      window.confirm(
        `Möchten Sie alle Einträge in der Zeile "${displayName}" für diese Woche löschen?`,
      )
    ) {
      bulkDeleteMutation.mutate(shiftsToDelete.map((shift) => shift.id));
    }
  };

  const handleBeforeCapture = (before) => {
    const normalizedDraggableId = normalizeDraggableId(before.draggableId);
    if (!normalizedDraggableId) return;

    let doctorId = null;
    let shiftId = null;

    if (normalizedDraggableId.startsWith('sidebar-doc-')) {
      doctorId = normalizedDraggableId.replace('sidebar-doc-', '');
    } else if (normalizedDraggableId.startsWith('available-doc-')) {
      doctorId = parseAvailableDoctorId(normalizedDraggableId);
    } else if (normalizedDraggableId.startsWith('shift-')) {
      shiftId = normalizedDraggableId.replace('shift-', '');
      const shift = currentWeekShifts.find((entry) => entry.id === shiftId);
      if (shift) doctorId = shift.doctor_id;
    }

    flushSync(() => {
      if (doctorId) setDraggingDoctorId(doctorId);
      if (shiftId) setDraggingShiftId(shiftId);
      if (collapsedSections.length > 0) {
        savedCollapsedSectionsRef.current = collapsedSections;
        setCollapsedSections([]);
      }
      if (collapsedTimeslotGroups.length > 0) {
        savedCollapsedGroupsRef.current = collapsedTimeslotGroups;
        setCollapsedTimeslotGroups([]);
      }
    });
  };

  const handleDragStart = (start) => {
    console.log('Drag Start:', start);
    const normalizedDraggableId = normalizeDraggableId(start.draggableId);
    if (!normalizedDraggableId) return;

    let doctorId = null;
    if (normalizedDraggableId.startsWith('sidebar-doc-')) {
      doctorId = normalizedDraggableId.replace('sidebar-doc-', '');
    } else if (normalizedDraggableId.startsWith('available-doc-')) {
      doctorId = parseAvailableDoctorId(normalizedDraggableId);
    } else if (normalizedDraggableId.startsWith('shift-')) {
      const shiftId = normalizedDraggableId.replace('shift-', '');
      setDraggingShiftId(shiftId);
      const shift = currentWeekShifts.find((entry) => entry.id === shiftId);
      if (shift) doctorId = shift.doctor_id;
    }

    console.log('Dragging Doctor ID:', doctorId);
    setDraggingDoctorId(doctorId);

    const sourceDroppableId = stripPanelPrefix(start.source.droppableId);
    if (sourceDroppableId !== 'sidebar' && !sourceDroppableId.startsWith('available__')) {
      setIsDraggingFromGrid(true);
    }
  };

  const handleDragUpdate = (update) => {
    const destinationDroppableId = update?.destination?.droppableId;
    if (!destinationDroppableId) return;

    const workplaceName = getWorkplaceNameFromDroppableId(destinationDroppableId);
    if (workplaceName && isSpecificTimeslotDestination(destinationDroppableId, workplaceName)) {
      droppedInTimeslotGroupRef.current = workplaceName;
    }
  };

  const handleDragEnd = async (result) => {
    setIsDraggingFromGrid(false);

    const savedSections = savedCollapsedSectionsRef.current;
    if (savedSections) {
      const droppedWorkplace = result.destination
        ? getWorkplaceNameFromDroppableId(result.destination.droppableId)
        : null;
      if (droppedWorkplace) {
        const droppedSection = sections.find((section) =>
          section.rows.some(
            (row) => (typeof row === 'string' ? row : row.name) === droppedWorkplace,
          ),
        );
        if (droppedSection) {
          setCollapsedSections(savedSections.filter((title) => title !== droppedSection.title));
        } else {
          setCollapsedSections(savedSections);
        }
      } else {
        setCollapsedSections(savedSections);
      }
      savedCollapsedSectionsRef.current = null;
    }

    const savedGroups = savedCollapsedGroupsRef.current;
    if (savedGroups) {
      const droppedWorkplace = result.destination
        ? getWorkplaceNameFromDroppableId(result.destination.droppableId)
        : null;
      const keepOpen =
        (droppedWorkplace &&
          isSpecificTimeslotDestination(result.destination?.droppableId, droppedWorkplace)) ||
        droppedInTimeslotGroupRef.current === droppedWorkplace;
      setCollapsedTimeslotGroups(
        keepOpen ? savedGroups.filter((name) => name !== droppedWorkplace) : savedGroups,
      );
      savedCollapsedGroupsRef.current = null;
    }
    droppedInTimeslotGroupRef.current = null;

    console.log('DEBUG: Drag Operation Ended', {
      draggableId: result.draggableId,
      source: result.source,
      destination: result.destination,
      reason: result.reason,
    });

    setDraggingDoctorId(null);
    setDraggingShiftId(null);

    const { source, destination, draggableId } = result;
    const normalizedDraggableId = normalizeDraggableId(draggableId);
    const sourceDroppableId = stripPanelPrefix(source.droppableId);
    const destinationDroppableId = destination ? stripPanelPrefix(destination.droppableId) : null;

    if (normalizedDraggableId.startsWith('shift-preview-')) {
      const shiftId = normalizedDraggableId.replace('shift-', '');
      const previewShift = previewShifts?.find((shift) => shift.id === shiftId);
      if (!previewShift || !previewShifts) return;

      if (
        !destination ||
        destinationDroppableId === 'sidebar' ||
        destinationDroppableId === 'trash' ||
        destinationDroppableId === 'trash-overlay' ||
        destinationDroppableId.startsWith('available__') ||
        destinationDroppableId.endsWith('__Verfügbar')
      ) {
        let remaining = previewShifts.filter((shift) => shift.id !== shiftId);
        if (isAutoOffPosition(previewShift.position)) {
          remaining = removePreviewAutoFrei(
            previewShift.doctor_id,
            previewShift.date,
            previewShift.position,
            remaining,
          );
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

      if (destinationDroppableId.startsWith('rowHeader__')) return;
      if (sourceDroppableId === destinationDroppableId && source.index === destination.index)
        return;

      const destParts = destinationDroppableId.split('__');
      const newDateStr = destParts[0];
      const newPosition = destParts[1];
      if (!newDateStr || !newPosition) return;

      if (!ABSENCE_POSITIONS.includes(newPosition)) {
        const workplace = workplaces.find((candidate) => candidate.name === newPosition);
        if (workplace) {
          const activeDays =
            workplace.active_days && workplace.active_days.length > 0
              ? workplace.active_days
              : [1, 2, 3, 4, 5];
          const date = new Date(`${newDateStr}T00:00:00`);
          const dayOfWeek = date.getDay();
          const isActive = isPublicHoliday(date)
            ? activeDays.some((value) => Number(value) === 0)
            : activeDays.some((value) => Number(value) === dayOfWeek);
          if (!isActive) {
            toast.error('Diese Position ist an diesem Tag nicht aktiv.');
            return;
          }
        }
      }

      const duplicate = currentWeekShifts.find(
        (shift) =>
          shift.id !== shiftId &&
          shift.date === newDateStr &&
          shift.position === newPosition &&
          shift.doctor_id === previewShift.doctor_id,
      );
      if (duplicate) {
        toast.error('Arzt ist dort bereits eingeteilt.');
        return;
      }

      let updated = previewShifts.map((shift) =>
        shift.id !== shiftId ? shift : { ...shift, date: newDateStr, position: newPosition },
      );

      if (isAutoOffPosition(previewShift.position)) {
        updated = removePreviewAutoFrei(
          previewShift.doctor_id,
          previewShift.date,
          previewShift.position,
          updated,
        );
      }
      if (isAutoOffPosition(newPosition)) {
        updated = addPreviewAutoFrei(previewShift.doctor_id, newDateStr, newPosition, updated);
      }

      setPreviewShifts(updated);
      return;
    }

    if (!destination) {
      if (isDraggingFromGrid && normalizedDraggableId.startsWith('shift-')) {
        const shiftId = normalizedDraggableId.replace('shift-', '');
        if (shiftId.startsWith('temp-')) return;
        const shift =
          currentWeekShifts.find((entry) => entry.id === shiftId) ||
          allShifts.find((entry) => entry.id === shiftId);
        if (shift) deleteShiftWithCleanup(shift);
      }
      return;
    }

    if (destinationDroppableId.startsWith('rowHeader__')) {
      const headerParts = destinationDroppableId.replace('rowHeader__', '').split('__');
      const rowName = headerParts[0];
      const rawHeaderTimeslotId = headerParts[1] || null;
      const isAllTimeslots = rawHeaderTimeslotId === 'allTimeslots';
      const rowHeaderTimeslotId = isAllTimeslots ? null : rawHeaderTimeslotId;

      if (isAllTimeslots) {
        const workplace = workplaces.find((candidate) => candidate.name === rowName);
        if (workplace) {
          setCollapsedTimeslotGroups((previous) => previous.filter((name) => name !== rowName));
          toast.info(
            'Zeitfenster aufgeklappt – bitte Mitarbeiter in das gewünschte Zeitfenster ziehen.',
          );
        }
        return;
      }

      let doctorId = null;
      if (sourceDroppableId === 'sidebar') {
        doctorId = normalizedDraggableId.replace('sidebar-doc-', '');
      } else if (normalizedDraggableId.startsWith('shift-')) {
        const shift = currentWeekShifts.find(
          (entry) => entry.id === normalizedDraggableId.replace('shift-', ''),
        );
        doctorId = shift?.doctor_id;
      } else if (normalizedDraggableId.startsWith('available-doc-')) {
        doctorId = parseAvailableDoctorId(normalizedDraggableId);
      }
      if (!doctorId) return;

      const monday = startOfWeek(currentDate, { weekStartsOn: 1 });
      const allWeekDays = [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(monday, offset));
      const daysToAssign = allWeekDays.filter((day) =>
        isWorkplaceActiveOnDate(rowName, format(day, 'yyyy-MM-dd')),
      );

      const toCreate = [];
      const toDelete = [];
      let successCount = 0;
      let blockedCount = 0;

      for (const day of daysToAssign) {
        const dateStr = format(day, 'yyyy-MM-dd');
        if (getScheduleBlock(dateStr, rowName, rowHeaderTimeslotId)) {
          blockedCount += 1;
          continue;
        }
        if (checkConflicts(doctorId, dateStr, rowName, true)) {
          blockedCount += 1;
          continue;
        }

        const limitWarning = checkLimits(doctorId, dateStr, rowName);
        if (limitWarning) {
          toast.warning(`Limit Warnung (${format(day, 'dd.MM')}): ${limitWarning}`);
        }

        if (ABSENCE_POSITIONS.includes(rowName)) {
          const staffingWarn = checkStaffing(dateStr, doctorId);
          if (staffingWarn) toast.warning(staffingWarn);

          currentWeekShifts
            .filter((shift) => shift.doctor_id === doctorId && shift.date === dateStr)
            .forEach((shift) => toDelete.push(shift.id));
        } else {
          const occupying = findOccupyingShift(dateStr, rowName);
          if (occupying) toDelete.push(occupying.id);
        }

        const effectiveTsId = rowHeaderTimeslotId === '__unassigned__' ? null : rowHeaderTimeslotId;
        const existingShift = currentWeekShifts.find((shift) => {
          if (
            shift.date !== dateStr ||
            shift.position !== rowName ||
            shift.doctor_id !== doctorId
          ) {
            return false;
          }
          if (effectiveTsId) return shift.timeslot_id === effectiveTsId;
          return !shift.timeslot_id;
        });
        if (existingShift) continue;

        const cellShifts = currentWeekShifts.filter((shift) => {
          if (shift.date !== dateStr || shift.position !== rowName) return false;
          if (effectiveTsId) return shift.timeslot_id === effectiveTsId;
          return !shift.timeslot_id;
        });
        const pendingInCell = toCreate.filter(
          (shift) =>
            shift.date === dateStr &&
            shift.position === rowName &&
            shift.timeslot_id === effectiveTsId,
        );
        const maxOrder = Math.max(
          cellShifts.reduce((max, shift) => Math.max(max, shift.order || 0), -1),
          pendingInCell.reduce((max, shift) => Math.max(max, shift.order || 0), -1),
        );

        const newShiftData = {
          date: dateStr,
          position: rowName,
          doctor_id: doctorId,
          order: maxOrder + 1,
        };
        if (effectiveTsId) newShiftData.timeslot_id = effectiveTsId;
        toCreate.push(newShiftData);
        successCount += 1;
      }

      if (toDelete.length > 0) {
        await bulkDeleteMutation.mutateAsync(toDelete);
      }
      if (toCreate.length > 0) {
        const created = await bulkCreateShifts(toCreate);
        if (created && Array.isArray(created)) {
          setUndoStack((previous) => [
            ...previous,
            { type: 'BULK_DELETE', ids: created.map((entry) => entry.id) },
          ]);
        }
        setTimeout(
          () =>
            queryClient.invalidateQueries({
              queryKey: ['shifts', fetchRange.start, fetchRange.end],
            }),
          100,
        );
      }

      if (successCount > 0) toast.success(`${successCount} Tage zugewiesen (Mo-Fr)`);
      if (blockedCount > 0) toast.warning(`${blockedCount} Tage übersprungen wegen Konflikten`);
      return;
    }

    if (sourceDroppableId === 'sidebar' && destinationDroppableId === 'sidebar') {
      if (source.index === destination.index) return;
      const newDoctors = Array.from(sidebarDoctors);
      const [movedDoctor] = newDoctors.splice(source.index, 1);
      newDoctors.splice(destination.index, 0, movedDoctor);
      newDoctors.forEach((doctor, index) => {
        if (doctor.order !== index) {
          updateDoctorMutation.mutate({ id: doctor.id, data: { order: index } });
        }
      });
      return;
    }

    const isDestAvailable =
      destinationDroppableId.startsWith('available__') ||
      destinationDroppableId.endsWith('__Verfügbar');
    const isSourceFromGrid =
      sourceDroppableId !== 'sidebar' && !sourceDroppableId.startsWith('available__');

    if (isSourceFromGrid && (isDestAvailable || destinationDroppableId === 'sidebar')) {
      const shiftId = normalizedDraggableId.replace('shift-', '');
      if (shiftId.startsWith('preview-') && previewShifts) {
        const removedShift = previewShifts.find((shift) => shift.id === shiftId);
        let remaining = previewShifts.filter((shift) => shift.id !== shiftId);
        if (removedShift && isAutoOffPosition(removedShift.position)) {
          remaining = removePreviewAutoFrei(
            removedShift.doctor_id,
            removedShift.date,
            removedShift.position,
            remaining,
          );
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

      const shift = currentWeekShifts.find((entry) => entry.id === shiftId);
      console.log(`[DEBUG-LOG] Drop to Trash/Sidebar. ShiftID: ${shiftId}, Found: ${!!shift}`);
      if (shift) {
        deleteShiftWithCleanup(shift);
      } else {
        console.error(
          `[DEBUG-LOG] Shift ${shiftId} not found in currentWeekShifts! Available IDs:`,
          currentWeekShifts.map((entry) => entry.id),
        );
        const fallbackShift = allShifts.find((entry) => entry.id === shiftId);
        if (fallbackShift) {
          console.log('[DEBUG-LOG] Found shift in allShifts fallback. Deleting.');
          deleteShiftWithCleanup(fallbackShift);
        }
      }
      return;
    }

    if (sourceDroppableId === 'sidebar' || sourceDroppableId.startsWith('available__')) {
      if (
        destinationDroppableId === 'trash' ||
        destinationDroppableId === 'trash-overlay' ||
        destinationDroppableId === 'sidebar' ||
        !destinationDroppableId.includes('__') ||
        destinationDroppableId.endsWith('__Verfügbar') ||
        destinationDroppableId.startsWith('available__')
      ) {
        return;
      }

      const doctorId =
        sourceDroppableId === 'sidebar'
          ? normalizedDraggableId.replace('sidebar-doc-', '')
          : parseAvailableDoctorId(normalizedDraggableId);

      if (previewShifts) {
        const dropParts = destinationDroppableId.split('__');
        const dateStr = dropParts[0];
        const position = dropParts[1];
        if (!dateStr || !position) return;

        const duplicate = currentWeekShifts.find(
          (shift) =>
            shift.date === dateStr && shift.position === position && shift.doctor_id === doctorId,
        );
        if (duplicate) {
          toast.error('Arzt ist dort bereits eingeteilt.');
          return;
        }

        let updatedPreviews = [
          ...previewShifts,
          {
            id: `preview-add-${Date.now()}`,
            date: dateStr,
            position,
            doctor_id: doctorId,
            isPreview: true,
          },
        ];
        if (isAutoOffPosition(position)) {
          updatedPreviews = addPreviewAutoFrei(doctorId, dateStr, position, updatedPreviews);
        }
        setPreviewShifts(updatedPreviews);
        toast.info('Vorschlag hinzugefügt');
        return;
      }

      const dropParts = destinationDroppableId.split('__');
      const dateStr = dropParts[0];
      const position = dropParts[1];
      const rawTimeslotId = dropParts[2] || null;
      const isAllTimeslots = rawTimeslotId === 'allTimeslots';
      if (isAllTimeslots) {
        setCollapsedTimeslotGroups((previous) => previous.filter((name) => name !== position));
        toast.info(`Bitte Zeitfenster wählen: "${position}" wurde aufgeklappt.`);
        return;
      }

      let timeslotId = rawTimeslotId === '__unassigned__' ? null : rawTimeslotId;
      const workplace = workplaces.find((candidate) => candidate.name === position);
      let timeslotsToAssign = null;

      if (!timeslotId && workplace?.timeslots_enabled) {
        const wpTimeslots = workplaceTimeslots
          .filter((timeslot) => timeslot.workplace_id === workplace.id)
          .sort((left, right) => (left.order || 0) - (right.order || 0));
        if (wpTimeslots.length === 1) {
          timeslotId = wpTimeslots[0].id;
          console.log('Auto-assigning single timeslot:', timeslotId);
        }
      }

      console.log('Dropping Doctor:', doctorId, 'to', dateStr, position, 'timeslotId:', timeslotId);
      const dropBlock = getScheduleBlock(dateStr, position, timeslotId);
      if (dropBlock) {
        toast.error('Zelle gesperrt' + (dropBlock.reason ? `: ${dropBlock.reason}` : ''));
        return;
      }
      if (!ABSENCE_POSITIONS.includes(position) && !isWorkplaceActiveOnDate(position, dateStr)) {
        toast.error('Diese Position ist an diesem Tag nicht aktiv.');
        return;
      }

      if (ABSENCE_POSITIONS.includes(position)) {
        const executeAbsenceCreation = () => {
          cleanupOtherShifts(doctorId, dateStr);
          const existing = currentWeekShifts.find(
            (shift) =>
              shift.date === dateStr && shift.doctor_id === doctorId && shift.position === position,
          );
          if (existing) {
            console.log('DEBUG: Absence already exists');
            return;
          }
          const existingInCell = currentWeekShifts.filter(
            (shift) => shift.date === dateStr && shift.position === position,
          );
          const maxOrder = existingInCell.reduce(
            (max, shift) => Math.max(max, shift.order || 0),
            -1,
          );
          createShiftMutation.mutate({
            date: dateStr,
            position,
            doctor_id: doctorId,
            order: maxOrder + 1,
          });
        };

        const hasConflicts = checkAbsenceDropConflicts(
          doctorId,
          dateStr,
          position,
          executeAbsenceCreation,
        );
        if (hasConflicts) {
          console.log('Absence drop conflicts - waiting for override decision');
          return;
        }
        executeAbsenceCreation();
        return;
      }

      const limitWarning = checkLimits(doctorId, dateStr, position);
      if (limitWarning) alert(limitWarning);

      const effectiveTimeslotId = timeslotId === '__unassigned__' ? null : timeslotId;
      const exists = currentWeekShifts.some((shift) => {
        if (shift.date !== dateStr || shift.position !== position || shift.doctor_id !== doctorId) {
          return false;
        }
        if (effectiveTimeslotId) return shift.timeslot_id === effectiveTimeslotId;
        return !shift.timeslot_id;
      });
      if (exists) {
        console.log('DEBUG: Blocked - Shift already exists for this doctor/date/position/timeslot');
        alert('Mitarbeiter ist in dieser Position bereits eingeteilt.');
        return;
      }

      const occupyingShift = findOccupyingShift(dateStr, position);
      if (!occupyingShift && !lockCell(dateStr, position, effectiveTimeslotId)) {
        console.warn('[CellLock] Blocked rapid duplicate drop:', dateStr, position);
        return;
      }

      const executeShiftCreation = () => {
        if (occupyingShift) deleteShiftWithCleanup(occupyingShift);

        const shiftsToCreate = [];
        const slotsToProcess = timeslotsToAssign || [timeslotId];
        for (const tsId of slotsToProcess) {
          const slotTimeslotId = tsId === '__unassigned__' ? null : tsId;
          const existsForSlot = currentWeekShifts.some((shift) => {
            if (
              shift.date !== dateStr ||
              shift.position !== position ||
              shift.doctor_id !== doctorId
            ) {
              return false;
            }
            if (slotTimeslotId) return shift.timeslot_id === slotTimeslotId;
            return !shift.timeslot_id;
          });
          if (existsForSlot) {
            console.log('DEBUG: Skipping - Shift already exists for timeslot:', slotTimeslotId);
            continue;
          }

          const existingInCell = currentWeekShifts.filter((shift) => {
            if (shift.date !== dateStr || shift.position !== position) return false;
            if (slotTimeslotId) return shift.timeslot_id === slotTimeslotId;
            return !shift.timeslot_id;
          });
          const maxOrder = existingInCell.reduce(
            (max, shift) => Math.max(max, shift.order || 0),
            -1,
          );
          const newShiftData = {
            date: dateStr,
            position,
            doctor_id: doctorId,
            order: maxOrder + 1,
          };
          if (slotTimeslotId) newShiftData.timeslot_id = slotTimeslotId;
          shiftsToCreate.push(newShiftData);
        }

        const autoFreiDateStr = shouldCreateAutoFrei(position, dateStr, isPublicHoliday);
        let updateAutoFreiNeeded = false;
        let existingAutoFreiShift = null;
        if (autoFreiDateStr) {
          const warning = checkStaffing(autoFreiDateStr, doctorId);
          if (warning) {
            toast.warning(
              `${warning}\n(Durch automatischen Freizeitausgleich am ${format(new Date(autoFreiDateStr), 'dd.MM.')})`,
            );
          }

          existingAutoFreiShift = allShifts.find(
            (shift) => shift.date === autoFreiDateStr && shift.doctor_id === doctorId,
          );
          if (!existingAutoFreiShift) {
            shiftsToCreate.push({
              date: autoFreiDateStr,
              position: 'Frei',
              doctor_id: doctorId,
              note: 'Autom. Freizeitausgleich',
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
              if (updateAutoFreiNeeded && existingAutoFreiShift) {
                if (
                  window.confirm(
                    `Für den Folgetag (${format(new Date(autoFreiDateStr), 'dd.MM.')}) existiert bereits ein Eintrag "${existingAutoFreiShift.position}". Soll dieser durch "Frei" ersetzt werden?`,
                  )
                ) {
                  updateAutoFreiMutation.mutate({
                    id: existingAutoFreiShift.id,
                    data: { position: 'Frei', note: 'Autom. Freizeitausgleich' },
                  });
                }
              }
            },
            onError: (error) => {
              console.error('DEBUG: Error creating shifts:', error);
              toast.error('Fehler beim Erstellen: ' + error.message);
            },
          });
        }
      };

      const hasConflict = checkConflictsWithOverride(
        doctorId,
        dateStr,
        position,
        null,
        executeShiftCreation,
      );
      if (hasConflict) {
        console.log('Conflict detected - waiting for override decision');
        return;
      }
      executeShiftCreation();
      return;
    }

    if (
      sourceDroppableId !== 'sidebar' &&
      !sourceDroppableId.startsWith('available__') &&
      destinationDroppableId !== 'sidebar' &&
      destinationDroppableId !== 'trash' &&
      destinationDroppableId !== 'trash-overlay' &&
      !destinationDroppableId.endsWith('__Verfügbar') &&
      !destinationDroppableId.startsWith('available__')
    ) {
      const shiftId = normalizedDraggableId.replace('shift-', '');
      const destParts = destinationDroppableId.split('__');
      const newDateStr = destParts[0];
      const newPosition = destParts[1];
      const rawNewTimeslotId = destParts[2] || null;
      let newTimeslotId = rawNewTimeslotId === '__unassigned__' ? null : rawNewTimeslotId;

      if (!newTimeslotId) {
        const workplace = workplaces.find((candidate) => candidate.name === newPosition);
        if (workplace?.timeslots_enabled) {
          const wpTimeslots = workplaceTimeslots
            .filter((timeslot) => timeslot.workplace_id === workplace.id)
            .sort((left, right) => (left.order || 0) - (right.order || 0));
          if (wpTimeslots.length === 1) {
            newTimeslotId = wpTimeslots[0].id;
            console.log('Auto-assigning single timeslot for move:', newTimeslotId);
          }
        }
      }

      if (
        !ABSENCE_POSITIONS.includes(newPosition) &&
        !isWorkplaceActiveOnDate(newPosition, newDateStr)
      ) {
        toast.error('Diese Position ist an diesem Tag nicht aktiv.');
        return;
      }

      const moveBlock = getScheduleBlock(newDateStr, newPosition, newTimeslotId);
      if (moveBlock) {
        toast.error('Zelle gesperrt' + (moveBlock.reason ? `: ${moveBlock.reason}` : ''));
        return;
      }

      if (sourceDroppableId === destinationDroppableId) {
        if (source.index === destination.index) return;

        const cellShifts = currentWeekShifts
          .filter((shift) => {
            if (shift.date !== newDateStr || shift.position !== newPosition) return false;
            if (newTimeslotId) return shift.timeslot_id === newTimeslotId;
            return !shift.timeslot_id;
          })
          .sort((left, right) => (left.order || 0) - (right.order || 0));

        const newShifts = Array.from(cellShifts);
        const [movedShift] = newShifts.splice(source.index, 1);
        newShifts.splice(destination.index, 0, movedShift);
        newShifts.forEach((shift, index) => {
          if (shift.order !== index) {
            updateShiftMutation.mutate({ id: shift.id, data: { order: index } });
          }
        });
        return;
      }

      const shift = currentWeekShifts.find((entry) => entry.id === shiftId);
      if (!shift) return;

      if (isCtrlPressed && sourceDroppableId !== destinationDroppableId) {
        const alreadyInTarget = currentWeekShifts.some((entry) => {
          if (
            entry.date !== newDateStr ||
            entry.position !== newPosition ||
            entry.doctor_id !== shift.doctor_id
          ) {
            return false;
          }
          if (newTimeslotId) return entry.timeslot_id === newTimeslotId;
          return !entry.timeslot_id;
        });
        if (alreadyInTarget) {
          alert('Mitarbeiter ist in dieser Position bereits eingeteilt.');
          return;
        }

        if (ABSENCE_POSITIONS.includes(newPosition)) {
          const executeCopyAbsence = () => {
            cleanupOtherShifts(shift.doctor_id, newDateStr);
            const existingInNewCell = currentWeekShifts.filter((entry) => {
              if (entry.date !== newDateStr || entry.position !== newPosition) return false;
              if (newTimeslotId) return entry.timeslot_id === newTimeslotId;
              return !entry.timeslot_id;
            });
            const maxOrder = existingInNewCell.reduce(
              (max, entry) => Math.max(max, entry.order || 0),
              -1,
            );
            const copyData = {
              date: newDateStr,
              position: newPosition,
              doctor_id: shift.doctor_id,
              order: maxOrder + 1,
            };
            if (newTimeslotId) copyData.timeslot_id = newTimeslotId;
            createShiftMutation.mutate(copyData, {
              onSuccess: () => handlePostShiftOff(shift.doctor_id, newDateStr, newPosition),
            });
          };

          const hasConflicts = checkAbsenceDropConflicts(
            shift.doctor_id,
            newDateStr,
            newPosition,
            executeCopyAbsence,
          );
          if (hasConflicts) return;
          executeCopyAbsence();
          return;
        }

        const limitWarning = checkLimits(shift.doctor_id, newDateStr, newPosition);
        if (limitWarning) toast.warning(limitWarning);

        const occupyingShift = findOccupyingShift(newDateStr, newPosition);
        if (occupyingShift) {
          if (isAutoOffPosition(occupyingShift.position)) {
            cleanupAutoFrei(occupyingShift.doctor_id, occupyingShift.date, occupyingShift.position);
          }
          deleteShiftWithCleanup(occupyingShift);
        }

        const executeCopy = () => {
          const existingInNewCell = currentWeekShifts.filter((entry) => {
            if (entry.date !== newDateStr || entry.position !== newPosition) return false;
            if (newTimeslotId) return entry.timeslot_id === newTimeslotId;
            return !entry.timeslot_id;
          });
          const maxOrder = existingInNewCell.reduce(
            (max, entry) => Math.max(max, entry.order || 0),
            -1,
          );
          const copyData = {
            date: newDateStr,
            position: newPosition,
            doctor_id: shift.doctor_id,
            order: maxOrder + 1,
          };
          if (newTimeslotId) copyData.timeslot_id = newTimeslotId;
          createShiftMutation.mutate(copyData, {
            onSuccess: () => handlePostShiftOff(shift.doctor_id, newDateStr, newPosition),
          });
        };

        const hasConflict = checkConflictsWithOverride(
          shift.doctor_id,
          newDateStr,
          newPosition,
          null,
          executeCopy,
        );
        if (hasConflict) return;
        executeCopy();
        return;
      }

      const wasAutoOff = isAutoOffPosition(shift.position);
      if (wasAutoOff && (newPosition !== shift.position || newDateStr !== shift.date)) {
        cleanupAutoFreiOnly(shift.doctor_id, shift.date, shift.position);
      }

      const positionOrTimeslotChanged =
        newPosition !== shift.position || newTimeslotId !== shift.timeslot_id;
      if (positionOrTimeslotChanged) {
        const alreadyInTarget = currentWeekShifts.some((entry) => {
          if (
            entry.date !== newDateStr ||
            entry.position !== newPosition ||
            entry.doctor_id !== shift.doctor_id ||
            entry.id === shiftId
          ) {
            return false;
          }
          if (newTimeslotId) return entry.timeslot_id === newTimeslotId;
          return !entry.timeslot_id;
        });
        if (alreadyInTarget) {
          alert('Mitarbeiter ist in dieser Position bereits eingeteilt.');
          return;
        }
      }

      if (ABSENCE_POSITIONS.includes(newPosition)) {
        const executeMoveToAbsence = () => {
          cleanupOtherShifts(shift.doctor_id, newDateStr, shiftId);
          const existingInNewCell = currentWeekShifts.filter((entry) => {
            if (entry.date !== newDateStr || entry.position !== newPosition) return false;
            if (newTimeslotId) return entry.timeslot_id === newTimeslotId;
            return !entry.timeslot_id;
          });
          const maxOrder = existingInNewCell.reduce(
            (max, entry) => Math.max(max, entry.order || 0),
            -1,
          );
          const updateData = { date: newDateStr, position: newPosition, order: maxOrder + 1 };
          if (newTimeslotId !== undefined) updateData.timeslot_id = newTimeslotId;
          updateShiftMutation.mutate(
            { id: shiftId, data: updateData },
            { onSuccess: () => handlePostShiftOff(shift.doctor_id, newDateStr, newPosition) },
          );
        };

        const hasConflicts = checkAbsenceDropConflicts(
          shift.doctor_id,
          newDateStr,
          newPosition,
          executeMoveToAbsence,
          shiftId,
        );
        if (hasConflicts) return;
        executeMoveToAbsence();
        return;
      }

      const limitWarning = checkLimits(shift.doctor_id, newDateStr, newPosition);
      if (limitWarning) toast.warning(limitWarning);

      const occupyingShift = findOccupyingShift(newDateStr, newPosition, shiftId);
      if (occupyingShift) deleteShiftWithCleanup(occupyingShift);

      const executeMove = () => {
        const existingInNewCell = currentWeekShifts.filter((entry) => {
          if (entry.date !== newDateStr || entry.position !== newPosition) return false;
          if (newTimeslotId) return entry.timeslot_id === newTimeslotId;
          return !entry.timeslot_id;
        });
        const maxOrder = existingInNewCell.reduce(
          (max, entry) => Math.max(max, entry.order || 0),
          -1,
        );
        const updateData = { date: newDateStr, position: newPosition, order: maxOrder + 1 };
        if (newTimeslotId !== undefined) updateData.timeslot_id = newTimeslotId;
        updateShiftMutation.mutate(
          { id: shiftId, data: updateData },
          { onSuccess: () => handlePostShiftOff(shift.doctor_id, newDateStr, newPosition) },
        );
      };

      const hasConflict = checkConflictsWithOverride(
        shift.doctor_id,
        newDateStr,
        newPosition,
        shiftId,
        executeMove,
      );
      if (hasConflict) return;
      executeMove();
    }
  };

  return {
    blockContextMenu,
    setBlockContextMenu,
    blockReasonInput,
    setBlockReasonInput,
    draggingDoctorId,
    draggingShiftId,
    handleCellContextMenu,
    handleBlockCell,
    handleUnblockCell,
    handleClearWeek,
    handleClearDay,
    handleClearRow,
    handleBeforeCapture,
    handleDragStart,
    handleDragUpdate,
    handleDragEnd,
  };
}
