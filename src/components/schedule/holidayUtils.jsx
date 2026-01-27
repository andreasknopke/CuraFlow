import { addDays, subDays, isSameDay, startOfDay, parseISO, isWithinInterval } from 'date-fns';

// German Holidays Calculation
// Easter Date (Gaussian algorithm)
function getEaster(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

const STATES = {
    'BW': 'Baden-Württemberg',
    'BY': 'Bayern',
    'BE': 'Berlin',
    'BB': 'Brandenburg',
    'HB': 'Bremen',
    'HH': 'Hamburg',
    'HE': 'Hessen',
    'MV': 'Mecklenburg-Vorpommern',
    'NI': 'Niedersachsen',
    'NW': 'Nordrhein-Westfalen',
    'RP': 'Rheinland-Pfalz',
    'SL': 'Saarland',
    'SN': 'Sachsen',
    'ST': 'Sachsen-Anhalt',
    'SH': 'Schleswig-Holstein',
    'TH': 'Thüringen'
};

export class HolidayCalculator {
    constructor(stateCode = 'MV', customHolidays = [], apiData = { school: [], public: [] }) {
        this.stateCode = stateCode;
        this.customHolidays = customHolidays;
        this.apiData = apiData;
        
        // Pre-calculate lookups for performance
        this.publicHolidaysMap = new Map();
        this.schoolHolidayRanges = [];
        
        this.init();
    }

    init() {
        // 1. Process Public Holidays
        // Determine years present in API data
        const apiYears = new Set();
        if (this.apiData.public) {
            this.apiData.public.forEach(h => {
                // Skip entries without valid date
                if (!h || !h.date) return;
                
                const y = parseISO(h.date).getFullYear();
                apiYears.add(y);
                // Format to YYYY-MM-DD for map key
                // Since h.date is likely YYYY-MM-DD, we can use it directly if it matches, but parseISO is safer
                const dStr = h.date.split('T')[0]; 
                this.publicHolidaysMap.set(dStr, { name: h.name, date: h.date });
            });
        }

        // Fallback for surrounding years if not in API
        const currentYear = new Date().getFullYear();
        const yearsToCalc = [currentYear - 1, currentYear, currentYear + 1]; // Basic window
        
        yearsToCalc.forEach(year => {
            if (!apiYears.has(year)) {
                const easter = getEaster(year);
                let holidays = [
                    { date: new Date(year, 0, 1), name: 'Neujahr' },
                    { date: new Date(year, 4, 1), name: 'Tag der Arbeit' },
                    { date: new Date(year, 9, 3), name: 'Tag der Deutschen Einheit' },
                    { date: new Date(year, 11, 25), name: '1. Weihnachtstag' },
                    { date: new Date(year, 11, 26), name: '2. Weihnachtstag' },
                    { date: subDays(easter, 2), name: 'Karfreitag' },
                    { date: addDays(easter, 1), name: 'Ostermontag' },
                    { date: addDays(easter, 39), name: 'Christi Himmelfahrt' },
                    { date: addDays(easter, 50), name: 'Pfingstmontag' },
                ];

                if (this.stateCode === 'MV') {
                    holidays.push({ date: new Date(year, 9, 31), name: 'Reformationstag' });
                    if (year >= 2023) holidays.push({ date: new Date(year, 2, 8), name: 'Internationaler Frauentag' });
                }
                
                holidays.forEach(h => {
                     // Use local date components to avoid UTC shifts (e.g. 00:00 Local -> 22:00 Previous Day UTC)
                     const y = h.date.getFullYear();
                     const m = h.date.getMonth() + 1;
                     const d = h.date.getDate();
                     const dStr = `${y}-${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`;
                     this.publicHolidaysMap.set(dStr, { name: h.name, date: h.date });
                });
            }
        });

        // Custom Public Additions and Removals
        this.customHolidays.filter(h => h.type === 'public' && h.action === 'add').forEach(h => {
            // Handle date ranges for public holidays too
            const startDate = parseISO(h.start_date + 'T00:00:00');
            const endDate = h.end_date ? parseISO(h.end_date + 'T00:00:00') : startDate;
            
            let currentDate = new Date(startDate);
            while (currentDate <= endDate) {
                const y = currentDate.getFullYear();
                const m = currentDate.getMonth() + 1;
                const d = currentDate.getDate();
                const dStr = `${y}-${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`;
                this.publicHolidaysMap.set(dStr, { name: h.name, date: h.start_date });
                currentDate.setDate(currentDate.getDate() + 1);
            }
        });

        // Custom Public Removals (we'll handle these during lookup or simply remove from map now if they are specific dates)
        // Removals are ranges, so we might need to keep them separate or iterate map to remove.
        // Iterating map is expensive if map is huge, but it's small (~50 entries).
        const publicRemovals = this.customHolidays.filter(h => h.type === 'public' && h.action === 'remove');
        if (publicRemovals.length > 0) {
             // Convert map keys to array to iterate safely while deleting
             Array.from(this.publicHolidaysMap.keys()).forEach(dateStr => {
                 const date = parseISO(dateStr);
                 const isRemoved = publicRemovals.some(r => {
                    const start = parseISO(r.start_date);
                    const end = r.end_date ? parseISO(r.end_date) : start;
                    return isWithinInterval(date, { start, end });
                 });
                 if (isRemoved) {
                     this.publicHolidaysMap.delete(dateStr);
                 }
             });
        }

        // 2. Process School Holidays
        let schoolRanges = [...(this.apiData.school || [])]
            .filter(r => r && r.start && r.end) // Skip entries without valid dates
            .map(r => ({
                start: parseISO(r.start).getTime(),
                end: parseISO(r.end).getTime(),
                name: r.name || 'Schulferien'
            }));

        // Custom School Additions
        this.customHolidays.filter(h => h.type === 'school' && h.action === 'add').forEach(h => {
            // Set end date to end of day to be inclusive
            schoolRanges.push({
                start: parseISO(h.start_date + 'T00:00:00').getTime(),
                end: parseISO((h.end_date || h.start_date) + 'T23:59:59.999').getTime(),
                name: h.name
            });
        });

        // Custom School Removals
        const schoolRemovals = this.customHolidays.filter(h => h.type === 'school' && h.action === 'remove').map(r => ({
            start: parseISO(r.start_date + 'T00:00:00').getTime(),
            end: parseISO((r.end_date || r.start_date) + 'T23:59:59.999').getTime()
        }));

        // Filter school ranges that are completely removed or adjust them? 
        // Complex removal logic (splitting ranges) is hard. 
        // For performance, we will just keep the 'isRemoved' check during lookup if needed, 
        // OR we can filter the simple cases. 
        // Let's just store the removals as efficient timestamps and check them during lookup.
        this.schoolHolidayRanges = schoolRanges;
        this.schoolRemovals = schoolRemovals;
    }

    isPublicHoliday(date) {
        // Optimization: simple string lookup
        // We assume date is passed as Date object.
        // Using simple string formatting manually is faster than date-fns format
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const dStr = `${year}-${month < 10 ? '0' + month : month}-${day < 10 ? '0' + day : day}`;
        
        return this.publicHolidaysMap.get(dStr) || null;
    }

    isSchoolHoliday(date) {
        const time = date.getTime();
        
        // Check removals first (fastest if few removals)
        if (this.schoolRemovals && this.schoolRemovals.length > 0) {
            const isRemoved = this.schoolRemovals.some(r => time >= r.start && time <= r.end);
            if (isRemoved) return null;
        }

        // Check ranges
        // Optimization: could sort ranges and binary search, but for < 50 ranges linear scan is fine
        // But we avoid creating Date objects or parsing ISOs here.
        const match = this.schoolHolidayRanges.find(r => time >= r.start && time <= r.end);
        
        return match ? { name: match.name } : null;
    }
}

// Legacy Exports for backward compatibility (defaulting to MV)
const defaultCalc = new HolidayCalculator('MV', []);
export const getEasterDate = getEaster; // alias
export const isHolidayMV = (date) => defaultCalc.isPublicHoliday(date);
export const isSchoolHolidayMV = (date) => defaultCalc.isSchoolHoliday(date);
export { STATES };