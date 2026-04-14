import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/client';
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  parseISO,
  isWithinInterval,
} from 'date-fns';
import { de } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Clock, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { timeToMinutes } from '@/utils/timeslotUtils';
import { isNonWorkingShiftPosition } from '@/utils/shiftPositionUtils';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';

interface Doctor {
  id: number;
  name: string;
  role?: string;
  order?: number;
  [key: string]: unknown;
}

interface Workplace {
  id: number;
  name: string;
  timeslots_enabled?: boolean;
  work_time_percentage?: number;
  [key: string]: unknown;
}

interface Timeslot {
  id: number;
  start_time?: string;
  end_time?: string;
  [key: string]: unknown;
}

interface ShiftEntry {
  id: number;
  doctor_id: number;
  date: string;
  position: string;
  timeslot_id?: number;
  [key: string]: unknown;
}

interface TimeInterval {
  start: number;
  end: number;
}

interface ShiftInterval extends TimeInterval {
  rawDuration: number;
  adjustedDuration: number;
}

/**
 * Berechnet die effektive Arbeitszeit unter Berücksichtigung von Überlappungen
 * @param {Array} intervals - Array von { start: minutes, end: minutes }
 * @returns {number} Gesamtminuten ohne Überlappung
 */
function mergeTimeIntervals(intervals: TimeInterval[]): number {
  if (!intervals || intervals.length === 0) return 0;

  // Sortiere nach Startzeit
  const sorted = [...intervals].sort((a, b) => a.start - b.start);

  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      // Überlappung: Erweitere das letzte Intervall
      last.end = Math.max(last.end, current.end);
    } else {
      // Keine Überlappung: Neues Intervall
      merged.push(current);
    }
  }

  // Summiere alle Intervalle
  return merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0);
}

/**
 * Konvertiert eine Schicht in Zeitintervalle (in Minuten seit Mitternacht)
 */
function shiftToInterval(
  shift: ShiftEntry,
  timeslot: Timeslot | null,
  workplace: Workplace | null,
): ShiftInterval {
  const workTimePercentage = (workplace?.work_time_percentage ?? 100) / 100;

  if (timeslot) {
    // Timeslot-basierte Arbeitszeit
    const start = timeToMinutes(timeslot.start_time);
    let end = timeToMinutes(timeslot.end_time);

    // Über Mitternacht
    if (end <= start) {
      end += 24 * 60;
    }

    const duration = (end - start) * workTimePercentage;

    return {
      start,
      end: start + duration,
      rawDuration: end - start,
      adjustedDuration: duration,
    };
  }

  // Ohne Timeslot: Standard 8h Arbeitstag (08:00 - 16:00)
  const defaultStart = 8 * 60; // 08:00
  const defaultEnd = 16 * 60; // 16:00
  const duration = (defaultEnd - defaultStart) * workTimePercentage;

  return {
    start: defaultStart,
    end: defaultStart + duration,
    rawDuration: defaultEnd - defaultStart,
    adjustedDuration: duration,
  };
}

