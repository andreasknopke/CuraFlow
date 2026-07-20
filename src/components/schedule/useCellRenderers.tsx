/* eslint-disable @typescript-eslint/no-explicit-any -- Extraction-only step: the
   body is moved verbatim from ScheduleBoard.tsx and preserves the original `any`
   propagation. Typing happens in a follow-up commit (plan step 6). */
import { isValid, format } from 'date-fns';
import { toast } from 'sonner';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import type { DraggableProvided, DraggableStateSnapshot, DraggableRubric } from '@hello-pangea/dnd';
import { Plus, Link2 } from 'lucide-react';
import { api } from '@/api/client';
import type { SystemSetting } from '@/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import DraggableShift from './DraggableShift';
import DroppableCell from './DroppableCell';
import { LateAvailabilityBadge } from './scheduleBoardHelpers';
import {
  getShiftTimeRangeLabel,
  getShiftDisplayMode,
  normalizeDraggableId,
  stripPanelPrefix,
} from './scheduleBoardHelpers';
import { getShiftsForScheduleCell } from '@/components/schedule/scheduleShiftLookup';

export interface CellRenderersDeps {
  // State values
  isReadOnly: boolean;
  user: any;
  isCtrlPressed: boolean;
  draggingShiftId: string | null;
  highlightMyName: boolean;
  selectedDoctorId: string | null;
  showInitialsOnly: boolean;
  isSplitViewEnabled: boolean;
  isMonthView: boolean;
  isEmbeddedSchedule: boolean;
  effectiveGridFontSize: number;
  shiftBoxSize: number;

  // State setters
  setRotationDemandDialog: React.Dispatch<React.SetStateAction<any>>;
  setRotationAssignmentDialog: React.Dispatch<React.SetStateAction<any>>;

  // Query / computed data
  crossTenantShiftsByCell: Map<any, any>;
  linkedWorkplacesByName: Record<string, any>;
  activeLinkTenantId: string | null;
  rotationAssignmentsByCell: Map<any, any>;
  rotationDemandsByCell: Map<any, any>;
  openReturnRequestByAssignmentId: Map<any, any>;
  jokerDoctorById: Map<any, any>;
  doctorByCentralEmployeeId: Map<any, any>;
  centralEmployeesById: Map<any, any>;
  doctorById: Map<any, any>;
  springerDoctorById: Map<any, any>;
  workplaceByName: Map<any, any>;
  lateRotationIndicatorByDoctorDay: Map<any, any>;
  allDisplayDocsByDate: Map<any, any>;
  currentWeekShiftLookup: any;
  currentWeekShifts: any[];
  workplaceTimeslots: any[];
  workTimeModelMap: Map<any, any>;
  colorSettings: any;
  isLoadingColors: boolean;
  systemSettings: SystemSetting[];
  updateShiftMutation: any;
  queryClient: import('@tanstack/react-query').QueryClient;

  // Component-level functions
  openPoolEditDialog: (...args: any[]) => any;
  getDoctorChipLabel: (doctor: any) => string;
  getRoleColor: (doctorId: any) => { backgroundColor: string; color: string };
  getDoctorWithEffectiveFte: (...args: any[]) => any;
  handleShiftTimeslotEdit: (...args: any[]) => any;
  getFairnessInfo: (...args: any[]) => any;
  getShiftWishMarker: (...args: any[]) => any;
  getDoctorQualIds: (...args: any[]) => any;
  getWpRequiredQualIds: (...args: any[]) => any;
  getWpExcludedQualIds: (...args: any[]) => any;
  showSidebarTimeAccount: boolean;
}

