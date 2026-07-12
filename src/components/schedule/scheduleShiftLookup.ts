interface ShiftEntry {
    id: string;
    date: string;
    position: string;
    order?: number;
    timeslot_id?: string;
    doctor_id?: string;
}

interface ShiftLookup {
    byDatePosition: Map<string, ShiftEntry[]>;
    byId: Map<string, ShiftEntry>;
}

export function createScheduleShiftLookup(shifts: ShiftEntry[] = []): ShiftLookup {
    const byDatePosition = new Map<string, ShiftEntry[]>();
    const byId = new Map<string, ShiftEntry>();

    for (const shift of shifts) {
        if (!shift?.date || !shift?.position) continue;

        byId.set(shift.id, shift);

        const key = getDatePositionKey(shift.date, shift.position);
        const existing = byDatePosition.get(key);
        if (existing) {
            existing.push(shift);
        } else {
            byDatePosition.set(key, [shift]);
        }
    }

    for (const shiftsForCell of byDatePosition.values()) {
        shiftsForCell.sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    return { byDatePosition, byId };
}

export function getDatePositionKey(dateStr: string, positionName: string): string {
    return `${dateStr}__${positionName}`;
}

export function getShiftsForScheduleCell({
    shiftLookup,
    dateStr,
    rowName,
    timeslotId = null,
    allTimeslotIds = null,
    singleTimeslotId = null,
    timeslotsEnabled = false,
}: {
    shiftLookup: ShiftLookup;
    dateStr: string;
    rowName: string;
    timeslotId?: string | null;
    allTimeslotIds?: string[] | null;
    singleTimeslotId?: string | null;
    timeslotsEnabled?: boolean;
}): ShiftEntry[] {
    const candidates = shiftLookup.byDatePosition.get(getDatePositionKey(dateStr, rowName)) || [];

    if (candidates.length === 0) return [];

    let shifts = candidates.filter((shift) => {
        if (singleTimeslotId) {
            return shift.timeslot_id === singleTimeslotId || !shift.timeslot_id;
        }

        if (allTimeslotIds && allTimeslotIds.length > 0) {
            return allTimeslotIds.includes(shift.timeslot_id || '') || !shift.timeslot_id;
        }

        if (timeslotId === '__unassigned__') {
            return !shift.timeslot_id;
        }

        if (timeslotId !== null) {
            return shift.timeslot_id === timeslotId;
        }

        if (timeslotsEnabled) {
            return false;
        }

        return true;
    });

    if (allTimeslotIds && allTimeslotIds.length > 0) {
        const seenDoctorIds = new Set<string>();
        shifts = shifts.filter((shift) => {
            if (!shift.doctor_id || seenDoctorIds.has(shift.doctor_id)) {
                return false;
            }
            seenDoctorIds.add(shift.doctor_id);
            return true;
        });
    }

    return shifts;
}
