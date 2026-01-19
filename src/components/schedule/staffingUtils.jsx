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
    
    // Get value: explicit entry > doctor default > 1.0
    let val = entry ? entry.value : (doctor.fte !== undefined ? String(doctor.fte) : "1.0");
    
    if (!val) val = "0"; // Treat empty/null as 0? Or 1.0? 
    // In StaffingPlanTable we said: "If monthStart > endDate -> ''". 
    // If contract ends, we handle it above.
    // If no entry and no contract end issue, we use doctor.fte.
    
    // Normalize
    val = String(val).trim();
    
    if (val === "KO" || val === "EZ") return false;
    
    // Check 0.00
    // Replace , with .
    const num = parseFloat(val.replace(',', '.'));
    // If it's a number and <= 0, unavailable
    if (!isNaN(num) && num <= 0.0001) return false; // epsilon for float safety
    
    return true;
}