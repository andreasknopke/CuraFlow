import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Reproduce the helper functions from holidays.js for isolated testing
// ---------------------------------------------------------------------------

const STATE_ISO_CODES = {
  'BW': 'DE-BW', 'BY': 'DE-BY', 'BE': 'DE-BE', 'BB': 'DE-BB',
  'HB': 'DE-HB', 'HH': 'DE-HH', 'HE': 'DE-HE', 'MV': 'DE-MV',
  'NI': 'DE-NI', 'NW': 'DE-NW', 'RP': 'DE-RP', 'SL': 'DE-SL',
  'SN': 'DE-SN', 'ST': 'DE-ST', 'SH': 'DE-SH', 'TH': 'DE-TH',
};

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function applyCorrections(apiSchool, apiPublic, customHolidays) {
  const publicMap = new Map();
  (apiPublic || []).forEach(h => {
    if (h?.date) publicMap.set(h.date, h);
  });

  // Add custom public holidays
  (customHolidays || [])
    .filter(c => c.type === 'public' && c.action === 'add')
    .forEach(c => {
      const startDate = c.start_date;
      const endDate = c.end_date || startDate;
      let current = new Date(startDate + 'T12:00:00');
      const end = new Date(endDate + 'T12:00:00');
      while (current <= end) {
        const dStr = localDateStr(current);
        publicMap.set(dStr, { name: c.name, date: dStr });
        current.setDate(current.getDate() + 1);
      }
    });

  // Remove custom public holidays
  (customHolidays || [])
    .filter(c => c.type === 'public' && c.action === 'remove')
    .forEach(c => {
      const startDate = c.start_date;
      const endDate = c.end_date || startDate;
      Array.from(publicMap.keys()).forEach(dateStr => {
        if (dateStr >= startDate && dateStr <= endDate) {
          publicMap.delete(dateStr);
        }
      });
    });

  // --- School Holidays ---
  let schoolRanges = [...(apiSchool || [])];

  (customHolidays || [])
    .filter(c => c.type === 'school' && c.action === 'add')
    .forEach(c => {
      schoolRanges.push({
        name: c.name,
        start: c.start_date,
        end: c.end_date || c.start_date,
      });
    });

  const schoolRemovals = (customHolidays || [])
    .filter(c => c.type === 'school' && c.action === 'remove')
    .map(c => ({
      start: c.start_date,
      end: c.end_date || c.start_date,
    }));

  if (schoolRemovals.length > 0) {
    let newRanges = [];
    for (const range of schoolRanges) {
      let currentRanges = [range];
      for (const removal of schoolRemovals) {
        const nextRanges = [];
        for (const r of currentRanges) {
          if (removal.start > r.end || removal.end < r.start) {
            nextRanges.push(r);
            continue;
          }
          if (removal.start <= r.start && removal.end >= r.end) {
            continue;
          }
          if (removal.start > r.start) {
            const dayBefore = new Date(removal.start + 'T12:00:00');
            dayBefore.setDate(dayBefore.getDate() - 1);
            nextRanges.push({ ...r, end: localDateStr(dayBefore) });
          }
          if (removal.end < r.end) {
            const dayAfter = new Date(removal.end + 'T12:00:00');
            dayAfter.setDate(dayAfter.getDate() + 1);
            nextRanges.push({ ...r, start: localDateStr(dayAfter) });
          }
        }
        currentRanges = nextRanges;
      }
      newRanges.push(...currentRanges);
    }
    schoolRanges = newRanges;
  }

  const resolvedPublic = Array.from(publicMap.values())
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    school: schoolRanges,
    public: resolvedPublic,
    schoolRemovals,
  };
}

function toStateIsoCode(stateCode) {
  return STATE_ISO_CODES[stateCode] || null;
}

// ---------------------------------------------------------------------------
// Tests: STATE_ISO_CODES
// ---------------------------------------------------------------------------
describe('STATE_ISO_CODES', () => {
  it('maps all 16 German states', () => {
    expect(Object.keys(STATE_ISO_CODES)).toHaveLength(16);
  });

  it('maps MV to DE-MV', () => {
    expect(STATE_ISO_CODES.MV).toBe('DE-MV');
  });

  it('maps BY to DE-BY', () => {
    expect(STATE_ISO_CODES.BY).toBe('DE-BY');
  });

  it('maps BE to DE-BE', () => {
    expect(STATE_ISO_CODES.BE).toBe('DE-BE');
  });
});

