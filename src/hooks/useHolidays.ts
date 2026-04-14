import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, db } from '@/api/client';
import { HolidayCalculator } from '@/components/schedule/holidayUtils';
import type { SystemSetting } from '@/types';

interface HolidayApiData {
  school: unknown[];
  public: unknown[];
  stateCode?: string;
}

export function useHolidays(yearOverride?: number) {
  const currentYear = new Date().getFullYear();
  const year = yearOverride || currentYear;

  const { data: settings = [] as SystemSetting[], isLoading: isLoadingSettings } = useQuery<
    SystemSetting[]
  >({
    queryKey: ['systemSettings'],
    queryFn: () => db.SystemSetting.list() as Promise<SystemSetting[]>,
  });

  const showSchoolSetting = settings.find((s) => s.key === 'show_school_holidays');
  const showSchoolHolidays = showSchoolSetting ? showSchoolSetting.value === 'true' : true;

  const { data: apiData = { school: [], public: [] } as HolidayApiData, isLoading: isLoadingApi } =
    useQuery<HolidayApiData>({
      queryKey: ['externalHolidays', year],
      queryFn: async (): Promise<HolidayApiData> => {
        try {
          return (await api.getHolidays(year)) as HolidayApiData;
        } catch (err) {
          console.error('Error fetching holidays', err);
          return { school: [], public: [] };
        }
      },
      staleTime: 1000 * 60 * 60 * 24,
    });

  const stateCode = apiData.stateCode || 'MV';

  const calculator = useMemo(() => {
    return new HolidayCalculator(stateCode, [], apiData as { school: never[]; public: never[] });
  }, [stateCode, apiData]);

  const isPublicHoliday = useCallback(
    (date: Date | string) => {
      return calculator.isPublicHoliday(date instanceof Date ? date : new Date(date));
    },
    [calculator],
  );

  const isSchoolHoliday = useCallback(
    (date: Date | string) => {
      return showSchoolHolidays
        ? calculator.isSchoolHoliday(date instanceof Date ? date : new Date(date))
        : null;
    },
    [calculator, showSchoolHolidays],
  );

  return {
    calculator,
    stateCode,
    showSchoolHolidays,
    isLoading: isLoadingSettings || isLoadingApi,
    isPublicHoliday,
    isSchoolHoliday,
  };
}
