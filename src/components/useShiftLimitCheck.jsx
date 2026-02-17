import { useQuery } from '@tanstack/react-query';
import { api, db, base44 } from "@/api/client";
import { startOfMonth, endOfMonth, isWeekend, isSameMonth, parseISO, format } from 'date-fns';

export function useShiftLimitCheck(shifts, workplaces) {
    const { data: settings = [] } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => base44.entities.SystemSetting.list(),
        staleTime: 1000 * 60 * 5
    });

    const limitFG = parseInt(settings.find(s => s.key === 'limit_fore_services')?.value || '4');
    const limitWeekend = parseInt(settings.find(s => s.key === 'limit_weekend_services')?.value || '1');
    const limitBG = parseInt(settings.find(s => s.key === 'limit_back_services')?.value || '12');

    const { data: doctors = [] } = useQuery({
        queryKey: ['doctors'],
        queryFn: () => base44.entities.Doctor.list(),
        staleTime: 1000 * 60 * 5
    });

    const { data: staffingEntries = [] } = useQuery({
        queryKey: ['staffingPlanEntriesAll'],
        queryFn: () => base44.entities.StaffingPlanEntry.list(null, 2000),
        staleTime: 1000 * 60 * 5
    });

    const getDoctorFte = (docId, date) => {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        
        const entry = staffingEntries.find(e => 
            e.doctor_id === docId && 
            e.year === year && 
            e.month === month
        );

        if (entry) {
            const val = String(entry.value).replace(',', '.');
            const num = parseFloat(val);
            if (isNaN(num)) return 0; // Codes like EZ, KO count as 0 FTE for limits
            return num;
        }

        const doctor = doctors.find(d => d.id === docId);
        return doctor?.fte ?? 1.0;
    };

    const checkLimits = (doctorId, dateStr, newPosition) => {
        if (!shifts || !workplaces) return null;

        const date = new Date(dateStr);
        
        // Only check if newPosition is a "Dienst"
        const workplace = workplaces.find(w => w.name === newPosition);
        if (!workplace || workplace.category !== 'Dienste') return null;

        // Build foreground/background position sets from service_type
        const serviceWorkplaces = workplaces.filter(w => w.category === 'Dienste');
        const sortedServices = [...serviceWorkplaces].sort((a, b) => (a.order || 0) - (b.order || 0));
        
        const foregroundPositions = new Set(serviceWorkplaces.filter(w => w.service_type === 1).map(w => w.name));
        const backgroundPositions = new Set(serviceWorkplaces.filter(w => w.service_type === 2).map(w => w.name));
        
        // Legacy fallback: if no service_type set, use old convention
        if (foregroundPositions.size === 0 && backgroundPositions.size === 0 && sortedServices.length > 0) {
            foregroundPositions.add(sortedServices[0].name);
            sortedServices.slice(1).forEach(w => backgroundPositions.add(w.name));
        }

        // Determine what this new shift counts as
        const isFG = foregroundPositions.has(newPosition);
        const isBG = backgroundPositions.has(newPosition);
        const isWknd = isWeekend(date) && isFG;

        // Count existing shifts for this doctor in this month
        let countFG = 0;
        let countBG = 0;
        let countWknd = 0;

        const currentMonthStr = format(date, 'yyyy-MM');

        shifts.forEach(s => {
            if (s.doctor_id !== doctorId) return;
            if (!s.date.startsWith(currentMonthStr)) return;

            if (foregroundPositions.has(s.position)) countFG++;
            if (backgroundPositions.has(s.position)) countBG++;
            
            // Count foreground towards weekend limit
            if (foregroundPositions.has(s.position)) {
                const sDate = parseISO(s.date);
                if (isWeekend(sDate)) {
                    countWknd++;
                }
            }
        });

        // Add the potential new shift
        if (isFG) countFG++;
        if (isBG) countBG++;
        if (isWknd) countWknd++;

        const fte = getDoctorFte(doctorId, date);
        const adjustedLimitFG = Math.round(limitFG * fte);
        const adjustedLimitBG = Math.round(limitBG * fte);

        const warnings = [];
        if (isFG && countFG > adjustedLimitFG) warnings.push(`- ${countFG}. Bereitschaftsdienst (Limit: ${adjustedLimitFG}, FTE: ${fte})`);
        if (isBG && countBG > adjustedLimitBG) warnings.push(`- ${countBG}. Rufbereitschaftsdienst (Limit: ${adjustedLimitBG}, FTE: ${fte})`);
        if (isWknd && countWknd > limitWeekend) warnings.push(`- ${countWknd}. Wochenenddienst (Limit: ${limitWeekend})`);

        if (warnings.length > 0) {
            return `Hinweis: Monatliches Limit überschritten!\n${warnings.join('\n')}`;
        }

        return null;
    };

    return { checkLimits };
}