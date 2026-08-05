import { format } from 'date-fns';
import { isWishOnDate } from '@/utils/wishRange';
import type { WishRequest } from '@/types';

/**
 * Resolve which wish is displayed for a doctor/date cell in the month
 * overview. A "Kein Dienst" (no_service) wish takes precedence over a
 * service wish on the same day: it is the stronger statement and matches
 * how the scheduler / Dienstplan display these days.
 */
export const resolveWishForCell = (
    wishes: WishRequest[],
    doctorId: string,
    date: Date,
    activeType?: string | null,
): WishRequest | undefined => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const doctorDateWishes = wishes.filter(
        (w) => w.doctor_id === doctorId && isWishOnDate(w, dateStr),
    );

    // "Kein Dienst" (no_service) wins over a service wish — either global
    // (no position) or for the active position/tab.
    const noServiceWish = doctorDateWishes.find(
        (w) => w.type === 'no_service' && (!w.position || !activeType || w.position === activeType),
    );
    if (noServiceWish) return noServiceWish;

    if (!activeType) {
        return doctorDateWishes.find((w) => w.type === 'service') || doctorDateWishes[0];
    }

    return doctorDateWishes.find((w) => w.type === 'service' && w.position === activeType);
};
