import { Droppable } from '@hello-pangea/dnd';
import { Clock, AlertTriangle } from 'lucide-react';
import DraggableDoctor from './DraggableDoctor';

interface Doctor {
  id: number;
  name: string;
  role?: string;
  fte?: number | string | null;
  target_weekly_hours?: number | string | null;
  work_time_model_id?: number | null;
  [key: string]: unknown;
}

interface WorkTimeModel {
  hours_per_week: number | string;
  [key: string]: unknown;
}

interface ScheduleSidebarProps {
  sidebarDoctors: Doctor[];
  viewMode: string;
  isMonthView: boolean;
  isReadOnly: boolean;
  draggingDoctorId: number | null;
  workTimeModelMap: Map<number, WorkTimeModel>;
  weeklyPlannedHours: Map<number, number>;
  getRoleColor: (role: string | undefined) => React.CSSProperties | undefined;
  getDoctorChipLabel: (doctor: Doctor) => string;
  shiftBoxSize: number;
  effectiveGridFontSize: number;
}

/**
 * ScheduleSidebar — available-staff panel on the left side of the schedule.
 *
 * Shows the list of doctors that can be dragged onto the grid,
 * weekly hours overview, and overplanned warnings.
 */
export default function ScheduleSidebar({
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
}: ScheduleSidebarProps) {
  return (
    <div
      className={`w-full lg:w-64 flex-shrink-0 bg-white p-4 rounded-lg shadow-sm border border-slate-200 lg:sticky lg:top-4 max-h-[calc(100vh-200px)] flex flex-col gap-4 z-50 ${draggingDoctorId ? 'overflow-hidden' : 'overflow-y-auto'}`}
    >
      <div>
        <h3 className="font-semibold text-slate-700 mb-3 flex items-center">
          <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full flex items-center justify-center text-xs mr-2">
            {sidebarDoctors.length}
          </span>
          Verfügbares Personal
        </h3>

        {/* Weekly hours summary */}
        {viewMode === 'week' &&
          (() => {
            const DEFAULT_FT = 38.5;
            const getTargetHours = (d: Doctor): number | null => {
              if (d.target_weekly_hours) return Number(d.target_weekly_hours);
              const model = d.work_time_model_id
                ? workTimeModelMap.get(d.work_time_model_id)
                : null;
              if (model) return Number(model.hours_per_week);
              if (d.fte && Number(d.fte) > 0)
                return Math.round(Number(d.fte) * DEFAULT_FT * 10) / 10;
              return null;
            };
            const withHours = sidebarDoctors.filter((d) => getTargetHours(d) !== null);
            const overplanned = withHours.filter((d) => {
              const target = getTargetHours(d);
              const planned = weeklyPlannedHours.get(d.id) || 0;
              return planned > target!;
            });
            if (withHours.length === 0) return null;
            return (
              <div className="mb-3 p-2 rounded-md bg-slate-50 border border-slate-200 text-xs">
                <div className="flex items-center justify-between text-slate-600 mb-1">
                  <span className="flex items-center gap-1">
                    <Clock size={11} /> Wochenstunden
                  </span>
                  <span className="text-slate-400">{withHours.length} Mitarbeiter</span>
                </div>
                {overplanned.length > 0 && (
                  <div className="flex items-center gap-1 text-red-600 font-medium mt-1">
                    <AlertTriangle size={11} />
                    <span>{overplanned.length} überplant</span>
                  </div>
                )}
              </div>
            );
          })()}

        <Droppable
          droppableId="sidebar"
          isDropDisabled={isReadOnly}
          renderClone={(provided, snapshot, rubric) => {
            const doctor = sidebarDoctors[rubric.source.index];
            const roleStyle = getRoleColor(doctor?.role);
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
                  className="flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400"
                  style={{
                    backgroundColor: roleStyle?.backgroundColor || '#ffffff',
                    color: roleStyle?.color || '#000000',
                    width: `${cloneSize}px`,
                    height: `${cloneSize}px`,
                    fontSize: `${effectiveGridFontSize}px`,
                    zIndex: 9999,
                  }}
                >
                  <span>{getDoctorChipLabel(doctor)}</span>
                </div>
              </div>
            );
          }}
        >
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1">
              {sidebarDoctors.map((doctor, index) => (
                <DraggableDoctor
                  key={doctor.id}
                  doctor={doctor}
                  index={index}
                  style={getRoleColor(doctor.role)}
                  compactLabel={getDoctorChipLabel(doctor)}
                  isCompactMode={isMonthView}
                  isDragDisabled={isReadOnly}
                  isBeingDragged={draggingDoctorId === doctor.id}
                  workTimeModel={
                    doctor.work_time_model_id
                      ? workTimeModelMap.get(doctor.work_time_model_id)
                      : null
                  }
                  plannedHours={weeklyPlannedHours.get(doctor.id) || 0}
                />
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </div>
    </div>
  );
}
