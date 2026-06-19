import { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { RotateCcw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const WEEKDAYS = [
  { index: 1, short: 'Mo', long: 'Montag' },
  { index: 2, short: 'Di', long: 'Dienstag' },
  { index: 3, short: 'Mi', long: 'Mittwoch' },
  { index: 4, short: 'Do', long: 'Donnerstag' },
  { index: 5, short: 'Fr', long: 'Freitag' },
  { index: 6, short: 'Sa', long: 'Samstag' },
  { index: 0, short: 'So', long: 'Sonntag' },
];

function getJSWeekday(date) {
  // date-fns getDay: 0=Sunday, 1=Monday ... 6=Saturday
  return getDay(date);
}

export default function WeekdayRecurrenceDialog({
  open,
  onOpenChange,
  absenceTypes,
  activeType,
  selectedYear,
  selectedDoctorId,
  onApply,
}) {
  const [selectedWeekdays, setSelectedWeekdays] = useState([]);
  const [targetMonth, setTargetMonth] = useState(new Date().getMonth());
  const [targetYear, setTargetYear] = useState(selectedYear);

  // Fetch existing shifts for the target month to show count
  const targetMonthStart = useMemo(
    () => format(startOfMonth(new Date(targetYear, targetMonth, 1)), 'yyyy-MM-dd'),
    [targetYear, targetMonth],
  );
  const targetMonthEnd = useMemo(
    () => format(endOfMonth(new Date(targetYear, targetMonth, 1)), 'yyyy-MM-dd'),
    [targetYear, targetMonth],
  );

  const { data: existingShifts = [] } = useQuery({
    queryKey: ['shifts', targetYear, targetMonth, selectedDoctorId],
    queryFn: () =>
      db.ShiftEntry.filter({
        doctor_id: selectedDoctorId,
        date: { $gte: targetMonthStart, $lte: targetMonthEnd },
      }),
    enabled: Boolean(selectedDoctorId) && open,
    staleTime: 10_000,
  });

  // Reset state when dialog opens
  const handleOpenChange = (next) => {
    if (next) {
      setSelectedWeekdays([]);
      setTargetMonth(new Date().getMonth());
      setTargetYear(selectedYear);
    }
    onOpenChange(next);
  };

  const toggleWeekday = (index) => {
    setSelectedWeekdays((prev) =>
      prev.includes(index)
        ? prev.filter((d) => d !== index)
        : [...prev, index],
    );
  };

  // Compute which dates in the target month match selected weekdays
  const affectedDates = useMemo(() => {
    if (selectedWeekdays.length === 0 || !selectedDoctorId) return [];

    const start = startOfMonth(new Date(targetYear, targetMonth, 1));
    const end = endOfMonth(new Date(targetYear, targetMonth, 1));
    const allDays = eachDayOfInterval({ start, end });

    const weekdaySet = new Set(selectedWeekdays);
    return allDays
      .filter((d) => weekdaySet.has(getJSWeekday(d)))
      .map((d) => format(d, 'yyyy-MM-dd'));
  }, [selectedWeekdays, targetYear, targetMonth, selectedDoctorId]);

  // Count how many of the affected dates already have the active type
  const existingCount = useMemo(() => {
    if (affectedDates.length === 0) return 0;
    const existingDates = new Set(
      existingShifts
        .filter((s) => s.position === activeType)
        .map((s) => s.date),
    );
    return affectedDates.filter((d) => existingDates.has(d)).length;
  }, [affectedDates, existingShifts, activeType]);

  const newCount = affectedDates.length - existingCount;

  const handleApply = () => {
    if (selectedWeekdays.length === 0 || !selectedDoctorId || newCount === 0) {
      return;
    }
    onApply(affectedDates, existingShifts.filter((s) => s.position === activeType));
    handleOpenChange(false);
  };

  const canApply = selectedWeekdays.length > 0 && newCount > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-indigo-600" />
            Wiederkehrende Abwesenheit
          </DialogTitle>
          <DialogDescription>
            Trage für einen ganzen Monat denselben Abwesenheitsstatus an
            bestimmten Wochentagen ein.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Wochentage */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">
              Wochentage auswählen
            </Label>
            <div className="flex gap-2">
              {WEEKDAYS.map(({ index, short, long }) => (
                <label
                  key={index}
                  className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    selectedWeekdays.includes(index)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  title={long}
                >
                  <input
                    type="checkbox"
                    checked={selectedWeekdays.includes(index)}
                    onChange={() => toggleWeekday(index)}
                    className="sr-only"
                  />
                  {short}
                </label>
              ))}
            </div>
          </div>

          {/* Monat / Jahr */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-700">
                Monat
              </Label>
              <Select
                value={String(targetMonth)}
                onValueChange={(v) => setTargetMonth(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {format(new Date(2000, i, 1), 'MMMM', { locale: de })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-700">
                Jahr
              </Label>
              <Select
                value={String(targetYear)}
                onValueChange={(v) => setTargetYear(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[targetYear - 1, targetYear, targetYear + 1, targetYear + 2].map(
                    (y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-700">
              Status
            </Label>
            <div className="flex flex-wrap gap-2">
              {absenceTypes
                .filter((t) => t.id !== 'DELETE')
                .map((type) => (
                  <Button
                    key={type.id}
                    variant={activeType === type.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      /* activeType is managed by parent */
                    }}
                    className="pointer-events-none gap-2"
                    style={
                      activeType === type.id
                        ? {
                            backgroundColor: type.bgColor,
                            color: type.textColor,
                            borderColor: 'transparent',
                          }
                        : {}
                    }
                  >
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: type.bgColor }}
                    />
                    {type.label}
                  </Button>
                ))}
            </div>
            <p className="text-xs text-slate-400">
              Der aktuell ausgewählte Status wird verwendet. Ändere ihn über
              die Status-Leiste oberhalb.
            </p>
          </div>

          {/* Zusammenfassung */}
          {selectedWeekdays.length > 0 && (
            <div className="rounded-lg border bg-slate-50 p-3 text-sm">
              <div className="font-medium text-slate-700">Zusammenfassung</div>
              <div className="mt-1 space-y-0.5 text-slate-500">
                <p>
                  {selectedWeekdays
                    .map(
                      (i) =>
                        WEEKDAYS.find((w) => w.index === i)?.long,
                    )
                    .join(', ')}{' '}
                  im{' '}
                  {format(new Date(targetYear, targetMonth, 1), 'MMMM yyyy', {
                    locale: de,
                  })}
                </p>
                <p>
                  <span className="font-medium">{affectedDates.length}</span>{' '}
                  Tage insgesamt
                  {existingCount > 0 && (
                    <span>
                      , davon{' '}
                      <span className="font-medium text-green-600">
                        {existingCount}
                      </span>{' '}
                      bereits vorhanden
                    </span>
                  )}
                  {newCount > 0 && (
                    <span>
                      ,{' '}
                      <span className="font-medium text-indigo-600">
                        {newCount} neu
                      </span>
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleApply} disabled={!canApply}>
            {newCount > 0
              ? `${newCount} Einträge erstellen`
              : 'Anwenden'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
