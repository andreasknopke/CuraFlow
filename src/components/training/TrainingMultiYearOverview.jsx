import React, { useState, useEffect, useCallback } from 'react';
import { eachDayOfInterval, endOfMonth, endOfYear, format, getDaysInMonth, setMonth, setYear, startOfMonth, startOfYear } from 'date-fns';
import { de } from 'date-fns/locale';
import { getContractTooltipLabel, isDateWithinContract } from '@/components/training/trainingContractUtils';

const MONTHS = Array.from({ length: 12 }, (_, monthIndex) => monthIndex);
const DISABLED_SEGMENT = '__disabled__';

function getSegmentStyle(modality, customColors) {
  if (modality === DISABLED_SEGMENT) {
    return {
      backgroundColor: '#e2e8f0',
      color: '#94a3b8',
      backgroundImage: 'repeating-linear-gradient(135deg, rgba(148, 163, 184, 0.28) 0, rgba(148, 163, 184, 0.28) 4px, transparent 4px, transparent 10px)',
    };
  }

  if (!modality) {
    return {
      backgroundColor: 'rgba(226, 232, 240, 0.7)',
      color: '#64748b',
    };
  }

  const colorConfig = customColors[modality];
  if (colorConfig && typeof colorConfig === 'object') {
    return {
      backgroundColor: colorConfig.backgroundColor,
      color: colorConfig.color,
    };
  }

  return {
    backgroundColor: '#cbd5e1',
    color: '#0f172a',
  };
}

function buildMonthTooltip({ doctorName, year, monthDate, segments, daysInMonth }) {
  const monthLabel = format(monthDate, 'LLLL yyyy', { locale: de });
  const summary = segments
    .map((segment) => `${segment.modality === DISABLED_SEGMENT ? 'außer Vertrag' : (segment.modality || 'Frei')}: ${segment.days} ${segment.days === 1 ? 'Tag' : 'Tage'}`)
    .join(' | ');

  return `${doctorName} – ${monthLabel}\n${summary || `Frei: ${daysInMonth} Tage`}`;
}

function isMonthWithinContract(monthDate, contractInfo) {
  if (!contractInfo || !contractInfo.contractStart) {
    return true;
  }
  const contractStart = new Date(contractInfo.contractStart);
  const contractEnd = contractInfo.contractEnd ? new Date(contractInfo.contractEnd) : new Date(contractInfo.contractStart);
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  return monthStart <= contractEnd && monthEnd >= contractStart;
}

