export const MIN_CUSTOM_TIMESLOT_DURATION_MINUTES = 5;

interface TimeslotOption {
    id?: string;
    effectiveStartMinutes?: number;
    slotStartMinutes?: number;
    slotEndMinutes?: number;
    effectiveEndMinutes?: number;
}

interface InitialSelection {
    isCustom?: boolean;
    timeslotId?: string;
    endTime?: string;
    startTime?: string;
}

const parseTimeToMinutes = (timeValue: unknown): number | null => {
    if (!timeValue) return null;

    const parts = String(timeValue).split(':');
    if (parts.length < 2) return null;

    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

    return (hours * 60) + minutes;
};

export const getDefaultCustomTimeslotEndMinutes = (option: TimeslotOption): number | null => {
    const startMinutes = Number(option?.effectiveStartMinutes ?? option?.slotStartMinutes);
    const maxEndMinutes = Number(option?.slotEndMinutes);
    const suggestedEndMinutes = Number(option?.effectiveEndMinutes ?? option?.slotEndMinutes);

    if (!Number.isFinite(startMinutes) || !Number.isFinite(maxEndMinutes)) return null;

    const minEndMinutes = Math.min(maxEndMinutes, startMinutes + MIN_CUSTOM_TIMESLOT_DURATION_MINUTES);
    if (!Number.isFinite(suggestedEndMinutes)) {
        return minEndMinutes;
    }

    return Math.max(minEndMinutes, suggestedEndMinutes);
};

export const normalizeCustomTimeslotEndMinutes = (option: TimeslotOption, timeValue: unknown): number | null => {
    const defaultEndMinutes = getDefaultCustomTimeslotEndMinutes(option);
    const parsedMinutes = parseTimeToMinutes(timeValue);
    if (!Number.isFinite(parsedMinutes)) {
        return defaultEndMinutes;
    }

    const startMinutes = Number(option?.effectiveStartMinutes ?? option?.slotStartMinutes);
    const maxEndMinutes = Number(option?.slotEndMinutes);
    if (!Number.isFinite(startMinutes) || !Number.isFinite(maxEndMinutes)) {
        return defaultEndMinutes;
    }

    let normalizedEndMinutes: number = parsedMinutes!;
    // Only treat as overnight when the slot actually spans past midnight
    if (maxEndMinutes > 24 * 60 && normalizedEndMinutes <= startMinutes) {
        normalizedEndMinutes += 24 * 60;
    }

    const minEndMinutes = Math.min(maxEndMinutes, startMinutes + MIN_CUSTOM_TIMESLOT_DURATION_MINUTES);
    return Math.max(minEndMinutes, normalizedEndMinutes);
};

export const buildInitialCustomTimeslotEndMinutesByOption = (
    options: TimeslotOption[] = [],
    initialSelection: InitialSelection | null = null,
): Record<string, number | null> => {
    return options.reduce<Record<string, number | null>>((accumulator, option) => {
        const optionId = option?.id;
        if (!optionId) return accumulator;

        const selectionMatchesOption = Boolean(initialSelection?.isCustom)
            && String(initialSelection?.timeslotId ?? '') === String(optionId);

        accumulator[optionId] = selectionMatchesOption
            ? normalizeCustomTimeslotEndMinutes(option, initialSelection?.endTime)
            : getDefaultCustomTimeslotEndMinutes(option);

        return accumulator;
    }, {});
};

export const normalizeCustomTimeslotStartMinutes = (option: TimeslotOption, timeValue: unknown): number | null => {
    const defaultStartMinutes = option.effectiveStartMinutes ?? option.slotStartMinutes ?? null;
    if (!timeValue) return defaultStartMinutes;

    const parsedMinutes = parseTimeToMinutes(timeValue);
    if (!Number.isFinite(parsedMinutes)) {
        return defaultStartMinutes;
    }

    // Allow start times earlier than the slot's default start.
    // Only ensure a non-negative time and at least MIN_CUSTOM_TIMESLOT_DURATION_MINUTES
    // before the slot end so there's room for a minimal assignment.
    const maxEndMinutes = Number(option?.slotEndMinutes);
    if (Number.isFinite(maxEndMinutes)) {
        const latestStart = maxEndMinutes - MIN_CUSTOM_TIMESLOT_DURATION_MINUTES;
        return Math.min(latestStart, Math.max(0, parsedMinutes!));
    }

    return Math.max(0, parsedMinutes!);
};

export const buildInitialCustomTimeslotStartMinutesByOption = (
    options: TimeslotOption[] = [],
    initialSelection: InitialSelection | null = null,
): Record<string, number | null> => {
    return options.reduce<Record<string, number | null>>((accumulator, option) => {
        const optionId = option?.id;
        if (!optionId) return accumulator;

        const selectionMatchesOption = Boolean(initialSelection?.isCustom)
            && String(initialSelection?.timeslotId ?? '') === String(optionId);

        accumulator[optionId] = selectionMatchesOption && initialSelection?.startTime
            ? normalizeCustomTimeslotStartMinutes(option, initialSelection.startTime)
            : (option.effectiveStartMinutes ?? option.slotStartMinutes ?? null);

        return accumulator;
    }, {});
};
