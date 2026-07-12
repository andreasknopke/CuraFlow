import { describe, it, expect } from 'vitest';
import {
  timeToMinutes,
  minutesToTime,
  spansMidnight,
  calculateDurationMinutes,
  calculateShiftHours,
  timeslotsOverlap,
  formatTimeslotLabel,
  formatTimeslotShort,
  parseDroppableId,
  createDroppableId,
} from '../timeslotUtils';

describe('timeToMinutes', () => {
  it('converts HH:MM to minutes since midnight', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('01:00')).toBe(60);
    expect(timeToMinutes('08:30')).toBe(510);
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('handles HH:MM:SS by ignoring seconds', () => {
    expect(timeToMinutes('08:30:00')).toBe(510);
  });

  it('returns 0 for falsy input', () => {
    expect(timeToMinutes(null)).toBe(0);
    expect(timeToMinutes('')).toBe(0);
    expect(timeToMinutes(undefined)).toBe(0);
  });
});

describe('minutesToTime', () => {
  it('converts minutes to HH:MM string with zero-padding', () => {
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(60)).toBe('01:00');
    expect(minutesToTime(510)).toBe('08:30');
    expect(minutesToTime(1439)).toBe('23:59');
  });

  it('wraps values beyond 24h back to start of day', () => {
    expect(minutesToTime(1440)).toBe('00:00');
    expect(minutesToTime(1500)).toBe('01:00');
  });

  it('normalizes negative minutes', () => {
    expect(minutesToTime(-60)).toBe('23:00');
  });
});

describe('spansMidnight', () => {
  it('returns false for same-day slots', () => {
    expect(spansMidnight('08:00', '16:00')).toBe(false);
    expect(spansMidnight('00:00', '23:59')).toBe(false);
  });

  it('returns true when end time is before start time', () => {
    expect(spansMidnight('22:00', '06:00')).toBe(true);
    expect(spansMidnight('20:00', '00:00')).toBe(true);
  });

  it('returns true when start equals end (full-day wrap)', () => {
    expect(spansMidnight('12:00', '12:00')).toBe(true);
  });
});

describe('calculateDurationMinutes', () => {
  it('calculates duration for same-day slot', () => {
    expect(calculateDurationMinutes('08:00', '16:00')).toBe(480);
    expect(calculateDurationMinutes('00:00', '23:59')).toBe(1439);
  });

  it('adds 24h when end time is before start time (overnight)', () => {
    expect(calculateDurationMinutes('22:00', '06:00')).toBe(480);
    expect(calculateDurationMinutes('20:00', '08:00')).toBe(720);
  });
});

describe('calculateShiftHours', () => {
  it('returns default hours when no timeslot provided', () => {
    expect(calculateShiftHours({}, null)).toBe(8);
    expect(calculateShiftHours({}, null, 10)).toBe(10);
  });

  it('calculates hours from timeslot duration', () => {
    const timeslot = { start_time: '08:00', end_time: '16:00' };
    expect(calculateShiftHours({}, timeslot)).toBe(8);
  });

  it('handles overnight timeslot', () => {
    const timeslot = { start_time: '20:00', end_time: '08:00' };
    expect(calculateShiftHours({}, timeslot)).toBe(12);
  });
});

describe('timeslotsOverlap', () => {
  it('detects overlapping same-day slots', () => {
    const a = { start_time: '08:00', end_time: '14:00' };
    const b = { start_time: '12:00', end_time: '18:00' };
    expect(timeslotsOverlap(a, b)).toBe(true);
  });

  it('returns false for non-overlapping slots', () => {
    const a = { start_time: '08:00', end_time: '12:00' };
    const b = { start_time: '12:00', end_time: '16:00' };
    expect(timeslotsOverlap(a, b)).toBe(false);
  });

  it('respects tolerance: adjacent slots within tolerance are non-overlapping', () => {
    const a = { start_time: '08:00', end_time: '12:05' };
    const b = { start_time: '12:00', end_time: '16:00' };
    expect(timeslotsOverlap(a, b, 10)).toBe(false);
  });

  it('detects overnight slot overlap', () => {
    const night = { start_time: '22:00', end_time: '06:00' };
    const morning = { start_time: '04:00', end_time: '10:00' };
    expect(timeslotsOverlap(night, morning)).toBe(true);
  });

  it('returns false when either slot is null', () => {
    const a = { start_time: '08:00', end_time: '16:00' };
    expect(timeslotsOverlap(a, null)).toBe(false);
    expect(timeslotsOverlap(null, a)).toBe(false);
  });
});

describe('formatTimeslotLabel', () => {
  it('returns empty string for null', () => {
    expect(formatTimeslotLabel(null)).toBe('');
  });

  it('includes label with times', () => {
    const slot = { label: 'Früh', start_time: '06:00', end_time: '14:00' };
    expect(formatTimeslotLabel(slot)).toBe('Früh (06:00-14:00)');
  });

  it('appends +1 for overnight slots', () => {
    const slot = { label: 'Nacht', start_time: '22:00', end_time: '06:00' };
    expect(formatTimeslotLabel(slot)).toBe('Nacht (22:00-06:00 +1)');
  });

  it('shows times without label', () => {
    const slot = { start_time: '08:00', end_time: '16:00' };
    expect(formatTimeslotLabel(slot)).toBe('08:00-16:00');
  });
});

describe('formatTimeslotShort', () => {
  it('returns empty string for null', () => {
    expect(formatTimeslotShort(null)).toBe('');
  });

  it('formats as start-end', () => {
    const slot = { start_time: '08:00', end_time: '16:00' };
    expect(formatTimeslotShort(slot)).toBe('08:00-16:00');
  });
});

describe('parseDroppableId', () => {
  it('parses a date__position ID', () => {
    expect(parseDroppableId('2024-03-11__CT')).toEqual({
      date: '2024-03-11',
      position: 'CT',
      timeslotId: null,
    });
  });

  it('parses a date__position__timeslotId ID', () => {
    expect(parseDroppableId('2024-03-11__CT__42')).toEqual({
      date: '2024-03-11',
      position: 'CT',
      timeslotId: '42',
    });
  });

  it('treats "null" string as null timeslotId', () => {
    expect(parseDroppableId('2024-03-11__CT__null').timeslotId).toBe(null);
  });

  it('returns nulls for empty/null input', () => {
    expect(parseDroppableId(null)).toEqual({ date: null, position: null, timeslotId: null });
    expect(parseDroppableId('')).toEqual({ date: null, position: null, timeslotId: null });
  });
});

describe('createDroppableId', () => {
  it('creates a two-part ID when timeslotId is null', () => {
    expect(createDroppableId('2024-03-11', 'CT')).toBe('2024-03-11__CT');
    expect(createDroppableId('2024-03-11', 'CT', null)).toBe('2024-03-11__CT');
  });

  it('creates a three-part ID when timeslotId is provided', () => {
    expect(createDroppableId('2024-03-11', 'CT', '42')).toBe('2024-03-11__CT__42');
  });

  it('roundtrips with parseDroppableId', () => {
    const id = createDroppableId('2024-03-11', 'MRT', '7');
    expect(parseDroppableId(id)).toEqual({ date: '2024-03-11', position: 'MRT', timeslotId: '7' });
  });
});
