import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import {
  CalendarDays, Plus, Trash2, MapPin, Eye,
  ChevronLeft, ChevronRight, Sun, Flag, AlertTriangle,
  Info, Shield
} from 'lucide-react';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { de } from 'date-fns/locale';

/**
 * MasterHolidays – Zentrale Feiertage- und Ferienverwaltung
 * 
 * Nur im Master-Frontend verfügbar (Admin only).
 * Alle Mandanten beziehen ihre Feiertage/Ferien von hier.
 */

// Monats-Kalender Helper
function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Monday = 0
}

export default function MasterHolidays() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [previewYear, setPreviewYear] = useState(currentYear);
  const [newHoliday, setNewHoliday] = useState({
    name: '', start_date: '', end_date: '', type: 'public', action: 'add'
  });

  // --- Data Fetching ---

  // Central settings
  const { data: settingsData, isLoading: isLoadingSettings } = useQuery({
    queryKey: ['masterHolidaySettings'],
    queryFn: () => api.request('/api/master/holidays/settings'),
  });

  // Custom corrections
  const { data: customHolidays = [], isLoading: isLoadingCustom } = useQuery({
    queryKey: ['masterCustomHolidays'],
    queryFn: () => api.request('/api/master/holidays/custom'),
  });

  // Preview resolved holidays
  const { data: previewData, isLoading: isLoadingPreview } = useQuery({
    queryKey: ['masterHolidayPreview', previewYear],
    queryFn: () => api.request(`/api/holidays?year=${previewYear}`),
    staleTime: 0, // Always refetch when custom holidays change
  });

  const settings = settingsData?.settings || {};
  const states = settingsData?.states || {};
  const federalState = settings.federal_state || 'MV';

  const publicHolidays = previewData?.public || [];
  const schoolHolidays = previewData?.school || [];

  // --- Mutations ---

  const updateSettingMutation = useMutation({
    mutationFn: ({ key, value }) => api.request('/api/master/holidays/settings', {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries(['masterHolidaySettings']);
      queryClient.invalidateQueries(['masterHolidayPreview']);
      toast({ title: 'Einstellung gespeichert', description: `${variables.key} aktualisiert.` });
    },
    onError: (err) => toast({ title: 'Fehler', description: err.message, variant: 'destructive' }),
  });

  const createHolidayMutation = useMutation({
    mutationFn: (data) => api.request('/api/master/holidays/custom', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['masterCustomHolidays']);
      queryClient.invalidateQueries(['masterHolidayPreview']);
      setNewHoliday({ name: '', start_date: '', end_date: '', type: 'public', action: 'add' });
      toast({ title: 'Korrektur gespeichert', description: 'Der Eintrag wurde zentral hinzugefügt.' });
    },
    onError: (err) => toast({ title: 'Fehler', description: err.message, variant: 'destructive' }),
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: (id) => api.request(`/api/master/holidays/custom/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries(['masterCustomHolidays']);
      queryClient.invalidateQueries(['masterHolidayPreview']);
      toast({ title: 'Eintrag gelöscht' });
    },
    onError: (err) => toast({ title: 'Fehler', description: err.message, variant: 'destructive' }),
  });

  const handleAddHoliday = () => {
    if (!newHoliday.name || !newHoliday.start_date) {
      toast({ title: 'Pflichtfelder fehlen', description: 'Name und Startdatum sind erforderlich.', variant: 'destructive' });
      return;
    }
    createHolidayMutation.mutate(newHoliday);
  };

  // --- Calendar helpers for preview ---
  const publicHolidayDates = useMemo(() => {
    const set = new Set();
    publicHolidays.forEach(h => set.add(h.date));
    return set;
  }, [publicHolidays]);

  const schoolRemovals = previewData?.schoolRemovals || [];

  const isSchoolHoliday = (dateStr) => {
    // Check if date is in a removal range
    const isRemoved = schoolRemovals.some(r => dateStr >= r.start && dateStr <= r.end);
    if (isRemoved) return false;
    return schoolHolidays.some(range => {
      if (!range.start || !range.end) return false;
      return dateStr >= range.start && dateStr <= range.end;
    });
  };

  // Mini calendar component
  const MiniMonth = ({ year, month }) => {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const days = [];

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isPublic = publicHolidayDates.has(dateStr);
      const isSchool = isSchoolHoliday(dateStr);
      const dayOfWeek = new Date(year, month, day).getDay();
      const isSunday = dayOfWeek === 0;
      const isSaturday = dayOfWeek === 6;

      let bgClass = '';
      let textClass = 'text-slate-700';

      if (isPublic) {
        bgClass = 'bg-red-100';
        textClass = 'text-red-700 font-semibold';
      } else if (isSchool) {
        bgClass = 'bg-green-50';
        textClass = 'text-green-700';
      } else if (isSunday) {
        textClass = 'text-red-400';
      } else if (isSaturday) {
        textClass = 'text-slate-400';
      }

      // Find holiday name for tooltip
      const holiday = publicHolidays.find(h => h.date === dateStr);
      const schoolRange = schoolHolidays.find(r => dateStr >= r.start && dateStr <= r.end);

      days.push(
        <div
          key={day}
          className={`w-7 h-7 flex items-center justify-center text-xs rounded ${bgClass} ${textClass} cursor-default`}
          title={holiday ? holiday.name : (schoolRange ? schoolRange.name : '')}
        >
          {day}
        </div>
      );
    }

    const monthName = new Date(year, month, 1).toLocaleDateString('de-DE', { month: 'long' });

    return (
      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-slate-600 text-center capitalize">{monthName}</h4>
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => (
            <div key={d} className="text-[10px] text-slate-400 font-medium w-7">{d}</div>
          ))}
          {days}
        </div>
      </div>
    );
  };

  const isLoading = isLoadingSettings || isLoadingCustom || isLoadingPreview;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <CalendarDays className="w-6 h-6 text-indigo-600" />
          Feiertage & Ferien
        </h1>
        <p className="text-slate-500 mt-1">
          Zentrale Verwaltung für alle Mandanten. Änderungen gelten sofort für alle Standorte.
        </p>
      </div>

      {/* Info Banner */}
      <Card className="border-indigo-100 bg-indigo-50/30">
        <CardContent className="py-3 flex items-start gap-3">
          <Shield className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
          <div className="text-sm text-indigo-800">
            <p className="font-medium">Zentrale Datenführung</p>
            <p className="text-indigo-600 mt-0.5">
              Feiertage und Schulferien werden automatisch über die OpenHoliday API geladen.
              Hier können Sie das Bundesland wählen und bei Bedarf Korrekturen vornehmen
              (z.B. fehlende Feiertage ergänzen oder fehlerhafte API-Einträge entfernen).
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Settings + Corrections */}
        <div className="lg:col-span-1 space-y-6">
          {/* Bundesland */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Bundesland
              </CardTitle>
              <CardDescription className="text-xs">
                Bestimmt welche Feiertage und Schulferien geladen werden.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={federalState}
                onValueChange={(val) => updateSettingMutation.mutate({ key: 'federal_state', value: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(states).map(([code, name]) => (
                    <SelectItem key={code} value={code}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Korrektur hinzufügen */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Korrektur hinzufügen
              </CardTitle>
              <CardDescription className="text-xs">
                Feiertag/Ferien ergänzen oder einen fehlerhaften API-Eintrag entfernen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Bezeichnung</Label>
                <Input
                  value={newHoliday.name}
                  onChange={e => setNewHoliday({ ...newHoliday, name: e.target.value })}
                  placeholder="z.B. Brückentag"
                  className="h-8"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Start</Label>
                  <Input
                    type="date"
                    value={newHoliday.start_date}
                    onChange={e => setNewHoliday({
                      ...newHoliday,
                      start_date: e.target.value,
                      end_date: e.target.value
                    })}
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Ende</Label>
                  <Input
                    type="date"
                    value={newHoliday.end_date}
                    onChange={e => setNewHoliday({ ...newHoliday, end_date: e.target.value })}
                    className="h-8"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Typ</Label>
                  <Select
                    value={newHoliday.type}
                    onValueChange={v => setNewHoliday({ ...newHoliday, type: v })}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Feiertag</SelectItem>
                      <SelectItem value="school">Schulferien</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Aktion</Label>
                  <Select
                    value={newHoliday.action}
                    onValueChange={v => setNewHoliday({ ...newHoliday, action: v })}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="add">Hinzufügen</SelectItem>
                      <SelectItem value="remove">Entfernen</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                onClick={handleAddHoliday}
                className="w-full h-8"
                size="sm"
                disabled={createHolidayMutation.isPending}
              >
                <Plus className="w-3 h-3 mr-2" />
                Speichern
              </Button>
            </CardContent>
          </Card>

          {/* Bestehende Korrekturen */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Manuelle Korrekturen
              </CardTitle>
              <CardDescription className="text-xs">
                Alle Korrekturen gelten für sämtliche Mandanten.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {customHolidays.length === 0 && (
                  <p className="text-xs text-slate-500 italic text-center py-4">
                    Keine manuellen Korrekturen vorhanden.
                  </p>
                )}
                {customHolidays.map(h => (
                  <div key={h.id} className="flex items-center justify-between text-sm border p-2 rounded bg-white">
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {h.name}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${h.action === 'add' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {h.action === 'add' ? '+ hinzugefügt' : '− entfernt'}
                        </span>
                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                          {h.type === 'school' ? 'Ferien' : 'Feiertag'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {format(parseISO(h.start_date), 'dd.MM.yyyy')}
                        {h.end_date && h.end_date !== h.start_date && ` – ${format(parseISO(h.end_date), 'dd.MM.yyyy')}`}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-500 hover:text-red-700"
                      onClick={() => deleteHolidayMutation.mutate(h.id)}
                      disabled={deleteHolidayMutation.isPending}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Calendar Preview */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    Vorschau – So sehen es die Mandanten
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    {states[federalState] || federalState} · {publicHolidays.length} Feiertage · {schoolHolidays.length} Ferienperioden
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setPreviewYear(y => y - 1)}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm font-semibold w-12 text-center">{previewYear}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setPreviewYear(y => y + 1)}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingPreview ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {/* Legend */}
                  <div className="flex items-center gap-4 mb-4 text-xs text-slate-500">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 rounded bg-red-100 border border-red-200" />
                      Feiertag
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 rounded bg-green-50 border border-green-200" />
                      Schulferien
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-red-400 font-semibold">So</span>
                      Sonntag
                    </div>
                  </div>

                  {/* Calendar Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                    {Array.from({ length: 12 }, (_, i) => (
                      <MiniMonth key={i} year={previewYear} month={i} />
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Feiertage-Liste */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Flag className="w-4 h-4 text-red-500" />
                  Feiertage {previewYear}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {publicHolidays.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">Keine Feiertage geladen.</p>
                  ) : (
                    publicHolidays.map((h, i) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                        <span className="text-slate-700">{h.name}</span>
                        <span className="text-slate-500 tabular-nums">
                          {format(parseISO(h.date), 'EEE, dd.MM.', { locale: de })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sun className="w-4 h-4 text-green-500" />
                  Schulferien {previewYear}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {schoolHolidays.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">Keine Schulferien geladen.</p>
                  ) : (
                    schoolHolidays.map((h, i) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                        <span className="text-slate-700">{h.name}</span>
                        <span className="text-slate-500 tabular-nums">
                          {format(parseISO(h.start), 'dd.MM.')} – {format(parseISO(h.end), 'dd.MM.')}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
