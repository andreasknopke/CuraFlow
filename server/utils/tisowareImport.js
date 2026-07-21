/**
 * Tisoware Import Utility
 *
 * Imports employee absence data from the Tisoware MSSQL database
 * (accessed via the ODBC/HTTP proxy) into the CuraFlow MasterDB
 * CentralAbsenceEntry table.
 *
 * ─── ID Bridge ───────────────────────────────────────────────────────────
 * PERSTAMM.PSPERSNR (nvarchar) → Employee.payroll_id (VARCHAR(50))
 * PERSTAMM.PSNR (int, PK) → used in ABWKAL.PSNR for linking.
 * Workflow: PSPERSNR → query PERSTAMM → get PSNR → query ABWKAL by PSNR.
 *
 * ─── LOANR → Canonical Position Mapping ────────────────────────────────
 * Tisoware uses LOANR (Abwesenheitsgrund-Nummer) linked to LOASTAMM.
 * We map known codes to the canonical CuraFlow absence positions and
 * write a [TISO:CODE] prefix into the note field for auditability.
 *
 * ─── Merge Strategy ─────────────────────────────────────────────────────
 * CentralAbsenceEntry has UNIQUE(employee_id, date). On conflict:
 * - Same position → skip (already exists)
 * - Different position → compare ABSENCE_PRIORITY
 *   - Local (Tisoware) priority > central → update
 *   - Central priority > local → keep central
 *   - Tie → report conflict, leave unresolved
 */

import crypto from 'crypto';
import { runQuery as queryTisoware } from './tisowareDataSource.js';
import {
  isCentralAbsencePosition,
  ensureCentralAbsenceTables,
  CENTRAL_ABSENCE_POSITIONS,
} from './centralAbsences.js';

// Re-use priority from centralAbsences (imported dynamically to avoid
// circular deps at the module level — the function version works fine).

// ─── LOANR → Canonical Position Mapping ────────────────────────────────────
// Based on analysis of Tisoware LOASTAMM (~50 absence codes).
// Only codes that map to a canonical CuraFlow absence position are listed.
// Unmapped codes are preserved as-is with [TISO:CODE] note but stored
// as "Nicht verfügbar" (the safest fallback).

const LOANR_TO_POSITION = {
  // Urlaub / Vacation
  '505': 'Urlaub',

  // Krank / Sick (various subtypes)
  '530': 'Krank',
  '530KV': 'Krank',
  '530KE': 'Krank',
  '531': 'Krank',
  '532': 'Krank',
  '533': 'Krank',
  '534': 'Krank',
  '535': 'Krank',
  '536': 'Krank',
  '537': 'Krank',
  '538': 'Krank',
  '539': 'Krank',
  '540': 'Krank',
  '570': 'Krank',
  '570Ä': 'Krank',
  '570Q': 'Krank',
  '571': 'Krank',
  '572': 'Krank',

  // Mutterschutz / Maternity leave
  '550': 'Mutterschutz',
  '551': 'Mutterschutz',
  '5511': 'Mutterschutz',

  // Elternzeit / Parental leave
  '552': 'Elternzeit',

  // Dienstreise / Business trip
  '555': 'Dienstreise',

  // Frei / Free (various subtypes)
  '506': 'Frei',
  '507': 'Frei',
  '508': 'Frei',
  '509': 'Frei',
  '510': 'Frei',
  '511': 'Frei',
  '512': 'Frei',
  '9000': 'Frei',

  // Nicht verfügbar / Unavailable
  '575': 'Nicht verfügbar',
  '579': 'Nicht verfügbar',
  '580': 'Nicht verfügbar',
};

// Subtype descriptions for known LOANR codes (used in [TISO:CODE] note)
const LOANR_TO_NOTE = {
  '530KV': 'Krank auf Vertrauen',
  '530KE': 'Krank auf Vertrauen (Eltern)',
  '531': 'Krank ohne AU-Bescheinigung',
  '532': 'Krank mit AU-Bescheinigung',
  '533': 'Krank Kind krank',
  '534': 'Krank Unfall',
  '535': 'Krank stationär',
  '536': 'Krank Reha',
  '537': 'Krank Kuraufenthalt',
  '538': 'Krank Quarantäne',
  '539': 'Krank Verdienstausfall',
  '540': 'Krank Infektion',
  '570': 'Krank (Attest)',
  '570Ä': 'Krank (ärztl. Attest)',
  '570Q': 'Krank (Quarantäne)',
  '571': 'Krank (ohne Attest)',
  '572': 'Krank (Kind)',
  '551': 'Mutterschutz vor Geburt',
  '5511': 'Mutterschutz nach Geburt',
  '506': 'Freizeitausgleich',
  '507': 'Überstundenabbau',
  '508': 'Sonderurlaub',
  '509': 'Bildungsurlaub',
  '510': 'Freistellung',
  '511': 'AZV-Tag',
  '512': 'Freischicht',
  '575': 'Freigestellt',
  '579': 'Suspendiert',
  '580': 'Ruhendes Arbeitsverhältnis',
  '9000': 'Sonstige Abwesenheit',
};

