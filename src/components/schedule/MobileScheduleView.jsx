import React, { useState, useMemo } from 'react';
import { format, addDays, startOfWeek, isSameDay, isWeekend, isValid } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar, User, Clock, MapPin } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';

const ABSENCE_POSITIONS = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];

export default function MobileScheduleView({ 
    currentDate, 
    setCurrentDate, 
    shifts, 
    doctors, 
    workplaces,
    isPublicHoliday,
    isSchoolHoliday 
}) {
    const [selectedDay, setSelectedDay] = useState(currentDate);
    const [viewTab, setViewTab] = useState('day'); // 'day' | 'week'

    const weekDays = useMemo(() => {
        const start = startOfWeek(currentDate, { weekStartsOn: 1 });
        return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
    }, [currentDate]);

    const selectedDateStr = format(selectedDay, 'yyyy-MM-dd');
    
    const dayShifts = useMemo(() => {
        return shifts.filter(s => s.date === selectedDateStr);
    }, [shifts, selectedDateStr]);

    // Group shifts by category (dynamically from workplaces)
    const groupedShifts = useMemo(() => {
        const absences = dayShifts.filter(s => ABSENCE_POSITIONS.includes(s.position));
        const services = dayShifts.filter(s => {
            const wp = workplaces.find(w => w.name === s.position);
            return wp?.category === 'Dienste';
        });
        const rotations = dayShifts.filter(s => {
            const wp = workplaces.find(w => w.name === s.position);
            return wp?.category === 'Rotationen';
        });
        const demos = dayShifts.filter(s => {
            const wp = workplaces.find(w => w.name === s.position);
            return wp?.category === 'Demonstrationen & Konsile';
        });
        const other = dayShifts.filter(s => 
            !ABSENCE_POSITIONS.includes(s.position) &&
            !workplaces.find(w => w.name === s.position && ['Dienste', 'Rotationen', 'Demonstrationen & Konsile'].includes(w.category))
        );

        return { absences, services, rotations, demos, other };
    }, [dayShifts, workplaces]);

    const getDoctor = (id) => doctors.find(d => d.id === id);

    const renderShiftCard = (shift, colorClass = "bg-slate-100") => {
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
                    <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => addDays(d, -7))}>
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
                    <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => addDays(d, 7))}>
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
                                onClick={() => setSelectedDay(day)}
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
                    {/* Services */}
                    {groupedShifts.services.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-blue-600" />
                                    Dienste
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {groupedShifts.services.map(s => renderShiftCard(s, "bg-blue-50"))}
                            </CardContent>
                        </Card>
                    )}

                    {/* Rotations */}
                    {groupedShifts.rotations.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <MapPin className="w-4 h-4 text-emerald-600" />
                                    Rotationen
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {groupedShifts.rotations.map(s => renderShiftCard(s, "bg-emerald-50"))}
                            </CardContent>
                        </Card>
                    )}

                    {/* Demos */}
                    {groupedShifts.demos.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <Calendar className="w-4 h-4 text-amber-600" />
                                    Demos & Konsile
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {groupedShifts.demos.map(s => renderShiftCard(s, "bg-amber-50"))}
                            </CardContent>
                        </Card>
                    )}

                    {/* Absences */}
                    {groupedShifts.absences.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <User className="w-4 h-4 text-slate-600" />
                                    Abwesenheiten
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {groupedShifts.absences.map(s => {
                                    let color = "bg-slate-100";
                                    if (s.position === "Urlaub") color = "bg-green-50";
                                    else if (s.position === "Krank") color = "bg-red-50";
                                    else if (s.position === "Frei") color = "bg-yellow-50";
                                    return renderShiftCard(s, color);
                                })}
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