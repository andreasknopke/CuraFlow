import React, { useState, useEffect, memo } from 'react';
import { format, getDaysInMonth, setDate, setMonth, setYear, isWeekend, isSameDay, isWithinInterval } from 'date-fns';
import { de } from 'date-fns/locale';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';

// Memoized Cell Component for Training Overview
const TrainingOverviewCell = memo(({ 
    date, 
    doctor, 
    status, 
    isWeekend: isWknd, 
    isHoliday, 
    isSchoolHoliday, 
    customColors, 
    dragInfo, 
    onMouseDown, 
    onMouseEnter, 
    onToggle 
}) => {
    const { isDragging, dragStart, dragCurrent, dragDoctorId } = dragInfo;

    const isRowInvolved = isDragging && dragDoctorId === doctor.id;
    
    const isDragged = isRowInvolved && dragStart && dragCurrent && isWithinInterval(date, {
        start: dragStart < dragCurrent ? dragStart : dragCurrent,
        end: dragCurrent > dragStart ? dragCurrent : dragStart
    });

    let style = {};
    let cellClass = "cursor-pointer hover:opacity-80 transition-opacity select-none";

    if (status && customColors[status]) {
        // Use Tailwind bg class
        const colorClass = customColors[status];
        cellClass += ` ${colorClass} text-white`;
    } else if (!status) {
        if (isHoliday) cellClass += " bg-blue-200/70";
        else if (isWknd) cellClass += " bg-slate-200/70";
        else if (isSchoolHoliday) cellClass += " bg-green-200/50";
        else cellClass += " hover:bg-slate-100";
    }

    if (isDragged) {
        cellClass += " ring-2 ring-indigo-400 ring-offset-1 z-20 opacity-80 relative";
    }

    return (
        <td 
            className={`border-b border-r p-0 text-center text-[10px] h-6 ${cellClass}`}
            style={style}
            title={status ? `${status} - ${doctor.name}` : (isHoliday ? 'Feiertag' : isSchoolHoliday ? 'Ferien' : format(date, 'dd.MM.'))}
            onMouseDown={(e) => {
                if(e.button === 0) onMouseDown(date, doctor.id);
            }}
            onMouseEnter={() => onMouseEnter(date, doctor.id)}
            onClick={(e) => onToggle(date, status, doctor.id, e)}
        >
        </td>
    );
}, (prevProps, nextProps) => {
    if (
        prevProps.status !== nextProps.status ||
        prevProps.isWeekend !== nextProps.isWeekend ||
        prevProps.isHoliday !== nextProps.isHoliday ||
        prevProps.isSchoolHoliday !== nextProps.isSchoolHoliday ||
        prevProps.customColors !== nextProps.customColors
    ) {
        return false;
    }

    const prevDrag = prevProps.dragInfo;
    const nextDrag = nextProps.dragInfo;

    if (
        prevDrag.isDragging === nextDrag.isDragging &&
        prevDrag.dragDoctorId === nextDrag.dragDoctorId &&
        prevDrag.dragStart === nextDrag.dragStart &&
        prevDrag.dragCurrent === nextDrag.dragCurrent
    ) {
        return true;
    }

    const prevInvolved = prevDrag.isDragging && prevDrag.dragDoctorId === prevProps.doctor.id;
    const nextInvolved = nextDrag.isDragging && nextDrag.dragDoctorId === nextProps.doctor.id;

    if (!prevInvolved && !nextInvolved) {
        return true;
    }

    return false;
});

