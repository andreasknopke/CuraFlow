import { describe, expect, it } from 'vitest';

import {
    buildInitialCustomTimeslotEndMinutesByOption,
    getDefaultCustomTimeslotEndMinutes,
    normalizeCustomTimeslotEndMinutes,
} from '../timeslotSelectionUtils';

describe('timeslotSelectionUtils', () => {
    it('uses the effective end time as default custom end time', () => {
        expect(getDefaultCustomTimeslotEndMinutes({
            slotStartMinutes: 7 * 60,
            slotEndMinutes: 14 * 60,
            effectiveStartMinutes: 7 * 60,
            effectiveEndMinutes: (13 * 60) + 30,
        })).toBe((13 * 60) + 30);
    });

    it('clamps same-day custom end times to slot boundaries', () => {
        const option = {
            slotStartMinutes: 8 * 60,
            slotEndMinutes: 16 * 60,
            effectiveStartMinutes: 8 * 60,
            effectiveEndMinutes: 16 * 60,
        };

        expect(normalizeCustomTimeslotEndMinutes(option, '07:00')).toBe((8 * 60) + 5);
        expect(normalizeCustomTimeslotEndMinutes(option, '17:30')).toBe(16 * 60);
        expect(normalizeCustomTimeslotEndMinutes(option, '14:45')).toBe((14 * 60) + 45);
    });

    it('interprets overnight custom end times as next-day values within the slot', () => {
        const option = {
            slotStartMinutes: 22 * 60,
            slotEndMinutes: (24 * 60) + (6 * 60),
            effectiveStartMinutes: 22 * 60,
            effectiveEndMinutes: (24 * 60) + (4 * 60),
        };

        expect(normalizeCustomTimeslotEndMinutes(option, '02:00')).toBe((24 * 60) + (2 * 60));
    });

    it('hydrates custom end times from the existing custom selection for the matching slot', () => {
        const options = [
            {
                id: 'slot-a',
                slotStartMinutes: 7 * 60,
                slotEndMinutes: 15 * 60,
                effectiveStartMinutes: 7 * 60,
                effectiveEndMinutes: 15 * 60,
            },
            {
                id: 'slot-b',
                slotStartMinutes: 15 * 60,
                slotEndMinutes: 22 * 60,
                effectiveStartMinutes: 15 * 60,
                effectiveEndMinutes: 22 * 60,
            },
        ];

        expect(buildInitialCustomTimeslotEndMinutesByOption(options, {
            timeslotId: 'slot-b',
            endTime: '20:15',
            isCustom: true,
        })).toEqual({
            'slot-a': 15 * 60,
            'slot-b': (20 * 60) + 15,
        });
    });
});