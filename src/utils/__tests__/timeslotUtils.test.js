import { describe, expect, it } from 'vitest';
import {
  aggregateWorkingHours,
  calculateDurationMinutes,
  createDroppableId,
  formatTimeslotLabel,
  minutesToTime,
  parseDroppableId,
  spansMidnight,
  timeToMinutes,
  timeslotsOverlap,
} from '../timeslotUtils.js';

describe('timeslotUtils', () => {
  it('converts between time strings and minutes', () => {
    expect(timeToMinutes('23:30')).toBe(1410);
    expect(minutesToTime(-1)).toBe('23:59');
    expect(minutesToTime(1500)).toBe('01:00');
  });

  it('detects midnight-spanning slots and computes their duration', () => {
    expect(spansMidnight('22:00', '06:00')).toBe(true);
    expect(calculateDurationMinutes('22:00', '06:00')).toBe(480);
    expect(formatTimeslotLabel({ label: 'Nacht', start_time: '22:00', end_time: '06:00' })).toBe(
      'Nacht (22:00-06:00 +1)',
    );
  });

  it('detects overlaps across midnight boundaries', () => {
    const overnight = { start_time: '22:00', end_time: '02:00' };
    const earlyMorning = { start_time: '01:00', end_time: '03:00' };
    const daytime = { start_time: '10:00', end_time: '12:00' };

    expect(timeslotsOverlap(overnight, earlyMorning)).toBe(true);
    expect(timeslotsOverlap(overnight, daytime)).toBe(false);
  });

  it('aggregates working hours per doctor within a date range', () => {
    const shifts = [
      { doctor_id: 'doc-1', date: '2026-04-10', position: 'Dienst A', timeslot_id: 'slot-1' },
      { doctor_id: 'doc-1', date: '2026-04-11', timeslot_id: null },
      { doctor_id: 'doc-2', date: '2026-05-01', timeslot_id: 'slot-2' },
    ];
    const timeslots = [
      { id: 'slot-1', start_time: '08:00', end_time: '12:00' },
      { id: 'slot-2', start_time: '09:00', end_time: '17:00' },
    ];

    expect(
      aggregateWorkingHours(shifts, timeslots, {
        start: '2026-04-01',
        end: '2026-04-30',
      }),
    ).toEqual({
      'doc-1': 12,
    });
  });

  it('ignores non-working shift positions when aggregating working hours', () => {
    const shifts = [
      { doctor_id: 'doc-1', date: '2026-04-10', position: 'Dienst A', timeslot_id: 'slot-1' },
      {
        doctor_id: 'doc-1',
        date: '2026-04-11',
        position: 'Nicht verfügbar',
        timeslot_id: 'slot-1',
      },
      { doctor_id: 'doc-1', date: '2026-04-12', position: 'AZ', timeslot_id: null },
      { doctor_id: 'doc-1', date: '2026-04-13', position: 'Fortbildung', timeslot_id: 'slot-1' },
    ];
    const timeslots = [{ id: 'slot-1', start_time: '08:00', end_time: '12:00' }];

    expect(
      aggregateWorkingHours(shifts, timeslots, {
        start: '2026-04-01',
        end: '2026-04-30',
      }),
    ).toEqual({
      'doc-1': 4,
    });
  });

  it('round-trips droppable IDs with and without a timeslot', () => {
    expect(parseDroppableId(createDroppableId('2026-04-10', 'Dienst A'))).toEqual({
      date: '2026-04-10',
      position: 'Dienst A',
      timeslotId: null,
    });

    expect(parseDroppableId(createDroppableId('2026-04-10', 'Dienst A', 'slot-7'))).toEqual({
      date: '2026-04-10',
      position: 'Dienst A',
      timeslotId: 'slot-7',
    });
  });
});