export default function TrainingOverview({ 
    year, 
    doctors, 
    rotations,
    isSchoolHoliday, 
    isPublicHoliday, 
    customColors = {}, 
    onToggle, 
    onRangeSelect, 
    activeType, 
    isReadOnly, 
    monthsPerRow = 3 
}) {
    const [dragStart, setDragStart] = useState(null);
    const [dragCurrent, setDragCurrent] = useState(null);
    const [dragDoctorId, setDragDoctorId] = useState(null);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const handleMouseUp = () => {
            if (isDragging) {
                if (dragStart && dragCurrent && dragDoctorId && !isSameDay(dragStart, dragCurrent)) {
                    onRangeSelect && onRangeSelect(dragStart, dragCurrent, dragDoctorId);
                }
                setIsDragging(false);
                setDragStart(null);
                setDragCurrent(null);
                setDragDoctorId(null);
            }
        };
        window.addEventListener('mouseup', handleMouseUp);
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, [isDragging, dragStart, dragCurrent, dragDoctorId, onRangeSelect]);

    const handleMouseDown = React.useCallback((date, doctorId) => {
        if (isReadOnly) return;
        setDragStart(date);
        setDragCurrent(date);
        setDragDoctorId(doctorId);
        setIsDragging(true);
    }, [isReadOnly]);

    const handleMouseEnter = React.useCallback((date, doctorId) => {
        setDragCurrent(prev => {
            if (prev && isSameDay(prev, date)) return prev;
            return date;
        });
    }, []);
    
    const handleToggle = React.useCallback((date, status, docId, e) => {
        if (!isDragging || (dragStart && dragCurrent && isSameDay(dragStart, dragCurrent))) {
            onToggle && onToggle(date, status, docId, e);
        }
    }, [isDragging, dragStart, dragCurrent, onToggle]);

    // Build a lookup map: "yyyy-MM-dd_doctorId" -> modality
    const rotationLookup = React.useMemo(() => {
        const lookup = new Map();
        rotations.forEach(rot => {
            // Expand the range into daily entries
            const start = new Date(rot.start_date);
            const end = new Date(rot.end_date);
            
            // Only process if overlaps with selected year
            const yearStart = new Date(year, 0, 1);
            const yearEnd = new Date(year, 11, 31);
            
            if (start > yearEnd || end < yearStart) return;
            
            const effectiveStart = start < yearStart ? yearStart : start;
            const effectiveEnd = end > yearEnd ? yearEnd : end;
            
            let current = new Date(effectiveStart);
            while (current <= effectiveEnd) {
                const dateStr = format(current, 'yyyy-MM-dd');
                lookup.set(`${dateStr}_${rot.doctor_id}`, rot.modality);
                current = new Date(current);
                current.setDate(current.getDate() + 1);
            }
        });
        return lookup;
    }, [rotations, year]);

    const getStatus = React.useCallback((date, doctorId) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return rotationLookup.get(`${dateStr}_${doctorId}`) || null;
    }, [rotationLookup]);

    const monthChunks = React.useMemo(() => {
        const chunks = [];
        for (let i = 0; i < 12; i += monthsPerRow) {
            const chunk = [];
            for (let j = 0; j < monthsPerRow && (i + j) < 12; j++) {
                chunk.push(i + j);
            }
            chunks.push(chunk);
        }
        return chunks;
    }, [monthsPerRow]);

    const dragInfo = React.useMemo(() => ({
        isDragging,
        dragStart,
        dragCurrent,
        dragDoctorId
    }), [isDragging, dragStart, dragCurrent, dragDoctorId]);

    return (
        <div className="space-y-8">
            {monthChunks.map((months, qIdx) => (
                <div key={qIdx} className="border rounded-lg overflow-hidden shadow-sm bg-white">
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-xs table-fixed">
                            <thead>
                                {/* Month Headers */}
                                <tr>
                                    <th className="sticky left-0 z-20 bg-slate-100 border-b border-r p-2 w-[150px] min-w-[150px] text-left">
                                        Mitarbeiter
                                    </th>
                                    {months.map(m => {
                                        const date = setMonth(setYear(new Date(), year), m);
                                        const daysInMonth = getDaysInMonth(date);
                                        return (
                                            <th key={m} colSpan={daysInMonth} className="border-b border-r bg-slate-50 p-1 text-center font-bold text-slate-700">
                                                {format(date, 'MMMM yyyy', { locale: de })}
                                            </th>
                                        );
                                    })}
                                </tr>
                                {/* Day Headers */}
                                <tr>
                                    <th className="sticky left-0 z-20 bg-slate-100 border-b border-r p-1"></th>
                                    {months.map(m => {
                                        const date = setMonth(setYear(new Date(), year), m);
                                        const daysInMonth = getDaysInMonth(date);
                                        return Array.from({ length: daysInMonth }).map((_, i) => {
                                            const d = setDate(date, i + 1);
                                            const isWknd = isWeekend(d);
                                            const isHol = isPublicHoliday ? isPublicHoliday(d) : false;
                                            const isSchool = isSchoolHoliday ? isSchoolHoliday(d) : false;
                                            let headerClass = isHol ? 'bg-blue-100 text-blue-700' : isWknd ? 'bg-slate-100 text-slate-500' : 'bg-white';
                                            if (isSchool && !isHol && !isWknd) headerClass = 'bg-green-50 text-green-700';
                                            
                                            return (
                                                <th key={`${m}-${i}`} className={`relative border-b border-r p-0.5 text-[10px] text-center w-[22px] min-w-[22px] ${headerClass}`}>
                                                    {i + 1}
                                                </th>
                                            );
                                        });
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {doctors.map(doc => (
                                    <tr key={doc.id} className="hover:bg-slate-50">
                                        <td className="sticky left-0 z-10 bg-white border-b border-r p-1 px-2 font-medium text-slate-700 truncate">
                                            {doc.name}
                                        </td>
                                        {months.map(m => {
                                            const date = setMonth(setYear(new Date(), year), m);
                                            const daysInMonth = getDaysInMonth(date);
                                            return Array.from({ length: daysInMonth }).map((_, i) => {
                                                const d = setDate(date, i + 1);
                                                const isWknd = isWeekend(d);
                                                const isHol = isPublicHoliday ? isPublicHoliday(d) : false;
                                                const isSchool = isSchoolHoliday ? isSchoolHoliday(d) : false;
                                                const status = getStatus(d, doc.id);

                                                return (
                                                    <TrainingOverviewCell
                                                        key={`${doc.id}-${m}-${i}`}
                                                        date={d}
                                                        doctor={doc}
                                                        status={status}
                                                        isWeekend={isWknd}
                                                        isHoliday={isHol}
                                                        isSchoolHoliday={isSchool}
                                                        customColors={customColors}
                                                        dragInfo={dragInfo}
                                                        onMouseDown={handleMouseDown}
                                                        onMouseEnter={handleMouseEnter}
                                                        onToggle={handleToggle}
                                                    />
                                                );
                                            });
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}
        </div>
    );
}
