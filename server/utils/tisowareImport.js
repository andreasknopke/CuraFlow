/**
 * Tisoware Import Utility
 *
 * Imports employee absence data from the Tisoware MSSQL database
 * (accessed via the ODBC/HTTP proxy) into the CuraFlow MasterDB
 * CentralAbsenceEntry table.
 *
 * ─── ID Bridge ───────────────────────────────────────────────────────────
 * PERSTAMM.PSPERSNR (nvarchar) → Employee.payroll_id (VARCHAR(50))
 * PERSTAMM.PSPERSNR is also used in ABWKAL.PSPERSNR for linking.
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
 * Fetch absence entries from Tisoware ABWKAL for a list of PSPERSNR values.
 *
 * @param {string[]} psPersNrList - PSPERSNR values to fetch absences for
 * @param {string} [dateFrom] - Optional start date (YYYYMMDD format for Tisoware)
 * @param {string} [dateTo] - Optional end date (YYYYMMDD format for Tisoware)
 * @returns {Promise<Array>} ABWKAL rows
 */
export async function fetchTisowareAbsences(psPersNrList, dateFrom, dateTo) {
  const unique = [...new Set(psPersNrList.map(p => String(p || '').trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const inClause = unique.map(p => `'${p.replace(/'/g, "''")}'`).join(',');

  let sql = `SELECT ABWKAL.* FROM dbo.ABWKAL WHERE PSPERSNR IN (${inClause})`;

  if (dateFrom && dateTo) {
    // Tisoware dates are often stored as varchar YYYYMMDD or YYYY-MM-DD
    // We try both formats
    sql += ` AND (ABWDATVON >= '${dateFrom.replace(/'/g, "''")}' AND ABWDATBIS <= '${dateTo.replace(/'/g, "''")}')`;
  }

  sql += ' ORDER BY PSPERSNR, ABWDATVON';

  const result = await queryTisoware(sql, 50000); // Higher limit for bulk import
  return result.rows || [];
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

  // 1. Fetch matched employees
  const tisowareRows = await searchTisowareEmployees({ q: '', limit: 500 });
  const filtered = psPersNrList.length > 0
    ? tisowareRows.filter(r => psPersNrList.includes(String(r.PSPERSNR || '').trim()))
    : tisowareRows;

  const matched = await matchTisowareEmployees(masterDb, filtered);

  const matchedEmployees = matched.filter(e => e.match_status === 'matched');
  const unmatchedEmployees = matched.filter(e => e.match_status !== 'matched');
  const matchedPsPersNr = matchedEmployees.map(e => String(e.PSPERSNR).trim());

  if (matchedPsPersNr.length === 0) {
    return {
      total_source_employees: filtered.length,
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
    // We need to peek at ABWKAL to get the LOANR codes — do a targeted query
    const inClause = matchedPsPersNr.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
    let peekSql = `SELECT DISTINCT LOANR FROM dbo.ABWKAL WHERE PSPERSNR IN (${inClause})`;
    if (dateFrom && dateTo) {
      peekSql += ` AND (ABWDATVON >= '${dateFrom.replace(/'/g, "''")}' AND ABWDATBIS <= '${dateTo.replace(/'/g, "''")}')`;
    }
    const peekResult = await queryTisoware(peekSql);
    for (const row of (peekResult.rows || [])) {
      if (row.LOANR) allLoanrCodes.add(String(row.LOANR).trim());
    }
    loanrMap = await fetchLoanrDescriptions([...allLoanrCodes]);
  } catch (e) {
    console.warn('[Tisoware import] Could not fetch LOANR descriptions:', e.message);
  }

  // 3. Fetch absences
  const absenceRows = await fetchTisowareAbsences(matchedPsPersNr, dateFrom, dateTo);

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
    const psPersNr = String(row.PSPERSNR || '').trim();
    const employeeId = employeeIdByPsPersNr.get(psPersNr);
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
    total_source_employees: filtered.length,
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

  // 1. Match employees
  const tisowareRows = await searchTisowareEmployees({ q: '', limit: 500 });
  const filtered = psPersNrList.length > 0
    ? tisowareRows.filter(r => psPersNrList.includes(String(r.PSPERSNR || '').trim()))
    : tisowareRows;

  const matched = await matchTisowareEmployees(masterDb, filtered);
  const matchedEmployees = matched.filter(e => e.match_status === 'matched');
  const matchedPsPersNr = matchedEmployees.map(e => String(e.PSPERSNR).trim());

  if (matchedPsPersNr.length === 0) {
    return {
      imported: 0,
      skipped_existing: 0,
      resolved_conflicts: 0,
      unresolved_conflicts: 0,
      unparseable_dates: 0,
      errors: [],
    };
  }

  // 2. Fetch LOASTAMM descriptions
  let loanrMap = new Map();
  try {
    const inClause = matchedPsPersNr.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
    let peekSql = `SELECT DISTINCT LOANR FROM dbo.ABWKAL WHERE PSPERSNR IN (${inClause})`;
    if (dateFrom && dateTo) {
      peekSql += ` AND (ABWDATVON >= '${dateFrom.replace(/'/g, "''")}' AND ABWDATBIS <= '${dateTo.replace(/'/g, "''")}')`;
    }
    const peekResult = await queryTisoware(peekSql);
    const allLoanrCodes = new Set();
    for (const row of (peekResult.rows || [])) {
      if (row.LOANR) allLoanrCodes.add(String(row.LOANR).trim());
    }
    loanrMap = await fetchLoanrDescriptions([...allLoanrCodes]);
  } catch (e) {
    console.warn('[Tisoware import] Could not fetch LOANR descriptions:', e.message);
  }

  // 3. Fetch absences
  const absenceRows = await fetchTisowareAbsences(matchedPsPersNr, dateFrom, dateTo);

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
    const psPersNr = String(row.PSPERSNR || '').trim();
    const employeeId = employeeIdByPsPersNr.get(psPersNr);
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
