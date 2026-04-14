// @ts-nocheck
import { format, isSameDay, isValid } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  EyeOff,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import ScheduleSidebar from './ScheduleSidebar';
import FreeTextCell from './FreeTextCell';
import DroppableCell from './DroppableCell';
import { SPLIT_DRAG_PREFIX, SPLIT_PANEL_PREFIX } from './utils/scheduleConstants';
import { withPanelPrefix } from './utils/scheduleFormatters';

export default function ScheduleBoardDesktopLayout({
  showSidebar,
  isEmbeddedSchedule,
  sidebarDoctors,
  viewMode,
  isMonthView,
  isReadOnly,
  draggingDoctorId,
  workTimeModelMap,
  weeklyPlannedHours,
  getRoleColor,
  getDoctorChipLabel,
  shiftBoxSize,
  effectiveGridFontSize,
  matrixMinWidth,
  matrixGridStyle,
  weekDays,
  currentWeekShifts,
  isPublicHoliday,
  isSchoolHoliday,
  sortDoctorsForDisplay,
  doctors,
  sections,
  handleClearDay,
  hiddenRows,
  collapsedTimeslotGroups,
  collapsedSections,
  getSectionStyle,
  getRowStyle,
  setCollapsedSections,
  getSectionName,
  activeSectionTabId,
  handleMoveSectionToTab,
  pinnedSectionTitle,
  draggingShiftId,
  workplaces,
  trainingRotations,
  getScheduleBlock,
  handleCellContextMenu,
  renderShiftClone,
  renderCellShifts,
  user,
  highlightMyName,
  getDoctorDayWishes,
  buildWishTooltip,
  scheduleNotesMap,
  scheduleNotes,
  createNoteMutation,
  updateNoteMutation,
  deleteNoteMutation,
  toggleTimeslotGroup,
  setHiddenRows,
  handleClearRow,
  canUseSplitView,
  isSplitViewEnabled,
  splitSections,
}) {
  const renderSplitMatrix = () => {
    if (!canUseSplitView || !isSplitViewEnabled || splitSections.length === 0) return null;

    return (
      <div
        className={`w-full lg:flex-1 bg-white rounded-lg shadow-sm border border-slate-200 max-h-[calc(100vh-180px)] z-0 ${draggingDoctorId ? 'overflow-hidden' : 'overflow-x-auto overflow-y-auto'}`}
      >
        <div className="min-w-[800px]">
          <div
            className={`grid ${viewMode === 'day' ? 'grid-cols-[200px_1fr]' : 'grid-cols-[200px_repeat(7,1fr)]'} border-b border-slate-200 bg-slate-50 sticky top-0 z-30 shadow-sm`}
          >
            <div className="p-3 font-semibold text-slate-700 border-r border-slate-200 flex items-center bg-slate-50">
              Bereich / Datum
            </div>
            {weekDays.map((day) => {
              if (!isValid(day)) {
                return (
                  <div key={Math.random()} className="p-2 text-center text-red-500">
                    Invalid Date
                  </div>
                );
              }

              const isToday = isSameDay(day, new Date());
              const isHoliday = isPublicHoliday(day);
              const isSchoolHol = isSchoolHoliday(day);
              let bgClass = '';

              if (isToday)
                bgClass =
                  'bg-yellow-50/30 border-x-2 border-t-2 border-yellow-400 border-b border-slate-200 text-yellow-900';
              else if (isHoliday) bgClass = 'bg-blue-100 text-blue-900';
              else if (isSchoolHol) bgClass = 'bg-green-100 text-green-900';
              else if ([0, 6].includes(day.getDay())) bgClass = 'bg-orange-50/50';

              return (
                <div
                  key={`split-${day.toISOString()}`}
                  className={`group relative p-2 text-center border-r border-slate-200 last:border-r-0 ${bgClass || 'bg-white'}`}
                >
                  <div className={`font-semibold ${isToday ? 'text-blue-700' : 'text-slate-800'}`}>
                    {format(day, 'EEEE', { locale: de })}
                  </div>
                  <div className={`text-xs ${isToday ? 'text-blue-600' : 'text-slate-500'}`}>
                    {format(day, 'dd.MM.', { locale: de })}
                  </div>
                </div>
              );
            })}
          </div>

          {splitSections.map((section, sIdx) => {
            const normalizedRows = section.rows.map((row) =>
              typeof row === 'string'
                ? {
                    name: row,
                    displayName: row,
                    timeslotId: null,
                    isTimeslotRow: false,
                    isTimeslotGroupHeader: false,
                  }
                : row,
            );
            const visibleRows = normalizedRows.filter((row) => {
              if (hiddenRows.includes(row.name)) return false;
              if (row.isTimeslotRow && collapsedTimeslotGroups.includes(row.name)) return false;
              if (row.isUnassignedRow) {
                const hasUnassignedShifts = currentWeekShifts.some(
                  (shift) => shift.position === row.name && !shift.timeslot_id,
                );
                if (!hasUnassignedShifts) return false;
              }
              return true;
            });
            if (visibleRows.length === 0) return null;

            const isCollapsed = collapsedSections.includes(section.title);
            const customStyle = getSectionStyle(section.title);

            return (
              <div key={`split-section-${sIdx}`}>
                <div
                  className={`px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-slate-200 flex items-center justify-between cursor-pointer select-none transition-colors ${!customStyle ? section.headerColor : ''}`}
                  style={customStyle ? customStyle.header : {}}
                  onClick={() =>
                    setCollapsedSections((prev) =>
                      prev.includes(section.title)
                        ? prev.filter((title) => title !== section.title)
                        : [...prev, section.title],
                    )
                  }
                >
                  <div className="flex items-center gap-2">
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                    {getSectionName(section.title)}
                  </div>
                  <span className="text-[10px] opacity-70 bg-white/20 px-2 py-0.5 rounded-full">
                    {visibleRows.length}
                  </span>
                </div>

                {!isCollapsed &&
                  visibleRows.map((rowObj, rIdx) => {
                    const rowName = rowObj.name;
                    const rowDisplayName = rowObj.displayName || rowName;
                    const rowTimeslotId = rowObj.timeslotId;
                    const isGroupHeader = rowObj.isTimeslotGroupHeader;
                    const isGroupCollapsed = collapsedTimeslotGroups.includes(rowName);
                    const rowStyle = getRowStyle(rowName, customStyle);
                    const rawHeaderDroppableId = isGroupHeader
                      ? `rowHeader__${rowName}__allTimeslots__`
                      : `rowHeader__${rowName}${rowTimeslotId ? '__' + rowTimeslotId : ''}`;
                    const headerDroppableId = withPanelPrefix(
                      rawHeaderDroppableId,
                      SPLIT_PANEL_PREFIX,
                    );

                    return (
                      <div
                        key={`split-${sIdx}-${rowDisplayName}-${rowTimeslotId || 'full'}`}
                        className={`grid ${viewMode === 'day' ? 'grid-cols-[200px_1fr]' : 'grid-cols-[200px_repeat(7,1fr)]'} border-b border-slate-200 ${draggingDoctorId || draggingShiftId ? '' : 'hover:bg-slate-50/50'} transition-colors group`}
                      >
                        <Droppable droppableId={headerDroppableId} isDropDisabled={isReadOnly}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.droppableProps}
                              className={`p-2 text-sm font-medium border-r border-slate-200 flex items-center justify-between transition-colors ${!customStyle ? section.headerColor : ''} ${snapshot.isDraggingOver ? 'ring-2 ring-inset ring-indigo-400 bg-indigo-50' : ''} ${isGroupHeader ? 'cursor-pointer' : ''}`}
                              style={customStyle ? customStyle.header : {}}
                              onClick={
                                isGroupHeader ? () => toggleTimeslotGroup(rowName) : undefined
                              }
                            >
                              <div className="flex flex-col min-w-0">
                                <span
                                  className="truncate flex items-center gap-1"
                                  title={rowDisplayName}
                                >
                                  {isGroupHeader && (
                                    <span className="text-slate-500">
                                      {isGroupCollapsed ? (
                                        <ChevronRight className="w-3 h-3 inline" />
                                      ) : (
                                        <ChevronDown className="w-3 h-3 inline" />
                                      )}
                                    </span>
                                  )}
                                  {rowObj.isTimeslotRow && !rowObj.isUnassignedRow && (
                                    <span className="text-slate-400 mr-1">↳</span>
                                  )}
                                  {rowObj.isUnassignedRow && (
                                    <span className="text-amber-500 mr-1">⚠</span>
                                  )}
                                  <span className={rowObj.isUnassignedRow ? 'text-amber-700' : ''}>
                                    {rowDisplayName}
                                  </span>
                                </span>
                              </div>
                              <div className="hidden">{provided.placeholder}</div>
                            </div>
                          )}
                        </Droppable>

                        {weekDays.map((day, dIdx) => {
                          const isWeekendDay = [0, 6].includes(day.getDay());
                          const isToday = isSameDay(day, new Date());
                          const dateStr = format(day, 'yyyy-MM-dd');
                          const rawCellId = isGroupHeader
                            ? `${dateStr}__${rowName}__allTimeslots__`
                            : rowTimeslotId
                              ? `${dateStr}__${rowName}__${rowTimeslotId}`
                              : `${dateStr}__${rowName}`;
                          const cellId = withPanelPrefix(rawCellId, SPLIT_PANEL_PREFIX);
                          let isDisabled = false;
                          let isTrainingHighlight = false;

                          if (draggingDoctorId) {
                            const activeRotations = trainingRotations.filter(
                              (rotation) =>
                                rotation.doctor_id === draggingDoctorId &&
                                rotation.start_date <= dateStr &&
                                rotation.end_date >= dateStr,
                            );
                            const isTarget = activeRotations.some(
                              (rotation) =>
                                rotation.modality === rowName ||
                                (rotation.modality === 'Röntgen' &&
                                  (rowName === 'DL/konv. Rö' || rowName.includes('Rö'))),
                            );
                            if (isTarget) isTrainingHighlight = true;
                          }

                          if (rowName !== 'Verfügbar') {
                            const setting = workplaces.find(
                              (workplace) => workplace.name === rowName,
                            );
                            if (setting) {
                              const activeDays =
                                setting.active_days && setting.active_days.length > 0
                                  ? setting.active_days
                                  : [1, 2, 3, 4, 5];
                              const isActive = isPublicHoliday(day)
                                ? activeDays.some((value) => Number(value) === 0)
                                : activeDays.some((value) => Number(value) === day.getDay());
                              if (!isActive) isDisabled = true;
                            }
                          }

                          return (
                            <div
                              key={`split-cell-${dIdx}`}
                              className="border-r border-slate-100 last:border-r-0"
                            >
                              {rowName === 'Verfügbar' ? (
                                <Droppable
                                  droppableId={withPanelPrefix(
                                    `available__${dateStr}`,
                                    SPLIT_PANEL_PREFIX,
                                  )}
                                  isDropDisabled={isReadOnly}
                                >
                                  {(provided) => {
                                    const blockingShifts = currentWeekShifts.filter((shift) => {
                                      if (shift.date !== dateStr) return false;
                                      const workplace = workplaces.find(
                                        (candidate) => candidate.name === shift.position,
                                      );
                                      if (workplace?.affects_availability === false) return false;
                                      if (workplace?.allows_rotation_concurrently === true)
                                        return false;
                                      if (workplace?.allows_rotation_concurrently === false)
                                        return true;
                                      if (
                                        workplace &&
                                        ['Dienste', 'Demonstrationen & Konsile'].includes(
                                          workplace.category,
                                        )
                                      )
                                        return false;
                                      return true;
                                    });
                                    const assignedDocIds = new Set(
                                      blockingShifts.map((shift) => shift.doctor_id),
                                    );
                                    const availableDocs = sortDoctorsForDisplay(
                                      doctors.filter(
                                        (doctor) =>
                                          !assignedDocIds.has(doctor.id) &&
                                          doctor.role !== 'Nicht-Radiologe',
                                      ),
                                    );

                                    return (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.droppableProps}
                                        className="min-h-[40px] p-1 flex flex-wrap gap-1 transition-colors"
                                      >
                                        {availableDocs.map((doc, idx) => (
                                          <Draggable
                                            key={`split-available-${doc.id}-${dateStr}`}
                                            draggableId={`${SPLIT_DRAG_PREFIX}available-doc-${doc.id}-${dateStr}`}
                                            index={idx}
                                            isDragDisabled={isReadOnly}
                                          >
                                            {(provided, snapshot) => (
                                              <div
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                {...provided.dragHandleProps}
                                                style={{
                                                  ...provided.draggableProps.style,
                                                  ...getRoleColor(doc.role),
                                                }}
                                                className={`${isMonthView ? 'text-[9px] px-1 py-0.5 max-w-[44px] whitespace-nowrap' : 'text-[10px] px-1.5 py-0.5 max-w-[100px] truncate'} rounded border shadow-sm select-none ${snapshot.isDragging ? 'opacity-50 ring-2 ring-indigo-500 z-50' : ''}`}
                                              >
                                                {getDoctorChipLabel(doc)}
                                              </div>
                                            )}
                                          </Draggable>
                                        ))}
                                        {provided.placeholder}
                                      </div>
                                    );
                                  }}
                                </Droppable>
                              ) : rowName === 'Sonstiges' ? (
                                isReadOnly ? (
                                  <div className="p-2 text-base text-slate-500 h-full min-h-[40px] whitespace-pre-wrap">
                                    {scheduleNotes.find(
                                      (note) =>
                                        note.date === format(day, 'yyyy-MM-dd') &&
                                        note.position === rowName,
                                    )?.content || ''}
                                  </div>
                                ) : (
                                  <FreeTextCell
                                    date={day}
                                    rowName={rowName}
                                    notes={scheduleNotes}
                                    onCreate={createNoteMutation}
                                    onUpdate={updateNoteMutation}
                                    onDelete={deleteNoteMutation}
                                  />
                                )
                              ) : (
                                <DroppableCell
                                  id={cellId}
                                  isToday={isToday}
                                  isWeekend={isWeekendDay}
                                  isDisabled={isDisabled}
                                  isReadOnly={isReadOnly}
                                  isAlternate={rIdx % 2 !== 0}
                                  isTrainingHighlight={isTrainingHighlight}
                                  isBlocked={!!getScheduleBlock(dateStr, rowName, rowTimeslotId)}
                                  blockReason={
                                    getScheduleBlock(dateStr, rowName, rowTimeslotId)?.reason
                                  }
                                  onContextMenu={(event) =>
                                    handleCellContextMenu(event, dateStr, rowName, rowTimeslotId)
                                  }
                                  baseClassName={
                                    !customStyle && !rowStyle.backgroundColor
                                      ? section.rowColor
                                      : ''
                                  }
                                  baseStyle={
                                    rowStyle.backgroundColor
                                      ? {
                                          backgroundColor: rowStyle.backgroundColor,
                                          color: rowStyle.color,
                                        }
                                      : {}
                                  }
                                  renderClone={renderShiftClone}
                                >
                                  {({ cellWidth }) =>
                                    renderCellShifts(
                                      day,
                                      rowName,
                                      ['Dienste', 'Demonstrationen & Konsile'].includes(
                                        section.title,
                                      ),
                                      rowTimeslotId,
                                      isGroupHeader && isGroupCollapsed
                                        ? rowObj.allTimeslotIds
                                        : null,
                                      rowObj.singleTimeslotId || null,
                                      SPLIT_DRAG_PREFIX,
                                      cellWidth,
                                    )
                                  }
                                </DroppableCell>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start relative min-h-[500px]">
      {showSidebar && !isEmbeddedSchedule && (
        <ScheduleSidebar
          sidebarDoctors={sidebarDoctors}
          viewMode={viewMode}
          isMonthView={isMonthView}
          isReadOnly={isReadOnly}
          draggingDoctorId={draggingDoctorId}
          workTimeModelMap={workTimeModelMap}
          weeklyPlannedHours={weeklyPlannedHours}
          getRoleColor={getRoleColor}
          getDoctorChipLabel={getDoctorChipLabel}
          shiftBoxSize={shiftBoxSize}
          effectiveGridFontSize={effectiveGridFontSize}
        />
      )}

      <div
        className={`w-full lg:flex-1 bg-white rounded-lg shadow-sm border border-slate-200 ${isEmbeddedSchedule ? 'max-h-[calc(100vh-120px)]' : 'max-h-[calc(100vh-180px)]'} z-0 ${draggingDoctorId ? 'overflow-hidden' : 'overflow-x-auto overflow-y-auto'}`}
      >
        <div style={{ minWidth: `${matrixMinWidth}px` }}>
          <div
            className="grid border-b border-slate-200 bg-slate-50 sticky top-0 z-30 shadow-sm"
            style={matrixGridStyle}
          >
            <div className="p-3 font-semibold text-slate-700 border-r border-slate-200 flex items-center bg-slate-50">
              Bereich / Datum
            </div>
            {weekDays.map((day) => {
              if (!isValid(day)) {
                return (
                  <div key={Math.random()} className="p-2 text-center text-red-500">
                    Invalid Date
                  </div>
                );
              }

              const isToday = isSameDay(day, new Date());
              const hasShifts = currentWeekShifts.some(
                (shift) => shift.date === format(day, 'yyyy-MM-dd'),
              );
              const isHoliday = isPublicHoliday(day);
              const isSchoolHol = isSchoolHoliday(day);

              let bgClass = '';
              if (isToday) {
                bgClass =
                  'bg-yellow-50/30 border-x-2 border-t-2 border-yellow-400 border-b border-slate-200 text-yellow-900';
              } else if (isHoliday) {
                bgClass = 'bg-blue-100 text-blue-900';
              } else if (isSchoolHol) {
                bgClass = 'bg-green-100 text-green-900';
              } else if ([0, 6].includes(day.getDay())) {
                bgClass = 'bg-orange-50/50';
              }

              const dateStr = format(day, 'yyyy-MM-dd');
              const dayShifts = currentWeekShifts.filter((shift) => shift.date === dateStr);
              const assignedDocIds = new Set(dayShifts.map((shift) => shift.doctor_id));
              const unassignedDocs = sortDoctorsForDisplay(
                doctors.filter(
                  (doctor) => !assignedDocIds.has(doctor.id) && doctor.role !== 'Nicht-Radiologe',
                ),
              );
              const rotationSection = sections.find((section) => section.title === 'Rotationen');
              const rotationRows = rotationSection ? rotationSection.rows : [];
              const filledPositions = new Set(dayShifts.map((shift) => shift.position));
              const allRotationsFilled =
                rotationRows.length > 0 && rotationRows.every((row) => filledPositions.has(row));
              const showWarning =
                allRotationsFilled &&
                unassignedDocs.length > 0 &&
                !isHoliday &&
                ![0, 6].includes(day.getDay());

              return (
                <div
                  key={day.toISOString()}
                  className={`group relative text-center border-r border-slate-200 last:border-r-0 ${isMonthView ? 'px-0.5 py-1' : 'p-2'} ${bgClass || 'bg-white'}`}
                >
                  {isMonthView ? (
                    <>
                      <div
                        className={`font-semibold leading-none ${isToday ? 'text-blue-700' : 'text-slate-800'}`}
                      >
                        {format(day, 'd', { locale: de })}
                      </div>
                      <div
                        className={`text-[10px] uppercase leading-tight mt-1 ${isToday ? 'text-blue-600' : 'text-slate-500'}`}
                      >
                        {format(day, 'EEEEE', { locale: de })}
                      </div>
                      {isHoliday && (
                        <span className="block text-[9px] opacity-75 leading-tight mt-1">FT</span>
                      )}
                      {isSchoolHol && !isHoliday && (
                        <span className="block text-[9px] opacity-75 leading-tight mt-1">
                          Ferien
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <div
                        className={`font-semibold ${isToday ? 'text-blue-700' : 'text-slate-800'}`}
                      >
                        {format(day, 'EEEE', { locale: de })}
                      </div>
                      <div className={`text-xs ${isToday ? 'text-blue-600' : 'text-slate-500'}`}>
                        {format(day, 'dd.MM.', { locale: de })}
                        {isHoliday && (
                          <span className="block text-[10px] opacity-75 leading-tight mt-1">
                            Feiertag
                          </span>
                        )}
                        {isSchoolHol && !isHoliday && (
                          <span className="block text-[10px] opacity-75 leading-tight mt-1">
                            Ferien
                          </span>
                        )}
                      </div>
                    </>
                  )}

                  {showWarning && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className="absolute top-1 left-1 p-1 rounded-full bg-amber-100 text-amber-600 hover:bg-amber-200 transition-colors"
                          title="Unbesetzte Ärzte"
                        >
                          <AlertTriangle className="w-3 h-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3">
                        <div className="space-y-2">
                          <h4 className="font-medium text-sm text-amber-800 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            Nicht eingeteilte Ärzte
                          </h4>
                          <div className="text-xs text-slate-600">
                            Folgende Ärzte haben heute noch keinen Eintrag (weder Dienst noch
                            Abwesenheit):
                          </div>
                          <ScrollArea className="h-[200px] border rounded-md bg-slate-50 p-2">
                            <div className="space-y-1">
                              {unassignedDocs.map((doc) => (
                                <div
                                  key={doc.id}
                                  className="flex items-center gap-2 text-sm text-slate-700 p-1 hover:bg-white rounded"
                                >
                                  <div
                                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${getRoleColor(doc.role).backgroundColor}`}
                                    style={{ color: getRoleColor(doc.role).color }}
                                  >
                                    {getDoctorChipLabel(doc)}
                                  </div>
                                  <span>{doc.name}</span>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}

                  {hasShifts && (
                    <button
                      onClick={() => handleClearDay(day)}
                      className="absolute top-1 right-1 p-1 rounded-full bg-white/80 text-red-400 hover:text-red-600 hover:bg-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Tag leeren"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {sections.map((section, sIdx) => {
            const normalizedRows = section.rows.map((row) =>
              typeof row === 'string'
                ? {
                    name: row,
                    displayName: row,
                    timeslotId: null,
                    isTimeslotRow: false,
                    isTimeslotGroupHeader: false,
                  }
                : row,
            );
            const visibleRows = normalizedRows.filter((row) => {
              if (hiddenRows.includes(row.name)) return false;
              if (row.isTimeslotRow && collapsedTimeslotGroups.includes(row.name)) return false;
              if (row.isUnassignedRow) {
                const hasUnassignedShifts = currentWeekShifts.some(
                  (shift) => shift.position === row.name && !shift.timeslot_id,
                );
                if (!hasUnassignedShifts) return false;
              }
              return true;
            });
            if (visibleRows.length === 0) return null;

            const isCollapsed = collapsedSections.includes(section.title);
            const customStyle = getSectionStyle(section.title);

            return (
              <div key={sIdx}>
                <div
                  className={`px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-slate-200 flex items-center justify-between cursor-pointer select-none transition-colors ${!customStyle ? section.headerColor : ''}`}
                  style={customStyle ? customStyle.header : {}}
                  onClick={() =>
                    setCollapsedSections((prev) =>
                      prev.includes(section.title)
                        ? prev.filter((title) => title !== section.title)
                        : [...prev, section.title],
                    )
                  }
                >
                  <div className="flex items-center gap-2">
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                    {getSectionName(section.title)}
                  </div>
                  <div className="flex items-center gap-2">
                    {activeSectionTabId === 'main' &&
                      section.title !== 'Archiv / Unbekannt' &&
                      section.title !== pinnedSectionTitle && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleMoveSectionToTab(section.title);
                          }}
                          className="p-1 rounded hover:bg-white/40"
                          title="In eigenen Reiter verschieben"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      )}
                    <span className="text-[10px] opacity-70 bg-white/20 px-2 py-0.5 rounded-full">
                      {visibleRows.length}
                    </span>
                  </div>
                </div>

                {!isCollapsed &&
                  visibleRows.map((rowObj, rIdx) => {
                    const rowName = rowObj.name;
                    const rowDisplayName = rowObj.displayName || rowName;
                    const rowTimeslotId = rowObj.timeslotId;
                    const isGroupHeader = rowObj.isTimeslotGroupHeader;
                    const isGroupCollapsed = collapsedTimeslotGroups.includes(rowName);
                    const rowStyle = getRowStyle(rowName, customStyle);
                    const headerDroppableId = isGroupHeader
                      ? `rowHeader__${rowName}__allTimeslots__`
                      : `rowHeader__${rowName}${rowTimeslotId ? '__' + rowTimeslotId : ''}`;

                    return (
                      <div
                        key={`${sIdx}-${rowDisplayName}-${rowTimeslotId || 'full'}`}
                        className={`grid border-b border-slate-200 ${draggingDoctorId || draggingShiftId ? '' : 'hover:bg-slate-50/50'} transition-colors group`}
                        style={matrixGridStyle}
                      >
                        <Droppable droppableId={headerDroppableId} isDropDisabled={isReadOnly}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.droppableProps}
                              className={`p-2 text-sm font-medium border-r border-slate-200 flex items-center justify-between transition-colors ${!customStyle ? section.headerColor : ''} ${snapshot.isDraggingOver ? 'ring-2 ring-inset ring-indigo-400 bg-indigo-50' : ''} ${isGroupHeader ? 'cursor-pointer' : ''}`}
                              style={customStyle ? customStyle.header : {}}
                              onClick={
                                isGroupHeader ? () => toggleTimeslotGroup(rowName) : undefined
                              }
                            >
                              <div className="flex flex-col min-w-0">
                                <span
                                  className="truncate flex items-center gap-1"
                                  title={rowDisplayName}
                                >
                                  {isGroupHeader && (
                                    <span className="text-slate-500">
                                      {isGroupCollapsed ? (
                                        <ChevronRight className="w-3 h-3 inline" />
                                      ) : (
                                        <ChevronDown className="w-3 h-3 inline" />
                                      )}
                                    </span>
                                  )}
                                  {rowObj.isTimeslotRow && !rowObj.isUnassignedRow && (
                                    <span className="text-slate-400 mr-1">↳</span>
                                  )}
                                  {rowObj.isUnassignedRow && (
                                    <span className="text-amber-500 mr-1">⚠</span>
                                  )}
                                  <span className={rowObj.isUnassignedRow ? 'text-amber-700' : ''}>
                                    {rowDisplayName}
                                  </span>
                                  {isGroupHeader && rowObj.timeslotCount && (
                                    <span className="text-[10px] text-slate-400 ml-1">
                                      ({rowObj.timeslotCount})
                                    </span>
                                  )}
                                </span>
                                {rowObj.isUnassignedRow && (
                                  <span className="text-[10px] font-normal text-amber-600">
                                    Bitte Zeitfenster zuweisen
                                  </span>
                                )}
                                {rowObj.isTimeslotRow &&
                                  !rowObj.isUnassignedRow &&
                                  rowObj.startTime && (
                                    <span className="text-[10px] font-normal opacity-80">
                                      {rowObj.startTime?.substring(0, 5)}-
                                      {rowObj.endTime?.substring(0, 5)}
                                    </span>
                                  )}
                                {!rowObj.isTimeslotRow &&
                                  workplaces.find((workplace) => workplace.name === rowName)
                                    ?.time && (
                                    <span className="text-[10px] font-normal opacity-80">
                                      {
                                        workplaces.find((workplace) => workplace.name === rowName)
                                          .time
                                      }{' '}
                                      Uhr
                                    </span>
                                  )}
                              </div>
                              <div className="flex items-center gap-0.5">
                                {!isReadOnly && rowName !== 'Verfügbar' && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-600"
                                    onClick={() => handleClearRow(rowName, rowTimeslotId)}
                                    title="Zeile leeren"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 opacity-0 group-hover:opacity-100 hover:bg-black/10"
                                  onClick={() => setHiddenRows((prev) => [...prev, rowName])}
                                  title="Zeile ausblenden"
                                >
                                  <EyeOff className="h-3 w-3 opacity-50" />
                                </Button>
                              </div>
                              <div className="hidden">{provided.placeholder}</div>
                            </div>
                          )}
                        </Droppable>
                        {weekDays.map((day, dIdx) => {
                          const isWeekend = [0, 6].includes(day.getDay());
                          const isToday = isSameDay(day, new Date());
                          const dateStr = format(day, 'yyyy-MM-dd');
                          const cellId = isGroupHeader
                            ? `${dateStr}__${rowName}__allTimeslots__`
                            : rowTimeslotId
                              ? `${dateStr}__${rowName}__${rowTimeslotId}`
                              : `${dateStr}__${rowName}`;

                          let isDisabled = false;
                          let isTrainingHighlight = false;

                          if (draggingDoctorId) {
                            const activeRotations = trainingRotations.filter(
                              (rotation) =>
                                rotation.doctor_id === draggingDoctorId &&
                                rotation.start_date <= dateStr &&
                                rotation.end_date >= dateStr,
                            );
                            const isTarget = activeRotations.some(
                              (rotation) =>
                                rotation.modality === rowName ||
                                (rotation.modality === 'Röntgen' &&
                                  (rowName === 'DL/konv. Rö' || rowName.includes('Rö'))),
                            );
                            if (isTarget) isTrainingHighlight = true;
                          }

                          if (rowName !== 'Verfügbar') {
                            const setting = workplaces.find(
                              (workplace) => workplace.name === rowName,
                            );
                            if (setting) {
                              const activeDays =
                                setting.active_days && setting.active_days.length > 0
                                  ? setting.active_days
                                  : [1, 2, 3, 4, 5];
                              const isActive = isPublicHoliday(day)
                                ? activeDays.some((value) => Number(value) === 0)
                                : activeDays.some((value) => Number(value) === day.getDay());
                              if (!isActive) isDisabled = true;
                            }
                          }

                          return (
                            <div key={dIdx} className="border-r border-slate-100 last:border-r-0">
                              {rowName === 'Verfügbar' ? (
                                <Droppable
                                  droppableId={`available__${dateStr}`}
                                  isDropDisabled={isReadOnly}
                                >
                                  {(provided, snapshot) => {
                                    const blockingShifts = currentWeekShifts.filter((shift) => {
                                      if (shift.date !== dateStr) return false;
                                      const workplace = workplaces.find(
                                        (candidate) => candidate.name === shift.position,
                                      );
                                      if (workplace?.affects_availability === false) return false;
                                      if (workplace?.allows_rotation_concurrently === true)
                                        return false;
                                      if (workplace?.allows_rotation_concurrently === false)
                                        return true;
                                      if (
                                        workplace &&
                                        ['Dienste', 'Demonstrationen & Konsile'].includes(
                                          workplace.category,
                                        )
                                      ) {
                                        return false;
                                      }
                                      return true;
                                    });

                                    const assignedDocIds = new Set(
                                      blockingShifts.map((shift) => shift.doctor_id),
                                    );
                                    const availableDocs = sortDoctorsForDisplay(
                                      doctors.filter(
                                        (doctor) =>
                                          !assignedDocIds.has(doctor.id) &&
                                          doctor.role !== 'Nicht-Radiologe',
                                      ),
                                    );

                                    return (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.droppableProps}
                                        className={`${isMonthView ? 'min-h-[32px] p-0.5 gap-0.5' : 'min-h-[40px] p-1 gap-1'} flex flex-wrap transition-colors ${snapshot.isDraggingOver ? 'bg-green-100' : 'bg-green-50/30'}`}
                                      >
                                        {availableDocs.map((doc, idx) => (
                                          <Draggable
                                            key={`available-${doc.id}-${dateStr}`}
                                            draggableId={`available-doc-${doc.id}-${dateStr}`}
                                            index={idx}
                                            isDragDisabled={isReadOnly}
                                          >
                                            {(provided, snapshot) => {
                                              let style = getRoleColor(doc.role);
                                              const doctorWishes = getDoctorDayWishes(
                                                doc.id,
                                                dateStr,
                                              );
                                              const wish = doctorWishes[0];
                                              let wishClass = '';
                                              const isCurrentUser =
                                                user?.doctor_id && doc.id === user.doctor_id;
                                              if (isCurrentUser && highlightMyName) {
                                                wishClass =
                                                  'ring-2 ring-red-500 ring-offset-1 z-10';
                                              }
                                              const tooltipText = buildWishTooltip(
                                                doc,
                                                doctorWishes,
                                              );

                                              if (wish) {
                                                if (wish.type === 'service') {
                                                  style = {
                                                    backgroundColor: '#dcfce7',
                                                    color: '#166534',
                                                  };
                                                  wishClass = 'ring-1 ring-green-500';
                                                } else if (wish.type === 'no_service') {
                                                  style = {
                                                    backgroundColor: '#fee2e2',
                                                    color: '#991b1b',
                                                  };
                                                  wishClass = 'ring-1 ring-red-500';
                                                }
                                              }

                                              return (
                                                <div
                                                  ref={provided.innerRef}
                                                  {...provided.draggableProps}
                                                  {...provided.dragHandleProps}
                                                  style={{
                                                    ...provided.draggableProps.style,
                                                    ...style,
                                                  }}
                                                  className={`${isMonthView ? 'text-[9px] px-1 py-0.5 max-w-[44px] whitespace-nowrap' : 'text-[10px] px-1.5 py-0.5 max-w-[100px] truncate'} rounded border shadow-sm select-none ${snapshot.isDragging ? 'opacity-50 ring-2 ring-indigo-500 z-50' : ''} ${wishClass}`}
                                                  title={tooltipText}
                                                >
                                                  {getDoctorChipLabel(doc)}
                                                </div>
                                              );
                                            }}
                                          </Draggable>
                                        ))}
                                        {provided.placeholder}
                                      </div>
                                    );
                                  }}
                                </Droppable>
                              ) : rowName === 'Sonstiges' ? (
                                isMonthView ? (
                                  (() => {
                                    const note = scheduleNotesMap.get(`${dateStr}|${rowName}`);
                                    const hasNote = Boolean(note?.content?.trim());
                                    return (
                                      <div
                                        className={`h-full min-h-[38px] flex items-center justify-center ${hasNote ? 'bg-purple-50/40 hover:bg-purple-100/70 cursor-help' : 'bg-purple-50/10'} transition-colors`}
                                        title={hasNote ? note.content : undefined}
                                      >
                                        {hasNote ? (
                                          <StickyNote className="w-3.5 h-3.5 text-purple-500" />
                                        ) : null}
                                      </div>
                                    );
                                  })()
                                ) : isReadOnly ? (
                                  <div className="p-2 text-base text-slate-500 h-full min-h-[40px] whitespace-pre-wrap">
                                    {scheduleNotesMap.get(`${dateStr}|${rowName}`)?.content || ''}
                                  </div>
                                ) : (
                                  <FreeTextCell
                                    date={day}
                                    rowName={rowName}
                                    notes={scheduleNotes}
                                    onCreate={createNoteMutation}
                                    onUpdate={updateNoteMutation}
                                    onDelete={deleteNoteMutation}
                                  />
                                )
                              ) : (
                                <DroppableCell
                                  id={cellId}
                                  isCompact={isMonthView}
                                  isToday={isToday}
                                  isWeekend={isWeekend}
                                  isDisabled={isDisabled}
                                  isReadOnly={isReadOnly}
                                  isAlternate={rIdx % 2 !== 0}
                                  isTrainingHighlight={isTrainingHighlight}
                                  isBlocked={!!getScheduleBlock(dateStr, rowName, rowTimeslotId)}
                                  blockReason={
                                    getScheduleBlock(dateStr, rowName, rowTimeslotId)?.reason
                                  }
                                  onContextMenu={(event) =>
                                    handleCellContextMenu(event, dateStr, rowName, rowTimeslotId)
                                  }
                                  baseClassName={
                                    !customStyle && !rowStyle.backgroundColor
                                      ? section.rowColor
                                      : ''
                                  }
                                  baseStyle={
                                    rowStyle.backgroundColor
                                      ? {
                                          backgroundColor: rowStyle.backgroundColor,
                                          color: rowStyle.color,
                                        }
                                      : {}
                                  }
                                  renderClone={renderShiftClone}
                                >
                                  {({ cellWidth }) =>
                                    renderCellShifts(
                                      day,
                                      rowName,
                                      ['Dienste', 'Demonstrationen & Konsile'].includes(
                                        section.title,
                                      ),
                                      rowTimeslotId,
                                      isGroupHeader && isGroupCollapsed
                                        ? rowObj.allTimeslotIds
                                        : null,
                                      rowObj.singleTimeslotId || null,
                                      '',
                                      cellWidth,
                                    )
                                  }
                                </DroppableCell>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>
      {renderSplitMatrix()}
    </div>
  );
}
