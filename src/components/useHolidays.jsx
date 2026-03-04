import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, db, base44 } from "@/api/client";
import { HolidayCalculator } from '@/components/schedule/holidayUtils';

export function useHolidays(yearOverride) {
    const currentYear = new Date().getFullYear();
    const year = yearOverride || currentYear;

    const { data: settings = [], isLoading: isLoadingSettings } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => db.SystemSetting.list(),
    });

    const showSchoolSetting = settings.find(s => s.key === 'show_school_holidays');
    const showSchoolHolidays = showSchoolSetting ? showSchoolSetting.value === 'true' : true;

    // Fetch holidays from central API (corrections are already applied server-side)
    const { data: apiData = { school: [], public: [] }, isLoading: isLoadingApi } = useQuery({
        queryKey: ['externalHolidays', year],
        queryFn: async () => {
            try {
                return await api.getHolidays(year);
            } catch (err) {
                console.error("Error fetching holidays", err);
                return { school: [], public: [] };
            }
        },
        staleTime: 1000 * 60 * 60 * 24, // Cache for 24 hours
    });

    // State code comes from central API response (no longer per-tenant)
    const stateCode = apiData.stateCode || 'MV';

    const calculator = React.useMemo(() => {
        // No custom holidays needed – server already applies corrections
        return new HolidayCalculator(stateCode, [], apiData);
    }, [stateCode, apiData]);

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
        isLoading: isLoadingSettings || isLoadingApi,
        isPublicHoliday,
        isSchoolHoliday
    };
}