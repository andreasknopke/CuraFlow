import { useEffect, useState, useMemo } from 'react';
import { format, addDays, startOfWeek, isSameDay, isSameWeek, isWeekend } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar, User, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Doctor, ShiftEntry, Workplace } from '@/types';
import { getWorkplaceCategoriesFromSettings } from '@/utils/workplaceCategoryUtils';

// ── Local types ────────────────────────────────────────────────────────────

interface HolidayResult {
  name: string;
}

interface MobileScheduleViewProps {
  currentDate: Date;
  setCurrentDate: React.Dispatch<React.SetStateAction<Date>>;
  shifts: ShiftEntry[];
  doctors: Doctor[];
  workplaces: Workplace[];
  systemSettings: { key: string; value?: string | null }[];
  isPublicHoliday: (date: Date) => HolidayResult | null;
  isSchoolHoliday: (date: Date) => HolidayResult | null;
}

interface CategoryStyle {
  headerColor: string;
  cardColor: string;
}

interface CategoryGroup {
  categoryName: string;
  shifts: ShiftEntry[];
  style: CategoryStyle;
}

// ── Constants ──────────────────────────────────────────────────────────────

const ABSENCE_POSITIONS = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];

const BUILT_IN_CATEGORY_STYLES: Record<string, CategoryStyle> = {
  'Dienste': { headerColor: 'text-blue-600', cardColor: 'bg-blue-50' },
  'Rotationen': { headerColor: 'text-emerald-600', cardColor: 'bg-emerald-50' },
  'Demonstrationen & Konsile': { headerColor: 'text-amber-600', cardColor: 'bg-amber-50' },
};

const CUSTOM_CATEGORY_STYLES: CategoryStyle[] = [
  { headerColor: 'text-indigo-600', cardColor: 'bg-indigo-50' },
  { headerColor: 'text-teal-600', cardColor: 'bg-teal-50' },
  { headerColor: 'text-rose-600', cardColor: 'bg-rose-50' },
  { headerColor: 'text-cyan-600', cardColor: 'bg-cyan-50' },
  { headerColor: 'text-violet-600', cardColor: 'bg-violet-50' },
  { headerColor: 'text-orange-600', cardColor: 'bg-orange-50' },
];

// ── Component ──────────────────────────────────────────────────────────────