/**
 * Determine canonical absence position for a given LOANR code.
 * Returns the position and a [TISO:CODE] note prefix.
 *
 * @param {string} loanr - The LOANR code from ABWKAL
 * @param {string|null} loatext1 - LOATEXT1 from LOASTAMM (human-readable name)
 * @returns {{ position: string, notePrefix: string }}
 */
function mapLoanrToPosition(loanr, loatext1 = null) {
  const code = String(loanr || '').trim();
  const position = LOANR_TO_POSITION[code] || 'Nicht verfügbar';

  // Build note: [TISO:CODE] subtype info
  const subtype = LOANR_TO_NOTE[code] || loatext1 || null;
  const notePrefix = subtype ? `[TISO:${code}] ${subtype}` : `[TISO:${code}]`;

  return { position, notePrefix };
}

/**
 * Build a conservative note by merging an existing central note with
 * the Tisoware note prefix. Never overwrites existing notes, only appends.
 *
 * @param {string|null} existingNote - Existing note in CentralAbsenceEntry
 * @param {string} notePrefix - The [TISO:CODE] prefix to add
 * @returns {string}
 */
function mergeNote(existingNote, notePrefix) {
  if (!existingNote) return notePrefix;
  if (existingNote.includes(`[TISO:`)) return existingNote; // Already has TISO prefix
  return `${notePrefix} | ${existingNote}`;
}

// ─── Employee Matching ──────────────────────────────────────────────────────

/**
 * Search for employees in the Tisoware PERSTAMM table via live proxy.
 *
 * @param {object} params
 * @param {string} [params.q] - Search query (name or PSPERSNR)
 * @param {string} [params.kstnr] - Cost center filter
 * @param {number} [params.limit=200] - Max results
 * @returns {Promise<Array>} PERSTAMM rows
 */
