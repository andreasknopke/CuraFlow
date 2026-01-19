import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { db } from '@/components/db';
import { HolidayCalculator } from '@/components/schedule/holidayUtils';

export function useHolidays(yearOverride) {
    const currentYear = new Date().getFullYear();
    const year = yearOverride || currentYear;

    const { data: settings = [], isLoading: isLoadingSettings } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => db.SystemSetting.list(),
    });

    const { data: customHolidays = [], isLoading: isLoadingCustom } = useQuery({
        queryKey: ['customHolidays'],
        queryFn: () => db.CustomHoliday.list(),
    });

    const stateSetting = settings.find(s => s.key === 'federal_state');
    const showSchoolSetting = settings.find(s => s.key === 'show_school_holidays');

    const stateCode = stateSetting ? stateSetting.value : 'MV';
    const showSchoolHolidays = showSchoolSetting ? showSchoolSetting.value === 'true' : true;

    // Fetch External Data via Backend Function
    const { data: apiData = { school: [], public: [] }, isLoading: isLoadingApi } = useQuery({
        queryKey: ['externalHolidays', stateCode, year],
        queryFn: async () => {
            try {
                const response = await base44.functions.invoke('getHolidays', { year, stateCode });
                return response.data;
            } catch (err) {
                console.error("Error fetching holidays", err);
                return { school: [], public: [] };
            }
        },
        staleTime: 1000 * 60 * 60 * 24, // Cache for 24 hours
        enabled: !!stateCode
    });

    const calculator = React.useMemo(() => {
        return new HolidayCalculator(stateCode, customHolidays, apiData);
    }, [stateCode, customHolidays, apiData]);

    const isPublicHoliday = React.useCallback((date) => {
        return calculator.isPublicHoliday(date);
    }, [calculator]);

    const isSchoolHoliday = React.useCallback((date) => {
        return showSchoolHolidays ? calculator.isSchoolHoliday(date) : null;
    }, [calculator, showSchoolHolidays]);

    return {
        calculator,
        stateCode,
        showSchoolHolidays,
        isLoading: isLoadingSettings || isLoadingCustom || isLoadingApi,
        isPublicHoliday,
        isSchoolHoliday
    };
}