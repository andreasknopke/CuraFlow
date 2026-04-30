export function isDoctorAvailable(doctor, date, planEntries) {
    // Check contract end
    if (doctor.contract_end_date) {
        const endDate = new Date(doctor.contract_end_date);
        endDate.setHours(0,0,0,0);
        const checkDate = new Date(date);
        checkDate.setHours(0,0,0,0);
        
        // If the date is strictly AFTER the end date, doctor is unavailable
        if (checkDate > endDate) return false;
    }
    
    // Check Plan Entry
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const entry = planEntries.find(e => e.doctor_id === doctor.id && e.year === year && e.month === month);

    // Keep availability aligned with the staffing table: empty monthly values fall back to the doctor's default FTE.
    const entryValue = typeof entry?.value === 'string' ? entry.value.trim() : entry?.value;
    let val;

    if (entryValue !== undefined && entryValue !== null && entryValue !== '') {
        val = String(entryValue);
    } else if (doctor.fte !== undefined && doctor.fte !== null && String(doctor.fte).trim() !== '') {
        val = String(doctor.fte);
    } else {
        val = "1.0";
    }

    // In StaffingPlanTable we said: "If monthStart > endDate -> ''". 
    // If contract ends, we handle it above.
    // If no entry and no contract end issue, we use doctor.fte.
    
    // Normalize
    val = String(val).trim();
    
    if (val === "KO" || val === "EZ" || val === "MS") return false;
    
    // Check 0.00
    // Replace , with .
    const num = parseFloat(val.replace(',', '.'));
    // If it's a number and <= 0, unavailable
    if (!isNaN(num) && num <= 0.0001) return false; // epsilon for float safety
    
    return true;
}

/**
 * Calculates the weekly target working hours for a doctor, adjusted for public holidays.
 * @param {number} fte - Full-time equivalent (e.g., 1.0, 0.75)
 * @param {Date} weekStart - Monday of the week
 * @param {string[]} holidays - Array of public holiday dates in 'YYYY-MM-DD' format that fall within the week
 * @param {number} [fullTimeWeeklyHours=40] - Full-time weekly hours for 1.0 FTE
 * @param {number} [workDaysPerWeek=5] - Number of working days per week (Mon-Fri)
 * @returns {number} Adjusted target weekly hours
 */
export function calculateWeeklyTargetHours(fte, weekStart, holidays = [], fullTimeWeeklyHours = 40, workDaysPerWeek = 5) {
  const baseWeeklyHours = fullTimeWeeklyHours * fte;
  const dailyHours = (fullTimeWeeklyHours / workDaysPerWeek) * fte;
  // Count holidays that fall on working days (Mon-Fri)
  const holidayCount = holidays.filter(holidayDate => {
    const holiday = new Date(holidayDate);
    const day = holiday.getDay();
    // Monday=1 ... Friday=5, Sunday=0
    return day >= 1 && day <= 5;
  }).length;
  return baseWeeklyHours - (holidayCount * dailyHours);
}