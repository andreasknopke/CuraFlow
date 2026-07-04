import React, { useState, useEffect, memo } from 'react';
import { format, getDaysInMonth, setDate, setMonth, setYear, isWeekend, isSameDay, isWithinInterval } from 'date-fns';
import { de } from 'date-fns/locale';
import { AlertTriangle } from 'lucide-react';
import { StickyHorizontalScrollbar } from '@/components/ui/sticky-horizontal-scrollbar';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getContractTooltipLabel, isDateWithinContract } from '@/components/training/trainingContractUtils';
import { parseAnnualVacationDays } from './vacationBalance';
import type { Doctor, ShiftEntry } from '@/types';

interface ContractInfo {
  contractStart?: string;
  contractEnd?: string;
}

interface AvailabilityThreshold {
  qualificationId: string;
  qualificationName?: string;
  min: number;
}

interface DragInfo {
  isDragging: boolean;
  dragStart: Date | null;
  dragCurrent: Date | null;
  dragDoctorId: string | null;
}

interface VacationOverviewCellProps {
  date: Date;
  doctor: Doctor & { vacation_days?: number };
  status: string | null;
  contractInfo: ContractInfo | null;
  isWeekend: boolean;
  isHoliday: boolean;
  isSchoolHoliday: boolean;
  visibleTypes: string[];
  customColors: Record<string, React.CSSProperties>;
  dragInfo: DragInfo;
  onMouseDown: (date: Date, doctorId: string) => void;
  onMouseEnter: (date: Date, doctorId: string) => void;
  onToggle: (date: Date, status: string | null, doctorId: string, e: React.MouseEvent) => void;
}

interface QualificationMapEntry {
  id: string;
  name: string;
}

interface DoctorQualEntry {
  qualification_id: string;
}

interface VacationOverviewProps {
  year: number;
  doctors: (Doctor & { vacation_days?: number })[];
  shifts: ShiftEntry[];
  contractInfoByDoctorId?: Record<string, ContractInfo>;
  entitlementByDoctorId?: Record<string, number>;
  isSchoolHoliday: (date: Date) => boolean;
  isPublicHoliday: (date: Date) => boolean;
  visibleTypes?: string[];
  customColors?: Record<string, React.CSSProperties>;
  onToggle?: (date: Date, status: string | null, doctorId: string, e: React.MouseEvent) => void;
  onRangeSelect?: (start: Date, end: Date, doctorId: string) => void;
  activeType?: string;
  isReadOnly?: boolean;
  monthsPerRow?: number;
  availabilityThresholds?: AvailabilityThreshold[];
  qualificationMap?: Record<string, QualificationMapEntry>;
  doctorQualByDoctor?: Record<string, DoctorQualEntry[]>;
}

