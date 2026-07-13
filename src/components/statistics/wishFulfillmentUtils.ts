import { getWishEndDate, getWishStartDate } from '@/utils/wishRange';
import type { Doctor, ShiftEntry, WishRequest } from '@/types';

interface WishFulfillmentStats {
    name: string;
    role: string | null | undefined;
    total: number;
    fulfilled: number;
    rate: number;
    approved: number;
    rejected: number;
}

function groupByDoctorId(items: ShiftEntry[] | WishRequest[]): Map<string, (ShiftEntry | WishRequest)[]> {
    const grouped = new Map<string, (ShiftEntry | WishRequest)[]>();

    items.forEach((item) => {
        if (!item?.doctor_id) {
            return;
        }

        if (!grouped.has(item.doctor_id)) {
            grouped.set(item.doctor_id, []);
        }

        grouped.get(item.doctor_id)!.push(item);
    });

    return grouped;
}

function isServiceShift(shift: ShiftEntry): boolean {
    return shift.position.includes('Dienst') || shift.position === 'Spätdienst';
}

export function buildWishFulfillmentStats({ doctors = [], wishes = [], shifts = [] }: {
    doctors: Doctor[];
    wishes: WishRequest[];
    shifts: ShiftEntry[];
}): WishFulfillmentStats[] {
    const wishesByDoctor = groupByDoctorId(wishes);
    const shiftsByDoctor = groupByDoctorId(shifts);

    return doctors
        .map((doctor) => {
            const doctorWishes = wishesByDoctor.get(doctor.id) || [];
            if (doctorWishes.length === 0) {
                return null;
            }

            const doctorShifts = (shiftsByDoctor.get(doctor.id) || []) as ShiftEntry[];
            let fulfilled = 0;
            let approved = 0;
            let rejected = 0;

            doctorWishes.forEach((wish) => {
                const typedWish = wish as WishRequest;
                if (typedWish.status === 'approved') approved += 1;
                if (typedWish.status === 'rejected') rejected += 1;

                const wishStartDate = getWishStartDate(typedWish);
                const wishEndDate = getWishEndDate(typedWish) || wishStartDate;
                const shiftsInRange = wishStartDate
                    ? doctorShifts.filter((shift) => shift.date >= wishStartDate && shift.date <= (wishEndDate ?? ''))
                    : [];

                const hasServiceShift = shiftsInRange.some(isServiceShift);
                const isFulfilled = typedWish.type === 'service' ? hasServiceShift : !hasServiceShift;

                if (isFulfilled) {
                    fulfilled += 1;
                }
            });

            const total = doctorWishes.length;

            return {
                name: doctor.name,
                role: doctor.role,
                total,
                fulfilled,
                rate: total > 0 ? Math.round((fulfilled / total) * 100) : 0,
                approved,
                rejected,
            };
        })
        .filter((item): item is WishFulfillmentStats => item !== null)
        .sort((a, b) => b.rate - a.rate);
}