export function useCellRenderers(deps: CellRenderersDeps) {
  const {
    isReadOnly,
    user,
    isCtrlPressed,
    draggingShiftId,
    highlightMyName,
    selectedDoctorId,
    showInitialsOnly,
    isSplitViewEnabled,
    isMonthView,
    isEmbeddedSchedule,
    effectiveGridFontSize,
    shiftBoxSize,
    setRotationDemandDialog,
    setRotationAssignmentDialog,
    crossTenantShiftsByCell,
    linkedWorkplacesByName,
    activeLinkTenantId,
    rotationAssignmentsByCell,
    rotationDemandsByCell,
    openReturnRequestByAssignmentId,
    jokerDoctorById,
    doctorByCentralEmployeeId,
    centralEmployeesById,
    doctorById,
    springerDoctorById,
    workplaceByName,
    lateRotationIndicatorByDoctorDay,
    allDisplayDocsByDate,
    currentWeekShiftLookup,
    currentWeekShifts,
    workplaceTimeslots,
    workTimeModelMap,
    colorSettings,
    isLoadingColors,
    systemSettings,
    updateShiftMutation,
    queryClient,
    openPoolEditDialog,
    getDoctorChipLabel,
    getRoleColor,
    getDoctorWithEffectiveFte,
    handleShiftTimeslotEdit,
    getFairnessInfo,
    getShiftWishMarker,
    getDoctorQualIds,
    showSidebarTimeAccount,
    getWpRequiredQualIds,
    getWpExcludedQualIds,
  } = deps;

  // Suppress unused warnings for deps used only inside useMemo closures.
  void user;
  void isCtrlPressed;
  void draggingShiftId;
  void highlightMyName;
  void selectedDoctorId;
  void showInitialsOnly;
  void isSplitViewEnabled;
  void isMonthView;
  void isEmbeddedSchedule;

    const renderCrossTenantCell = (workplace: any, dateStr: any) => {
        const shifts = crossTenantShiftsByCell.get(`${workplace.id}|${dateStr}`) || [];
        const canWrite = !isReadOnly && (workplace.canWrite !== false);
        return (
            <div
                className={`min-h-[40px] p-1 flex flex-wrap gap-1 transition-colors ${canWrite ? 'cursor-pointer hover:bg-indigo-50/40' : ''}`}
                onClick={(e) => {
                    if (!canWrite) return;
                    // Only open "create" when clicking empty area
                    if (e.target === e.currentTarget) {
                        openPoolEditDialog(workplace, dateStr, null);
                    }
                }}
            >
                {shifts.map((shift: any) => (
                    <button
                        key={shift.id}
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (canWrite) openPoolEditDialog(workplace, dateStr, shift);
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded border shadow-sm max-w-[140px] truncate ${shift.belongs_to_active_tenant ? 'bg-indigo-100 border-indigo-200 text-indigo-800' : 'bg-slate-100 border-slate-200 text-slate-700'}`}
                        title={`${shift.employee_name} · ${shift.workplace_name}`}
                        disabled={!canWrite}
                    >
                        {shift.employee_name}
                    </button>
                ))}
                {canWrite && shifts.length === 0 && (
                    <span
                        className="text-[10px] text-slate-400 inline-flex items-center gap-0.5 pointer-events-none"
                    >
                        <Plus className="w-3 h-3" />
                    </span>
                )}
            </div>
        );
    };

    // Renders a small Link2 icon button in the row header that opens a popover
    // showing the partner workplace staffing for the selected day (read-only).
    // Only shown in day view when workplace links exist.
    const renderLinkedWorkplaceButton = (rowName: any, dateStr: any) => {
        const rawPartners = linkedWorkplacesByName[rowName] || linkedWorkplacesByName[rowName.trim()];
        if (!rawPartners || rawPartners.length === 0) return null;
        // Show only partners from OTHER tenants — own tenant's workplaces are
        // already visible as separate rows in the schedule.
        const partners = activeLinkTenantId
            ? rawPartners.filter((p: any) => String(p.tenant_id) !== String(activeLinkTenantId))
            : rawPartners;
        if (partners.length === 0) return null;
        return (
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-teal-600 hover:text-teal-700 hover:bg-teal-50"
                        title="Verknüpfte Arbeitsplätze anzeigen"
                    >
                        <Link2 className="w-3.5 h-3.5" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3" align="start" side="right">
                    <div className="space-y-3">
                        <h4 className="font-semibold text-sm text-slate-800 border-b pb-1.5 flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-teal-600" />
                            Verknüpfte Arbeitsplätze
                        </h4>
                        {partners.map((partner: any) => {
                            const shiftsForDay = (partner.shifts || []).filter((s: any) => s.date === dateStr);
                            return (
                                <div key={`${partner.tenant_id}__${partner.workplace_name}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="text-[10px] font-semibold text-teal-700 border-teal-200 bg-teal-50/50">
                                            {partner.tenant_name}
                                        </Badge>
                                        <span className="text-sm font-medium text-slate-700">{partner.workplace_name}</span>
                                    </div>
                                    {shiftsForDay.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5 ml-1">
                                            {shiftsForDay.map((s: any, idx: any) => (
                                                <Badge
                                                    key={idx}
                                                    className="text-[11px] bg-white border-slate-200 text-slate-700 font-normal"
                                                    variant="outline"
                                                >
                                                    {s.doctor_name}
                                                    {s.start_time && s.end_time
                                                        ? ` (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})`
                                                        : s.start_time
                                                            ? ` (${s.start_time.slice(0, 5)})`
                                                            : ''}
                                                </Badge>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-400 italic ml-1">nicht besetzt</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </PopoverContent>
            </Popover>
        );
    };

    // Same popover as renderLinkedWorkplaceButton but styled for inside a cell:
    // positioned absolute top-right, visible only on row hover.
    // Used in week view (day view uses the header button instead).
    const renderLinkedWorkplaceCellButton = (rowName: any, dateStr: any) => {
        const rawPartners = linkedWorkplacesByName[rowName] || linkedWorkplacesByName[rowName.trim()];
        if (!rawPartners || rawPartners.length === 0) return null;
        const partners = activeLinkTenantId
            ? rawPartners.filter((p: any) => String(p.tenant_id) !== String(activeLinkTenantId))
            : rawPartners;
        if (partners.length === 0) return null;
        return (
            <Popover>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="absolute top-0.5 right-0.5 z-10 p-0.5 rounded bg-white/80 text-teal-500 hover:text-teal-700 hover:bg-white shadow-sm opacity-0 group-hover/cell:opacity-100 transition-opacity"
                        title="Verknüpfte Arbeitsplätze anzeigen"
                    >
                        <Link2 className="w-3 h-3" />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3" align="start" side="right">
                    <div className="space-y-3">
                        <h4 className="font-semibold text-sm text-slate-800 border-b pb-1.5 flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-teal-600" />
                            Verknüpfte Arbeitsplätze
                        </h4>
                        {partners.map((partner: any) => {
                            const shiftsForDay = (partner.shifts || []).filter((s: any) => s.date === dateStr);
                            return (
                                <div key={`cell-${partner.tenant_id}__${partner.workplace_name}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="text-[10px] font-semibold text-teal-700 border-teal-200 bg-teal-50/50">
                                            {partner.tenant_name}
                                        </Badge>
                                        <span className="text-sm font-medium text-slate-700">{partner.workplace_name}</span>
                                    </div>
                                    {shiftsForDay.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5 ml-1">
                                            {shiftsForDay.map((s: any, idx: any) => (
                                                <Badge
                                                    key={idx}
                                                    className="text-[11px] bg-white border-slate-200 text-slate-700 font-normal"
                                                    variant="outline"
                                                >
                                                    {s.doctor_name}
                                                    {s.start_time && s.end_time
                                                        ? ` (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})`
                                                        : s.start_time
                                                            ? ` (${s.start_time.slice(0, 5)})`
                                                            : ''}
                                                </Badge>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-400 italic ml-1">nicht besetzt</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </PopoverContent>
            </Popover>
        );
    };

    // ================================================================
    //  Springerpool-Rotationen — Zellen-Rendering
    // ================================================================
    // Zwei Modi:
    //   Pool-Planer (canWrite=true)  → EXAKT wie normale Rotationen:
    //                                   Droppable, grüner Hintergrund,
    //                                   Chips mit getDoctorChipLabel,
    //                                   Zeit im Chip + Timeslot-Dialog
    //   Station (canWrite=false)      → Timeslot-Sub-Zeilen mit Bedarf
    // ================================================================

    const formatRotationTime = (timeStr: any) => {
        if (!timeStr) return null;
        const parts = String(timeStr).split(':');
        if (parts.length < 2) return null;
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        return m === 0 ? `${h}` : `${h}:${String(m).padStart(2, '0')}`;
    };

    const renderRotationCell = (workplace: any, dateStr: any, extraProps: any = {}) => {
        const assignments = rotationAssignmentsByCell.get(`${workplace.id}|${dateStr}`) || [];
        const canWrite = !isReadOnly && (workplace.canWrite !== false);
        const hasTimeslots = workplace.timeslots_enabled && workplace.timeslots?.length > 0;
        const { isToday, isWeekend, isAlternate, baseClassName, baseStyle } = extraProps;

        const getEmpName = (a: any) => {
            if (a.employee_name) return a.employee_name;
            // Joker assignments use central_employee_id — resolve from doctors
            const jokerDoc = jokerDoctorById.get(String(a.employee_id))
                || doctorByCentralEmployeeId.get(String(a.employee_id));
            if (jokerDoc?.name) return jokerDoc.name;
            return `#${a.employee_id}`;
        };

        // Collect demands for this cell
        const cellDemands: any[] = [];
        for (const [key, demand] of rotationDemandsByCell) {
            const [wpId, dDate] = key.split('|');
            if (wpId === String(workplace.id) && dDate === dateStr) {
                cellDemands.push(demand);
            }
        }

        const openDemandFor = (timeslot: any = null) => {
            const demandKey = `${workplace.id}|${dateStr}|${timeslot?.id || ''}`;
            const existing = rotationDemandsByCell.get(demandKey);
            setRotationDemandDialog({
                open: true, workplace, date: dateStr, timeslot,
                existingDemand: existing || null,
            });
        };

        // ============================================================
        //  POOL-PLANER (canWrite) — DROPPABLECELL + DRAGGABLE CHIPS
        //  Exakt wie normale Rotationszellen: gleiche Hoehe (60px),
        //  gleiches Styling, gleiches Drag-Verhalten.
        //  Zusaetzlich: Bedarfs-Anzeige aus Stations-Mandanten.
        // ============================================================
        if (canWrite) {
            const isOccupied = assignments.length > 0;

            // Sammle offene Bedarfsanforderungen fuer diese Zelle
            const openDemands = cellDemands.filter((d: any) => d.status === 'open');

            return (
                <DroppableCell
                    id={`rotationCell__${workplace.id}__${dateStr}`}
                    isToday={isToday}
                    isWeekend={isWeekend}
                    isDisabled={false}
                    isReadOnly={false}
                    isAlternate={isAlternate}
                    isOccupied={isOccupied}
                    baseClassName={baseClassName}
                    baseStyle={baseStyle}
                    isTrainingHighlight={false}
                    isBlocked={false}
                >
                    {() => {
                        const isSingleAssignment = assignments.length === 1 && openDemands.length === 0;

                        // Return-request demands are keyed to the WARD workplace,
                        // not this pool workplace. Scan the global lookup for any
                        // that reference assignments in this cell.
                        const globalReturnBadges = [];
                        const seenReturnDemandIds = new Set();
                        for (const a of assignments) {
                            const rd = openReturnRequestByAssignmentId.get(String(a.id));
                            if (rd && !seenReturnDemandIds.has(rd.id)) {
                                seenReturnDemandIds.add(rd.id);
                                const rTsLabel = rd.timeslot_label || (rd.timeslot_id
                                    ? workplace.timeslots?.find((t: any) => String(t.id) === String(rd.timeslot_id))?.label
                                    : null);
                                globalReturnBadges.push(
                                    <div key={`global-return-${rd.id}`}
                                         className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300 font-medium"
                                         title={`Rückgabe angefordert: ${rd.note || ''}`.trim()}>
                                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                        {rTsLabel ? `Rückgabe ${rTsLabel}` : 'Rückgabe'}
                                    </div>
                                );
                            }
                        }

                        return assignments.map((assignment: any, idx: any) => {
                            const empName = getEmpName(assignment);
                            const ts = hasTimeslots && assignment.timeslot_id
                                ? workplace.timeslots.find((t: any) => String(t.id) === String(assignment.timeslot_id))
                                : null;
                            const timeLabel = ts
                                ? `${formatRotationTime(ts.start_time)}–${formatRotationTime(ts.end_time)}`
                                : null;
                            const doctor = doctorById.get(assignment.employee_id)
                                || jokerDoctorById.get(String(assignment.employee_id))
                                || doctorByCentralEmployeeId.get(String(assignment.employee_id));
                            const doctorLike = doctor || { id: assignment.employee_id, name: empName };
                            const chipLabel = getDoctorChipLabel(doctorLike);
                            const roleColor = doctor
                                ? getRoleColor(doctor.role)
                                : { backgroundColor: '#f3f4f6', color: '#1f2937' };
                            // If the ward has already requested this Springer back,
                            // override the chip colour to red so the pool planner
                            // can spot the return-request at a glance.
                            const returnRequest = openReturnRequestByAssignmentId.get(String(assignment.id));
                            const effectiveColor = returnRequest
                                ? { backgroundColor: '#fef2f2', color: '#991b1b' }
                                : roleColor;
                            const displayFontSize = effectiveGridFontSize;
                            const boxSize = shiftBoxSize;

                            return (
                                <Draggable
                                    key={assignment.id}
                                    draggableId={`rotation-assignment-${assignment.id}`}
                                    index={idx}
                                    isDragDisabled={false}
                                >
                                    {(provided, snapshot) => {
                                        const isDragging = snapshot.isDragging;
                                        // Beim Drag: transparenter Container, der die dnd-transform uebernimmt.
                                        // Der sichtbare Chip wird als Kind gerendert (wie DraggableShift).
                                        const containerStyle = isDragging ? {
                                            ...provided.draggableProps.style,
                                            backgroundColor: 'transparent',
                                            border: 'none',
                                            boxShadow: 'none',
                                            zIndex: 9999,
                                            width: `${boxSize}px`,
                                            height: `${boxSize}px`,
                                        } : isSingleAssignment ? {
                                            ...provided.draggableProps.style,
                                            backgroundColor: effectiveColor.backgroundColor,
                                            color: effectiveColor.color,
                                            width: '100%',
                                            height: '100%',
                                            minHeight: `${boxSize * 0.8}px`,
                                            fontSize: `${displayFontSize}px`,
                                        } : {
                                            ...provided.draggableProps.style,
                                            backgroundColor: effectiveColor.backgroundColor,
                                            color: effectiveColor.color,
                                            width: `${boxSize}px`,
                                            height: `${boxSize}px`,
                                            fontSize: `${displayFontSize}px`,
                                        };
                                        const containerClass = isDragging
                                            ? 'flex items-center justify-center'
                                            : isSingleAssignment
                                                ? 'relative flex items-center justify-start overflow-hidden rounded-md font-bold border shadow-sm transition-colors select-none'
                                                : 'relative flex items-center justify-center rounded-md font-bold border shadow-sm transition-colors select-none cursor-grab active:cursor-grabbing';
                                        return (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                {...(isSingleAssignment && !isDragging ? {} : provided.dragHandleProps)}
                                                onDoubleClick={(e) => {
                                                    e.stopPropagation();
                                                    (setRotationAssignmentDialog as any)({
                                                        open: true, workplace, date: dateStr,
                                                        assignment, timeslotId: assignment.timeslot_id || null,
                                                    });
                                                }}
                                                className={containerClass}
                                                style={containerStyle}
                                                title={empName}
                                            >
                                                {isDragging ? (
                                                    <div
                                                        className="relative flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400"
                                                        style={{
                                                            backgroundColor: effectiveColor.backgroundColor,
                                                            color: effectiveColor.color,
                                                            width: `${boxSize}px`,
                                                            height: `${boxSize}px`,
                                                            fontSize: `${displayFontSize}px`,
                                                        }}
                                                    >
                                                        <span className="whitespace-nowrap leading-none">{chipLabel}</span>
                                                    </div>
                                                ) : isSingleAssignment ? (
                                                    <>
                                                        <div
                                                            {...provided.dragHandleProps}
                                                            className="flex-shrink-0 font-bold flex items-center justify-center cursor-grab active:cursor-grabbing rounded-l-md h-full bg-white/50 hover:bg-black/10 transition-colors"
                                                            style={{ width: `${boxSize}px`, fontSize: `${displayFontSize}px` }}
                                                            title="Ziehen zum Verschieben"
                                                        >
                                                            {chipLabel}
                                                        </div>
                                                        <div className="relative flex flex-col items-center min-w-0 basis-0 flex-1 h-full leading-tight py-0.5">
                                                            <span
                                                                className="absolute inset-x-0 top-1/2 -translate-y-1/2 block min-w-0 px-1 text-center truncate"
                                                                style={{ fontSize: `${displayFontSize}px` }}
                                                            >
                                                                {empName}
                                                            </span>
                                                        </div>
                                                        {timeLabel && (
                                                            <div className="flex-shrink-0 flex items-center justify-end pr-1.5 opacity-70" style={{ fontSize: `${Math.max(displayFontSize * 0.65, 8)}px` }}>
                                                                {timeLabel}
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="absolute inset-0 rounded-md bg-white/50 hover:bg-black/10 transition-colors z-0" />
                                                        <div className="flex flex-col items-center justify-center w-full relative z-10">
                                                            <span className="px-0.5 leading-none text-center whitespace-nowrap" style={{ fontSize: `${displayFontSize}px` }}>
                                                                {chipLabel}
                                                            </span>
                                                            {timeLabel && (
                                                                <span className="leading-none text-center whitespace-nowrap opacity-60"
                                                                      style={{ fontSize: `${Math.max(displayFontSize * 0.55, 7)}px`, marginTop: '1px' }}>
                                                                    {timeLabel}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    }}
                                </Draggable>
                            );
                        }).concat(openDemands.filter((d: any) => !d.return_requested_assignment_id && !d.offered_employee_id).map((demand: any) => {
                            const tsLabel = demand.timeslot_label || (demand.timeslot_id
                                ? workplace.timeslots?.find((t: any) => String(t.id) === String(demand.timeslot_id))?.label
                                : null);
                            return (
                                <div key={`demand-${demand.id}`}
                                     className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 font-medium"
                                     title={`Bedarf von Station: ${demand.note || ''}`.trim()}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                                    {tsLabel ? `Bedarf ${tsLabel}` : 'Bedarf'}
                                </div>
                            );
                        })).concat(openDemands.filter((d: any) => d.offered_employee_id).map((demand: any) => {
                            const tsLabel = demand.timeslot_label || (demand.timeslot_id
                                ? workplace.timeslots?.find((t: any) => String(t.id) === String(demand.timeslot_id))?.label
                                : null);
                            const centralEmp = demand.offered_employee_id
                                ? centralEmployeesById.get(String(demand.offered_employee_id))
                                : null;
                            const jokerName = (centralEmp
                                ? `${centralEmp.first_name || ''} ${centralEmp.last_name || ''}`.trim()
                                : '')
                                || (demand.note || '').replace(/^Übergabe von /, '').replace(/ an den Pool gewünscht$/, '')
                                || 'Mitarbeiter';
                            const jokerLabel = tsLabel ? `Übergabe ${tsLabel}` : `Übergabe ${jokerName}`;
                            const handleAcceptJoker = () => {
                                const confirmed = window.confirm(
                                    `Möchten Sie ${jokerName} an diesem Tag in den Springerpool übernehmen?`
                                );
                                if (!confirmed) return;
                                api.updateRotationDemand(demand.id, { status: 'fulfilled' }).then(() => {
                                    queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
                                    queryClient.invalidateQueries({ queryKey: ['rotations', 'demands'] });
                                    toast.success(`${jokerName} wurde in den Pool übernommen und steht in Anwesenheiten bereit.`);
                                }).catch((err) => {
                                    toast.error('Fehler beim Übernehmen: ' + (err?.message || ''));
                                });
                            };
                            return (
                                <div key={`joker-${demand.id}`}
                                     onClick={handleAcceptJoker}
                                     className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-300 font-medium cursor-pointer hover:bg-blue-200"
                                     title={`Klicken um ${jokerName} zu übernehmen`}> 
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                    {jokerLabel}
                                </div>
                            );
                        })).concat(openDemands.filter((d: any) => d.return_requested_assignment_id).map((demand: any) => {
                            const tsLabel = demand.timeslot_label || (demand.timeslot_id
                                ? workplace.timeslots?.find((t: any) => String(t.id) === String(demand.timeslot_id))?.label
                                : null);
                            return (
                                <div key={`return-${demand.id}`}
                                     className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-300 font-medium"
                                     title={`Rückgabe angefordert: ${demand.note || ''}`.trim()}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                    {tsLabel ? `Rückgabe ${tsLabel}` : 'Rückgabe'}
                                </div>
                            );
                        })).concat(globalReturnBadges);
                    }}
                </DroppableCell>
            );
        }

        // ============================================================
        //  STATIONS-ANSICHT (!canWrite) — Timeslot-Sub-Zeilen
        //  Jedes Timeslot-Sub-Feld ist einzeln droppable, damit ein
        //  Springer-Chip auf ein konkretes Timeslot gezogen werden kann,
        //  um die Rückgabe an den Pool anzufordern.
        // ============================================================
        if (hasTimeslots) {
            return (
                <div className="min-h-[40px] flex flex-col gap-0.5 p-0.5">
                    {workplace.timeslots.map((ts: any) => {
                        const tsAssignments = assignments.filter((a: any) =>
                            String(a.timeslot_id || '') === String(ts.id)
                        );
                        const tsDemand = cellDemands.find((d: any) =>
                            String(d.timeslot_id || '') === String(ts.id)
                        );
                        const isCovered = tsAssignments.length > 0;
                        const demandStatus = tsDemand?.status;
                        const hasReturnRequest = tsDemand?.status === 'open'
                            && tsDemand?.return_requested_assignment_id;
                        return (
                            <DroppableCell
                                key={ts.id}
                                id={`rotationCellTslot__${workplace.id}__${dateStr}__${ts.id}`}
                                isToday={isToday}
                                isWeekend={isWeekend}
                                isDisabled={false}
                                isReadOnly={false}
                                isAlternate={isAlternate}
                                baseClassName={baseClassName}
                                baseStyle={baseStyle}
                                isTrainingHighlight={false}
                                isBlocked={false}
                                isCompact
                            >
                                {() => (
                                    <div
                                        className={`flex items-center gap-1 text-[10px] rounded px-1 py-0.5 transition-colors cursor-pointer hover:bg-amber-50/40 w-full ${isCovered ? 'bg-teal-50/30' : ''}`}
                                        onClick={() => { openDemandFor(ts); }}
                                        title={`${ts.label}${tsDemand ? ` · ${hasReturnRequest ? 'Rückgabe angefordert' : tsDemand.status === 'open' ? 'Bedarf offen' : 'Bedarf erfüllt'}` : ''}`}
                                    >
                                        <span className="font-medium text-[9px] text-slate-500 w-12 shrink-0">{ts.label}</span>
                                        <div className="flex flex-1 flex-wrap gap-0.5">
                                            {tsAssignments.map((assignment: any) => {
                                                const empName = getEmpName(assignment);
                                                const isOpenReturn = tsDemand?.status === 'open'
                                                    && tsDemand?.return_requested_assignment_id
                                                    && String(tsDemand.return_requested_assignment_id) === String(assignment.id);
                                                return (
                                                    <span
                                                        key={assignment.id}
                                                        className={`inline-block px-1 py-0.5 rounded border max-w-[100px] truncate ${
                                                            isOpenReturn
                                                                ? 'bg-purple-100 border-purple-300 text-purple-800'
                                                                : 'bg-teal-100 border-teal-200 text-teal-800'
                                                        }`}
                                                        title={isOpenReturn ? `${empName} · Rückgabe angefordert` : empName}
                                                    >
                                                        {empName}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                        {demandStatus === 'open' && !hasReturnRequest && (
                                            <span className="shrink-0 w-2 h-2 rounded-full bg-orange-400 inline-block" title="Bedarf offen" />
                                        )}
                                        {demandStatus === 'fulfilled' && (
                                            <span className="shrink-0 w-2 h-2 rounded-full bg-green-500 inline-block" title="Bedarf erfüllt" />
                                        )}
                                        {hasReturnRequest && (
                                            <span className="shrink-0 text-[8px] px-1 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200 font-medium" title="Rückgabe angefordert">
                                                Rückgabe
                                            </span>
                                        )}
                                        {!isCovered && !tsDemand && (
                                            <span className="text-[9px] text-amber-500 shrink-0">+Bedarf</span>
                                        )}
                                    </div>
                                )}
                            </DroppableCell>
                        );
                    })}
                </div>
            );
        }

        // Einfache Zelle (ohne Timeslots) — Station
        // Droppable, damit ein Springer-Chip aus der Verfügbar-Reihe hier
        // abgelegt werden kann, um die Rückgabe an den Pool anzufordern.
        const demand = cellDemands[0];
        return (
            <DroppableCell
                id={`rotationCell__${workplace.id}__${dateStr}`}
                isToday={isToday}
                isWeekend={isWeekend}
                isDisabled={false}
                isReadOnly={false}
                isAlternate={isAlternate}
                baseClassName={baseClassName}
                baseStyle={baseStyle}
                isTrainingHighlight={false}
                isBlocked={false}
                onContextMenu={demand?.status !== 'fulfilled' ? (e: any) => {
                    e.preventDefault();
                    openDemandFor(null);
                } : undefined}
            >
                {() => (
                    <div
                        className={`min-h-[40px] p-1 w-full ${demand?.status !== 'fulfilled' ? 'cursor-pointer hover:bg-amber-50/40' : ''}`}
                        onClick={() => { openDemandFor(null); }}
                    >
                        <div className="flex flex-wrap gap-1">
                            {assignments.map((assignment: any) => {
                                const empName = getEmpName(assignment);
                                const isOpenReturn = cellDemands.some(
                                    (d) => d.status === 'open'
                                        && d.return_requested_assignment_id
                                        && String(d.return_requested_assignment_id) === String(assignment.id)
                                );
                                return (
                                    <span
                                        key={assignment.id}
                                        className={`inline-block text-[10px] px-1.5 py-0.5 rounded border shadow-sm max-w-[140px] truncate ${
                                            isOpenReturn
                                                ? 'bg-purple-100 border-purple-300 text-purple-800'
                                                : 'bg-teal-100 border-teal-200 text-teal-800'
                                        }`}
                                        title={isOpenReturn ? `${empName} · Rückgabe angefordert` : empName}
                                    >
                                        {empName}
                                    </span>
                                );
                            })}
                            {demand?.status === 'open' && !demand.return_requested_assignment_id && (
                                <span className="inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                                    Bedarf offen
                                </span>
                            )}
                            {demand?.status === 'open' && demand.return_requested_assignment_id && (
                                <span className="inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                                    Rückgabe angefordert
                                </span>
                            )}
                            {demand?.status === 'fulfilled' && (
                                <span className="inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                    Erfüllt
                                </span>
                            )}
                            {!demand && (
                                <span className="text-[10px] text-amber-500 inline-flex items-center gap-0.5">+Bedarf</span>
                            )}
                        </div>
                    </div>
                )}
            </DroppableCell>
        );
    };

    const renderCellShifts = useMemo(() => (date: Date, rowName: string, isSectionFullWidth: boolean, timeslotId: string | null = null, allTimeslotIds: string[] | null = null, singleTimeslotId: string | null = null, dragIdPrefix: string = '', cellWidth: number | null = null): ReactNode => {
    // Wait for color settings to load
    if (isLoadingColors) return null;
    if (!isValid(date)) return null;
    const dateStr = format(date, 'yyyy-MM-dd');
    
        const workplace = workplaceByName.get(rowName) as any;
        const shifts = getShiftsForScheduleCell({
                shiftLookup: currentWeekShiftLookup,
                dateStr,
                rowName,
                timeslotId,
                allTimeslotIds,
                singleTimeslotId,
                timeslotsEnabled: Boolean(workplace?.timeslots_enabled),
        });

    const isSingleShift = shifts.length === 1;
    const isSplitModeActive = isEmbeddedSchedule || isSplitViewEnabled;
    const boxSize = shiftBoxSize;

    // Qualifikations-Status für diese Position ermitteln
    const wpRequiredQuals = workplace ? getWpRequiredQualIds((workplace).id) : [];
    const wpExcludedQuals = workplace ? getWpExcludedQualIds((workplace).id) : [];
    const hasQualRequirements = wpRequiredQuals.length > 0;

    // Bei Mehrfachbesetzung: Warnung nur wenn KEINER der Eingetragenen qualifiziert ist
    let anyoneQualified = false;
    if (hasQualRequirements && shifts.length > 1) {
        anyoneQualified = shifts.some((s: any) => {
            const docQuals = getDoctorQualIds(s.doctor_id);
            return wpRequiredQuals.every((qId: any) => docQuals.includes(qId));
        });
    }

    return shifts.map((shift: any, index: any) => {
        const baseDoctor = doctorById.get(shift.doctor_id)
            || springerDoctorById.get(shift.doctor_id);
        const doctor = baseDoctor && !baseDoctor._isSpringer
            ? getDoctorWithEffectiveFte(baseDoctor, shift.date)
            : baseDoctor; // springer synthetic doc — no FTE calc needed
        if (!doctor) return null;
        const compactLabel = getDoctorChipLabel(doctor);
        
        const shiftTimeLabel = getShiftTimeRangeLabel(shift, doctor, workplace, workplaceTimeslots, workTimeModelMap, centralEmployeesById);
        // Im Benutzermodus (ReadOnly) nur die Zeiten des eigenen Mitarbeiters anzeigen
        const isOwnShift = user?.doctor_id && doctor.id === user?.doctor_id;
        const effectiveTimeLabel = isReadOnly && !isOwnShift ? null : shiftTimeLabel;
        const lateRotationTooltip = lateRotationIndicatorByDoctorDay.get(`${doctor.id}__${dateStr}`) || null;
        
        // Qualifikations-Indikator
        // 'excluded' wenn Arzt eine NOT-Qualifikation hat (harter Fehler)
        // 'unqualified' wenn Pflicht-Qualifikation fehlt und kein qualifizierter Kollege da ist
        let qualificationStatus = null;
        const docQuals = getDoctorQualIds(doctor.id);
        if (wpExcludedQuals.length > 0 && wpExcludedQuals.some((qId: any) => docQuals.includes(qId))) {
            qualificationStatus = 'excluded';
        } else if (hasQualRequirements) {
            const hasAll = wpRequiredQuals.every((qId: any) => docQuals.includes(qId));
            if (!hasAll && (shifts.length === 1 || !anyoneQualified)) {
                qualificationStatus = 'unqualified';
            }
        }

        const roleColor = getRoleColor(doctor.role);
        const isDraggingThis = draggingShiftId === shift.id;
        const showCopyGhost = isCtrlPressed && isDraggingThis;
        const displayMode = getShiftDisplayMode({
            doctor,
            isSplitModeActive,
            isSingleShift,
            forceInitialsOnly: showInitialsOnly || isMonthView,
            cellWidth,
            gridFontSize: effectiveGridFontSize,
            boxSize
        });
        const isFullWidth = displayMode === 'full';

        return (
            <div key={shift.id} style={{ display: 'contents' }}>
                {showCopyGhost && (
                    <div 
                        className="flex items-center justify-center rounded-md font-bold border shadow-sm opacity-40 border-dashed border-slate-400 pointer-events-none"
                        style={{
                            fontSize: `${effectiveGridFontSize}px`,
                            backgroundColor: roleColor.backgroundColor,
                            color: roleColor.color,
                            width: isFullWidth ? '100%' : `${boxSize}px`,
                            height: isFullWidth ? '100%' : `${boxSize}px`,
                            minHeight: isFullWidth ? `${boxSize * 0.8}px` : undefined,
                            marginBottom: '4px'
                        }}
                    >
                        <span className={`${isMonthView ? 'whitespace-nowrap leading-none' : 'truncate'} px-1`}>
                            {isFullWidth ? doctor.name : compactLabel}
                        </span>
                    </div>
                )}
                <DraggableShift 
                    shift={shift} 
                    doctor={doctor} 
                    index={index}
                    draggableIdPrefix={dragIdPrefix}
                    style={roleColor}
                    displayMode={displayMode}
                    compactLabel={compactLabel}
                    isDragDisabled={isReadOnly}
                    fontSize={effectiveGridFontSize}
                    boxSize={boxSize}
                    currentUserDoctorId={user?.doctor_id as any}
                    highlightMyName={highlightMyName}
                    selectedDoctorId={selectedDoctorId}
                    isBeingDragged={isDraggingThis}
                    qualificationStatus={qualificationStatus as any}
                    fairnessInfo={shift.isPreview && !isMonthView ? getFairnessInfo(shift) : null}
                    wishMarker={getShiftWishMarker(shift)}
                    timeslotLabel={null}
                    timeLabelOverride={effectiveTimeLabel}
                    onTimeLabelClick={!shift.isPreview && !isReadOnly && (effectiveTimeLabel || (workplace)?.timeslots_enabled) ? () => { handleShiftTimeslotEdit(shift, doctor, workplace); } : null}
                    onDoubleClick={!shift.isPreview && !isReadOnly && (workplace)?.timeslots_enabled ? () => { handleShiftTimeslotEdit(shift, doctor, workplace); } : null}
                    hideTimeLabel={isReadOnly && !isOwnShift || !showSidebarTimeAccount}
                    showLateStartIndicator={Boolean(lateRotationTooltip)}
                    lateStartTooltip={lateRotationTooltip}
                />
            </div>
        );
    });
    }, [currentWeekShiftLookup, doctorById, springerDoctorById, draggingShiftId, isCtrlPressed, shiftBoxSize, effectiveGridFontSize, isReadOnly, user, highlightMyName, selectedDoctorId, showInitialsOnly, showSidebarTimeAccount, colorSettings, isLoadingColors, getRoleColor, workplaceByName, workplaceTimeslots, getDoctorQualIds, getWpRequiredQualIds, getWpExcludedQualIds, getFairnessInfo, getShiftWishMarker, isEmbeddedSchedule, isSplitViewEnabled, isMonthView, getDoctorChipLabel, lateRotationIndicatorByDoctorDay, currentWeekShifts, systemSettings, updateShiftMutation, workTimeModelMap]);

  // Render clone for shift drags from cells - matches sidebar behavior
  const renderShiftClone = useMemo(() => (provided: DraggableProvided, snapshot: DraggableStateSnapshot, rubric: DraggableRubric): ReactNode => {
        const draggableId = normalizeDraggableId(rubric.draggableId);
        if (!draggableId.startsWith('shift-')) return null;
    
    const shiftId = draggableId.replace('shift-', '');
    const shift = currentWeekShiftLookup.byId.get(shiftId);
    if (!shift) return null;
    
    const doctor = shift.doctor_id
        ? doctorById.get(shift.doctor_id)
            || springerDoctorById.get(shift.doctor_id)
        : undefined;
    if (!doctor) return null;
    const compactLabel = doctor._isSpringer ? doctor._springerLabel : getDoctorChipLabel(doctor);
    const lateRotationTooltip = lateRotationIndicatorByDoctorDay.get(`${doctor.id}__${shift.date}`) || null;
    
    const roleColor = doctor._isSpringer
        ? { backgroundColor: '#fef3c7', color: '#92400e' }
        : getRoleColor(doctor.role);
    const cloneSize = shiftBoxSize;
    
    return (
      <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        className="flex items-center justify-center"
        style={{
          ...provided.draggableProps.style,
          backgroundColor: 'transparent',
          border: 'none',
          boxShadow: 'none',
          width: `${cloneSize}px`,
          height: `${cloneSize}px`,
        }}
      >
        <div 
                    className="relative flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400"
          style={{
            backgroundColor: roleColor?.backgroundColor || '#f1f5f9',
            color: roleColor?.color || '#0f172a',
            width: `${cloneSize}px`,
            height: `${cloneSize}px`,
                        fontSize: `${effectiveGridFontSize}px`,
            zIndex: 9999,
          }}
        >
                                                                                <span>{compactLabel}</span>
                    {lateRotationTooltip && <LateAvailabilityBadge tooltip={lateRotationTooltip} compact />}
        </div>
      </div>
    );
                                }, [currentWeekShiftLookup, doctorById, springerDoctorById, getRoleColor, shiftBoxSize, effectiveGridFontSize, getDoctorChipLabel, lateRotationIndicatorByDoctorDay]);

    const renderAvailableDoctorClone = useMemo(() => (provided: DraggableProvided, snapshot: DraggableStateSnapshot, rubric: DraggableRubric): ReactNode => {
        const droppableId = stripPanelPrefix(rubric.source.droppableId || '');
        const dateStr = droppableId.startsWith('available__') ? droppableId.replace('available__', '') : null;
        const doc = dateStr ? allDisplayDocsByDate.get(dateStr)?.[rubric.source.index] : null;
        if (!doc) return null;

        const isSpringer = doc._isSpringer;
        const roleStyle = isSpringer
            ? { backgroundColor: '#fef3c7', color: '#92400e' }
            : (getRoleColor(doc.role) || { backgroundColor: '#f3f4f6', color: '#1f2937' });
        const cloneSize = shiftBoxSize;
        const label = isSpringer ? doc._springerLabel : getDoctorChipLabel(doc);

        return (
            <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                className="flex items-center justify-center"
                style={{
                    ...provided.draggableProps.style,
                    backgroundColor: 'transparent',
                    border: 'none',
                    boxShadow: 'none',
                    width: `${cloneSize}px`,
                    height: `${cloneSize}px`,
                }}
            >
                <div
                    className="relative flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400"
                    style={{
                        backgroundColor: roleStyle?.backgroundColor || '#ffffff',
                        color: roleStyle?.color || '#000000',
                        width: `${cloneSize}px`,
                        height: `${cloneSize}px`,
                        fontSize: `${effectiveGridFontSize}px`,
                        zIndex: 9999,
                    }}
                >
                    <span>{label}</span>
                </div>
            </div>
        );
    }, [allDisplayDocsByDate, effectiveGridFontSize, getDoctorChipLabel, getRoleColor, shiftBoxSize]);

  return {
    renderCrossTenantCell,
    renderLinkedWorkplaceButton,
    renderLinkedWorkplaceCellButton,
    renderRotationCell,
    renderCellShifts,
    renderShiftClone,
    renderAvailableDoctorClone,
  };
}