// Memoized Cell Component
const VacationOverviewCell = memo(function VacationOverviewCell({
    date,
    doctor,
    status,
    contractInfo,
    isWeekend,
    isHoliday,
    isSchoolHoliday,
    visibleTypes,
    customColors,
    dragInfo,
    onMouseDown,
    onMouseEnter,
    onToggle
}: VacationOverviewCellProps) {
    const { isDragging, dragStart, dragCurrent, dragDoctorId } = dragInfo;
    const isDisabled = !isDateWithinContract(date, contractInfo?.contractStart, contractInfo?.contractEnd);
    const isContractEnd = Boolean(contractInfo?.contractEnd) && format(date, 'yyyy-MM-dd') === contractInfo.contractEnd;

    // Only calculate isDragged if the drag is happening on this doctor's row
    const isRowInvolved = isDragging && dragDoctorId === doctor.id;
    
    const isDragged = isRowInvolved && dragStart && dragCurrent && isWithinInterval(date, {
        start: dragStart < dragCurrent ? dragStart : dragCurrent,
        end: dragCurrent > dragStart ? dragCurrent : dragStart
    });

    let content = "";
    let style: React.CSSProperties = {};
    let cellClass = "cursor-pointer hover:opacity-80 transition-opacity select-none relative";

    const isVisible = status && (visibleTypes.length === 0 || visibleTypes.includes(status));

    if (isDisabled) {
        style = {
            backgroundColor: '#f8fafc',
            backgroundImage: 'repeating-linear-gradient(135deg, rgba(148, 163, 184, 0.22) 0, rgba(148, 163, 184, 0.22) 4px, transparent 4px, transparent 10px)'
        };
        cellClass += " text-slate-300 cursor-not-allowed";
    } else if (isVisible) {
        if (customColors[status]) {
            style = customColors[status];
        } else {
            // Fallback legacy hardcoded
            if (status === 'Urlaub') cellClass += " bg-green-500 text-white";
            else if (status === 'Krank') cellClass += " bg-red-500 text-white";
            else if (status === 'Frei') cellClass += " bg-slate-500 text-white";
            else if (status === 'Dienstreise') cellClass += " bg-blue-500 text-white";
            else if (status === 'Nicht verfügbar') cellClass += " bg-orange-500 text-white";
        }
    } else {
        // Stronger background for weekends/holidays/school holidays
        if (isHoliday) cellClass += " bg-blue-200/70";
        else if (isWeekend) cellClass += " bg-slate-200/70";
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
            title={isDisabled ? `Außerhalb der Vertragslaufzeit ${format(date, 'dd.MM.yyyy')}` : (isVisible ? status : (isHoliday ? 'Feiertag' : isSchoolHoliday ? 'Ferien' : format(date, 'dd.MM.')))}
            onMouseDown={(e) => {
                if (!isDisabled && e.button === 0) onMouseDown(date, doctor.id);
            }}
            onMouseEnter={() => {
                if (!isDisabled) onMouseEnter(date, doctor.id);
            }}
            onClick={(e) => {
                if (!isDisabled) onToggle(date, status, doctor.id, e);
            }}
        >
            {content}
            {isContractEnd && (
                <span className="pointer-events-none absolute inset-y-0 right-0 w-[2px] bg-rose-500" aria-hidden="true" />
            )}
        </td>
    );
}, function areEqual(prevProps: VacationOverviewCellProps, nextProps: VacationOverviewCellProps): boolean {
    // Custom comparison function for performance
    
    // Check basic props first
    if (
        prevProps.status !== nextProps.status ||
        prevProps.contractInfo !== nextProps.contractInfo ||
        prevProps.isWeekend !== nextProps.isWeekend ||
        prevProps.isHoliday !== nextProps.isHoliday ||
        prevProps.isSchoolHoliday !== nextProps.isSchoolHoliday ||
        prevProps.visibleTypes !== nextProps.visibleTypes || // Array reference check
        prevProps.customColors !== nextProps.customColors // Object reference check
    ) {
        return false; // Re-render
    }

    // Check drag state
    const prevDrag = prevProps.dragInfo;
    const nextDrag = nextProps.dragInfo;

    // If drag state didn't change at all, no need to re-render
    if (
        prevDrag.isDragging === nextDrag.isDragging &&
        prevDrag.dragDoctorId === nextDrag.dragDoctorId &&
        prevDrag.dragStart === nextDrag.dragStart &&
        prevDrag.dragCurrent === nextDrag.dragCurrent
    ) {
        return true; // Equal
    }

    // Drag state changed.
    // If neither previous nor next drag involves this doctor, we don't need to re-render
    // (unless we were previously dragged, but that's covered by isDragging/dragDoctorId check above)
    const prevInvolved = prevDrag.isDragging && prevDrag.dragDoctorId === prevProps.doctor.id;
    const nextInvolved = nextDrag.isDragging && nextDrag.dragDoctorId === nextProps.doctor.id;

    if (!prevInvolved && !nextInvolved) {
        return true; // No visual change for this cell
    }

    // If we are involved in the drag, we must re-render to update selection
    return false;
});