export async function searchTisowareEmployees({ q, kstnr, limit = 200 } = {}) {
  let sql = `SELECT PSNR, PSPERSNR, PSVORNA, PSNACHNA, PSEINDAT, PSAUSDAT, PGNR, QALNR, KSTNR
             FROM dbo.PERSTAMM WHERE 1=1`;
  const conditions = [];

  if (q) {
    const safeQ = q.replace(/'/g, "''");
    conditions.push(`(PSPERSNR LIKE '%${safeQ}%' OR PSNACHNA LIKE '%${safeQ}%' OR PSVORNA LIKE '%${safeQ}%')`);
  }
  if (kstnr) {
    const safeKst = kstnr.replace(/'/g, "''");
    conditions.push(`KSTNR = '${safeKst}'`);
  }

  if (conditions.length > 0) {
    sql += ' AND ' + conditions.join(' AND ');
  }

  sql += ` ORDER BY PSNACHNA, PSVORNA`;
  // TOP for MSSQL
  sql = sql.replace('SELECT', `SELECT TOP ${Math.min(limit, 500)}`);

  const result = await queryTisoware(sql);
  return result.rows || [];
}

/**
 * Match Tisoware employees against CuraFlow MasterDB Employee table.
 * Uses PSPERSNR → payroll_id bridge.
 *
 * @param {object} masterDb - MasterDB pool
 * @param {Array} tisowareEmployees - PERSTAMM rows from Tisoware
 * @returns {Promise<Array>} Matched results with match status
 */
export async function matchTisowareEmployees(masterDb, tisowareEmployees) {
  // Build set of PSPERSNR values to look up
  const psPersNrList = tisowareEmployees
    .map(e => String(e.PSPERSNR || '').trim())
    .filter(Boolean);

  if (psPersNrList.length === 0) {
    return tisowareEmployees.map(e => ({
      ...e,
      match_status: 'no_pspersnr',
      employee_id: null,
      employee_name: null,
    }));
  }

  // Look up Employee by payroll_id (which equals PSPERSNR for stammdat-sourced employees)
  const placeholders = psPersNrList.map(() => '?').join(',');
  const [employeeRows] = await masterDb.execute(
    `SELECT id, payroll_id, last_name, first_name, is_active
     FROM Employee
     WHERE payroll_id IN (${placeholders})`,
    psPersNrList
  );

  const employeeByPayrollId = new Map();
  for (const row of employeeRows) {
    const pid = String(row.payroll_id || '').trim();
    if (pid) employeeByPayrollId.set(pid, row);
  }

  return tisowareEmployees.map(e => {
    const psPersNr = String(e.PSPERSNR || '').trim();
    if (!psPersNr) {
      return {
        ...e,
        match_status: 'no_pspersnr',
        employee_id: null,
        employee_name: null,
      };
    }

    const employee = employeeByPayrollId.get(psPersNr);
    if (employee) {
      return {
        ...e,
        match_status: 'matched',
        employee_id: employee.id,
        employee_name: [employee.first_name, employee.last_name].filter(Boolean).join(' ').trim() || employee.last_name,
        employee_active: !!employee.is_active,
      };
    }

    return {
      ...e,
      match_status: 'unmatched',
      employee_id: null,
      employee_name: null,
    };
  });
}

// ─── LOANR Lookup (batch) ───────────────────────────────────────────────────

/**
 * Fetch LOANR descriptions from LOASTAMM for a set of LOANR codes.
 * Returns a Map: LOANR → LOATEXT1
 *
 * @param {string[]} loanrCodes - Array of LOANR codes
 * @returns {Promise<Map<string, string>>}
 */
export async function fetchLoanrDescriptions(loanrCodes) {
  const unique = [...new Set(loanrCodes.map(c => String(c || '').trim()).filter(Boolean))];
  if (unique.length === 0) return new Map();

  // Build IN clause — MSSQL doesn't support parameterized IN well from Node,
  // but our queryTisoware sanitizes and these are alphanumeric codes anyway.
  const inClause = unique.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
  const sql = `SELECT LOANR, LOATEXT1 FROM dbo.LOASTAMM WHERE LOANR IN (${inClause})`;

  try {
    const result = await queryTisoware(sql);
    const map = new Map();
    for (const row of (result.rows || [])) {
      map.set(String(row.LOANR || '').trim(), row.LOATEXT1 || null);
    }
    return map;
  } catch {
    // LOASTAMM table might not exist or be inaccessible
    return new Map();
  }
}

// ─── Absence Fetching ────────────────────────────────────────────────────────

/**
 * Discover date column names from ABWKAL row keys.
 * ABWKAL columns vary across Tisoware versions; we can't hardcode them.
 * Returns { fromCol, toCol } with the best-guess column names.
 *
 * @param {string[]} keys - Column names from a sample ABWKAL row
 * @returns {{ fromCol: string|null, toCol: string|null }}
 */
export function discoverAbwkalDateColumns(keys) {
  const upperKeys = keys.map(k => k.toUpperCase());

  // Canonical Tisoware column names: ABWDATE = single date column (int, YYYYMMDD).
  // ABWKAL stores one date per row — use it for both from/to.
  const dateIdx = upperKeys.indexOf('ABWDATE');
  if (dateIdx !== -1) {
    return { fromCol: keys[dateIdx], toCol: keys[dateIdx] };
  }
  // Some older Tisoware installations may use ABWDATUM instead
  const datumIdx = upperKeys.indexOf('ABWDATUM');
  if (datumIdx !== -1) {
    return { fromCol: keys[datumIdx], toCol: keys[datumIdx] };
  }

  const candidates = keys.filter(k => {
    const u = k.toUpperCase();
    // Look for columns that contain date-like German terms
    return (u.includes('VON') || u.includes('BIS') || u.includes('BEGINN')
      || u.includes('ENDE') || u.includes('ANFANG') || u.includes('DAT'))
      && !u.includes('ZEIT')  // Exclude time columns (ZEITVON, ZEITBIS)
      && !u.includes('STD')   // Exclude hours (Stunden): VONSTD, BISSTD
      && !u.includes('MIN');  // Exclude minutes: VONMIN, BISMIN
  });

  // Sort: "VON/BEGINN/ANFANG"-like first, then "BIS/ENDE"-like
  const fromCandidates = candidates.filter(c => {
    const u = c.toUpperCase();
    return u.includes('VON') || u.includes('BEGINN') || u.includes('ANFANG');
  });
  const toCandidates = candidates.filter(c => {
    const u = c.toUpperCase();
    return u.includes('BIS') || u.includes('ENDE');
  });

  // If we have a single date column (e.g., ABWDATUM), use it for both
  if (candidates.length === 1 && fromCandidates.length === 0 && toCandidates.length === 0) {
    return { fromCol: candidates[0], toCol: candidates[0] };
  }

  return {
    fromCol: fromCandidates[0] || null,
    toCol: toCandidates[0] || fromCandidates[0] || null, // fallback
  };
}

/**
 * Normalize ABWKAL rows: remap discovered date columns to canonical ABWDATVON / ABWDATBIS.
 *
 * @param {object[]} rows - Raw ABWKAL rows
 * @param {string} fromCol - Actual "from date" column name
 * @param {string} toCol - Actual "to date" column name
 * @returns {object[]} Rows with ABWDATVON and ABWDATBIS properties added
 */
function normalizeAbwkalRows(rows, fromCol, toCol) {
  if (!fromCol || rows.length === 0) return rows;
  for (const row of rows) {
    row.ABWDATVON = row[fromCol];
    row.ABWDATBIS = row[toCol];
  }
  return rows;
}

/**
 * Fetch absence entries from Tisoware ABWKAL for a list of PSNR (integer) values.
 * ABWKAL links to PERSTAMM via PSNR, not PSPERSNR.
 *
 * Column names vary across Tisoware versions — we discover date columns dynamically
 * and normalize them to ABWDATVON / ABWDATBIS for downstream consumers.
 *
 * @param {(string|number)[]} psnrList - PERSTAMM.PSNR values to fetch absences for
 * @param {string} [dateFrom] - Optional start date (YYYYMMDD) — applied client-side after fetch
 * @param {string} [dateTo] - Optional end date (YYYYMMDD) — applied client-side after fetch
 * @returns {Promise<Array>} ABWKAL rows with normalized ABWDATVON/ABWDATBIS properties
 */
export async function fetchTisowareAbsences(psnrList, dateFrom, dateTo) {
  const unique = [...new Set(psnrList.map(p => String(p || '').trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const inClause = unique.join(','); // PSNR is numeric, no quoting needed

  // No date filter in SQL — column names are unknown until we fetch
  const sql = `SELECT ABWKAL.* FROM dbo.ABWKAL WHERE PSNR IN (${inClause}) ORDER BY PSNR`;

  console.log(`[Tisoware import] fetchTisowareAbsences: querying ABWKAL for ${unique.length} PSNR(s)`);

  const result = await queryTisoware(sql, 50000); // Higher limit for bulk import
  const rawRows = result.rows || [];
  console.log(`[Tisoware import] fetchTisowareAbsences: returned ${rawRows.length} raw row(s)`);
  if (rawRows.length === 0 && unique.length > 0) {
    console.log(`[Tisoware import] fetchTisowareAbsences: sample PSNRs: [${unique.slice(0, 5).join(', ')}]`);
    return [];
  }

  // Discover actual date column names from the first row
  const keys = Object.keys(rawRows[0] || {});
  const { fromCol, toCol } = discoverAbwkalDateColumns(keys);
  console.log(`[Tisoware import] fetchTisowareAbsences: ALL ABWKAL columns: [${keys.join(', ')}]`);
  console.log(`[Tisoware import] fetchTisowareAbsences: detected fromCol=${fromCol}, toCol=${toCol}`);
  // Log sample values from detected columns to diagnose wrong-field mapping
  if (fromCol) {
    const sampleFromVals = [...new Set(rawRows.slice(0, 20).map(r => String(r[fromCol] ?? '').trim()))];
    console.log(`[Tisoware import] fetchTisowareAbsences: sample values for '${fromCol}': [${sampleFromVals.join(', ')}]`);
  }
  if (toCol && toCol !== fromCol) {
    const sampleToVals = [...new Set(rawRows.slice(0, 20).map(r => String(r[toCol] ?? '').trim()))];
    console.log(`[Tisoware import] fetchTisowareAbsences: sample values for '${toCol}': [${sampleToVals.join(', ')}]`);
  }

  // Normalize: add ABWDATVON/ABWDATBIS aliases for downstream compatibility
  const rows = normalizeAbwkalRows(rawRows, fromCol, toCol);

  // Debug: log sample of raw rows and unique dates/PNSRs to diagnose mismatches
  if (rows.length > 0) {
    const samplePsnrs = [...new Set(rows.slice(0, 200).map(r => String(r.PSNR || '').trim()))];
    const sampleDates = [...new Set(rows.slice(0, 200).map(r => String(r.ABWDATVON || '').trim()))];
    const sampleRow = rows[0];
    const allKeys = Object.keys(sampleRow).join(',');
    console.log(`[Tisoware import] fetchTisowareAbsences: debug sample — PSNRs=[${samplePsnrs.slice(0, 10).join(',')}], dates=[${sampleDates.slice(0, 10).join(',')}], columns=${allKeys}`);
    if (sampleDates.length < 3) {
      console.log(`[Tisoware import] fetchTisowareAbsences: WARNING — only ${sampleDates.length} unique date(s) across ${rows.length} rows!`);
    }
  }

  // Client-side date filtering (since we can't use SQL WHERE with unknown column names)
  if (dateFrom || dateTo) {
    return rows.filter(row => {
      const fromVal = row.ABWDATVON ? String(row.ABWDATVON).trim() : '';
      const toVal = row.ABWDATBIS ? String(row.ABWDATBIS).trim() : '';
      if (!fromVal) return false;
      if (dateFrom && fromVal < dateFrom) return false;
      if (dateTo && toVal > dateTo) return false;
      return true;
    });
  }

  return rows;
}

// ─── Date Parsing ────────────────────────────────────────────────────────────

/**
 * Parse a Tisoware date string into ISO format (YYYY-MM-DD).
 * Tisoware stores dates in various formats: YYYYMMDD, YYYY-MM-DD, DD.MM.YYYY, etc.
 *
 * @param {string|null|undefined} raw - Raw date value from Tisoware
 * @returns {string|null} ISO date string or null if unparseable
 */
export function parseTisowareDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // YYYYMMDD (e.g., 20260101)
  if (/^\d{8}$/.test(s)) {
    const y = s.substring(0, 4);
    const m = s.substring(4, 6);
    const d = s.substring(6, 8);
    const parsed = new Date(`${y}-${m}-${d}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) return `${y}-${m}-${d}`;
  }

  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const parsed = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // DD.MM.YYYY
  const deMatch = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (deMatch) {
    const parsed = new Date(`${deMatch[3]}-${deMatch[2]}-${deMatch[1]}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) return `${deMatch[3]}-${deMatch[2]}-${deMatch[1]}`;
  }

  // Try Date.parse as last resort
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && d.getFullYear() > 2000) {
    return d.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Generate all dates between fromDate and toDate (inclusive).
 *
 * @param {string} fromDate - ISO date string
 * @param {string} toDate - ISO date string
 * @returns {string[]}
 */
function expandDateRange(fromDate, toDate) {
  const dates = [];
  const from = new Date(fromDate + 'T12:00:00');
  const to = new Date(toDate + 'T12:00:00');

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [fromDate];

  const current = new Date(from);
  while (current <= to) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// ─── Preview & Import ────────────────────────────────────────────────────────

/**
 * Preview the Tisoware absence import for a list of PSPERSNR values.
 *
 * Returns detailed stats about what would happen without writing anything.
 *
 * @param {object} masterDb - MasterDB pool
 * @param {string[]} psPersNrList - PSPERSNR values to import
 * @param {object} options
 * @param {string} [options.dateFrom] - Start date filter
 * @param {string} [options.dateTo] - End date filter
 * @param {boolean} [options.resolveConflicts=false] - Whether to show conflict resolution
 * @returns {Promise<object>} Preview result
 */
export async function previewTisowareImport(masterDb, psPersNrList, options = {}) {
  const { dateFrom, dateTo, resolveConflicts = false } = options;

  // 1. Fetch Tisoware employee data directly for the requested PSPERSNR values
  //    (avoid TOP-500 limitation of searchTisowareEmployees with empty q)
  const cleanList = [...new Set(psPersNrList.map(p => String(p || '').trim()).filter(Boolean))];

  let tisowareRows = [];
  if (cleanList.length > 0) {
    const inClause = cleanList.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
    const sql = `SELECT PSNR, PSPERSNR, PSVORNA, PSNACHNA, PSEINDAT, PSAUSDAT, PGNR, QALNR, KSTNR
                 FROM dbo.PERSTAMM WHERE PSPERSNR IN (${inClause})
                 ORDER BY PSNACHNA, PSVORNA`;
    const result = await queryTisoware(sql);
    tisowareRows = result.rows || [];
  } else {
    // No PSPERSNR list provided — fetch all (for full-org import)
    tisowareRows = await searchTisowareEmployees({ q: '', limit: 500 });
  }

  console.log(`[Tisoware import] preview: requested ${cleanList.length} PSPERSNR(s), found ${tisowareRows.length} PERSTAMM row(s)`);
  console.log(`[Tisoware import] preview: PSPERSNRs found: [${tisowareRows.map(r => r.PSPERSNR).join(', ')}]`);

  const matched = await matchTisowareEmployees(masterDb, tisowareRows);

  const matchedEmployees = matched.filter(e => e.match_status === 'matched');
  const unmatchedEmployees = matched.filter(e => e.match_status !== 'matched');
  const matchedPsPersNr = matchedEmployees.map(e => String(e.PSPERSNR).trim());

  // Build PSNR ↔ PSPERSNR maps (ABWKAL links via PSNR, not PSPERSNR)
  const psnrToPsPersNr = new Map();
  const psPersNrToPsnr = new Map();
  const psnrToEindat = new Map(); // PSNR → PSEINDAT for filtering stale PSNR-reuse data
  for (const e of matchedEmployees) {
    const psnr = String(e.PSNR || '').trim();
    const psp = String(e.PSPERSNR || '').trim();
    if (psnr && psp) {
      psnrToPsPersNr.set(psnr, psp);
      psPersNrToPsnr.set(psp, psnr);
      if (e.PSEINDAT) psnrToEindat.set(psnr, String(e.PSEINDAT).trim());
    }
  }
  const matchedPsnr = [...psnrToPsPersNr.keys()];

  if (matchedPsPersNr.length === 0) {
    return {
      total_source_employees: tisowareRows.length,
      matched_employees: 0,
      unmatched_employees: unmatchedEmployees.length,
      total_absence_rows: 0,
      new_absences: [],
      conflicts: [],
      already_exists: [],
      unparseable_dates: [],
      unmatched_details: unmatchedEmployees,
    };
  }

  // 2. Fetch LOASTAMM descriptions for LOANR codes we'll encounter
  let loanrMap = new Map();
  try {
    const allLoanrCodes = new Set();
    // Peek at ABWKAL to get the LOANR codes — query by PSNR, no date filter
    const peekInClause = matchedPsnr.join(',');
    const peekSql = `SELECT DISTINCT LOANR FROM dbo.ABWKAL WHERE PSNR IN (${peekInClause})`;
    const peekResult = await queryTisoware(peekSql);
    for (const row of (peekResult.rows || [])) {
      if (row.LOANR) allLoanrCodes.add(String(row.LOANR).trim());
    }
    loanrMap = await fetchLoanrDescriptions([...allLoanrCodes]);
  } catch (e) {
    console.warn('[Tisoware import] Could not fetch LOANR descriptions:', e.message);
  }

  // 3. Fetch absences by PSNR (ABWKAL links to PERSTAMM via PSNR)
  let absenceRows = await fetchTisowareAbsences(matchedPsnr, dateFrom, dateTo);

  // Filter out abwesenheits that predate the employee's PSEINDAT (PSNR reuse)
  let filteredByEindat = 0;
  absenceRows = absenceRows.filter(row => {
    const psnr = String(row.PSNR || '').trim();
    const eindat = psnrToEindat.get(psnr);
    if (!eindat) return true; // no PSEINDAT, keep it
    const rawFrom = row.ABWDATVON ? String(row.ABWDATVON).trim() : '';
    if (!rawFrom) return true; // no date, keep it — will be caught as unparseable later
    // Simple string comparison works if both are YYYYMMDD
    if (rawFrom < eindat) {
      filteredByEindat++;
      return false;
    }
    return true;
  });
  if (filteredByEindat > 0) {
    console.log(`[Tisoware import] preview: filtered ${filteredByEindat} ABWKAL row(s) before PSEINDAT (PSNR reuse)`);
  }

  console.log(`[Tisoware import] preview: fetched ${absenceRows.length} ABWKAL row(s) for ${matchedPsnr.length} employee PSNR(s)`);
  if (absenceRows.length === 0) {
    console.log(`[Tisoware import] preview: ABWKAL query returned 0 rows for PSNRs: [${matchedPsnr.slice(0, 10).join(', ')}]`);
  }

  await ensureCentralAbsenceTables(masterDb);

  // 4. Analyze each absence row
  const employeeIdByPsPersNr = new Map(
    matchedEmployees.map(e => [String(e.PSPERSNR).trim(), e.employee_id])
  );

  const newAbsences = [];
  const conflicts = [];
  const alreadyExists = [];
  const unparseableDates = [];

  for (const row of absenceRows) {
    // ABWKAL has PSNR, map back to PSPERSNR to find the CuraFlow employee
    const psnr = String(row.PSNR || '').trim();
    const psPersNr = psnrToPsPersNr.get(psnr) || '';
    const employeeId = psPersNr ? employeeIdByPsPersNr.get(psPersNr) : undefined;
    if (!employeeId) continue; // Shouldn't happen, but safety

    const fromDate = parseTisowareDate(row.ABWDATVON);
    const toDate = parseTisowareDate(row.ABWDATBIS);
    if (!fromDate) {
      unparseableDates.push({ psPersNr, loanr: row.LOANR, rawFrom: row.ABWDATVON, rawTo: row.ABWDATBIS, reason: 'invalid_from_date' });
      continue;
    }

    const dates = expandDateRange(fromDate, toDate || fromDate);
    const loanr = String(row.LOANR || '').trim();
    const { position, notePrefix } = mapLoanrToPosition(loanr, loanrMap.get(loanr));

    for (const date of dates) {
      // Check if already exists in CentralAbsenceEntry
      const [existingRows] = await masterDb.execute(
        'SELECT id, position, note FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ? LIMIT 1',
        [employeeId, date]
      );

      if (existingRows.length > 0) {
        const existing = existingRows[0];
        const samePosition = existing.position === position;

        if (samePosition) {
          alreadyExists.push({
            employee_id: employeeId,
            psPersNr,
            date,
            position,
            loanr,
          });
        } else {
          // Conflict
          const { absencePriority } = await import('./centralAbsences.js');
          const localPrio = absencePriority(position);
          const centralPrio = absencePriority(existing.position);

          if (resolveConflicts && localPrio > centralPrio) {
            conflicts.push({
              employee_id: employeeId,
              psPersNr,
              date,
              tisoware_position: position,
              existing_position: existing.position,
              resolution: 'tisoware_wins',
              local_priority: localPrio,
              central_priority: centralPrio,
              loanr,
            });
          } else if (resolveConflicts && centralPrio > localPrio) {
            conflicts.push({
              employee_id: employeeId,
              psPersNr,
              date,
              tisoware_position: position,
              existing_position: existing.position,
              resolution: 'central_wins',
              local_priority: localPrio,
              central_priority: centralPrio,
              loanr,
            });
          } else {
            conflicts.push({
              employee_id: employeeId,
              psPersNr,
              date,
              tisoware_position: position,
              existing_position: existing.position,
              resolution: 'unresolved',
              local_priority: localPrio,
              central_priority: centralPrio,
              loanr,
            });
          }
        }
      } else {
        newAbsences.push({
          employee_id: employeeId,
          psPersNr,
          date,
          position,
          notePrefix,
          loanr,
          note: row.LOATEXT1 || null,
        });
      }
    }
  }

  return {
    total_source_employees: tisowareRows.length,
    matched_employees: matchedEmployees.length,
    unmatched_employees: unmatchedEmployees.length,
    total_absence_rows: absenceRows.length,
    new_absences: newAbsences,
    conflicts,
    already_exists: alreadyExists,
    unparseable_dates: unparseableDates,
    unmatched_details: unmatchedEmployees.map(e => ({
      PSPERSNR: e.PSPERSNR,
      PSVORNA: e.PSVORNA,
      PSNACHNA: e.PSNACHNA,
      match_status: e.match_status,
    })),
  };
}

/**
 * Execute the Tisoware absence import.
 * Writes absences to CentralAbsenceEntry with idempotent INSERT ON DUPLICATE KEY UPDATE.
 *
 * @param {object} masterDb - MasterDB pool
 * @param {string[]} psPersNrList - PSPERSNR values to import
 * @param {object} options
 * @param {string} [options.dateFrom]
 * @param {string} [options.dateTo]
 * @param {boolean} [options.resolveConflicts=false]
 * @param {string} [options.createdBy] - Email of the admin performing the import
 * @returns {Promise<object>} Import result
 */
export async function executeTisowareImport(masterDb, psPersNrList, options = {}) {
  const { dateFrom, dateTo, resolveConflicts = false, createdBy = null } = options;

  // 1. Match employees — query PERSTAMM directly by PSPERSNR
  const cleanList = [...new Set(psPersNrList.map(p => String(p || '').trim()).filter(Boolean))];

  let tisowareRows = [];
  if (cleanList.length > 0) {
    const inClause = cleanList.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
    const sql = `SELECT PSNR, PSPERSNR, PSVORNA, PSNACHNA, PSEINDAT, PSAUSDAT, PGNR, QALNR, KSTNR
                 FROM dbo.PERSTAMM WHERE PSPERSNR IN (${inClause})
                 ORDER BY PSNACHNA, PSVORNA`;
    const result = await queryTisoware(sql);
    tisowareRows = result.rows || [];
  }

  console.log(`[Tisoware import] execute: requested ${cleanList.length} PSPERSNR(s), found ${tisowareRows.length} PERSTAMM row(s)`);

  const matched = await matchTisowareEmployees(masterDb, tisowareRows);
  const matchedEmployees = matched.filter(e => e.match_status === 'matched');
  const matchedPsPersNr = matchedEmployees.map(e => String(e.PSPERSNR).trim());

  // Build PSNR ↔ PSPERSNR maps (ABWKAL links via PSNR, not PSPERSNR)
  const psnrToPsPersNr = new Map();
  const psnrToEindat = new Map(); // PSNR → PSEINDAT for filtering stale PSNR-reuse data
  for (const e of matchedEmployees) {
    const psnr = String(e.PSNR || '').trim();
    const psp = String(e.PSPERSNR || '').trim();
    if (psnr && psp) {
      psnrToPsPersNr.set(psnr, psp);
      if (e.PSEINDAT) psnrToEindat.set(psnr, String(e.PSEINDAT).trim());
    }
  }
  const matchedPsnr = [...psnrToPsPersNr.keys()];

  if (matchedPsPersNr.length === 0) {
    return {
      imported: 0,
      skipped_existing: 0,
      resolved_conflicts: 0,
      unresolved_conflicts: 0,
      unparseable_dates: 0,
      errors_count: 0,
      errors: [],
    };
  }

  // 2. Fetch LOASTAMM descriptions
  let loanrMap = new Map();
  try {
    const peekInClause = matchedPsnr.join(',');
    // No date filter — column names are unknown until we actually fetch ABWKAL
    const peekSql = `SELECT DISTINCT LOANR FROM dbo.ABWKAL WHERE PSNR IN (${peekInClause})`;
    const peekResult = await queryTisoware(peekSql);
    const allLoanrCodes = new Set();
    for (const row of (peekResult.rows || [])) {
      if (row.LOANR) allLoanrCodes.add(String(row.LOANR).trim());
    }
    loanrMap = await fetchLoanrDescriptions([...allLoanrCodes]);
  } catch (e) {
    console.warn('[Tisoware import] Could not fetch LOANR descriptions:', e.message);
  }

  // 3. Fetch absences by PSNR (ABWKAL links to PERSTAMM via PSNR)
  let absenceRows = await fetchTisowareAbsences(matchedPsnr, dateFrom, dateTo);

  // Filter out abwesenheits that predate the employee's PSEINDAT (PSNR reuse)
  let filteredByEindat = 0;
  absenceRows = absenceRows.filter(row => {
    const psnr = String(row.PSNR || '').trim();
    const eindat = psnrToEindat.get(psnr);
    if (!eindat) return true;
    const rawFrom = row.ABWDATVON ? String(row.ABWDATVON).trim() : '';
    if (!rawFrom) return true;
    if (rawFrom < eindat) {
      filteredByEindat++;
      return false;
    }
    return true;
  });
  if (filteredByEindat > 0) {
    console.log(`[Tisoware import] execute: filtered ${filteredByEindat} ABWKAL row(s) before PSEINDAT (PSNR reuse)`);
  }

  await ensureCentralAbsenceTables(masterDb);

  const employeeIdByPsPersNr = new Map(
    matchedEmployees.map(e => [String(e.PSPERSNR).trim(), e.employee_id])
  );

  let imported = 0;
  let skippedExisting = 0;
  let resolvedConflicts = 0;
  let unresolvedConflicts = 0;
  let unparseableDates = 0;
  const errors = [];

  const { absencePriority, updateCentralAbsencePosition } = await import('./centralAbsences.js');

  for (const row of absenceRows) {
    // ABWKAL has PSNR, map back to PSPERSNR to find the CuraFlow employee
    const psnr = String(row.PSNR || '').trim();
    const psPersNr = psnrToPsPersNr.get(psnr) || '';
    const employeeId = psPersNr ? employeeIdByPsPersNr.get(psPersNr) : undefined;
    if (!employeeId) continue;

    const fromDate = parseTisowareDate(row.ABWDATVON);
    const toDate = parseTisowareDate(row.ABWDATBIS);
    if (!fromDate) {
      unparseableDates++;
      errors.push({ psPersNr, loanr: row.LOANR, rawFrom: row.ABWDATVON, error: 'invalid_from_date' });
      continue;
    }

    const dates = expandDateRange(fromDate, toDate || fromDate);
    const loanr = String(row.LOANR || '').trim();
    const { position, notePrefix } = mapLoanrToPosition(loanr, loanrMap.get(loanr));

    for (const date of dates) {
      try {
        const [existingRows] = await masterDb.execute(
          'SELECT id, position, note FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ? LIMIT 1',
          [employeeId, date]
        );

        if (existingRows.length > 0) {
          const existing = existingRows[0];
          const samePosition = existing.position === position;

          if (samePosition) {
            // Already exists with same position — skip
            skippedExisting++;
            continue;
          }

          // Conflict resolution
          const localPrio = absencePriority(position);
          const centralPrio = absencePriority(existing.position);

          if (resolveConflicts && localPrio > centralPrio) {
            // Tisoware has higher priority — update central
            const mergedNote = mergeNote(existing.note, notePrefix);
            await masterDb.execute(
              'UPDATE CentralAbsenceEntry SET position = ?, note = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?',
              [position, mergedNote, existing.id]
            );
            resolvedConflicts++;
          } else if (resolveConflicts && centralPrio > localPrio) {
            // Central has higher priority — keep it, skip Tisoware
            skippedExisting++;
          } else {
            // Tie or resolveConflicts=false — leave unresolved
            unresolvedConflicts++;
          }
        } else {
          // New entry — insert
          const id = crypto.randomUUID();
          const fullNote = row.LOATEXT1 && row.LOATEXT1 !== notePrefix
            ? `${notePrefix} | ${String(row.LOATEXT1 || '').trim()}`
            : notePrefix;

          await masterDb.execute(
            `INSERT INTO CentralAbsenceEntry (
              id, employee_id, date, position, note,
              created_date, updated_date, created_by,
              source_tenant_id, source_tenant_doctor_id
            ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, NULL, NULL)
            ON DUPLICATE KEY UPDATE
              position = VALUES(position),
              note = VALUES(note),
              updated_date = CURRENT_TIMESTAMP`,
            [id, employeeId, date, position, fullNote, createdBy]
          );
          imported++;
        }
      } catch (err) {
        errors.push({
          psPersNr,
          date,
          loanr,
          position,
          error: err.message,
        });
      }
    }
  }

  return {
    imported,
    skipped_existing: skippedExisting,
    resolved_conflicts: resolvedConflicts,
    unresolved_conflicts: unresolvedConflicts,
    unparseable_dates: unparseableDates,
    errors_count: errors.length,
    errors: errors.slice(0, 50), // Cap errors in response
  };
}
