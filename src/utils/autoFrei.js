import { addDays, format, parseISO } from 'date-fns';

export function getAutoFreiDate(dateStr, isPublicHoliday) {
    const nextDay = addDays(parseISO(dateStr), 1);
    const dayOfWeek = nextDay.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = Boolean(isPublicHoliday?.(nextDay));

    if (isWeekend || isHoliday) {
        return null;
    }

    return format(nextDay, 'yyyy-MM-dd');
}