export default function MobileScheduleView({ 
    currentDate, 
    setCurrentDate, 
    shifts, 
    doctors, 
    workplaces,
    systemSettings,
    isPublicHoliday,
    isSchoolHoliday 
}: MobileScheduleViewProps) {
    const [selectedDay, setSelectedDay] = useState<Date>(() => {
        const today = new Date();
        return isSameWeek(today, currentDate, { weekStartsOn: 1 }) ? today : currentDate;
    });
    useEffect(() => {
        setSelectedDay(prev => {
            if (isSameWeek(prev, currentDate, { weekStartsOn: 1 })) {
                return prev;
            }

            const today = new Date();
            return isSameWeek(today, currentDate, { weekStartsOn: 1 }) ? today : currentDate;
        });
    }, [currentDate]);

    const weekDays = useMemo(() => {
        const start = startOfWeek(currentDate, { weekStartsOn: 1 });
        return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
    }, [currentDate]);

    const selectedDateStr = format(selectedDay, 'yyyy-MM-dd');
    
    const dayShifts = useMemo(() => {
        return shifts.filter(s => s.date === selectedDateStr);
    }, [shifts, selectedDateStr]);

    // Group shifts by category (dynamically from workplaces + custom categories)
    const absenceShifts = useMemo(() =>
        dayShifts.filter(s => ABSENCE_POSITIONS.includes(s.position)),
        [dayShifts]
    );

    const categoryGroups = useMemo((): CategoryGroup[] => {
        const customCategories = getWorkplaceCategoriesFromSettings(systemSettings);
        const builtInNames = ['Dienste', 'Rotationen', 'Demonstrationen & Konsile'];
        const allCategoryNames = [...new Set([...builtInNames, ...customCategories.map(c => c.name)])];

        const groups: CategoryGroup[] = [];

        for (let i = 0; i < allCategoryNames.length; i++) {
            const categoryName = allCategoryNames[i];
            const categoryShifts = dayShifts.filter(s => {
                const wp = workplaces.find(w => w.name === s.position);
                return wp?.category === categoryName;
            });
            if (categoryShifts.length === 0) continue;

            // Sort by workplace name to group employees by workplace, then by doctor order
            const sorted = [...categoryShifts].sort((a, b) => {
                const posDiff = a.position.localeCompare(b.position, 'de', { sensitivity: 'base' });
                if (posDiff !== 0) return posDiff;
                const docA = doctors.find(d => d.id === a.doctor_id);
                const docB = doctors.find(d => d.id === b.doctor_id);
                return (docA?.order ?? 0) - (docB?.order ?? 0);
            });

            const style = BUILT_IN_CATEGORY_STYLES[categoryName]
                ?? CUSTOM_CATEGORY_STYLES[(i - builtInNames.length) % CUSTOM_CATEGORY_STYLES.length];

            groups.push({ categoryName, shifts: sorted, style });
        }

        return groups;
    }, [dayShifts, workplaces, doctors, systemSettings]);

    const otherShifts = useMemo(() =>
        dayShifts.filter(s =>
            !ABSENCE_POSITIONS.includes(s.position) &&
            !s.position.startsWith('__') &&
            !workplaces.some(w => w.name === s.position)
        ),
        [dayShifts, workplaces]
    );

    const getDoctor = (id: string | undefined | null): Doctor | undefined => doctors.find(d => d.id === id);

    const renderShiftCard = (shift: ShiftEntry, colorClass: string = "bg-slate-100") => {
        const doctor = getDoctor(shift.doctor_id);
        if (!doctor) return null;

        return (
            <div key={shift.id} className={`flex items-center justify-between p-3 rounded-lg ${colorClass}`}>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center font-bold text-sm shadow-sm">
                        {doctor.initials || doctor.name.substring(0, 2)}
                    </div>
                    <div>
                        <div className="font-medium text-sm">{doctor.name}</div>
                        <div className="text-xs text-slate-500">{doctor.role}</div>
                    </div>
                </div>
                <Badge variant="outline" className="text-xs">
                    {shift.position}
                </Badge>
            </div>
        );
    };

    const isHoliday = isPublicHoliday(selectedDay);
    const isSchoolHol = isSchoolHoliday(selectedDay);

    return (
        <div className="flex flex-col h-full bg-slate-50">
            {/* Header with Date Navigation */}
            <div className="bg-white border-b border-slate-200 p-4 sticky top-0 z-10">
                <div className="flex items-center justify-between mb-4">
                    <Button variant="ghost" size="icon" onClick={() => { setCurrentDate(d => addDays(d, -7)); }}>
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <div className="text-center">
                        <div className="font-bold text-lg">
                            {format(selectedDay, 'EEEE', { locale: de })}
                        </div>
                        <div className="text-sm text-slate-500">
                            {format(selectedDay, 'd. MMMM yyyy', { locale: de })}
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => { setCurrentDate(d => addDays(d, 7)); }}>
                        <ChevronRight className="h-5 w-5" />
                    </Button>
                </div>

                {/* Week Day Selector */}
                <div className="flex gap-1 overflow-x-auto pb-2 -mx-4 px-4">
                    {weekDays.map(day => {
                        const isSelected = isSameDay(day, selectedDay);
                        const isToday = isSameDay(day, new Date());
                        const isWeekendDay = isWeekend(day);
                        const dayHoliday = isPublicHoliday(day);

                        return (
                            <button
                                key={day.toISOString()}
                                onClick={() => { setSelectedDay(day); }}
                                className={`flex-shrink-0 w-12 py-2 rounded-lg text-center transition-colors ${
                                    isSelected 
                                        ? 'bg-indigo-600 text-white' 
                                        : isToday 
                                            ? 'bg-indigo-100 text-indigo-700'
                                            : dayHoliday
                                                ? 'bg-blue-50 text-blue-700'
                                                : isWeekendDay
                                                    ? 'bg-orange-50 text-orange-700'
                                                    : 'bg-white text-slate-700 border border-slate-200'
                                }`}
                            >
                                <div className="text-[10px] font-medium uppercase">
                                    {format(day, 'EEE', { locale: de })}
                                </div>
                                <div className="text-lg font-bold">
                                    {format(day, 'd')}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {(isHoliday || isSchoolHol) && (
                    <div className={`mt-2 text-xs py-1 px-2 rounded text-center ${isHoliday ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                        {isHoliday ? '🎉 Feiertag' : '🏫 Schulferien'}
                    </div>
                )}
            </div>

            {/* Content */}
            <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                    {/* Dynamic category sections (Dienste, Rotationen, custom areas, …) */}
                    {categoryGroups.map(group => {
                        const byPosition = new Map<string, ShiftEntry[]>();
                        for (const shift of group.shifts) {
                            const existing = byPosition.get(shift.position) ?? [];
                            existing.push(shift);
                            byPosition.set(shift.position, existing);
                        }

                        return (
                            <Card key={group.categoryName}>
                                <CardHeader className="pb-2">
                                    <CardTitle className={`text-sm flex items-center gap-2 ${group.style.headerColor}`}>
                                        <MapPin className="w-4 h-4" />
                                        {group.categoryName}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    {Array.from(byPosition.entries()).map(([position, posShifts]) => (
                                        <div key={position}>
                                            {byPosition.size > 1 && (
                                                <div className="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">{position}</div>
                                            )}
                                            <div className="space-y-2">
                                                {posShifts.map(s => renderShiftCard(s, group.style.cardColor))}
                                            </div>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        );
                    })}

                    {/* Absences */}
                    {absenceShifts.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <User className="w-4 h-4 text-slate-600" />
                                    Abwesenheiten
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {absenceShifts.map(s => {
                                    let color = "bg-slate-100";
                                    if (s.position === "Urlaub") color = "bg-green-50";
                                    else if (s.position === "Krank") color = "bg-red-50";
                                    else if (s.position === "Frei") color = "bg-yellow-50";
                                    return renderShiftCard(s, color);
                                })}
                            </CardContent>
                        </Card>
                    )}

                    {/* Other / Sonstiges */}
                    {otherShifts.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2 text-purple-600">
                                    <Calendar className="w-4 h-4" />
                                    Sonstiges
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {otherShifts.map(s => renderShiftCard(s, "bg-purple-50"))}
                            </CardContent>
                        </Card>
                    )}

                    {dayShifts.length === 0 && (
                        <div className="text-center py-12 text-slate-400">
                            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                            <p>Keine Einträge für diesen Tag</p>
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