export default function WorkingTimeReport() {
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [viewMode, setViewMode] = useState('month'); // day, week, month, year
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));

  // Dynamische Statistikausschluss-Rollen
  const { statisticsExcludedRoles } = useTeamRoles();

  // Fetch all required data
  const { data: doctors = [] as Doctor[], isLoading: isLoadingDocs } = useQuery<
    Doctor[],
    Error,
    Doctor[]
  >({
    queryKey: ['doctors', statisticsExcludedRoles],
    queryFn: () => db.Doctor.list() as Promise<Doctor[]>,
    select: (data: Doctor[]) =>
      data
        .filter((d) => !d.role || !statisticsExcludedRoles.includes(d.role))
        .sort((a, b) => (a.order || 0) - (b.order || 0)),
  });

  const { data: workplaces = [] as Workplace[], isLoading: isLoadingWorkplaces } = useQuery<
    Workplace[]
  >({
    queryKey: ['workplaces'],
    queryFn: () => db.Workplace.list() as Promise<Workplace[]>,
  });

  const { data: timeslots = [] as Timeslot[], isLoading: isLoadingTimeslots } = useQuery<
    Timeslot[]
  >({
    queryKey: ['workplaceTimeslots'],
    queryFn: () => db.WorkplaceTimeslot.list() as Promise<Timeslot[]>,
  });

  const { data: shifts = [] as ShiftEntry[], isLoading: isLoadingShifts } = useQuery<ShiftEntry[]>({
    queryKey: ['shifts', year],
    queryFn: async (): Promise<ShiftEntry[]> => {
      try {
        return (
          ((await db.ShiftEntry.filter({
            date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
          })) as ShiftEntry[]) || []
        );
      } catch {
        const all = (await db.ShiftEntry.list()) as ShiftEntry[];
        return all.filter((s) => s.date.startsWith(year));
      }
    },
  });

  const isLoading = isLoadingDocs || isLoadingWorkplaces || isLoadingTimeslots || isLoadingShifts;

  // Check if any workplace has timeslots enabled
  const hasTimeslotsEnabled = useMemo(() => {
    return workplaces.some((w) => w.timeslots_enabled) && timeslots.length > 0;
  }, [workplaces, timeslots]);

  // Calculate date range based on view mode
  const dateRange = useMemo(() => {
    if (viewMode === 'day') {
      const date = parseISO(selectedDate);
      return { start: date, end: date };
    } else if (viewMode === 'week') {
      const date = parseISO(selectedDate);
      return {
        start: startOfWeek(date, { weekStartsOn: 1 }),
        end: endOfWeek(date, { weekStartsOn: 1 }),
      };
    } else if (viewMode === 'month') {
      const [y, m] = selectedMonth.split('-');
      const date = new Date(parseInt(y), parseInt(m) - 1, 1);
      return { start: startOfMonth(date), end: endOfMonth(date) };
    } else {
      return {
        start: startOfYear(new Date(parseInt(year), 0, 1)),
        end: endOfYear(new Date(parseInt(year), 0, 1)),
      };
    }
  }, [viewMode, selectedDate, selectedMonth, year]);

  // Calculate working time per doctor
  const workingTimeStats = useMemo(() => {
    if (isLoading || !doctors.length) return [];

    const stats = doctors.map((doctor) => {
      // Filter shifts for this doctor in date range
      const doctorShifts = shifts.filter((s) => {
        if (s.doctor_id !== doctor.id) return false;
        const shiftDate = parseISO(s.date);
        return isWithinInterval(shiftDate, { start: dateRange.start, end: dateRange.end });
      });

      // Group shifts by date
      const shiftsByDate: Record<string, ShiftEntry[]> = {};
      doctorShifts.forEach((shift) => {
        if (!shiftsByDate[shift.date]) {
          shiftsByDate[shift.date] = [];
        }
        shiftsByDate[shift.date].push(shift);
      });

      let totalMinutes = 0;
      let totalDays = 0;
      const dailyDetails: Record<string, { minutes: number; hours: string; shifts: number }> = {};

      // Process each day
      Object.entries(shiftsByDate).forEach(([date, dayShifts]) => {
        const intervals: ShiftInterval[] = [];

        dayShifts.forEach((shift) => {
          const workplace = workplaces.find((w) => w.name === shift.position) ?? null;

          if (isNonWorkingShiftPosition(shift.position)) {
            return;
          }

          const timeslot = shift.timeslot_id
            ? (timeslots.find((t) => t.id === shift.timeslot_id) ?? null)
            : null;

          const interval = shiftToInterval(shift, timeslot, workplace);
          intervals.push(interval);
        });

        if (intervals.length > 0) {
          // Merge overlapping intervals
          const dayMinutes = mergeTimeIntervals(
            intervals.map((i) => ({
              start: i.start,
              end: i.end,
            })),
          );

          totalMinutes += dayMinutes;
          totalDays++;
          dailyDetails[date] = {
            minutes: dayMinutes,
            hours: (dayMinutes / 60).toFixed(1),
            shifts: dayShifts.length,
          };
        }
      });

      return {
        doctor,
        totalMinutes,
        totalHours: (totalMinutes / 60).toFixed(1),
        totalDays,
        avgHoursPerDay: totalDays > 0 ? (totalMinutes / 60 / totalDays).toFixed(1) : '0.0',
        dailyDetails,
      };
    });

    return stats.sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [doctors, shifts, workplaces, timeslots, dateRange, isLoading]);

  // Summary statistics
  const summary = useMemo(() => {
    if (workingTimeStats.length === 0) return null;

    const totalHours = workingTimeStats.reduce((sum, s) => sum + parseFloat(s.totalHours), 0);
    const avgHours = totalHours / workingTimeStats.length;
    const maxHours = Math.max(...workingTimeStats.map((s) => parseFloat(s.totalHours)));
    const minHours = Math.min(
      ...workingTimeStats
        .filter((s) => parseFloat(s.totalHours) > 0)
        .map((s) => parseFloat(s.totalHours)),
    );

    return {
      totalHours: totalHours.toFixed(1),
      avgHours: avgHours.toFixed(1),
      maxHours: maxHours.toFixed(1),
      minHours: minHours > 0 ? minHours.toFixed(1) : '0.0',
    };
  }, [workingTimeStats]);

  const MONTHS = [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ];

  if (!hasTimeslotsEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Arbeitszeitauswertung
          </CardTitle>
          <CardDescription>
            Diese Auswertung ist nur verfügbar, wenn Zeitfenster (Timeslots) für mindestens einen
            Arbeitsplatz aktiviert sind.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-slate-500">
            <Clock className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p>
              Aktivieren Sie Zeitfenster in den Arbeitsplatz-Einstellungen, um diese Auswertung zu
              nutzen.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Arbeitszeitauswertung
            </CardTitle>
            <CardDescription className="flex items-center gap-1 mt-1">
              Kumulierte Anwesenheitszeit pro Mitarbeiter
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="w-3 h-3 text-slate-400" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>
                      Überlappende Arbeitsplätze werden nur einmal gezählt. Dienste können mit einem
                      Arbeitszeitprozentsatz gewichtet werden (z.B. Rufbereitschaft = 70%).
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={viewMode} onValueChange={setViewMode}>
              <TabsList className="h-8">
                <TabsTrigger value="day" className="text-xs px-2">
                  Tag
                </TabsTrigger>
                <TabsTrigger value="week" className="text-xs px-2">
                  Woche
                </TabsTrigger>
                <TabsTrigger value="month" className="text-xs px-2">
                  Monat
                </TabsTrigger>
                <TabsTrigger value="year" className="text-xs px-2">
                  Jahr
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* Date/Period Selection */}
        <div className="flex items-center gap-2 mt-4">
          {(viewMode === 'day' || viewMode === 'week') && (
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
          )}
          {viewMode === 'month' && (
            <div className="flex gap-2">
              <Select
                value={selectedMonth.split('-')[0]}
                onValueChange={(y) => setSelectedMonth(`${y}-${selectedMonth.split('-')[1]}`)}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2024, 2025, 2026, 2027].map((y) => (
                    <SelectItem key={y} value={y.toString()}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={selectedMonth.split('-')[1]}
                onValueChange={(m) => setSelectedMonth(`${selectedMonth.split('-')[0]}-${m}`)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((name, i) => (
                    <SelectItem key={i} value={(i + 1).toString().padStart(2, '0')}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {viewMode === 'year' && (
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2024, 2025, 2026, 2027].map((y) => (
                  <SelectItem key={y} value={y.toString()}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Badge variant="outline" className="ml-2">
            {format(dateRange.start, 'dd.MM.yyyy', { locale: de })} -{' '}
            {format(dateRange.end, 'dd.MM.yyyy', { locale: de })}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-sm text-slate-500">Gesamt</div>
              <div className="text-2xl font-bold text-slate-900">{summary.totalHours}h</div>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg">
              <div className="text-sm text-blue-600">Durchschnitt</div>
              <div className="text-2xl font-bold text-blue-900">{summary.avgHours}h</div>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-sm text-green-600">Maximum</div>
              <div className="text-2xl font-bold text-green-900">{summary.maxHours}h</div>
            </div>
            <div className="p-4 bg-amber-50 rounded-lg">
              <div className="text-sm text-amber-600">Minimum</div>
              <div className="text-2xl font-bold text-amber-900">{summary.minHours}h</div>
            </div>
          </div>
        )}

        {/* Detail Table */}
        <ScrollArea className="h-[400px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mitarbeiter</TableHead>
                <TableHead>Rolle</TableHead>
                <TableHead className="text-right">Arbeitstage</TableHead>
                <TableHead className="text-right">Stunden gesamt</TableHead>
                <TableHead className="text-right">Ø Stunden/Tag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                    Daten werden geladen...
                  </TableCell>
                </TableRow>
              ) : workingTimeStats.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                    Keine Daten für den ausgewählten Zeitraum.
                  </TableCell>
                </TableRow>
              ) : (
                workingTimeStats.map((stat) => (
                  <TableRow key={stat.doctor.id}>
                    <TableCell className="font-medium">{stat.doctor.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {stat.doctor.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{stat.totalDays}</TableCell>
                    <TableCell className="text-right font-semibold">{stat.totalHours}h</TableCell>
                    <TableCell className="text-right text-slate-500">
                      {stat.avgHoursPerDay}h
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
