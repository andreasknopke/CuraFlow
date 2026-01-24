import express from 'express';
import { db } from '../index.js';

const router = express.Router();
// Holidays are public - no auth required

// State code mapping (German abbreviations to ISO codes)
const STATE_ISO_CODES = {
  'BW': 'DE-BW', 'BY': 'DE-BY', 'BE': 'DE-BE', 'BB': 'DE-BB',
  'HB': 'DE-HB', 'HH': 'DE-HH', 'HE': 'DE-HE', 'MV': 'DE-MV',
  'NI': 'DE-NI', 'NW': 'DE-NW', 'RP': 'DE-RP', 'SL': 'DE-SL',
  'SN': 'DE-SN', 'ST': 'DE-ST', 'SH': 'DE-SH', 'TH': 'DE-TH'
};

// ===== GET HOLIDAYS =====
router.get('/', async (req, res, next) => {
  try {
    const { year, state = 'MV' } = req.query;
    
    if (!year) {
      return res.status(400).json({ error: 'Year parameter required' });
    }
    
    const isoStateCode = STATE_ISO_CODES[state] || 'DE-MV';
    const countryCode = 'DE';
    const validFrom = `${year}-01-01`;
    const validTo = `${year}-12-31`;
    
    try {
      // Fetch from OpenHolidays API
      const [schoolRes, publicRes] = await Promise.all([
        fetch(`https://openholidaysapi.org/SchoolHolidays?countryIsoCode=${countryCode}&subdivisionCode=${isoStateCode}&validFrom=${validFrom}&validTo=${validTo}&languageIsoCode=DE`),
        fetch(`https://openholidaysapi.org/PublicHolidays?countryIsoCode=${countryCode}&subdivisionCode=${isoStateCode}&validFrom=${validFrom}&validTo=${validTo}&languageIsoCode=DE`)
      ]);
      
      const schoolData = await schoolRes.json();
      const publicData = await publicRes.json();
      
      // Transform school holidays to expected format
      const school = (Array.isArray(schoolData) ? schoolData : []).map(h => ({
        name: h.name?.[0]?.text || h.name || 'Schulferien',
        startDate: h.startDate,
        endDate: h.endDate
      }));
      
      // Transform public holidays to expected format
      const publicHolidays = (Array.isArray(publicData) ? publicData : []).map(h => ({
        name: h.name?.[0]?.text || h.name || 'Feiertag',
        date: h.startDate
      }));
      
      res.json({ school, public: publicHolidays });
    } catch (apiError) {
      console.error('OpenHolidays API error:', apiError.message);
      // Fallback to calculated holidays
      const fallback = calculateGermanHolidays(parseInt(year));
      res.json({ school: [], public: fallback });
    }
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

export default router;
