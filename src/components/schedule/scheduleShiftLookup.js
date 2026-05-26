export function createScheduleShiftLookup(shifts = []) {
    const byDatePosition = new Map();
    const byId = new Map();

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

export function getDatePositionKey(dateStr, positionName) {
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
}) {
    const candidates = shiftLookup.byDatePosition.get(getDatePositionKey(dateStr, rowName)) || [];

    if (candidates.length === 0) return [];

    let shifts = candidates.filter((shift) => {
        if (singleTimeslotId) {
            return shift.timeslot_id === singleTimeslotId || !shift.timeslot_id;
        }

        if (allTimeslotIds && allTimeslotIds.length > 0) {
            return allTimeslotIds.includes(shift.timeslot_id) || !shift.timeslot_id;
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
        const seenDoctorIds = new Set();
        shifts = shifts.filter((shift) => {
            if (seenDoctorIds.has(shift.doctor_id)) {
                return false;
            }
            seenDoctorIds.add(shift.doctor_id);
            return true;
        });
    }

    return shifts;
}