export default function TrainingMultiYearOverview({
  centerYear,
  doctors,
  rotations,
  contractInfoByDoctorId = {},
  customColors = {},
  yearsToShow = 3,
  activeModality,
  onMonthClick,
  onRangeSelect,
  isReadOnly = false,
  isMutating = false,
  getDoctorContractInfo,
}) {
  const [dragStart, setDragStart] = useState(null);
  const [dragCurrent, setDragCurrent] = useState(null);

  const visibleYears = React.useMemo(() => {
    const offset = Math.floor(yearsToShow / 2);
    return Array.from({ length: yearsToShow }, (_, index) => centerYear - offset + index);
  }, [centerYear, yearsToShow]);

  const rotationLookup = React.useMemo(() => {
    const lookup = new Map();
    const firstYear = visibleYears[0];
    const lastYear = visibleYears[visibleYears.length - 1];
    const visibleStart = startOfYear(new Date(firstYear, 0, 1));
    const visibleEnd = endOfYear(new Date(lastYear, 0, 1));

    rotations.forEach((rotation) => {
      const start = new Date(rotation.start_date);
      const end = new Date(rotation.end_date);

      if (start > visibleEnd || end < visibleStart) {
        return;
      }

      const effectiveStart = start < visibleStart ? visibleStart : start;
      const effectiveEnd = end > visibleEnd ? visibleEnd : end;

      eachDayOfInterval({ start: effectiveStart, end: effectiveEnd }).forEach((day) => {
        lookup.set(`${rotation.doctor_id}_${format(day, 'yyyy-MM-dd')}`, rotation.modality || null);
      });
    });

    return lookup;
  }, [rotations, visibleYears]);

  const monthCells = React.useMemo(() => {
    return doctors.map((doctor) => {
      const cells = visibleYears.flatMap((year) => {
        return MONTHS.map((monthIndex) => {
          const monthDate = new Date(year, monthIndex);
          const monthStart = startOfMonth(monthDate);
          const monthEnd = endOfMonth(monthDate);
          const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
          const daysInMonth = getDaysInMonth(monthDate);
          const segments = [];
          const contractInfo = contractInfoByDoctorId[doctor.id];

          days.forEach((day) => {
            const dateKey = `${doctor.id}_${format(day, 'yyyy-MM-dd')}`;
            const modality = isDateWithinContract(day, contractInfo?.contractStart, contractInfo?.contractEnd)
              ? (rotationLookup.get(dateKey) || null)
              : DISABLED_SEGMENT;
            const lastSegment = segments[segments.length - 1];

            if (!lastSegment || lastSegment.modality !== modality) {
              segments.push({ modality, days: 1 });
            } else {
              lastSegment.days += 1;
            }
          });

          return {
            key: `${doctor.id}-${year}-${monthIndex}`,
            year,
            monthIndex,
            monthDate,
            daysInMonth,
            contractEndOffsetPercent: contractInfo?.contractEnd && contractInfo.contractEnd.startsWith(`${year}-${String(monthIndex + 1).padStart(2, '0')}-`)
              ? `${Math.min((Number(contractInfo.contractEnd.slice(-2)) / daysInMonth) * 100, 100)}%`
              : null,
            segments,
            tooltip: buildMonthTooltip({
              doctorName: doctor.name,
              year,
              monthDate,
              segments,
              daysInMonth,
            }),
          };
        });
      });

      return {
        doctor,
        cells,
      };
    });
  }, [contractInfoByDoctorId, doctors, rotationLookup, visibleYears]);

  // Drag selection helpers
  const isCellInDragSelection = useCallback((cell, doctorId, dragStart, dragCurrent) => {
    if (!dragStart || !dragCurrent) return false;
    if (dragStart.doctorId !== doctorId) return false;
    const startIndex = dragStart.year * 12 + dragStart.month;
    const endIndex = dragCurrent.year * 12 + dragCurrent.month;
    const cellIndex = cell.year * 12 + cell.monthIndex;
    const min = Math.min(startIndex, endIndex);
    const max = Math.max(startIndex, endIndex);
    return cellIndex >= min && cellIndex <= max;
  }, []);

  // Global mouse event listeners for drag selection
  useEffect(() => {
    if (!dragStart) return;

    const handleMouseMove = (e) => {
      const target = e.target.closest('td[data-doctor-id]');
      if (target) {
        const doctorId = target.dataset.doctorId;
        const year = parseInt(target.dataset.year, 10);
        const month = parseInt(target.dataset.month, 10);
        if (doctorId === dragStart.doctorId) {
          setDragCurrent({ doctorId, year, month });
        }
      }
    };

    const handleMouseUp = () => {
      if (dragCurrent && (dragCurrent.year !== dragStart.year || dragCurrent.month !== dragStart.month)) {
        if (typeof onRangeSelect === 'function') {
          const startDate = new Date(dragStart.year, dragStart.month);
          const endDate = new Date(dragCurrent.year, dragCurrent.month);
          onRangeSelect(dragStart.doctorId, startDate, endDate);
        }
      } else {
        if (typeof onMonthClick === 'function') {
          onMonthClick(dragStart.doctorId, dragStart.year, dragStart.month);
        }
      }
      setDragStart(null);
      setDragCurrent(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragStart, dragCurrent, onMonthClick, onRangeSelect]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full min-w-[1600px] table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-[220px]" />
            {visibleYears.flatMap((year) =>
              MONTHS.map((monthIndex) => (
                <col key={`col-${year}-${monthIndex}`} className="w-[38px]" />
              )),
            )}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 z-30 w-[220px] min-w-[220px] border-b border-r border-slate-200 bg-slate-100 p-3 text-left font-semibold text-slate-700">
                Mitarbeiter
              </th>
              {visibleYears.map((year) => (
                <th
                  key={year}
                  colSpan={12}
                  className="border-b border-r border-slate-200 bg-slate-50 p-2 text-center text-sm font-semibold text-slate-700"
                >
                  {year}
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 z-30 border-b border-r border-slate-200 bg-slate-100 p-2"></th>
              {visibleYears.flatMap((year) =>
                MONTHS.map((monthIndex) => (
                  <th
                    key={`${year}-${monthIndex}`}
                    className={`w-[38px] border-b border-r p-2 text-center font-medium text-slate-600 ${monthIndex === 11 ? 'border-r-slate-300' : 'border-r-slate-200'} bg-white`}
                  >
                    {format(new Date(year, monthIndex), 'MMM', { locale: de })}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {monthCells.map(({ doctor, cells }) => (
              <tr key={doctor.id} className="hover:bg-slate-50/60">
                <td className="sticky left-0 z-20 border-b border-r border-slate-200 bg-white p-3 text-slate-700">
                  <div className="truncate font-medium" title={getContractTooltipLabel(contractInfoByDoctorId[doctor.id]) || undefined}>{doctor.name}</div>
                </td>
                {cells.map((cell) => {
                  const contractInfo = getDoctorContractInfo ? getDoctorContractInfo(doctor.id) : contractInfoByDoctorId[doctor.id];
                  const monthWithinContract = isMonthWithinContract(cell.monthDate, contractInfo);
                  const clickable = !isReadOnly && !isMutating && activeModality && monthWithinContract && typeof onMonthClick === 'function';
                  const selected = isCellInDragSelection(cell, doctor.id, dragStart, dragCurrent);
                  return (
                    <td
                      key={cell.key}
                      data-doctor-id={doctor.id}
                      data-year={cell.year}
                      data-month={cell.monthIndex}
                      className={`w-[38px] border-b border-r border-slate-200 p-1 align-middle ${cell.monthIndex === 11 ? 'border-r-slate-300' : ''} ${clickable ? 'cursor-pointer hover:bg-slate-100' : ''} ${selected ? 'bg-blue-100' : ''}`}
                      title={cell.tooltip}
                      onMouseDown={clickable ? (e) => { e.preventDefault(); setDragStart({ doctorId: doctor.id, year: cell.year, month: cell.monthIndex }); setDragCurrent({ doctorId: doctor.id, year: cell.year, month: cell.monthIndex }); } : undefined}
                    >
                      <div className="relative flex h-8 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                        {cell.segments.map((segment, index) => {
                          const style = getSegmentStyle(segment.modality, customColors);
                          const width = `${(segment.days / cell.daysInMonth) * 100}%`;
                          return (
                            <div
                              key={`${cell.key}-${index}`}
                              className="h-full"
                              style={{
                                width,
                                backgroundColor: style.backgroundColor,
                                color: style.color,
                                backgroundImage: style.backgroundImage,
                              }}
                            />
                          );
                        })}
                        {cell.contractEndOffsetPercent && (
                          <span
                            className="pointer-events-none absolute inset-y-0 z-10 w-[2px] -translate-x-1/2 bg-rose-500"
                            style={{ left: cell.contractEndOffsetPercent }}
                            aria-hidden="true"
                          />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
