import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { format, addMonths, startOfMonth } from 'date-fns';
import { de } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, CheckCircle2, Clock, AlertCircle, FileText, Loader2 } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STATUS_CONFIG = {
  has_wishes: {
    label: 'Wünsche eingetragen',
    icon: FileText,
    color: 'bg-blue-100 text-blue-700 border-blue-200',
    dotColor: 'bg-blue-500',
  },
  acknowledged: {
    label: 'Keine Wünsche (bestätigt)',
    icon: CheckCircle2,
    color: 'bg-green-100 text-green-700 border-green-200',
    dotColor: 'bg-green-500',
  },
  sent: {
    label: 'Erinnerung gesendet',
    icon: Clock,
    color: 'bg-amber-100 text-amber-700 border-amber-200',
    dotColor: 'bg-amber-500',
  },
  no_reminder: {
    label: 'Keine Erinnerung',
    icon: AlertCircle,
    color: 'bg-slate-100 text-slate-500 border-slate-200',
    dotColor: 'bg-slate-400',
  },
};

/**
 * Shows wish reminder acknowledgment status for a given target month.
 * Admin-only component displayed on WishList and Dashboard.
 * 
 * @param {Object} props
 * @param {string} props.targetMonth - Format: "YYYY-MM"
 * @param {boolean} [props.compact=false] - Show compact summary only (for Dashboard)
 */
export default function WishReminderStatus({ targetMonth, compact = false }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['wish-reminder-status', targetMonth],
    queryFn: async () => {
      const res = await api.fetch(`/api/staff/wish-reminder-status?month=${targetMonth}`);
      if (!res.ok) throw new Error('Fehler beim Laden des Erinnerungsstatus');
      return res.json();
    },
    enabled: !!targetMonth,
    refetchInterval: 60000, // Refresh every minute
  });

  if (isLoading) {
    return compact ? null : (
      <div className="flex items-center gap-2 text-sm text-slate-400 p-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Lade Erinnerungsstatus...
      </div>
    );
  }

  if (error || !data) return null;

  const { stats, doctors: doctorStatuses } = data;

  // Don't show anything if no reminders were sent at all
  const hasAnyReminders = stats.sent > 0 || stats.acknowledged > 0 || stats.has_wishes > 0;
  if (!hasAnyReminders) return null;

  // Compact mode for Dashboard
  if (compact) {
    const responded = stats.acknowledged + stats.has_wishes;
    const total = stats.sent + stats.acknowledged + stats.has_wishes;
    const allDone = stats.sent === 0;

    return (
      <div className="flex items-center gap-2">
        <Mail className={`w-4 h-4 ${allDone ? 'text-green-600' : 'text-amber-600'}`} />
        <span className="text-sm">
          Erinnerung: <strong>{responded}/{total}</strong> haben reagiert
        </span>
        {stats.sent > 0 && (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
            {stats.sent} offen
          </Badge>
        )}
        {allDone && (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
            Alle erledigt
          </Badge>
        )}
      </div>
    );
  }

  // Full mode for WishList
  const targetMonthFormatted = (() => {
    try {
      const [y, m] = targetMonth.split('-').map(Number);
      return format(new Date(y, m - 1, 1), 'MMMM yyyy', { locale: de });
    } catch {
      return targetMonth;
    }
  })();

  return (
    <Card className="border-indigo-100 shadow-sm mb-4">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-indigo-900">
          <Mail className="w-4 h-4 text-indigo-600" />
          Erinnerungsstatus – {targetMonthFormatted}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        {/* Summary bar */}
        <div className="flex gap-3 mb-3 text-xs">
          {stats.has_wishes > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
              {stats.has_wishes} Wünsche eingetragen
            </span>
          )}
          {stats.acknowledged > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              {stats.acknowledged} ohne Wünsche (bestätigt)
            </span>
          )}
          {stats.sent > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
              {stats.sent} ausstehend
            </span>
          )}
        </div>

        {/* Doctor list */}
        <TooltipProvider>
          <div className="flex flex-wrap gap-1.5">
            {doctorStatuses
              .filter(d => d.reminder_status !== 'no_reminder')
              .map(d => {
                const cfg = STATUS_CONFIG[d.reminder_status];
                const Icon = cfg.icon;
                return (
                  <Tooltip key={d.doctor_id}>
                    <TooltipTrigger asChild>
                      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${cfg.color} cursor-default`}>
                        <Icon className="w-3 h-3" />
                        {d.initials || d.name.split(' ').map(n => n[0]).join('')}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-medium">{d.name}</p>
                      <p className="text-xs text-slate-500">{cfg.label}</p>
                      {d.acknowledged_date && (
                        <p className="text-xs text-slate-400 mt-1">
                          Bestätigt am {new Date(d.acknowledged_date).toLocaleDateString('de-DE')}
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