// ---------------------------------------------------------------------------
// Tests: localDateStr
// ---------------------------------------------------------------------------
describe('localDateStr', () => {
  it('formats a date to YYYY-MM-DD', () => {
    expect(localDateStr(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('pads single-digit months', () => {
    expect(localDateStr(new Date(2026, 2, 5))).toBe('2026-03-05');
  });

  it('pads single-digit days', () => {
    expect(localDateStr(new Date(2026, 11, 1))).toBe('2026-12-01');
  });

  it('handles December dates', () => {
    expect(localDateStr(new Date(2026, 11, 25))).toBe('2026-12-25');
  });

  it('handles year transitions', () => {
    expect(localDateStr(new Date(2027, 0, 1))).toBe('2027-01-01');
  });
});

// ---------------------------------------------------------------------------
// Tests: toStateIsoCode
// ---------------------------------------------------------------------------
describe('toStateIsoCode', () => {
  it('converts MV to DE-MV', () => {
    expect(toStateIsoCode('MV')).toBe('DE-MV');
  });

  it('returns null for unknown state codes', () => {
    expect(toStateIsoCode('XX')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(toStateIsoCode('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: applyCorrections — public holidays
// ---------------------------------------------------------------------------
describe('applyCorrections — public holidays', () => {
  it('returns empty arrays when no data is provided', () => {
    const result = applyCorrections([], [], []);
    expect(result.public).toEqual([]);
    expect(result.school).toEqual([]);
    expect(result.schoolRemovals).toEqual([]);
  });

  it('passes through API public holidays unchanged', () => {
    const apiPublic = [
      { date: '2026-01-01', name: 'Neujahr' },
      { date: '2026-05-01', name: 'Tag der Arbeit' },
    ];
    const result = applyCorrections([], apiPublic, []);
    expect(result.public).toHaveLength(2);
    expect(result.public[0].name).toBe('Neujahr');
    expect(result.public[1].name).toBe('Tag der Arbeit');
  });

  it('adds custom public holidays', () => {
    const custom = [
      { type: 'public', action: 'add', start_date: '2026-11-27', name: 'Brückentag' },
    ];
    const result = applyCorrections([], [], custom);
    expect(result.public).toHaveLength(1);
    expect(result.public[0].name).toBe('Brückentag');
    expect(result.public[0].date).toBe('2026-11-27');
  });

  it('adds multi-day custom public holidays', () => {
    const custom = [
      { type: 'public', action: 'add', start_date: '2026-07-01', end_date: '2026-07-05', name: 'Sommerfest' },
    ];
    const result = applyCorrections([], [], custom);
    expect(result.public).toHaveLength(5);
    expect(result.public[0].date).toBe('2026-07-01');
    expect(result.public[4].date).toBe('2026-07-05');
  });

  it('removes a specific API public holiday', () => {
    const apiPublic = [
      { date: '2026-01-01', name: 'Neujahr' },
      { date: '2026-10-03', name: 'Tag der Deutschen Einheit' },
    ];
    const custom = [
      { type: 'public', action: 'remove', start_date: '2026-10-03' },
    ];
    const result = applyCorrections([], apiPublic, custom);
    expect(result.public).toHaveLength(1);
    expect(result.public[0].name).toBe('Neujahr');
  });

  it('removes a range of API public holidays', () => {
    const apiPublic = [
      { date: '2026-12-24', name: 'Heiligabend' },
      { date: '2026-12-25', name: '1. Weihnachtstag' },
      { date: '2026-12-26', name: '2. Weihnachtstag' },
    ];
    const custom = [
      { type: 'public', action: 'remove', start_date: '2026-12-24', end_date: '2026-12-26' },
    ];
    const result = applyCorrections([], apiPublic, custom);
    expect(result.public).toHaveLength(0);
  });

  it('sorts public holidays by date', () => {
    const apiPublic = [
      { date: '2026-12-25', name: 'Weihnachten' },
      { date: '2026-01-01', name: 'Neujahr' },
      { date: '2026-05-01', name: 'Tag der Arbeit' },
    ];
    const result = applyCorrections([], apiPublic, []);
    expect(result.public[0].date).toBe('2026-01-01');
    expect(result.public[1].date).toBe('2026-05-01');
    expect(result.public[2].date).toBe('2026-12-25');
  });

  it('handles add and remove simultaneously', () => {
    const apiPublic = [
      { date: '2026-01-01', name: 'Neujahr' },
      { date: '2026-10-03', name: 'Tag der Deutschen Einheit' },
    ];
    const custom = [
      { type: 'public', action: 'remove', start_date: '2026-10-03' },
      { type: 'public', action: 'add', start_date: '2026-10-02', name: 'Brückentag' },
    ];
    const result = applyCorrections([], apiPublic, custom);
    expect(result.public).toHaveLength(2);
    expect(result.public.find(h => h.name === 'Brückentag')).toBeTruthy();
    expect(result.public.find(h => h.name === 'Tag der Deutschen Einheit')).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Tests: applyCorrections — school holidays
// ---------------------------------------------------------------------------
describe('applyCorrections — school holidays', () => {
  it('passes through API school holidays unchanged', () => {
    const apiSchool = [
      { start: '2026-07-01', end: '2026-08-31', name: 'Sommerferien' },
    ];
    const result = applyCorrections(apiSchool, [], []);
    expect(result.school).toHaveLength(1);
    expect(result.school[0].name).toBe('Sommerferien');
  });

  it('adds custom school holidays', () => {
    const custom = [
      { type: 'school', action: 'add', start_date: '2026-05-01', end_date: '2026-05-05', name: 'Extra Ferien' },
    ];
    const result = applyCorrections([], [], custom);
    expect(result.school).toHaveLength(1);
    expect(result.school[0].name).toBe('Extra Ferien');
  });

  it('removes part of a school holiday range (splits range)', () => {
    const apiSchool = [
      { start: '2026-07-01', end: '2026-08-15', name: 'Sommerferien' },
    ];
    const custom = [
      { type: 'school', action: 'remove', start_date: '2026-07-15', end_date: '2026-07-20' },
    ];
    const result = applyCorrections(apiSchool, [], custom);
    // Sommerferien should be split into two ranges
    expect(result.school).toHaveLength(2);
    expect(result.school[0].end).toBe('2026-07-14');
    expect(result.school[1].start).toBe('2026-07-21');
  });

  it('completely removes a school holiday range when removal covers entire range', () => {
    const apiSchool = [
      { start: '2026-07-01', end: '2026-07-10', name: 'Kurzferien' },
    ];
    const custom = [
      { type: 'school', action: 'remove', start_date: '2026-07-01', end_date: '2026-07-10' },
    ];
    const result = applyCorrections(apiSchool, [], custom);
    expect(result.school).toHaveLength(0);
  });

  it('does nothing when removal does not overlap any range', () => {
    const apiSchool = [
      { start: '2026-07-01', end: '2026-08-31', name: 'Sommerferien' },
    ];
    const custom = [
      { type: 'school', action: 'remove', start_date: '2026-05-01', end_date: '2026-05-05' },
    ];
    const result = applyCorrections(apiSchool, [], custom);
    expect(result.school).toHaveLength(1);
    expect(result.school[0].name).toBe('Sommerferien');
  });

  it('returns schoolRemovals array for frontend backward compat', () => {
    const custom = [
      { type: 'school', action: 'remove', start_date: '2026-07-15', end_date: '2026-07-20' },
    ];
    const result = applyCorrections([], [], custom);
    expect(result.schoolRemovals).toHaveLength(1);
    expect(result.schoolRemovals[0].start).toBe('2026-07-15');
    expect(result.schoolRemovals[0].end).toBe('2026-07-20');
  });
});

// ---------------------------------------------------------------------------
// Tests: applyCorrections — edge cases
// ---------------------------------------------------------------------------
describe('applyCorrections — edge cases', () => {
  it('handles undefined/null inputs gracefully', () => {
    const result = applyCorrections(null, null, null);
    expect(result.public).toEqual([]);
    expect(result.school).toEqual([]);
    expect(result.schoolRemovals).toEqual([]);
  });

  it('handles empty custom holidays array', () => {
    const result = applyCorrections([], [], []);
    expect(result.public).toEqual([]);
    expect(result.school).toEqual([]);
  });

  it('ignores custom holidays with missing type or action', () => {
    const custom = [
      { name: 'Orphan entry' },
      { type: 'public' },
      { action: 'add' },
    ];
    const result = applyCorrections([], [], custom);
    expect(result.public).toEqual([]);
    expect(result.school).toEqual([]);
  });

  it('handles single-day school holiday without end_date', () => {
    const custom = [
      { type: 'school', action: 'add', start_date: '2026-05-01', name: 'Feiertag Schule' },
    ];
    const result = applyCorrections([], [], custom);
    expect(result.school).toHaveLength(1);
    expect(result.school[0].start).toBe('2026-05-01');
    expect(result.school[0].end).toBe('2026-05-01');
  });

  it('handles removal that is wider than the school range on both sides', () => {
    const apiSchool = [
      { start: '2026-07-01', end: '2026-07-31', name: 'Sommerferien' },
    ];
    const custom = [
      { type: 'school', action: 'remove', start_date: '2026-06-01', end_date: '2026-08-31' },
    ];
    const result = applyCorrections(apiSchool, [], custom);
    expect(result.school).toHaveLength(0);
  });
});
