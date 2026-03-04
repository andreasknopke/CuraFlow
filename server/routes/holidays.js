import express from 'express';
import crypto from 'crypto';
import { db } from '../index.js';

const router = express.Router();
// Holidays are public - no auth required
// Data is centrally managed in the master database

// State code mapping (German abbreviations to ISO codes)
const STATE_ISO_CODES = {
  'BW': 'DE-BW', 'BY': 'DE-BY', 'BE': 'DE-BE', 'BB': 'DE-BB',
  'HB': 'DE-HB', 'HH': 'DE-HH', 'HE': 'DE-HE', 'MV': 'DE-MV',
  'NI': 'DE-NI', 'NW': 'DE-NW', 'RP': 'DE-RP', 'SL': 'DE-SL',
  'SN': 'DE-SN', 'ST': 'DE-ST', 'SH': 'DE-SH', 'TH': 'DE-TH'
};

/**
 * Ensure central holiday tables exist in master DB
 */
async function ensureHolidayTables() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS holiday_settings (
      \`key\` VARCHAR(100) PRIMARY KEY,
      \`value\` TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  // Insert defaults if not present
  await db.execute(`INSERT IGNORE INTO holiday_settings (\`key\`, \`value\`) VALUES ('federal_state', 'MV')`);
  await db.execute(`INSERT IGNORE INTO holiday_settings (\`key\`, \`value\`) VALUES ('show_school_holidays', 'true')`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS custom_holidays (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE DEFAULT NULL,
      type ENUM('public', 'school') NOT NULL DEFAULT 'public',
      action ENUM('add', 'remove') NOT NULL DEFAULT 'add',
      created_by VARCHAR(255) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Get central federal state setting from master DB
 */
async function getCentralFederalState() {
  try {
    await ensureHolidayTables();
    const [rows] = await db.execute("SELECT `value` FROM holiday_settings WHERE `key` = 'federal_state'");
    return rows[0]?.value || 'MV';
  } catch (err) {
    console.error('[Holidays] Error reading central federal_state:', err.message);
    return 'MV';
  }
}

/**
 * Get central custom holidays from master DB
 */
async function getCentralCustomHolidays() {
  try {
    await ensureHolidayTables();
    const [rows] = await db.execute('SELECT * FROM custom_holidays ORDER BY start_date');
    return rows;
  } catch (err) {
    console.error('[Holidays] Error reading central custom_holidays:', err.message);
    return [];
  }
}

/**
 * Format a Date object to YYYY-MM-DD using local date parts (timezone-safe)
 */
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Apply custom corrections to API data server-side
 */
function applyCorrections(apiSchool, apiPublic, customHolidays) {
  // --- Public Holidays ---
  const publicMap = new Map();
  apiPublic.forEach(h => {
    if (h?.date) publicMap.set(h.date, h);
  });

  // Add custom public holidays
  customHolidays
    .filter(c => c.type === 'public' && c.action === 'add')
    .forEach(c => {
      const startDate = c.start_date;
      const endDate = c.end_date || startDate;
      // Expand date range
      let current = new Date(startDate + 'T12:00:00');
      const end = new Date(endDate + 'T12:00:00');
      while (current <= end) {
        const dStr = localDateStr(current);
        publicMap.set(dStr, { name: c.name, date: dStr });
        current.setDate(current.getDate() + 1);
      }
    });

  // Remove custom public holidays
  customHolidays
    .filter(c => c.type === 'public' && c.action === 'remove')
    .forEach(c => {
      const startDate = c.start_date;
      const endDate = c.end_date || startDate;
      // Remove all dates in range from map (string comparison, no Date needed)
      Array.from(publicMap.keys()).forEach(dateStr => {
        if (dateStr >= startDate && dateStr <= endDate) {
          publicMap.delete(dateStr);
        }
      });
    });

  // --- School Holidays ---
  let schoolRanges = [...apiSchool];

  // Add custom school holidays
  customHolidays
    .filter(c => c.type === 'school' && c.action === 'add')
    .forEach(c => {
      schoolRanges.push({
        name: c.name,
        start: c.start_date,
        end: c.end_date || c.start_date
      });
    });

  // Remove custom school holidays — split ranges for partial overlaps
  const schoolRemovals = customHolidays
    .filter(c => c.type === 'school' && c.action === 'remove')
    .map(c => ({
      start: c.start_date,
      end: c.end_date || c.start_date
    }));

  if (schoolRemovals.length > 0) {
    let newRanges = [];
    for (const range of schoolRanges) {
      let currentRanges = [range];
      for (const removal of schoolRemovals) {
        const nextRanges = [];
        for (const r of currentRanges) {
          // No overlap (string comparison works for YYYY-MM-DD)
          if (removal.start > r.end || removal.end < r.start) {
            nextRanges.push(r);
            continue;
          }
          // Complete removal
          if (removal.start <= r.start && removal.end >= r.end) {
            continue; // skip entirely
          }
          // Partial overlap: split range
          if (removal.start > r.start) {
            // Left part survives: range.start to day before removal.start
            const dayBefore = new Date(removal.start + 'T12:00:00');
            dayBefore.setDate(dayBefore.getDate() - 1);
            nextRanges.push({ ...r, end: localDateStr(dayBefore) });
          }
          if (removal.end < r.end) {
            // Right part survives: day after removal.end to range.end
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

  const resolvedPublic = Array.from(publicMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return {
    school: schoolRanges,
    public: resolvedPublic,
    schoolRemovals // Also pass for frontend HolidayCalculator backward compat
  };
}

// ===== GET HOLIDAYS (now centralized) =====
// The state parameter from the query is IGNORED - we always use the central setting
router.get('/', async (req, res, next) => {
  try {
    const { year } = req.query;
    
    if (!year) {
      return res.status(400).json({ error: 'Year parameter required' });
    }

    // Read central settings from master DB
    const stateCode = await getCentralFederalState();
    const customHolidays = await getCentralCustomHolidays();
    
    const isoStateCode = STATE_ISO_CODES[stateCode] || 'DE-MV';
    const countryCode = 'DE';
    const validFrom = `${year}-01-01`;
    const validTo = `${year}-12-31`;
    
    let apiSchool = [];
    let apiPublic = [];

    try {
      // Fetch from OpenHolidays API
      const [schoolRes, publicRes] = await Promise.all([
        fetch(`https://openholidaysapi.org/SchoolHolidays?countryIsoCode=${countryCode}&subdivisionCode=${isoStateCode}&validFrom=${validFrom}&validTo=${validTo}&languageIsoCode=DE`),
        fetch(`https://openholidaysapi.org/PublicHolidays?countryIsoCode=${countryCode}&subdivisionCode=${isoStateCode}&validFrom=${validFrom}&validTo=${validTo}&languageIsoCode=DE`)
      ]);
      
      const schoolData = await schoolRes.json();
      const publicData = await publicRes.json();
      
      // Filter out BBS (Berufsschulen) entries - only keep ABS (allgemeinbildende Schulen).
      // The OpenHoliday API returns separate entries for ABS and BBS in the "groups" array:
      //   ABS: { code: "DE-MV-ABS", shortName: "MV-ABS" }
      //   BBS: { code: "DE-MV-BBS", shortName: "MV-BBS" }
      const rawSchoolCount = Array.isArray(schoolData) ? schoolData.length : 0;
      const filteredSchoolData = (Array.isArray(schoolData) ? schoolData : []).filter(h => {
        // Primary check: "groups" array contains BBS codes (e.g. "DE-MV-BBS")
        if (h.groups?.some(g => /[-_]BBS$/i.test(g.code || g.shortName || ''))) return false;
        // Fallback: also check subdivisions in case API structure changes
        if (h.subdivisions?.some(s => /[-_]BBS$/i.test(s.code || s.shortName || ''))) return false;
        return true;
      });
      
      if (filteredSchoolData.length < rawSchoolCount) {
        console.log(`[Holidays] Filtered ${rawSchoolCount - filteredSchoolData.length} BBS school holiday entries (kept ${filteredSchoolData.length} ABS entries)`);
      }
      
      apiSchool = filteredSchoolData.map(h => ({
        name: h.name?.[0]?.text || h.name || 'Schulferien',
        start: h.startDate,
        end: h.endDate
      }));
      
      apiPublic = (Array.isArray(publicData) ? publicData : []).map(h => ({
        name: h.name?.[0]?.text || h.name || 'Feiertag',
        date: h.startDate
      }));
    } catch (apiError) {
      console.error('OpenHolidays API error:', apiError.message);
      // Fallback to calculated holidays
      apiPublic = calculateGermanHolidays(parseInt(year));
    }

    // Apply central corrections
    const resolved = applyCorrections(apiSchool, apiPublic, customHolidays);
    
    res.json({
      school: resolved.school,
      public: resolved.public,
      schoolRemovals: resolved.schoolRemovals,
      stateCode, // Tell frontend which state is configured centrally
      centralized: true // Flag so frontend knows corrections are already applied
    });
  } catch (error) {
    next(error);
  }
});

// Simple German holidays calculation
function calculateGermanHolidays(year) {
  const holidays = [
    { date: `${year}-01-01`, name: 'Neujahr' },
    { date: `${year}-05-01`, name: 'Tag der Arbeit' },
    { date: `${year}-10-03`, name: 'Tag der Deutschen Einheit' },
    { date: `${year}-12-25`, name: '1. Weihnachtstag' },
    { date: `${year}-12-26`, name: '2. Weihnachtstag' },
  ];
  
  // Calculate Easter and dependent holidays
  const easter = calculateEaster(year);
  holidays.push(
    { date: formatDate(addDays(easter, -2)), name: 'Karfreitag' },
    { date: formatDate(easter), name: 'Ostersonntag' },
    { date: formatDate(addDays(easter, 1)), name: 'Ostermontag' },
    { date: formatDate(addDays(easter, 39)), name: 'Christi Himmelfahrt' },
    { date: formatDate(addDays(easter, 50)), name: 'Pfingstmontag' }
  );
  
  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

function calculateEaster(year) {
  const f = Math.floor,
    G = year % 19,
    C = f(year / 100),
    H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30,
    I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11)),
    J = (year + f(year / 4) + I + 2 - C + f(C / 4)) % 7,
    L = I - J,
    month = 3 + f((L + 40) / 44),
    day = L + 28 - 31 * f(month / 4);
  
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Get the complete set of public holiday dates for a given year,
 * including calculated holidays AND manual corrections (adds/removes)
 * from the central custom_holidays table.
 * Returns a Set of 'YYYY-MM-DD' strings.
 */
async function getPublicHolidayDatesForYear(year) {
  const holidays = calculateGermanHolidays(year);
  const dateSet = new Set(holidays.map(h => h.date));

  // Apply manual corrections from master DB
  try {
    const customHolidays = await getCentralCustomHolidays();
    // Add custom public holidays
    customHolidays
      .filter(c => c.type === 'public' && c.action === 'add')
      .forEach(c => {
        const startDate = typeof c.start_date === 'string' ? c.start_date.substring(0, 10) : c.start_date;
        const endDate = c.end_date ? (typeof c.end_date === 'string' ? c.end_date.substring(0, 10) : c.end_date) : startDate;
        let current = new Date(startDate + 'T12:00:00');
        const end = new Date(endDate + 'T12:00:00');
        while (current <= end) {
          const dStr = localDateStr(current);
          if (dStr.startsWith(String(year))) dateSet.add(dStr);
          current.setDate(current.getDate() + 1);
        }
      });
    // Remove custom public holidays
    customHolidays
      .filter(c => c.type === 'public' && c.action === 'remove')
      .forEach(c => {
        const startDate = typeof c.start_date === 'string' ? c.start_date.substring(0, 10) : c.start_date;
        const endDate = c.end_date ? (typeof c.end_date === 'string' ? c.end_date.substring(0, 10) : c.end_date) : startDate;
        for (const dateStr of Array.from(dateSet)) {
          if (dateStr >= startDate && dateStr <= endDate) {
            dateSet.delete(dateStr);
          }
        }
      });
  } catch (e) {
    console.warn('[Holidays] Could not apply custom corrections for workday check:', e.message);
  }

  return dateSet;
}

export default router;
export { calculateGermanHolidays, getPublicHolidayDatesForYear };
