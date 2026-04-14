import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetHolidays = vi.fn();
const mockSystemSettingList = vi.fn();

vi.mock('@/api/client', () => ({
  api: {
    getHolidays: (...args: unknown[]) => mockGetHolidays(...args),
  },
  db: {
    SystemSetting: {
      list: (...args: unknown[]) => mockSystemSettingList(...args),
    },
  },
}));

import { useHolidays } from '../useHolidays';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

describe('useHolidays', () => {
  beforeEach(() => {
    mockSystemSettingList.mockReset();
    mockGetHolidays.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads settings and holiday data and exposes holiday lookup helpers', async () => {
    mockSystemSettingList.mockResolvedValue([{ key: 'show_school_holidays', value: 'true' }]);
    mockGetHolidays.mockResolvedValue({
      stateCode: 'MV',
      public: [{ date: '2026-01-01', name: 'Neujahr' }],
      school: [{ start: '2026-02-02', end: '2026-02-06', name: 'Winterferien' }],
    });

    const { result } = renderHook(() => useHolidays(2026), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockGetHolidays).toHaveBeenCalledWith(2026);
    expect(result.current.stateCode).toBe('MV');
    expect(result.current.showSchoolHolidays).toBe(true);
    expect(result.current.isPublicHoliday(new Date('2026-01-01'))).toMatchObject({
      name: 'Neujahr',
    });
    expect(result.current.isSchoolHoliday(new Date('2026-02-03'))).toMatchObject({
      name: 'Winterferien',
    });
    expect(result.current.isSchoolHoliday(new Date('2026-03-01'))).toBeNull();
  });

  it('returns null for school holiday checks when the setting disables them', async () => {
    mockSystemSettingList.mockResolvedValue([{ key: 'show_school_holidays', value: 'false' }]);
    mockGetHolidays.mockResolvedValue({
      stateCode: 'MV',
      public: [],
      school: [{ start: '2026-02-02', end: '2026-02-06', name: 'Winterferien' }],
    });

    const { result } = renderHook(() => useHolidays(2026), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.showSchoolHolidays).toBe(false);
    expect(result.current.isSchoolHoliday(new Date('2026-02-03'))).toBeNull();
  });

  it('falls back to empty API data and default MV state on fetch failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockSystemSettingList.mockResolvedValue([]);
    mockGetHolidays.mockRejectedValue(new Error('holiday api down'));

    const { result } = renderHook(() => useHolidays(2026), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.stateCode).toBe('MV');
    expect(result.current.showSchoolHolidays).toBe(true);
    expect(result.current.isPublicHoliday(new Date('2026-01-07'))).toBeNull();
    expect(result.current.isSchoolHoliday(new Date('2026-02-03'))).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});
