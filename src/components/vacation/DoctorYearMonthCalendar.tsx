import React from 'react';
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameDay,
  isWeekend,
  isWithinInterval,
  startOfMonth,
} from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';

export interface DoctorYearMonthCalendarProps {
  month: Date;
  getShiftStatus: (date: Date) => string | null;
  onDateClick: (date: Date, e: React.MouseEvent) => void;
  onMouseDown: (date: Date) => void;
  onMouseEnter: (date: Date) => void;
  dragStart: Date | null;
  dragCurrent: Date | null;
  isDragging: boolean;
  rangeStart?: Date | null;
  customColors?: Record<string, string | { backgroundColor: string; color: string }>;
  getCustomColor: (position: string) => { backgroundColor: string; color: string } | null;
  isSchoolHoliday?: (date: Date) => boolean;
  isPublicHoliday?: (date: Date) => boolean;
}

export default function DoctorYearMonthCalendar({
  month,
  getShiftStatus,
  onDateClick,
  onMouseDown,
  onMouseEnter,
  dragStart,
  dragCurrent,
  isDragging,
  rangeStart,
  customColors,
  getCustomColor,
  isSchoolHoliday: checkSchoolHoliday,
  isPublicHoliday: checkPublicHoliday,
}: DoctorYearMonthCalendarProps) {
  const days = eachDayOfInterval({
    start: startOfMonth(month),
    end: endOfMonth(month),
  });

  const startDay = getDay(startOfMonth(month));
  const emptyDays = (startDay + 6) % 7;

  return (
    <div className="border rounded-md p-3">
      <div className="font-bold text-center mb-2 text-slate-700 capitalize">
        {format(month, 'MMMM', { locale: de })}
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs mb-1">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((dayLabel) => (
          <div key={dayLabel} className="text-center text-slate-400 font-medium">
            {dayLabel}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-sm">
        {Array(emptyDays)
          .fill(null)
          .map((_, index) => (
            <div key={`empty-${index}`} />
          ))}
        {days.map((date) => {
          const status = getShiftStatus(date);
          const isWeekendDay = isWeekend(date);
          const isHoliday = checkPublicHoliday ? checkPublicHoliday(date) : false;
          const isSchoolHoliday = checkSchoolHoliday ? checkSchoolHoliday(date) : false;
          const isRangeStart = rangeStart && isSameDay(date, rangeStart);

          const isDragged =
            isDragging &&
            dragStart &&
            dragCurrent &&
            isWithinInterval(date, {
              start: dragStart < dragCurrent ? dragStart : dragCurrent,
              end: dragCurrent > dragStart ? dragCurrent : dragStart,
            });

          let colorClass = '';
          let style = {};

          const dynamicColor = status ? getCustomColor(status) : null;

          if (customColors && status && customColors[status]) {
            const colorVal = customColors[status];
            if (typeof colorVal === 'object' && colorVal.backgroundColor) {
              style = colorVal;
              colorClass = 'hover:opacity-90 font-medium';
            } else if (typeof colorVal === 'string') {
              colorClass = `${colorVal} text-white hover:opacity-90`;
            }
          } else if (dynamicColor) {
            style = dynamicColor;
            colorClass = 'hover:opacity-90 font-medium';
          } else if (status === 'Urlaub') colorClass = 'bg-green-500 text-white hover:bg-green-600';
          else if (status === 'Frei') colorClass = 'bg-slate-500 text-white hover:bg-slate-600';
          else if (status === 'Krank') colorClass = 'bg-red-500 text-white hover:bg-red-600';
          else if (status === 'Dienstreise')
            colorClass = 'bg-blue-500 text-white hover:bg-blue-600';
          else if (status === 'Nicht verfügbar')
            colorClass = 'bg-orange-500 text-white hover:bg-orange-600';
          else if (status) colorClass = 'bg-slate-200 text-slate-500';
          else if (isHoliday) {
            colorClass = 'text-blue-900 hover:bg-blue-200 font-medium';
            style = {
              backgroundColor: '#eff6ff',
              backgroundImage:
                'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(59, 130, 246, 0.1) 5px, rgba(59, 130, 246, 0.1) 10px)',
            };
          } else if (isSchoolHoliday) {
            colorClass = 'text-green-900 hover:bg-green-200';
            style = {
              backgroundColor: '#f0fdf4',
              backgroundImage:
                'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(34, 197, 94, 0.1) 5px, rgba(34, 197, 94, 0.1) 10px)',
            };
          } else if (isWeekendDay) colorClass = 'bg-slate-50 text-slate-400 hover:bg-slate-100';
          else colorClass = 'hover:bg-slate-100 text-slate-700';

          if (isRangeStart) {
            colorClass += ' ring-2 ring-indigo-500 ring-offset-1 z-10';
          }

          if (isDragged) {
            colorClass += ' ring-2 ring-indigo-400 ring-offset-1 z-20 opacity-80';
          }

          return (
            <button
              key={date.toString()}
              onMouseDown={() => onMouseDown(date)}
              onMouseEnter={() => onMouseEnter(date)}
              onClick={(e) => onDateClick(date, e)}
              className={cn(
                'aspect-square flex items-center justify-center rounded-sm transition-colors text-xs sm:text-sm select-none',
                colorClass,
              )}
              style={style}
              title={
                status ||
                `${isHoliday ? 'Feiertag' : isSchoolHoliday ? 'Ferien' : ''} ${format(date, 'dd.MM.yyyy')}`
              }
            >
              {format(date, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}
