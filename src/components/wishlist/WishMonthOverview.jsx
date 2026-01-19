import React, { useState, useEffect } from 'react';
import { format, getDaysInMonth, startOfMonth, addMonths, subMonths, isSameDay, isWeekend, getYear } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, XCircle, AlertCircle, Eye, CheckSquare, Square, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { base44 } from '@/api/base44Client';

export default function WishMonthOverview({ 
    year, 
    month, 
    doctors, 
    wishes, 
    shifts,
    onDateChange,
    onToggle,
    isSchoolHoliday,
    isPublicHoliday,
    activeType
}) {
    const [hiddenDoctorIds, setHiddenDoctorIds] = useState([]);
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [showAbsences, setShowAbsences] = useState(true);
    const [showOccupiedDates, setShowOccupiedDates] = useState(true);
    const [preferencesLoaded, setPreferencesLoaded] = useState(false);

    // Load all user preferences
    useEffect(() => {
        const loadPreferences = async () => {
            try {
                const user = await base44.auth.me();
                if (user) {
                    if (user.show_occupied_wish_dates !== undefined) {
                        setShowOccupiedDates(user.show_occupied_wish_dates);
                    }
                    if (user.wish_overview_show_absences !== undefined) {
                        setShowAbsences(user.wish_overview_show_absences);
                    }
                    if (user.wish_overview_hidden_doctors && Array.isArray(user.wish_overview_hidden_doctors)) {
                        setHiddenDoctorIds(user.wish_overview_hidden_doctors);
                    }
                }
            } catch (e) {
                console.error("Could not load preferences", e);
            } finally {
                setPreferencesLoaded(true);
            }
        };
        loadPreferences();
    }, []);

    // Save preference when changed
    const toggleShowOccupiedDates = async () => {
        const newValue = !showOccupiedDates;
        setShowOccupiedDates(newValue);
        try {
            await base44.auth.updateMe({ show_occupied_wish_dates: newValue });
        } catch (e) {
            console.error("Could not save preference", e);
        }
    };

    // Save absences preference when changed
    const handleShowAbsencesChange = async (checked) => {
        setShowAbsences(checked);
        try {
            await base44.auth.updateMe({ wish_overview_show_absences: checked });
        } catch (e) {
            console.error("Could not save preference", e);
        }
    };

    // Save hidden doctors preference when changed
    const saveHiddenDoctors = async (newHiddenIds) => {
        try {
            await base44.auth.updateMe({ wish_overview_hidden_doctors: newHiddenIds });
        } catch (e) {
            console.error("Could not save preference", e);
        }
    };

    // Derived current date
    const currentMonth = new Date(year, month, 1);
    
    const handlePrevMonth = () => {
        const newDate = subMonths(currentMonth, 1);
        onDateChange(newDate);
    };

    const handleNextMonth = () => {
        const newDate = addMonths(currentMonth, 1);
        onDateChange(newDate);
    };

    const daysInMonth = getDaysInMonth(currentMonth);
    const days = Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1));

    const visibleDoctors = doctors.filter(d => !hiddenDoctorIds.includes(d.id));

    const getWish = (doctor, date) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return wishes.find(w => 
            w.doctor_id === doctor.id && 
            w.date === dateStr &&
            (w.type === 'no_service' || !activeType || w.position === activeType)
        );
    };

    const hasAnyWish = (date) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return wishes.some(w => 
            w.date === dateStr &&
            w.type === 'service' &&
            w.position === activeType
        );
    };

    const getAbsence = (doctor, date) => {
        if (!shifts) return null;
        const dateStr = format(date, 'yyyy-MM-dd');
        return shifts.find(s => 
            s.doctor_id === doctor.id && 
            s.date === dateStr && 
            ["Urlaub", "Krank", "Frei", "Dienstreise", "Nicht verfügbar"].includes(s.position)
        );
    };

    const toggleDoctorVisibility = (docId) => {
        setHiddenDoctorIds(prev => {
            const newHiddenIds = prev.includes(docId) 
                ? prev.filter(id => id !== docId)
                : [...prev, docId];
            saveHiddenDoctors(newHiddenIds);
            return newHiddenIds;
        });
    };

    const showAllDoctors = () => {
        setHiddenDoctorIds([]);
        saveHiddenDoctors([]);
    };

    const renderCell = (doctor, date) => {
        const absence = getAbsence(doctor, date);
        const hasOtherWish = showOccupiedDates && hasAnyWish(date);

        if (absence && showAbsences) {
            let bgColor = 'bg-slate-100';
            let textColor = 'text-slate-600';
            let label = absence.position;
            let shortLabel = label.substring(0, 1);
            
            if (absence.position === 'Urlaub') {
                bgColor = 'bg-emerald-100'; textColor = 'text-emerald-800'; shortLabel = 'U';
            } else if (absence.position === 'Krank') {
                bgColor = 'bg-red-100'; textColor = 'text-red-800'; shortLabel = 'K';
            } else if (absence.position === 'Dienstreise') {
                bgColor = 'bg-purple-100'; textColor = 'text-purple-800'; shortLabel = 'DR';
            } else if (absence.position === 'Nicht verfügbar') {
                bgColor = 'bg-gray-200'; textColor = 'text-gray-600'; shortLabel = 'NV';
            } else if (absence.position === 'Frei') {
                bgColor = 'bg-slate-100'; textColor = 'text-slate-400'; shortLabel = 'F';
            }

            return (
                <TooltipProvider>
                    <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                            <div className={`w-full h-full min-h-[40px] flex items-center justify-center border border-transparent rounded-sm ${bgColor} ${textColor} text-[10px] font-bold cursor-not-allowed`}>
                                {shortLabel}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>
                            <div className="font-bold">{doctor.name}</div>
                            <div>{absence.position}</div>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            );
        }

        const wish = getWish(doctor, date);
        
        // Don't show rejected wishes (prevent "ghost" boxes)
        if (!wish || wish.status === 'rejected') {
            const borderClass = hasOtherWish ? "ring-2 ring-inset ring-emerald-400/60" : "";
            return (
                <div 
                    className={`w-full h-full min-h-[40px] hover:bg-slate-50 cursor-pointer transition-colors ${borderClass}`}
                    onClick={() => onToggle && onToggle(date, doctor.id)}
                ></div>
            );
        }

        let bgColor = 'bg-gray-50';
        let icon = null;
        let borderColor = 'border-transparent';
        let textColor = 'text-slate-700';

        if (wish.type === 'service') {
            bgColor = wish.status === 'approved' ? 'bg-green-200' : wish.status === 'rejected' ? 'bg-green-50 opacity-50 grayscale' : 'bg-green-100';
            borderColor = wish.status === 'approved' ? 'border-green-600' : 'border-green-400';
            textColor = 'text-green-900';
            // For narrow columns, maybe just a small dot or checkmark?
            // Or just color code. 
            // "D" for Dienst?
            icon = <div className="font-bold text-[10px] leading-tight">D</div>;
        } else if (wish.type === 'no_service') {
            bgColor = wish.status === 'approved' ? 'bg-red-200' : wish.status === 'rejected' ? 'bg-red-50 opacity-50 grayscale' : 'bg-red-100';
            borderColor = wish.status === 'approved' ? 'border-red-600' : 'border-red-400';
            textColor = 'text-red-900';
            icon = <XCircle className="w-3 h-3 text-red-600 mx-auto" />;
        }

        if (wish.status === 'pending') {
            borderColor = 'border-amber-400 border-dashed border-2';
        }

        return (
            <TooltipProvider>
                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <div 
                            className={`relative w-full h-full min-h-[40px] flex items-center justify-center border rounded-sm ${bgColor} ${borderColor} ${textColor} transition-all hover:opacity-80 cursor-pointer p-0.5`}
                            onClick={() => onToggle && onToggle(date, doctor.id)}
                        >
                            {icon}
                            {wish.status === 'pending' && (
                                <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                            )}
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                        <div className="text-xs">
                            <div className="font-bold">{doctor.name}</div>
                            <div>{format(date, 'dd.MM.yyyy')}</div>
                            <div className="my-1 border-t border-white/20 pt-1">
                                {wish.type === 'service' ? <span className="text-green-300 font-bold">Dienstwunsch: {wish.position || 'Allgemein'}</span> : <span className="text-red-300 font-bold">Kein Dienst</span>}
                            </div>
                            <div className="italic opacity-90">Status: {
                                wish.status === 'pending' ? 'Ausstehend' : 
                                wish.status === 'approved' ? 'Genehmigt' : 'Abgelehnt'
                            }</div>
                            {wish.reason && <div className="mt-1 text-slate-300 italic">"{wish.reason}"</div>}
                            {wish.admin_comment && <div className="mt-1 text-amber-300 border-t border-white/10 pt-1">Admin: {wish.admin_comment}</div>}
                        </div>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    };

    return (
        <div className="bg-white rounded-lg shadow border border-slate-200 flex flex-col h-[calc(100vh-240px)]">
            <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 rounded-t-lg shrink-0">
                <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-base text-slate-800 flex items-center gap-2">
                        Monatsübersicht
                    </h2>
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                        {activeType || 'Alle'}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 border-r border-slate-200 pr-3 mr-1">
                        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                            <input 
                                type="checkbox" 
                                checked={showAbsences} 
                                onChange={(e) => handleShowAbsencesChange(e.target.checked)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            Abwesenheiten
                        </label>
                    </div>
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={toggleShowOccupiedDates}
                        className="h-8 gap-2"
                        title="Wunsch-Markierung ein-/ausblenden"
                    >
                        {showOccupiedDates ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        <span className="hidden sm:inline">Wunsch-Mark.</span>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setIsConfigOpen(true)} className="h-8 gap-2">
                        <Eye className="w-4 h-4" />
                        <span className="hidden sm:inline">Ärzte</span>
                    </Button>
                    <div className="w-px h-6 bg-slate-200 mx-1" />
                    <div className="flex items-center bg-white rounded-md border border-slate-200 shadow-sm p-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePrevMonth}>
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="w-36 text-center font-medium text-sm">
                            {format(currentMonth, 'MMMM yyyy', { locale: de })}
                        </span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNextMonth}>
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </div>

            <ScrollArea className="flex-1 w-full">
                <div className="min-w-fit">
                    {/* Header Row: Doctors */}
                    <div className="flex border-b border-slate-200 sticky top-0 z-20 bg-white shadow-sm">
                        <div className="w-[80px] flex-shrink-0 p-2 font-bold text-slate-500 text-xs border-r border-slate-200 bg-slate-50 flex items-center justify-center sticky left-0 z-30 shadow-[1px_0_3px_-1px_rgba(0,0,0,0.1)]">
                            Datum
                        </div>
                        {visibleDoctors.map(doc => (
                            <TooltipProvider key={doc.id}>
                                <Tooltip delayDuration={0}>
                                    <TooltipTrigger asChild>
                                        <div className="w-[45px] flex-shrink-0 p-2 text-center border-r border-slate-100 last:border-r-0 bg-slate-50 cursor-help hover:bg-slate-100 transition-colors">
                                            <div className="font-bold text-sm text-slate-800">{doc.initials}</div>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{doc.name} ({doc.role})</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        ))}
                    </div>

                    {/* Rows: Days */}
                    <div className="flex flex-col">
                        {days.map(day => {
                            const isToday = isSameDay(day, new Date());
                            const isWknd = isWeekend(day);
                            
                            const isHol = isPublicHoliday ? isPublicHoliday(day) : false;
                            const isSchoolHol = isSchoolHoliday ? isSchoolHoliday(day) : false;
                            
                            let bgClass = 'bg-white';
                            let hatchStyle = {};

                            if (isToday) {
                                bgClass = 'bg-blue-50/50';
                            } else if (isHol) {
                                bgClass = 'bg-blue-50';
                                hatchStyle = { 
                                    backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(59, 130, 246, 0.1) 5px, rgba(59, 130, 246, 0.1) 10px)' 
                                };
                            } else if (isSchoolHol) {
                                bgClass = 'bg-green-50';
                                hatchStyle = { 
                                    backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(34, 197, 94, 0.1) 5px, rgba(34, 197, 94, 0.1) 10px)' 
                                };
                            } else if (isWknd) {
                                bgClass = 'bg-slate-50/50';
                            }

                            return (
                                <div 
                                    key={day.toISOString()} 
                                    className={`flex border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors ${bgClass}`}
                                    style={hatchStyle}
                                >
                                    {/* Date Column */}
                                    <div 
                                        className={`w-[80px] flex-shrink-0 p-1 border-r border-slate-200 flex flex-col items-center justify-center text-xs sticky left-0 z-10 bg-opacity-95 backdrop-blur-sm shadow-[1px_0_3px_-1px_rgba(0,0,0,0.1)] ${bgClass}`}
                                        style={hatchStyle}
                                    >
                                        <span className={`font-bold ${isWknd || isHol ? 'text-red-500' : (isSchoolHol ? 'text-green-700' : 'text-slate-700')} ${isToday ? 'text-blue-600' : ''}`}>
                                            {format(day, 'dd.MM.')}
                                        </span>
                                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                                            {format(day, 'EE', { locale: de })}
                                        </span>
                                    </div>
                                    
                                    {/* Doctor Columns */}
                                    {visibleDoctors.map(doc => (
                                        <div key={`${day.toISOString()}-${doc.id}`} className="w-[45px] flex-shrink-0 p-0.5 border-r border-slate-100 last:border-r-0 relative group">
                                            {renderCell(doc, day)}
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>

            <Dialog open={isConfigOpen} onOpenChange={setIsConfigOpen}>
                <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Sichtbare Ärzte</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto pr-2">
                        <div className="grid gap-2">
                            <div 
                                className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded cursor-pointer border border-transparent hover:border-slate-200"
                                onClick={showAllDoctors}
                            >
                                <CheckSquare className="w-4 h-4 text-indigo-600" />
                                <span className="font-medium">Alle anzeigen</span>
                            </div>
                            {doctors.map(doc => {
                                const isHidden = hiddenDoctorIds.includes(doc.id);
                                return (
                                    <div 
                                        key={doc.id} 
                                        className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded cursor-pointer border border-transparent hover:border-slate-200"
                                        onClick={() => toggleDoctorVisibility(doc.id)}
                                    >
                                        {isHidden ? (
                                            <Square className="w-4 h-4 text-slate-300" />
                                        ) : (
                                            <CheckSquare className="w-4 h-4 text-indigo-600" />
                                        )}
                                        <div className="flex flex-col">
                                            <span className={`font-medium ${isHidden ? 'text-slate-400' : 'text-slate-900'}`}>{doc.name}</span>
                                            <span className="text-xs text-slate-400">{doc.role}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setIsConfigOpen(false)}>Fertig</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}