export default function VacationOverview({ year, doctors, shifts, contractInfoByDoctorId = {}, entitlementByDoctorId = {}, isSchoolHoliday, isPublicHoliday, visibleTypes = [], customColors = {}, onToggle, onRangeSelect, activeType, isReadOnly, monthsPerRow = 3, availabilityThresholds = [], qualificationMap = {}, doctorQualByDoctor = {} }: VacationOverviewProps) {
    
    const [dragStart, setDragStart] = useState<Date | null>(null);
    const [dragCurrent, setDragCurrent] = useState<Date | null>(null);
    const [dragDoctorId, setDragDoctorId] = useState<string | null>(null);
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

    const handleMouseDown = React.useCallback((date: Date, doctorId: string) => {
        if (isReadOnly) return;
        setDragStart(date);
        setDragCurrent(date);
        setDragDoctorId(doctorId);
        setIsDragging(true);
    }, [isReadOnly]);

    const handleMouseEnter = React.useCallback((date: Date, _doctorId: string) => {
        // Only update state if it's relevant to avoid renders?
        // But we need to update dragCurrent to visualize.
        // The Cell component memoization will prevent full table re-render.
        setDragCurrent(prev => {
            // Optimization: if date hasn't changed (mousemove within same cell), don't update
            if (prev && isSameDay(prev, date)) return prev;
            return date;
        });
    }, []);
    
    // Optimize shift lookup
    const shiftLookup = React.useMemo(() => {
        const lookup = new Map<string, string>();
        shifts.forEach(s => {
            lookup.set(`${s.date}_${s.doctor_id}`, s.position);
        });
        return lookup;
    }, [shifts]);

    // Helper to check status using lookup
    const getStatus = React.useCallback((date: Date, doctorId: string): string | null => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return shiftLookup.get(`${dateStr}_${doctorId}`) || null;
    }, [shiftLookup]);

    // Hilfsfunktion: gibt die Qualifikations-IDs eines Arztes zurück
    const getDoctorQualificationIds = React.useCallback((doctorId: string): string[] => {
        // 1. Explizite Qualifikationen aus der Join-Tabelle
        const entries = doctorQualByDoctor[doctorId];
        if (entries && entries.length > 0) {
            return entries.map(e => String(e.qualification_id));
        }
        // 2. Fallback: aus der Rolle ableiten (wenn keine Qualifikationen zugewiesen)
        const doc = doctors.find(d => d.id === doctorId);
        if (doc?.role) {
            const qual = Object.values(qualificationMap).find(q => q.name === doc.role);
            if (qual?.id) return [String(qual.id)];
        }
        return [];
    }, [doctorQualByDoctor, doctors, qualificationMap]);

    // Berechne pro Qualifikation: Gesamtpersonal und abwesendes Personal pro Tag
    const dailyAbsencesByQual = React.useMemo(() => {
        // Map: dateStr → Map<qualificationId, { absent: number, absentNames: string[] }>
        const byDate = new Map<string, Map<string, { absent: number; absentNames: string[] }>>();

        shifts.forEach(s => {
            if (!["Urlaub", "Krank", "Frei", "Dienstreise", "Nicht verfügbar"].includes(s.position)) return;
            
            const dStr = s.date;
            const doc = doctors.find(d => d.id === s.doctor_id);
            if (!doc) return;

            if (!byDate.has(dStr)) {
                byDate.set(dStr, new Map());
            }
            const qualMap = byDate.get(dStr)!;
            const docQualIds = getDoctorQualificationIds(doc.id);

            docQualIds.forEach(qId => {
                if (!qualMap.has(qId)) {
                    qualMap.set(qId, { absent: 0, absentNames: [] });
                }
                const entry = qualMap.get(qId)!;
                entry.absent++;
                if (!entry.absentNames.includes(doc.name)) {
                    entry.absentNames.push(doc.name);
                }
            });
        });
        return byDate;
    }, [shifts, doctors, getDoctorQualificationIds]);

    // Gesamtpersonal pro Qualifikation
    const totalStaffByQual = React.useMemo(() => {
        const totals: Record<string, number> = {};
        doctors.forEach(d => {
            const qIds = getDoctorQualificationIds(d.id);
            qIds.forEach(qId => {
                if (!totals[qId]) totals[qId] = 0;
                totals[qId]++;
            });
        });
        return totals;
    }, [doctors, getDoctorQualificationIds]);

    // Handler wrapper for toggle (muss NACH dailyAbsencesByQual/totalStaffByQual stehen wg. TDZ)
    const handleToggle = React.useCallback((date: Date, status: string | null, docId: string, e: React.MouseEvent) => {
        if (!isDragging || (dragStart && dragCurrent && isSameDay(dragStart, dragCurrent))) {
            onToggle && onToggle(date, status, docId, e);
        }
    }, [isDragging, dragStart, dragCurrent, onToggle]);

    const vacationCounts = React.useMemo(() => {
        const counts: Record<string, number> = {};
        doctors.forEach(doc => {
            counts[doc.id] = 0;
        });
        
        shifts.forEach(s => {
                if (s.position === 'Urlaub') {
                    const d = new Date(s.date);
                    if (!isWeekend(d) && !isPublicHoliday(d)) {
                        if (counts[s.doctor_id] !== undefined) {
                            counts[s.doctor_id]++;
                        }
                    }
                }
        });
        return counts;
    }, [shifts, doctors, isPublicHoliday]);

    const monthChunks = React.useMemo(() => {
        const chunks: number[][] = [];
        for (let i = 0; i < 12; i += monthsPerRow) {
            const chunk = [];
            for (let j = 0; j < monthsPerRow && (i + j) < 12; j++) {
                chunk.push(i + j);
            }
            chunks.push(chunk);
        }
        return chunks;
    }, [monthsPerRow]);

    // Drag info object for memoization
    const dragInfo = React.useMemo((): DragInfo => ({
        isDragging,
        dragStart,
        dragCurrent,
        dragDoctorId
    }), [isDragging, dragStart, dragCurrent, dragDoctorId]);

    return (
        <div className="space-y-8">
            {monthChunks.map((months, qIdx) => (
                <StickyHorizontalScrollbar key={qIdx} className="border rounded-lg shadow-sm bg-white">
                            <table className="w-full border-collapse text-xs table-fixed">
                                <thead>
                                    {/* Month Headers */}
                                    <tr>
                                        <th className="sticky left-0 z-20 bg-slate-100 border-b border-r p-2 w-[190px] min-w-[190px] text-left">
                                            Mitarbeiter
                                        </th>
                                        <th className="sticky left-[190px] z-20 bg-slate-100 border-b border-r p-2 w-[50px] min-w-[50px] text-center shadow-[1px_0_0_0_rgba(0,0,0,0.1)]" title="Jahresanspruch / verplante+genommene Urlaubstage (Netto)">
                                            Urlaub
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
                                        <th className="sticky left-[190px] z-20 bg-slate-100 border-b border-r p-1 text-center text-[10px] text-slate-500 shadow-[1px_0_0_0_rgba(0,0,0,0.1)]">∑</th>
                                        {months.map(m => {
                                            const date = setMonth(setYear(new Date(), year), m);
                                            const daysInMonth = getDaysInMonth(date);
                                            return Array.from({ length: daysInMonth }).map((_, i) => {
                                                const d = setDate(date, i + 1);
                                                const isWknd = isWeekend(d);
                                                const isHol = isPublicHoliday(d);
                                                const isSchool = isSchoolHoliday(d);
                                                let headerClass = isHol ? 'bg-blue-100 text-blue-700' : isWknd ? 'bg-slate-100 text-slate-500' : 'bg-white';
                                                if (isSchool && !isHol && !isWknd) headerClass = 'bg-green-50 text-green-700';

                                                // Check Limits (qualifikationsbasiert)
                                                const dStr = format(d, 'yyyy-MM-dd');
                                                const absencesByQual = dailyAbsencesByQual.get(dStr);
                                                let warning: React.ReactNode = null;

                                                const lowThresholds: Array<{ qualName: string; present: number; min: number; absentNames: string[] }> = [];

                                                if (absencesByQual && !isWknd && !isHol) {
                                                    availabilityThresholds.forEach(t => {
                                                        const qId = t.qualificationId;
                                                        const total = totalStaffByQual[qId] || 0;
                                                        const absent = absencesByQual.get(qId);
                                                        const absentCount = absent ? absent.absent : 0;
                                                        const present = total - absentCount;

                                                        if (present < t.min) {
                                                            lowThresholds.push({
                                                                qualName: t.qualificationName || qualificationMap[qId]?.name || qId,
                                                                present,
                                                                min: t.min,
                                                                absentNames: absent ? absent.absentNames : []
                                                            });
                                                        }
                                                    });

                                                    if (lowThresholds.length > 0) {
                                                        warning = (
                                                            <Popover>
                                                                <PopoverTrigger asChild>
                                                                    <div className="absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 z-30 cursor-pointer">
                                                                         <AlertTriangle className="w-3 h-3 text-red-600 bg-white rounded-full shadow-sm border border-red-200" fill="currentColor" fillOpacity={0.2} />
                                                                    </div>
                                                                </PopoverTrigger>
                                                                <PopoverContent className="w-72 p-3 z-50">
                                                                    <div className="space-y-2">
                                                                        <h4 className="font-medium text-sm text-red-800 flex items-center gap-2 border-b pb-1">
                                                                            <AlertTriangle className="w-4 h-4" />
                                                                            Personalunterdeckung
                                                                        </h4>
                                                                        <div className="text-xs space-y-3">
                                                                            {lowThresholds.map((lt, idx) => (
                                                                                <div key={idx}>
                                                                                    <div className="font-semibold text-slate-700">
                                                                                        Verfügbare {lt.qualName}: {lt.present} (Min: {lt.min})
                                                                                    </div>
                                                                                    {lt.absentNames.length > 0 && (
                                                                                        <>
                                                                                            <div className="text-slate-500 mb-1 mt-1">Abwesend:</div>
                                                                                            <ul className="list-disc list-inside text-slate-500 ml-1">
                                                                                                {lt.absentNames.map(n => <li key={n}>{n}</li>)}
                                                                                            </ul>
                                                                                        </>
                                                                                    )}
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                </PopoverContent>
                                                            </Popover>
                                                        );
                                                    }
                                                }
                                                
                                                return (
                                                    <th key={`${m}-${i}`} className={`relative border-b border-r p-0.5 text-[10px] text-center w-[22px] min-w-[22px] ${headerClass}`}>
                                                        {i + 1}
                                                        {warning}
                                                    </th>
                                                );
                                            });
                                        })}
                                    </tr>
                                </thead>
                                <tbody>
                                    {doctors.map(doc => (
                                        <tr key={doc.id} className="hover:bg-slate-50">
                                            <td className="sticky left-0 z-10 bg-white border-b border-r p-1 px-2 text-slate-700">
                                                <div className="truncate font-medium" title={getContractTooltipLabel(contractInfoByDoctorId[doc.id]) || undefined}>{doc.name}</div>
                                            </td>
                                            <td className="sticky left-[190px] z-10 bg-white border-b border-r p-1 text-center text-xs font-bold text-slate-600 shadow-[1px_0_0_0_rgba(0,0,0,0.1)]" title={`${vacationCounts[doc.id]} verplante+genommene Tage von ${entitlementByDoctorId[doc.id] ?? parseAnnualVacationDays(doc.vacation_days)} Tagen Jahresanspruch`}>
                                                {entitlementByDoctorId[doc.id] ?? parseAnnualVacationDays(doc.vacation_days)}
                                                <span className="text-slate-400 font-normal">/{vacationCounts[doc.id]}</span>
                                            </td>
                                            {months.map(m => {
                                                const date = setMonth(setYear(new Date(), year), m);
                                                const daysInMonth = getDaysInMonth(date);
                                                return Array.from({ length: daysInMonth }).map((_, i) => {
                                                    const d = setDate(date, i + 1);
                                                    const isWknd = isWeekend(d);
                                                    const isHol = isPublicHoliday(d);
                                                    const isSchool = isSchoolHoliday(d);
                                                    const status = getStatus(d, doc.id);

                                                    return (
                                                        <VacationOverviewCell
                                                            key={`${doc.id}-${m}-${i}`}
                                                            date={d}
                                                            doctor={doc}
                                                            status={status}
                                                            contractInfo={contractInfoByDoctorId[doc.id] || null}
                                                            isWeekend={isWknd}
                                                            isHoliday={isHol}
                                                            isSchoolHoliday={isSchool}
                                                            visibleTypes={visibleTypes}
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
                </StickyHorizontalScrollbar>
            ))}
        </div>
    );
}
