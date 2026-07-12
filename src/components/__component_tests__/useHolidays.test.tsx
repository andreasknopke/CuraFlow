import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Mock TanStack Query ─────────────────────────────────────────────────────
// useHolidays calls useQuery twice: systemSettings and externalHolidays.
const mockQueryData = {
  systemSettings: [{ key: 'show_school_holidays', value: 'true' }],
  externalHolidays: {
    stateCode: 'MV',
    school: [
      { start: '2026-06-22', end: '2026-08-01', name: 'Sommerferien' },
    ],
    public: [],
  },
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }) => {
    if (queryKey[0] === 'systemSettings') {
      return { data: mockQueryData.systemSettings, isLoading: false };
    }
    if (queryKey[0] === 'externalHolidays') {
      return { data: mockQueryData.externalHolidays, isLoading: false };
    }
    return { data: undefined, isLoading: true };
  },
}));

// ── Mock API client ─────────────────────────────────────────────────────────
vi.mock('@/api/client', () => ({
  api: {},
  db: {},
}));

import { useHolidays } from '@/components/useHolidays';

describe('useHolidays', () => {
  it('useHolidays(2026) returns holiday calculator for given year', () => {
    const { result } = renderHook(() => useHolidays(2026));

    expect(result.current).toHaveProperty('calculator');
    expect(result.current.calculator).toBeDefined();
    expect(result.current.calculator.stateCode).toBe('MV');
    expect(result.current).toHaveProperty('isLoading', false);
    expect(result.current).toHaveProperty('showSchoolHolidays', true);
  });

  it('isPublicHoliday(new Date("2026-05-01")) returns true (Tag der Arbeit)', () => {
    const { result } = renderHook(() => useHolidays(2026));

    // 2026-05-01 is Tag der Arbeit — a fixed public holiday in all German states
    const holiday = result.current.isPublicHoliday(new Date('2026-05-01'));
    expect(holiday).not.toBeNull();
    expect(holiday.name).toContain('Tag der Arbeit');
  });

  it('isSchoolHoliday returns null for non-holiday date', () => {
    const { result } = renderHook(() => useHolidays(2026));

    // 2026-05-15 is a regular Friday, not within any school holiday range
    const school = result.current.isSchoolHoliday(new Date('2026-05-15'));
    expect(school).toBeNull();
  });
});
