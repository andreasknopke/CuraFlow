import React, { useState } from 'react';
import {
  format,
  startOfYear,
  endOfYear,
  eachMonthOfInterval,
  isSameDay,
  startOfDay,
} from 'date-fns';
import { de } from 'date-fns/locale';
import { Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { api, db } from '@/api/client';
import { DEFAULT_COLORS } from '@/components/settings/ColorSettingsDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import DoctorYearMonthCalendar from './DoctorYearMonthCalendar';
import type { Doctor, ShiftEntry } from '@/types/models';

interface DoctorYearViewProps {
  doctor: Doctor;
  year: number;
  shifts: ShiftEntry[];
  onToggle: (date: Date, status: string | null, e: React.MouseEvent) => void;
  onRangeSelect?: (start: Date, end: Date) => void;
  activeType?: string;
  rangeStart?: Date | null;
  customColors?: Record<string, string | { backgroundColor: string; color: string }>;
  isSchoolHoliday?: (date: Date) => boolean;
  isPublicHoliday?: (date: Date) => boolean;
}

export default function DoctorYearView({
  doctor,
  year,
  shifts,
  onToggle,
  onRangeSelect,
  activeType,
  rangeStart,
  customColors: propCustomColors,
  isSchoolHoliday,
  isPublicHoliday,
}: DoctorYearViewProps) {
  const [dragStart, setDragStart] = useState<Date | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Date | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  React.useEffect(() => {
    const handleMouseUp = () => {
      if (isDragging) {
        if (dragStart && dragCurrent && !isSameDay(dragStart, dragCurrent)) {
          // Range selection finished
          onRangeSelect && onRangeSelect(dragStart, dragCurrent);
        }
        // If same day, we treat it as a click which is handled by the button onClick/onMouseUp combination,
        // but actually we suppress onClick if we handled drag?
        // Let's rely on standard onClick for single clicks if we didn't drag range.

        setIsDragging(false);
        setDragStart(null);
        setDragCurrent(null);
      }
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [isDragging, dragStart, dragCurrent, onRangeSelect]);

  const handleMouseDown = (date: Date) => {
    // Only left click
    setDragStart(date);
    setDragCurrent(date);
    setIsDragging(true);
  };

  const handleMouseEnter = (date: Date) => {
    if (isDragging) {
      setDragCurrent(date);
    }
  };

  const { data: colorSettings = [] } = useQuery({
    queryKey: ['colorSettings'],
    queryFn: () => db.ColorSetting.list(),
    staleTime: 1000 * 60 * 10, // 10 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const getCustomColor = (position: string) => {
    const setting = (colorSettings as Record<string, unknown>[]).find(
      (s: Record<string, unknown>) => s.name === position && s.category === 'position',
    );
    if (setting)
      return { backgroundColor: setting.bg_color as string, color: setting.text_color as string };
    if ((DEFAULT_COLORS.positions as Record<string, { bg: string; text: string }>)[position])
      return {
        backgroundColor: (DEFAULT_COLORS.positions as Record<string, { bg: string; text: string }>)[
          position
        ].bg,
        color: (DEFAULT_COLORS.positions as Record<string, { bg: string; text: string }>)[position]
          .text,
      };
    return null;
  };

  // Get future absences for email
  const today = startOfDay(new Date());
  const absenceTypes = ['Urlaub', 'Frei', 'Krank', 'Dienstreise', 'Nicht verfügbar'];
  const futureAbsences = shifts
    .filter((s) => {
      const shiftDate = new Date(s.date);
      return absenceTypes.includes(s.position) && shiftDate >= today;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Kalender/Dienstplan-Emails gehen an die Kalender-Adresse
  const doctorEmail = doctor?.google_email || doctor?.email;

  const _generateAbsenceICS = (absences: ShiftEntry[]) => {
    const events = absences
      .map((shift: ShiftEntry) => {
        const d = new Date(shift.date);
        const dateStr = d.toISOString().split('T')[0].replaceAll('-', '');

        const nextDay = new Date(d);
        nextDay.setHours(12);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = nextDay.toISOString().split('T')[0].replaceAll('-', '');

        return [
          'BEGIN:VEVENT',
          `UID:absence-${shift.id || shift.date}@radioplan`,
          `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
          `DTSTART;VALUE=DATE:${dateStr}`,
          `DTEND;VALUE=DATE:${nextDayStr}`,
          `SUMMARY:${shift.position}`,
          `DESCRIPTION:Abwesenheit: ${shift.position}`,
          'END:VEVENT',
        ].join('\r\n');
      })
      .join('\r\n');

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//RadioPlan//NONSGML v1.0//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      events,
      'END:VCALENDAR',
    ].join('\r\n');
  };

  const handleSendAbsenceEmail = async () => {
    if (!doctorEmail || futureAbsences.length === 0) return;

    setIsSendingEmail(true);
    try {
      const formatter = new Intl.DateTimeFormat('de-DE', {
        weekday: 'long',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

      const dateList = futureAbsences
        .map((s) => {
          const date = new Date(s.date);
          return `- ${formatter.format(date)}: ${s.position}`;
        })
        .join('\n');

      let body = `Hallo ${doctor.name},\n\n`;
      body += `Hier ist eine Übersicht deiner eingetragenen Abwesenheiten:\n\n${dateList}`;
      body += `\n\nViele Grüße,\nDein CuraFlow-System`;

      await api.sendEmail({
        to: doctorEmail.trim(),
        subject: `[CuraFlow] Deine Abwesenheiten`,
        body,
      });

      alert('E-Mail erfolgreich gesendet!');
      setEmailDialogOpen(false);
    } catch (error) {
      console.error('Failed to send email:', error);
      alert(
        'Fehler beim Senden der E-Mail: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setIsSendingEmail(false);
    }
  };

  const months = eachMonthOfInterval({
    start: startOfYear(new Date(year, 0, 1)),
    end: endOfYear(new Date(year, 0, 1)),
  });

  const getShiftStatus = (date: Date): string | null => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const shift = shifts.find((s) => s.date === dateStr);
    return shift ? shift.position : null;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shadow-sm ${doctor.color || 'bg-slate-100'}`}
          >
            {doctor.initials}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{doctor.name}</h2>
            <p className="text-slate-500">
              {doctor.role} • Jahresplanung {year}
            </p>
          </div>
        </div>

        {doctorEmail && futureAbsences.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEmailDialogOpen(true)}
            className="gap-2"
          >
            <Mail className="w-4 h-4" />
            Abwesenheiten senden
          </Button>
        )}
      </div>

      {/* Email Confirmation Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Abwesenheiten per E-Mail senden</DialogTitle>
            <DialogDescription>
              Folgende {futureAbsences.length} Abwesenheiten werden gesendet:
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[300px] overflow-y-auto border rounded-md p-3 bg-slate-50 text-sm space-y-1">
            {futureAbsences.slice(0, 20).map((s, idx) => {
              const date = new Date(s.date);
              return (
                <div key={idx} className="flex justify-between">
                  <span>{format(date, 'dd.MM.yyyy (EEEE)', { locale: de })}</span>
                  <span className="text-slate-500">{s.position}</span>
                </div>
              );
            })}
            {futureAbsences.length > 20 && (
              <div className="text-slate-400 italic pt-2">
                ... und {futureAbsences.length - 20} weitere
              </div>
            )}
          </div>

          <div className="bg-indigo-50 border border-indigo-100 rounded-md p-3 text-sm">
            <span className="font-medium text-indigo-800">Empfänger:</span>
            <span className="ml-2 text-indigo-600">{doctorEmail}</span>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSendAbsenceEmail} disabled={isSendingEmail} className="gap-2">
              {isSendingEmail ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sende...
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4" />
                  Jetzt senden
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {months.map((month) => (
          <DoctorYearMonthCalendar
            key={month.toString()}
            month={month}
            getShiftStatus={getShiftStatus}
            onDateClick={(date, e) => {
              // If we were dragging a range, don't trigger click toggle
              if (isDragging && dragStart && dragCurrent && !isSameDay(dragStart, dragCurrent)) {
                return;
              }
              onToggle(date, getShiftStatus(date), e);
            }}
            onMouseDown={handleMouseDown}
            onMouseEnter={handleMouseEnter}
            dragStart={dragStart}
            dragCurrent={dragCurrent}
            isDragging={isDragging}
            rangeStart={rangeStart}
            customColors={propCustomColors}
            getCustomColor={getCustomColor}
            isSchoolHoliday={isSchoolHoliday}
            isPublicHoliday={isPublicHoliday}
          />
        ))}
      </div>
    </div>
  );
}
