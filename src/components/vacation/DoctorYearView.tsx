import React, { useState, useMemo, useEffect } from 'react';
import { format, startOfYear, endOfYear, eachMonthOfInterval, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, isWeekend, isWithinInterval, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { Loader2, Mail, AlertTriangle, Sun, CalendarCheck, CalendarDays, RotateCw, Pencil, ChevronDown, ChevronRight, CalendarX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, db, base44 } from "@/api/client";
import { useToast } from '@/components/ui/use-toast';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { DEFAULT_COLORS } from '@/components/settings/ColorSettingsDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getContractTooltipLabel, isDateWithinContract } from '@/components/training/trainingContractUtils';
import { computeVacationBalance } from './vacationBalance';
import type { Doctor, ShiftEntry, ColorSetting } from '@/types';

interface ContractInfo {
  contractStart?: string;
  contractEnd?: string;
}

interface VacationBalance {
  total: number;
  taken: number;
  planned: number;
  remaining: number;
  overshoot: boolean;
}

interface ShiftEntitlement {
  employee_id?: string | null;
  shift_vacation_days?: number | null;
  carried_over?: boolean;
  carried_over_from_year?: number;
  expires_at?: string | null;
}

interface DoctorYearViewProps {
  doctor: Doctor & { vacation_days?: number };
  year: number;
  shifts: ShiftEntry[];
  onToggle: (date: Date, status: string | null, e: React.MouseEvent) => void;
  onRangeSelect?: (start: Date, end: Date) => void;
  activeType?: string;
  rangeStart?: Date | null;
  contractInfo?: ContractInfo;
  customColors?: Record<string, React.CSSProperties | string>;
  isSchoolHoliday?: (date: Date) => boolean;
  isPublicHoliday?: (date: Date) => boolean;
  dayTestIdPrefix?: string;
}

interface MonthCalendarProps {
  month: Date;
  getShiftStatus: (date: Date) => string | null;
  onDateClick: (date: Date, e: React.MouseEvent) => void;
  onMouseDown: (date: Date) => void;
  onMouseEnter: (date: Date) => void;
  dragStart: Date | null;
  dragCurrent: Date | null;
  isDragging: boolean;
  activeType?: string;
  rangeStart?: Date | null;
  contractInfo?: ContractInfo;
  isDateDisabled: (date: Date) => boolean;
  customColors?: Record<string, React.CSSProperties | string>;
  getCustomColor: (position: string) => React.CSSProperties | null;
  isSchoolHoliday: (date: Date) => boolean;
  isPublicHoliday: (date: Date) => boolean;
  dayTestIdPrefix?: string;
}

interface VacationBalanceBoxProps {
  balance: VacationBalance;
}

interface ShiftVacationBoxProps {
  balance: VacationBalance;
  entitlement: ShiftEntitlement | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  isSaving: boolean;
  canCarryOver: boolean;
  isCarrying: boolean;
  onCarryOver: () => void;
  year: number;
}

export default function DoctorYearView({
  doctor,
  year,
  shifts,
  onToggle,
  onRangeSelect,
  activeType,
  rangeStart,
  contractInfo,
  customColors: propCustomColors,
  isSchoolHoliday,
  isPublicHoliday,
  dayTestIdPrefix = 'year-day',
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

  const { data: colorSettings = [] } = useQuery<ColorSetting[]>({
    queryKey: ['colorSettings'],
    queryFn: () => db.ColorSetting.list(),
    staleTime: 1000 * 60 * 10, // 10 minutes
    cacheTime: 1000 * 60 * 30, // 30 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const getCustomColor = (position: string): React.CSSProperties | null => {
      const setting = colorSettings.find(s => s.name === position && s.category === 'position');
      if (setting) return { backgroundColor: setting.bg_color, color: setting.text_color };
      if (DEFAULT_COLORS.positions[position]) return { backgroundColor: DEFAULT_COLORS.positions[position].bg, color: DEFAULT_COLORS.positions[position].text };
      return null;
  };

  // Get future absences for email
  const today = startOfDay(new Date());
  const absenceTypes = ["Urlaub", "Frei", "Krank", "Dienstreise", "Nicht verfügbar"];
  const futureAbsences = shifts
      .filter(s => {
          const shiftDate = new Date(s.date);
          return absenceTypes.includes(s.position) && shiftDate >= today;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Kalender/Dienstplan-Emails gehen an die Kalender-Adresse
  const doctorEmail = doctor?.google_email || doctor?.email;

  const generateAbsenceICS = (absences: ShiftEntry[]): string => {
      const events = absences.map(shift => {
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
              'END:VEVENT'
          ].join('\r\n');
      }).join('\r\n');

      return [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//RadioPlan//NONSGML v1.0//EN',
          'CALSCALE:GREGORIAN',
          'METHOD:PUBLISH',
          events,
          'END:VCALENDAR'
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
              day: '2-digit'
          });

          const dateList = futureAbsences.map(s => {
              const date = new Date(s.date);
              return `- ${formatter.format(date)}: ${s.position}`;
          }).join('\n');

          let body = `Hallo ${doctor.name},\n\n`;
          body += `Hier ist eine Übersicht deiner eingetragenen Abwesenheiten:\n\n${dateList}`;
          body += `\n\nViele Grüße,\nDein CuraFlow-System`;

          await base44.integrations.Core.SendEmail({
              to: doctorEmail.trim(),
              subject: `[CuraFlow] Deine Abwesenheiten`,
              body: body
          });

          alert('E-Mail erfolgreich gesendet!');
          setEmailDialogOpen(false);
      } catch (error: unknown) {
          console.error('Failed to send email:', error);
          alert('Fehler beim Senden der E-Mail: ' + (error instanceof Error ? error.message : String(error)));
      } finally {
          setIsSendingEmail(false);
      }
  };

  const months = eachMonthOfInterval({
    start: startOfYear(new Date(year, 0, 1)),
    end: endOfYear(new Date(year, 0, 1))
  });

  // Fetch central absences for the active doctor. The endpoint
  // (`/api/vacation/central-absences`) is the authoritative source for
  // employees that have been linked to the central Employee database
  // and migrated to CentralAbsenceEntry — their absence rows no longer
  // exist in the local ShiftEntry table.
  //
  // We only fire the request when we have a doctor.id (i.e. the year
  // view is showing a specific employee) and skip silently on error so
  // the box degrades gracefully for unlinked doctors.
  const { data: centralAbsencePayload } = useQuery<{
    absences?: ShiftEntry[];
    employee_id?: string | null;
    vacation_days_annual?: number | null;
  }>({
    queryKey: ['central-absences', year, doctor?.id],
    queryFn: async () => {
      if (!doctor?.id) return { absences: [] };
      const result = await api.request(
        `/api/vacation/central-absences?year=${year}&doctorId=${encodeURIComponent(doctor.id)}`
      );
      return result || { absences: [] };
    },
    enabled: Boolean(doctor?.id),
    staleTime: 0,  // always refetch so the display is never stale after mutate
    retry: 0,
  });

  // Build a Set of `yyyy-MM-dd` strings for all public holidays in the
  // displayed year. The `isPublicHoliday` prop is a function; we evaluate
  // it once per day to build the set, then hand it to the pure balance
  // helper. Memoised by year + holiday-impl so toggling years refetches.
  const publicHolidayDates = useMemo(() => {
    const set = new Set<string>();
    const start = startOfYear(new Date(year, 0, 1));
    const end = endOfYear(new Date(year, 0, 1));
    for (const d of eachDayOfInterval({ start, end })) {
      if (isPublicHoliday && isPublicHoliday(d)) {
        set.add(format(d, 'yyyy-MM-dd'));
      }
    }
    return set;
  }, [year, isPublicHoliday]);

  // Live vacation balance for the year. Combines two sources:
  //   1. The `shifts` prop (tenant ShiftEntry — local rows that haven't
  //      been migrated to the central table yet, plus any non-absence
  //      context the caller already passes).
  //   2. The central absences fetched above, which are authoritative for
  //      doctors that have been linked + migrated.
  // Dedup is by `date` — a date that exists in both sources counts once.
  const vacationBalance = useMemo((): VacationBalance | null => {
    if (!doctor) return null;

    const localShifts = (shifts || []).filter(
      (s) => s.doctor_id === doctor.id || !s.doctor_id
    );
    const localDates = new Set(localShifts.map((s) => s.date));

    const centralShifts = (centralAbsencePayload?.absences || []).filter(
      (a) => !localDates.has(a.date) // dedup against local
    );

    // For linked employees, prefer the central vacation_days_annual over the
    // tenant-local Doctor.vacation_days so the display always reflects the
    // master frontend (e.g. changed via PayScaleTariff apply-defaults).
    const annualVacationDays =
      centralAbsencePayload?.employee_id
        ? (centralAbsencePayload.vacation_days_annual ?? doctor.vacation_days)
        : doctor.vacation_days;

    return computeVacationBalance({
      shifts: [...localShifts, ...centralShifts],
      year,
      annualVacationDays,
      publicHolidayDates,
    });
  }, [doctor, shifts, centralAbsencePayload, year, publicHolidayDates]);

  // Year-specific shift-/Sonderurlaubs-Anspruch for this doctor. Stored
  // centrally in EmployeeVacationYear; default 0 (most years carry none).
  // Only available for doctors that are linked to a central Employee,
  // because the entitlement is a property of the central record, not
  // the tenant-local Doctor row.
  const { data: shiftEntitlement } = useQuery<ShiftEntitlement | null>({
    queryKey: ['shift-vacation-entitlement', year, doctor?.id],
    queryFn: async () => {
      if (!doctor?.id) return null;
      try {
        const result = await api.request(
          `/api/vacation/shift-entitlement?year=${year}&doctorId=${encodeURIComponent(doctor.id)}`
        );
        return result || null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(doctor?.id),
    staleTime: 0,
    retry: 0,
  });

  // Live shift-vacation balance. Same merge logic as `vacationBalance`
  // but scoped to position 'Schichturlaub' and the year-specific entitlement.
  const shiftVacationBalance = useMemo((): VacationBalance | null => {
    if (!doctor) return null;
    const localShifts = (shifts || []).filter(
      (s) => s.doctor_id === doctor.id || !s.doctor_id
    );
    const localDates = new Set(localShifts.map((s) => s.date));
    const centralShifts = (centralAbsencePayload?.absences || []).filter(
      (a) => !localDates.has(a.date)
    );
    return computeVacationBalance({
      shifts: [...localShifts, ...centralShifts],
      year,
      position: 'Schichturlaub',
      annualVacationDays: shiftEntitlement?.shift_vacation_days ?? 0,
      publicHolidayDates,
    });
  }, [doctor, shifts, centralAbsencePayload, year, shiftEntitlement, publicHolidayDates]);

  // --- Shift-/Sonderurlaub editing + carry-over ---
  // We keep a local draft for the number input so the field stays
  // responsive while typing; only on explicit save do we PUT it. The
  // default value of `0` is enforced server-side even when no row exists.
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [shiftVacationDraft, setShiftVacationDraft] = useState('0');
  const [carryDialogOpen, setCarryDialogOpen] = useState(false);
  const [hasCarriedThisYear, setHasCarriedThisYear] = useState(false);
  const entitlementKey = ['shift-vacation-entitlement', year, doctor?.id];
  const nextYearKey = (nextYear: number) => ['shift-vacation-entitlement', nextYear, doctor?.id];

  useEffect(() => {
    // Reset the draft when the loaded value changes (year switch, refetch).
    setShiftVacationDraft(
      shiftEntitlement?.shift_vacation_days != null
        ? String(shiftEntitlement.shift_vacation_days)
        : '0'
    );
  }, [shiftEntitlement]);

  const saveShiftVacationMutation = useMutation({
    mutationFn: (shiftVacationDays: number) =>
      api.request('/api/vacation/shift-entitlement', {
        method: 'PUT',
        body: JSON.stringify({
          year,
          doctorId: doctor?.id,
          shift_vacation_days: shiftVacationDays,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entitlementKey });
      toast({ title: 'Gespeichert', description: 'Schichturlaub aktualisiert.' });
    },
    onError: (err: Error) => {
      toast({
        title: 'Fehler',
        description: err.message || 'Speichern fehlgeschlagen.',
        variant: 'destructive',
      });
    },
  });

  const carryOverMutation = useMutation({
    mutationFn: () =>
      api.request('/api/vacation/shift-entitlement/carry-over', {
        method: 'POST',
        body: JSON.stringify({
          fromYear: year,
          toYear: year + 1,
          doctorId: doctor?.id,
        }),
      }),
    onSuccess: (result: { carried_days: number }) => {
      queryClient.invalidateQueries({ queryKey: entitlementKey });
      queryClient.invalidateQueries({ queryKey: nextYearKey(year + 1) });
      setCarryDialogOpen(false);
      setHasCarriedThisYear(true);
      toast({
        title: 'Übertragen',
        description: `${result.carried_days} Tag(e) Schichturlaub ins Jahr ${year + 1} übertragen.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: 'Übertrag nicht möglich',
        description: err.message || 'Der Übertrag ist fehlgeschlagen.',
        variant: 'destructive',
      });
    },
  });

  // Carry-over is offered only when:
  //  - This year's entitlement is NOT itself a carry-over (carried_over
  //    Schichturlaub verfällt am 31.03. und darf nicht weitergetragen werden).
  //  - A carry was not already performed this session (nach erfolgreichem
  //    Übertrag verschwindet der Button sofort).
  //  - There's an actual remainder > 0.
  const shiftVacationRemainder = shiftVacationBalance?.remaining ?? 0;
  const canCarryOver =
    Boolean(shiftEntitlement?.employee_id) &&
    !shiftEntitlement?.carried_over &&
    !hasCarriedThisYear &&
    Number.isFinite(shiftVacationRemainder) &&
    shiftVacationRemainder > 0 &&
    !carryOverMutation.isPending;

  const getShiftStatus = (date: Date): string | null => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const shift = shifts.find(s => s.date === dateStr);
    return shift ? shift.position : null;
  };

    const isDateDisabled = (date: Date): boolean => !isDateWithinContract(date, contractInfo?.contractStart, contractInfo?.contractEnd);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shadow-sm ${doctor.color || "bg-slate-100"}`}>
              {doctor.initials}
          </div>
          <div>
              <h2 className="text-xl font-bold text-slate-900" title={getContractTooltipLabel(contractInfo) || undefined}>{doctor.name}</h2>
              <p className="text-slate-500">{doctor.role} • Jahresplanung {year}</p>
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

      {vacationBalance && (
        <VacationBalanceBox balance={vacationBalance} />
      )}

      {shiftVacationBalance && (
        <ShiftVacationBox
          balance={shiftVacationBalance}
          entitlement={shiftEntitlement ?? null}
          draft={shiftVacationDraft}
          onDraftChange={setShiftVacationDraft}
          onSave={() => {
            const parsed = parseInt(shiftVacationDraft, 10);
            if (!Number.isFinite(parsed) || parsed < 0) {
              toast({
                title: 'Ungültige Eingabe',
                description: 'Bitte eine nicht-negative Ganzzahl eingeben.',
                variant: 'destructive',
              });
              return;
            }
            saveShiftVacationMutation.mutate(parsed);
          }}
          isSaving={saveShiftVacationMutation.isPending}
          canCarryOver={canCarryOver}
          isCarrying={carryOverMutation.isPending}
          onCarryOver={() => setCarryDialogOpen(true)}
          year={year}
        />
      )}

      {/* Carry-over confirmation dialog */}
      <Dialog open={carryDialogOpen} onOpenChange={setCarryDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Schichturlaub ins Folgejahr übertragen?</DialogTitle>
            <DialogDescription>
              Es werden {shiftVacationRemainder} Tag(e) Schichturlaub aus {year}
              {' '}als Schichturlaub-Anspruch in das Jahr {year + 1} übernommen.
              {' '}Regulärer Urlaub bleibt unberührt und wird nicht übertragen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCarryDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={() => carryOverMutation.mutate()} disabled={carryOverMutation.isPending}>
              {carryOverMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <RotateCw className="w-4 h-4 mr-2" />
              )}
              {shiftVacationRemainder} Tag(e) übertragen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


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
                  <Button 
                      onClick={handleSendAbsenceEmail} 
                      disabled={isSendingEmail}
                      className="gap-2"
                  >
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
        {months.map(month => (
          <MonthCalendar 
            key={month.toString()} 
            month={month} 
            getShiftStatus={getShiftStatus}
            onDateClick={(date, e) => {
                // If we were dragging a range, don't trigger click toggle
                if (isDateDisabled(date) || (isDragging && dragStart && dragCurrent && !isSameDay(dragStart, dragCurrent))) {
                    return;
                }
                onToggle(date, getShiftStatus(date), e);
            }}
            onMouseDown={(date) => {
                if (!isDateDisabled(date)) handleMouseDown(date);
            }}
            onMouseEnter={(date) => {
                if (!isDateDisabled(date)) handleMouseEnter(date);
            }}
            dragStart={dragStart}
            dragCurrent={dragCurrent}
            isDragging={isDragging}
            activeType={activeType}
            rangeStart={rangeStart}
            contractInfo={contractInfo}
            isDateDisabled={isDateDisabled}
            customColors={propCustomColors}
            getCustomColor={getCustomColor}
            isSchoolHoliday={isSchoolHoliday}
            isPublicHoliday={isPublicHoliday}
            dayTestIdPrefix={dayTestIdPrefix}
          />
        ))}
      </div>
    </div>
  );
}

function MonthCalendar({ month, getShiftStatus, onDateClick, onMouseDown, onMouseEnter, dragStart, dragCurrent, isDragging, activeType, rangeStart, contractInfo, isDateDisabled, customColors, getCustomColor, isSchoolHoliday: checkSchoolHoliday, isPublicHoliday: checkPublicHoliday, dayTestIdPrefix }: MonthCalendarProps) {
  const days = eachDayOfInterval({
    start: startOfMonth(month),
    end: endOfMonth(month)
  });

  const startDay = getDay(startOfMonth(month));
  const emptyDays = (startDay + 6) % 7;

  return (
    <div className="border rounded-md p-3">
      <div className="font-bold text-center mb-2 text-slate-700 capitalize">
        {format(month, 'MMMM', { locale: de })}
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs mb-1">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => (
          <div key={d} className="text-center text-slate-400 font-medium">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-sm">
        {Array(emptyDays).fill(null).map((_, i) => <div key={`empty-${i}`} />)}
        {days.map(date => {
          const status = getShiftStatus(date);
                    const disabled = isDateDisabled ? isDateDisabled(date) : false;
                    const isContractEnd = Boolean(contractInfo?.contractEnd) && format(date, 'yyyy-MM-dd') === contractInfo.contractEnd;
          const isWeekendDay = isWeekend(date);
          // Use passed functions or defaults if missing
          const isHoliday = checkPublicHoliday ? checkPublicHoliday(date) : false;
          const isSchoolHoliday = checkSchoolHoliday ? checkSchoolHoliday(date) : false;
          const isRangeStart = rangeStart && isSameDay(date, rangeStart);
          
          const isDragged = isDragging && dragStart && dragCurrent && isWithinInterval(date, {
              start: dragStart < dragCurrent ? dragStart : dragCurrent,
              end: dragCurrent > dragStart ? dragCurrent : dragStart
          });

          // Color mapping
          let colorClass = "";
          let style: React.CSSProperties = {};

          const dynamicColor = status ? getCustomColor(status) : null;

          if (disabled) {
              style = {
                  backgroundColor: '#f8fafc',
                  backgroundImage: 'repeating-linear-gradient(135deg, rgba(148, 163, 184, 0.22) 0, rgba(148, 163, 184, 0.22) 4px, transparent 4px, transparent 10px)'
              };
              colorClass = "text-slate-300 cursor-not-allowed";
          } else if (customColors && customColors[status]) {
              const colorVal = customColors[status];
              if (typeof colorVal === 'object' && colorVal !== null && 'backgroundColor' in colorVal) {
                  // Inline style object (new format from Training & Vacation)
                  style = colorVal;
                  colorClass = "hover:opacity-90 font-medium";
              } else if (typeof colorVal === 'string') {
                  // Legacy Tailwind class string
                  colorClass = `${colorVal} text-white hover:opacity-90`;
              }
          } else if (dynamicColor) {
              style = dynamicColor;
              colorClass = "hover:opacity-90 font-medium";
          } else if (status === 'Urlaub') colorClass = "bg-green-500 text-white hover:bg-green-600";
          else if (status === 'Schichturlaub') colorClass = "bg-cyan-500 text-white hover:bg-cyan-600";
          else if (status === 'Frei') colorClass = "bg-slate-500 text-white hover:bg-slate-600";
          else if (status === 'Krank') colorClass = "bg-red-500 text-white hover:bg-red-600";
          else if (status === 'Dienstreise') colorClass = "bg-blue-500 text-white hover:bg-blue-600";
          else if (status === 'Nicht verfügbar') colorClass = "bg-orange-500 text-white hover:bg-orange-600";
          else if (status) colorClass = "bg-slate-200 text-slate-500"; 
          else if (isHoliday) {
              colorClass = "text-blue-900 hover:bg-blue-200 font-medium";
              style = { 
                  backgroundColor: '#eff6ff', // blue-50
                  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(59, 130, 246, 0.1) 5px, rgba(59, 130, 246, 0.1) 10px)'
              };
          }
          else if (isSchoolHoliday) {
              colorClass = "text-green-900 hover:bg-green-200";
              style = { 
                  backgroundColor: '#f0fdf4', // green-50
                  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(34, 197, 94, 0.1) 5px, rgba(34, 197, 94, 0.1) 10px)'
              };
          }
          else if (isWeekendDay) colorClass = "bg-slate-50 text-slate-400 hover:bg-slate-100";
          else colorClass = "hover:bg-slate-100 text-slate-700";

          if (isRangeStart && !disabled) {
              colorClass += " ring-2 ring-indigo-500 ring-offset-1 z-10";
          }
          
          if (isDragged && !disabled) {
              colorClass += " ring-2 ring-indigo-400 ring-offset-1 z-20 opacity-80";
          }

          return (
            <button
              key={date.toString()}
              data-testid={`${dayTestIdPrefix}-${format(date, 'yyyy-MM-dd')}`}
                            onMouseDown={() => {
                                if (!disabled) onMouseDown(date);
                            }}
                            onMouseEnter={() => {
                                if (!disabled) onMouseEnter(date);
                            }}
                            onClick={(e) => {
                                if (!disabled) onDateClick(date, e);
                            }}
              className={cn(
                                "aspect-square flex items-center justify-center rounded-sm transition-colors text-xs sm:text-sm select-none relative",
                colorClass
              )}
              style={style}
                            title={disabled ? `Außerhalb der Vertragslaufzeit ${format(date, 'dd.MM.yyyy')}` : (status || (isHoliday ? 'Feiertag' : isSchoolHoliday ? 'Ferien' : '') + ' ' + format(date, 'dd.MM.yyyy'))}
            >
              {format(date, 'd')}
                            {isContractEnd && (
                                <span className="pointer-events-none absolute inset-y-0 right-0 w-[2px] bg-rose-500" aria-hidden="true" />
                            )}
            </button>
          );
          })}
      </div>
    </div>
  );
}

/**
 * Compact 4-card vacation balance overview.
 * Shown above the year calendar. Highlights overshoot with a warning
 * banner + AlertTriangle so planers immediately see when a Mitarbeiter
 * has been overbooked.
 */
function VacationBalanceBox({ balance }: VacationBalanceBoxProps) {
  const colorMap: Record<string, string> = {
    slate: 'text-slate-900',
    blue: 'text-blue-700',
    emerald: 'text-emerald-700',
    red: 'text-red-700',
    amber: 'text-amber-700',
  };

  const cards = [
    { icon: Sun, label: 'Jahresanspruch', value: balance.total, suffix: 'Tage', color: 'slate' },
    { icon: CalendarCheck, label: 'Genommen', value: balance.taken, suffix: 'Tage', color: 'blue' },
    { icon: CalendarDays, label: 'Geplant', value: balance.planned, suffix: 'Tage', color: 'amber' },
    {
      icon: balance.overshoot ? AlertTriangle : CalendarDays,
      label: 'Resturlaub',
      value: balance.remaining,
      suffix: 'Tage',
      color: balance.overshoot ? 'red' : (balance.remaining < 5 ? 'red' : 'emerald'),
    },
  ];

  return (
    <div
      data-testid="vacation-balance-box"
      className={cn(
        'mb-6 rounded-xl border p-3',
        balance.overshoot
          ? 'border-red-200 bg-red-50'
          : 'border-slate-200 bg-slate-50'
      )}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map(({ icon: Icon, label, value, suffix, color }) => (
          <div
            key={label}
            className="p-3 bg-white rounded-lg border border-slate-200"
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className={cn('w-4 h-4', balance.overshoot && label === 'Resturlaub' ? 'text-red-500' : 'text-slate-400')} />
              <span className="text-xs text-slate-500">{label}</span>
            </div>
            <p className={cn('text-xl font-bold', colorMap[color])}>
              {value}
              {suffix && <span className="text-sm font-normal text-slate-400"> {suffix}</span>}
            </p>
          </div>
        ))}
      </div>
      {balance.overshoot && (
        <div
          data-testid="vacation-overshoot-warning"
          className="mt-3 flex items-start gap-2 text-sm text-red-700"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Urlaubskontingent überschritten:</strong> Für diesen Mitarbeiter sind
            {' '}
            <strong>{Math.abs(balance.remaining)} Tage</strong> mehr Urlaub geplant als
            der Jahresanspruch ({balance.total} Tage) erlaubt. Bitte Einträge prüfen und
            ggf. entfernen.
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Separate balance box for Schichturlaub (shift-/Sonderurlaub).
 *
 * Mirrors the layout of `VacationBalanceBox` but adds an inline input
 * to edit the year-specific entitlement (default 0) and a "carry over"
 * button that the planner uses to transfer the remainder into the next
 * year. Carry-over is only offered when a positive remainder exists;
 * this is the only place where the rule "nur Schichturlaub darf ins
 * Folgejahr übertragen werden" surfaces in the UI.
 *
 * The box is intentionally visually distinct (cyan accent) so planers
 * can tell Schichturlaub apart from regular Urlaub at a glance.
 */
function ShiftVacationBox({
  balance,
  entitlement,
  draft,
  onDraftChange,
  onSave,
  isSaving,
  canCarryOver,
  isCarrying,
  onCarryOver,
  year,
}: ShiftVacationBoxProps) {
  const isLinked = Boolean(entitlement?.employee_id);

  const cards = [
    { label: 'Zusatzurlaub', value: balance.total, suffix: 'Tage' },
    { label: 'Genommen', value: balance.taken, suffix: 'Tage' },
    { label: 'Geplant', value: balance.planned, suffix: 'Tage' },
    { label: 'Rest', value: balance.remaining, suffix: 'Tage' },
  ];

  return (
    <div
      data-testid="shift-vacation-box"
      className={cn(
        'rounded-xl border mb-6',
        balance.overshoot
          ? 'border-red-200 bg-red-50'
          : 'border-cyan-200 bg-cyan-50'
      )}
    >
      <Collapsible defaultOpen={false} className="group">
        <CollapsibleTrigger className="w-full text-left">
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 pb-0">
            <div className="flex items-center gap-2">
              <ChevronRight className="w-4 h-4 text-slate-400 group-open:hidden" />
              <ChevronDown className="w-4 h-4 text-slate-400 hidden group-open:block" />
              <Sun className="w-4 h-4 text-cyan-600" />
              <h3 className="text-sm font-semibold text-slate-800">
                Schicht- &amp; Sonderurlaub {year}
              </h3>
              {entitlement?.carried_over && (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                  Übertrag aus {entitlement.carried_over_from_year ?? 'Vorjahr'}
                </span>
              )}
              {entitlement?.expires_at && (
                <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-800">
                  Verfällt {new Date(entitlement.expires_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              )}
              <span className="inline group-open:hidden text-xs text-slate-500 ml-1">
                {balance.total} Tage · Rest {balance.remaining}
              </span>
            </div>

            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <label
                htmlFor="shift-vacation-days-input"
                className="text-xs text-slate-600"
              >
                Zusatzurlaub {year}
              </label>
              <Input
                id="shift-vacation-days-input"
                type="number"
                min={0}
                step={1}
                value={draft}
                disabled={!isLinked || isSaving}
                onChange={(e) => onDraftChange(e.target.value)}
                className="w-20 h-8"
                data-testid="shift-vacation-days-input"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!isLinked || isSaving}
                onClick={onSave}
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                <span className="ml-1">Speichern</span>
              </Button>
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="px-3 pb-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {cards.map(({ label, value, suffix }) => (
              <div key={label} className="p-3 bg-white rounded-lg border border-slate-200">
                <div className="text-xs text-slate-500 mb-1">{label}</div>
                <p
                  className={cn(
                    'text-xl font-bold',
                    balance.overshoot && label === 'Rest'
                      ? 'text-red-700'
                      : label === 'Rest'
                        ? (value < 0 ? 'text-red-700' : 'text-emerald-700')
                        : 'text-slate-900'
                  )}
                >
                  {value}
                  {suffix && <span className="text-sm font-normal text-slate-400"> {suffix}</span>}
                </p>
              </div>
            ))}
          </div>

          {!isLinked && (
            <div className="mt-3 text-xs text-slate-500 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                Dieser Mitarbeiter ist nicht zentral verknüpft. Die Pflege des
                Zusatzurlaubs ist erst nach Verknüpfung über die zentrale
                Mitarbeiterverwaltung möglich.
              </span>
            </div>
          )}

          {balance.overshoot && (
            <div
              data-testid="shift-vacation-overshoot-warning"
              className="mt-3 flex items-start gap-2 text-sm text-red-700"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                <strong>Schichturlaub überschritten:</strong>{' '}
                {Math.abs(balance.remaining)} Tag(e) mehr gebucht als
                der Zusatzurlaub ({balance.total} Tage) hergibt.
              </span>
            </div>
          )}

          {entitlement?.expires_at && new Date(entitlement.expires_at) < new Date(new Date().toDateString()) && (
            <div
              data-testid="shift-vacation-expired-warning"
              className="mt-3 flex items-start gap-2 text-sm text-red-700"
              role="alert"
            >
              <CalendarX className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                <strong>Schichturlaub abgelaufen:</strong> Der übertragene
                Schichturlaub ist seit dem{' '}
                {new Date(entitlement.expires_at).toLocaleDateString('de-DE', {
                  day: '2-digit', month: '2-digit', year: 'numeric'
                })}{' '}
                verfallen und kann nicht mehr genutzt werden.
              </span>
            </div>
          )}

          {canCarryOver && (
            <div className="mt-3 flex items-center justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canCarryOver}
                onClick={onCarryOver}
                title={`Rest (${balance.remaining} Tage) als Zusatzurlaub ins Jahr ${year + 1} übertragen`}
                data-testid="shift-vacation-carry-over-btn"
              >
                {isCarrying ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <RotateCw className="w-4 h-4 mr-1" />
                )}
                Rest ins Folgejahr ({year + 1}) übertragen
              </Button>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
