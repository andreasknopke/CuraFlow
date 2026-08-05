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
 * We map known codes to the canonical CuraFlow absence positions.
 *
 * Datenschutz (Art. 9 DSGVO): Krankheits-Subtypen (z. B. „Krank mit AU",
 * „Krank Quarantäne", „Krank Infektion") werden bewusst NICHT importiert.
 * Es wird nur die kanonische Position (z. B. „Krank") gespeichert, keine
 * gesundheitsbezogenen Detailinformationen in der note.
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
import type { Pool, RowDataPacket } from 'mysql2/promise';
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
// Unmapped codes are stored as "Nicht verfügbar" (the safest fallback).
//
// Datenschutz (Art. 9 DSGVO): Krankheits-Subtypen werden NICHT in die
// note geschrieben. Es wird ausschließlich die kanonische Position
// gespeichert (z. B. „Krank"), keine gesundheitsbezogenen Details.
//
// Mutterschutz / Elternzeit (and similar long-running status codes such as
// KO) are INTENTIONALLY mapped to "Nicht verfügbar" rather than to their own
// canonical positions. CuraFlow's tenant scheduler only renders a fixed set
// of absence rows (Frei/Krank/Urlaub/Dienstreise/Nicht verfügbar); writing
// "Mutterschutz"/"Elternzeit" causes these absences to spill into the
// "Archiv / Unbekannt" section.
// repairTisowareStatusMappings() below backfills already-imported rows.

const LOANR_TO_POSITION: Record<string, string> = {
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

  // Mutterschutz / Elternzeit — mapped to "Nicht verfügbar" (see note above).
  // The [TISO:CODE] note retains the original reason for the absence.
  '550': 'Nicht verfügbar',
  '551': 'Nicht verfügbar',
  '5511': 'Nicht verfügbar',
  '552': 'Nicht verfügbar',

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

// Subtype descriptions for known LOANR codes.
// Datenschutz (Art. 9 DSGVO): Die Subtypen werden bewusst NICHT in die
// Datenbank geschrieben. Nur die kanonische Position wird persistiert.

/**
 * Determine canonical absence position for a given LOANR code.
 * Returns only the canonical position — no [TISO:CODE] note prefix.
 *
 * Datenschutz (Art. 9 DSGVO): Krankheits-Subtypen und Original-Gründe
 * (z. B. "Mutterschutz", "Krank mit AU-Bescheinigung") werden bewusst
 * NICHT in die note geschrieben. Es wird ausschließlich die kanonische
 * Position gespeichert.
 *
 * Mutterschutz/Elternzeit LOANRs (550/551/5511/552) deliberately map to
 * the "Nicht verfügbar" position so they land in a known scheduler row.
 *
 * @param {string} loanr - The LOANR code from ABWKAL
 * @returns {{ position: string }}
 */
export function mapLoanrToPosition(loanr: string | null | undefined): { position: string } {
  const code = String(loanr || '').trim();
  const position = LOANR_TO_POSITION[code] || 'Nicht verfügbar';

  return { position };
}

/**
 * LOANR codes whose original Tisoware reason (Mutterschutz/Elternzeit) was
 * remapped to "Nicht verfügbar". Used by repairTisowareStatusMappings() to
 * detect rows that pre-date the remap and still carry position="Mutterschutz"/
 * "Elternzeit" (or the earlier "Frei" interim mapping).
 */
const STATUS_CODE_LOANRS = new Set(['550', '551', '5511', '552']);

/**
 * Extract the leading [TISO:CODE] from an absence note, or null when absent.
 *
 * @param {string|null} note
 * @returns {string|null} The LOANR code (trimmed) or null.
 */
function extractTisoCodeFromNote(note: string | null): string | null {
  if (!note) return null;
  const match = String(note).match(/\[TISO:([^\]]+)\]/);
  return match ? match[1].trim() : null;
}

/**
 * Repair CentralAbsenceEntry rows that were imported from Tisoware before
 * Mutterschutz/Elternzeit LOANRs were remapped to "Nicht verfügbar". Rows
 * whose note carries a [TISO:CODE] prefix for one of STATUS_CODE_LOANRS AND
 * whose position is "Mutterschutz" or "Elternzeit" are rewritten to
 * position="Nicht verfügbar", keeping the original note (audit trail). Runs
 * idempotently: calling it again is a no-op once all rows are repaired. Rows
 * without the [TISO:] marker are left untouched (they may originate from the
 * tenant-side migration that legitimately produced Mutterschutz/Elternzeit
 * positions).
 *
 * @param {object} masterDb - MasterDB pool
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - When true, only report counts; write nothing.
 * @returns {Promise<{ dryRun: boolean, scanned: number, repaired: number, sample: Array<{id:string,employee_id:string,date:string,old_position:string,note:string|null}> }>}
 */
export async function repairTisowareStatusMappings(masterDb: Pool, options: { dryRun?: boolean } = {}): Promise<{ dryRun: boolean; scanned: number; repaired: number; sample: Array<{ id: string; employee_id: string; date: string; old_position: string; note: string | null }> }> {
  const { dryRun = false } = options;

  await ensureCentralAbsenceTables(masterDb);

  // NOTE: We intentionally scope the rewrite to rows that carry a Tisoware
  // source marker in the note. Tenant-migrated Mutterschutz/Elternzeit rows
  // must remain untouched.
  const likeClauses = [...STATUS_CODE_LOANRS].map(code => `note LIKE ?`).join(' OR ');
  const likeParams = [...STATUS_CODE_LOANRS].map(code => `%[TISO:${code}]%`);

  const [rows] = await masterDb.execute(
    `SELECT id, employee_id, date, position, note
       FROM CentralAbsenceEntry
      WHERE position IN ('Mutterschutz', 'Elternzeit')
        AND (${likeClauses})`,
    likeParams
  ) as [RowDataPacket[], unknown];

  if (dryRun) {
    return {
      dryRun: true,
      scanned: rows.length,
      repaired: 0,
      sample: rows.slice(0, 10).map((r: RowDataPacket) => ({
        id: r.id,
        employee_id: r.employee_id,
        date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
        old_position: r.position,
        note: r.note,
      })),
    };
  }

  let repaired = 0;
  // Update per id to keep the transaction small and the WHERE clause indexed.
  for (const row of rows) {
    const code = extractTisoCodeFromNote(row.note);
    // Defence-in-depth: only repair when the note markers match the remapped set.
    if (!code || !STATUS_CODE_LOANRS.has(code)) continue;
    await masterDb.execute(
      `UPDATE CentralAbsenceEntry
         SET position = 'Nicht verfügbar', updated_date = CURRENT_TIMESTAMP
       WHERE id = ? AND position IN ('Mutterschutz', 'Elternzeit')`,
      [row.id]
    );
    repaired++;
  }

  console.log(`[Tisoware import] repairTisowareStatusMappings: rewrote ${repaired} of ${rows.length} Mutterschutz/Elternzeit rows to Nicht verfügbar`);

  return {
    dryRun: false,
    scanned: rows.length,
    repaired,
    sample: rows.slice(0, 10).map((r: RowDataPacket) => ({
      id: r.id,
      employee_id: r.employee_id,
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
      old_position: r.position,
      note: r.note,
    })),
  };
}

// ─── Employee Matching ──────────────────────────────────────────────────────

interface SearchTisowareEmployeesOptions {
  q?: string;
  kstnr?: string;
  allActive?: boolean;
  limit?: number;
}

/**
 * Search for employees in the Tisoware PERSTAMM table via live proxy.
 *
 * @param {object} params
 * @param {string} [params.q] - Search query (name or PSPERSNR)
 * @param {string} [params.kstnr] - Cost center filter
 * @param {boolean} [params.allActive=false] - If true, filter to currently active employees (PSAUSDAT >= today or NULL/0)
 * @param {number} [params.limit=200] - Max results (0 = no cap)
 * @returns {Promise<Array>} PERSTAMM rows
 */
export async function searchTisowareEmployees({ q, kstnr, allActive = false, limit = 200 }: SearchTisowareEmployeesOptions = {}): Promise<Record<string, unknown>[]> {
  let sql = `SELECT PSNR, PSPERSNR, PSVORNA, PSNACHNA, PSEINDAT, PSAUSDAT, PGNR, QALNR, KSTNR
             FROM dbo.PERSTAMM WHERE 1=1`;
  const conditions: string[] = [];

  if (allActive) {
    // PSAUSDAT is an int (YYYYMMDD). NULL/0 means no exit date set.
    // A past date means the employee has left; a future date (or the
    // far-future sentinel 20991231) means they are still active.
    // Use MSSQL GETDATE() to compare against today.
    conditions.push(`(PSAUSDAT IS NULL OR PSAUSDAT = 0 OR PSAUSDAT >= CAST(CONVERT(varchar(8), GETDATE(), 112) AS int))`);
  }

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
  // TOP for MSSQL; limit=0 means no cap
  if (limit > 0) {
    sql = sql.replace('SELECT', `SELECT TOP ${Math.min(limit, 500)}`);
  }

  const result = await queryTisoware(sql);
  return result.rows || [];
}

/**
 * Search Tisoware PERSTAMM by exact PSPERSNR values (batch lookup).
 * Used for MasterDB-first workflows: get payroll_ids from CuraFlow, then
 * look up the matching Tisoware rows in batches.
 *
 * @param {string[]} psPersNrList - PSPERSNR values to look up
 * @returns {Promise<Array>} PERSTAMM rows
 */
export async function searchTisowareByPsPersNr(psPersNrList: string[]): Promise<Record<string, unknown>[]> {
  const unique = [...new Set(psPersNrList.map((p: string) => String(p || '').trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const BATCH_SIZE = 200; // Keep IN clause well under 10 000 char proxy limit
  let allRows: Record<string, unknown>[] = [];

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const inClause = batch.map((p: string) => `'${p.replace(/'/g, "''")}'`).join(',');
    const sql = `SELECT PSNR, PSPERSNR, PSVORNA, PSNACHNA, PSEINDAT, PSAUSDAT, PGNR, QALNR, KSTNR
                 FROM dbo.PERSTAMM WHERE PSPERSNR IN (${inClause}) ORDER BY PSNACHNA, PSVORNA`;

    const result = await queryTisoware(sql);
    allRows = allRows.concat(result.rows || []);
  }

  // Compute today in YYYYMMDD format for PSAUSDAT comparison (PSAUSDAT is INT YYYYMMDD).
  // PSAUSDAT = Austrittsdatum; if set to a past date, the employee has left.
  const now = new Date();
  const todayInt = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();

  // Group by PSPERSNR and pick the best (active) row per PSPERSNR.
  // PSPERSNR can be reused across employees. We want exactly one PSNR per PSPERSNR,
  // preferring the currently active employee (PSAUSDAT = 0) over future-exited ones,
  // and preferring the highest PSNR (most recently created) as tiebreaker.
  // This ensures N PSPERSNRs → N PERSTAMM rows → N ABWKAL queries.
  const byPsPersNr = new Map<string, Record<string, unknown>>();
  for (const r of allRows) {
    const psp = String(r.PSPERSNR || '').trim();
    if (!psp) continue;

    const ausdatRaw = parseInt(String(r.PSAUSDAT || '0'), 10) || 0;

    // Exclude past-exited employees
    if (ausdatRaw > 0 && ausdatRaw < todayInt) continue;

    const existing = byPsPersNr.get(psp);
    if (!existing) {
      byPsPersNr.set(psp, r);
      continue;
    }

    const existingAus = parseInt(String(existing.PSAUSDAT || '0'), 10) || 0;
    const existingActive = existingAus === 0;
    const currentActive = ausdatRaw === 0;

    // Prefer active (no exit date) over future exit date
    if (currentActive && !existingActive) {
      byPsPersNr.set(psp, r);
    } else if (existingActive && !currentActive) {
      // keep existing
    } else {
      // Same status – prefer higher PSNR (more recently created)
      const currentPsnr = parseInt(String(r.PSNR || '0'), 10) || 0;
      const existingPsnr = parseInt(String(existing.PSNR || '0'), 10) || 0;
      if (currentPsnr > existingPsnr) {
        byPsPersNr.set(psp, r);
      }
    }
  }

  const duplicateCount = allRows.length - byPsPersNr.size;
  if (duplicateCount > 0) {
    console.log(`[Tisoware import] searchTisowareByPsPersNr: ${allRows.length} raw PERSTAMM rows → ${byPsPersNr.size} unique PSPERSNR (${duplicateCount} duplicates/past-exited removed)`);
  }

  return [...byPsPersNr.values()];
}

/**
 * Match Tisoware employees against CuraFlow MasterDB Employee table.
 * Uses PSPERSNR → payroll_id bridge.
 *
 * @param {object} masterDb - MasterDB pool
 * @param {Array} tisowareEmployees - PERSTAMM rows from Tisoware
 * @returns {Promise<Array>} Matched results with match status
 */
export async function matchTisowareEmployees(masterDb: Pool, tisowareEmployees: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  // Build set of PSPERSNR values to look up
  const psPersNrList = tisowareEmployees
    .map((e: Record<string, unknown>) => String(e.PSPERSNR || '').trim())
    .filter(Boolean);

  if (psPersNrList.length === 0) {
    return tisowareEmployees.map((e: Record<string, unknown>) => ({
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
  ) as [RowDataPacket[], unknown];

  const employeeByPayrollId = new Map<string, RowDataPacket>();
  for (const row of employeeRows) {
    const pid = String(row.payroll_id || '').trim();
    if (pid) employeeByPayrollId.set(pid, row);
  }

  return tisowareEmployees.map((e: Record<string, unknown>) => {
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

// ─── Absence Fetching ────────────────────────────────────────────────────────

/**
 * Discover date column names from ABWKAL row keys.
 * ABWKAL columns vary across Tisoware versions; we can't hardcode them.
 * Returns { fromCol, toCol } with the best-guess column names.
 *
 * @param {string[]} keys - Column names from a sample ABWKAL row
 * @returns {{ fromCol: string|null, toCol: string|null }}
 */
export function discoverAbwkalDateColumns(keys: string[]): { fromCol: string | null; toCol: string | null } {
  const upperKeys = keys.map((k: string) => k.toUpperCase());

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

  const candidates = keys.filter((k: string) => {
    const u = k.toUpperCase();
    // Look for columns that contain date-like German terms
    return (u.includes('VON') || u.includes('BIS') || u.includes('BEGINN')
      || u.includes('ENDE') || u.includes('ANFANG') || u.includes('DAT'))
      && !u.includes('ZEIT')  // Exclude time columns (ZEITVON, ZEITBIS)
      && !u.includes('STD')   // Exclude hours (Stunden): VONSTD, BISSTD
      && !u.includes('MIN');  // Exclude minutes: VONMIN, BISMIN
  });

  // Sort: "VON/BEGINN/ANFANG"-like first, then "BIS/ENDE"-like
  const fromCandidates = candidates.filter((c: string) => {
    const u = c.toUpperCase();
    return u.includes('VON') || u.includes('BEGINN') || u.includes('ANFANG');
  });
  const toCandidates = candidates.filter((c: string) => {
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
function normalizeAbwkalRows(rows: Record<string, unknown>[], fromCol: string | null, toCol: string | null): Record<string, unknown>[] {
  if (!fromCol || rows.length === 0) return rows;
  for (const row of rows) {
    row.ABWDATVON = row[fromCol];
    row.ABWDATBIS = row[toCol ?? fromCol];
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
export async function fetchTisowareAbsences(psnrList: (string | number)[], dateFrom?: string, dateTo?: string): Promise<Record<string, unknown>[]> {
  const unique = [...new Set(psnrList.map((p: string | number) => String(p || '').trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const BATCH_SIZE = 25; // Each PSNR can have 50–200 ABWKAL rows; PHP proxy caps at 5000 rows.
                          // 25 PSNRs × ~200 absences = 5000 rows max. For avg 100: 2500 rows.
  let allRows: Record<string, unknown>[] = [];
  let fromCol: string | null = null;
  let toCol: string | null = null;

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const inClause = batch.join(','); // PSNR is numeric, no quoting needed

    const sql = `SELECT ABWKAL.* FROM dbo.ABWKAL WHERE PSNR IN (${inClause}) ORDER BY PSNR`;

    const result = await queryTisoware(sql);
    const rawRows = result.rows || [];

    // PHP proxy caps at 5000 rows — warn if we hit that limit
    if (rawRows.length === 5000) {
      console.warn(`[Tisoware import] fetchTisowareAbsences: WARNING batch ${Math.floor(i / BATCH_SIZE) + 1} returned exactly 5000 rows — may be truncated by PHP proxy! Consider reducing BATCH_SIZE further.`);
    }

    // Discover date column names from the first non-empty batch
    if (!fromCol && rawRows.length > 0) {
      const keys = Object.keys(rawRows[0] || {});
      const discovered = discoverAbwkalDateColumns(keys);
      fromCol = discovered.fromCol;
      toCol = discovered.toCol;
    }

    // Normalize this batch
    const normalized = normalizeAbwkalRows(rawRows, fromCol, toCol);
    allRows = allRows.concat(normalized);
  }

  if (allRows.length === 0 && unique.length > 0) {
    return [];
  }

  // Deduplicate by PSNR + ABWDATVON + LOANR (paranoid safety net)
  const seen = new Set<string>();
  const rows = allRows.filter((r: Record<string, unknown>) => {
    const key = `${r.PSNR || ''}|${r.ABWDATVON || ''}|${r.LOANR || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Log unique PSNR coverage vs requested — only warn on missing
  const uniquePsnrsInResult = [...new Set(rows.map((r: Record<string, unknown>) => String(r.PSNR || '').trim()))];
  if (uniquePsnrsInResult.length < unique.length) {
    const missingPsnrs = unique.filter((p: string) => !uniquePsnrsInResult.includes(p));
    console.warn(`[Tisoware import] fetchTisowareAbsences: ${missingPsnrs.length} PSNRs have ZERO rows! First 20: [${missingPsnrs.slice(0, 20).join(',')}]`);
  }

  // Client-side date filtering (since we can't use SQL WHERE with unknown column names)
  if (dateFrom || dateTo) {
    return rows.filter((row: Record<string, unknown>) => {
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
export function parseTisowareDate(raw: string | null | undefined): string | null {
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
function expandDateRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
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

interface PreviewTisowareImportOptions {
  dateFrom?: string;
  dateTo?: string;
  resolveConflicts?: boolean;
}

interface ExecuteTisowareImportOptions {
  dateFrom?: string;
  dateTo?: string;
  resolveConflicts?: boolean;
  createdBy?: string | null;
}

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
export async function previewTisowareImport(masterDb: Pool, psPersNrList: string[], options: PreviewTisowareImportOptions = {}): Promise<Record<string, unknown>> {
  const { dateFrom, dateTo, resolveConflicts = false } = options;

  // 1. Fetch Tisoware employee data directly for the requested PSPERSNR values
  //    (avoid TOP-500 limitation of searchTisowareEmployees with empty q)
  const cleanList = [...new Set(psPersNrList.map((p: string) => String(p || '').trim()).filter(Boolean))];

  let tisowareRows: Record<string, unknown>[] = [];
  if (cleanList.length > 0) {
    tisowareRows = await searchTisowareByPsPersNr(cleanList);
  } else {
    // No PSPERSNR list provided — fetch all (for full-org import)
    tisowareRows = await searchTisowareEmployees({ q: '', limit: 500 });
  }

  console.log(`[Tisoware import] preview: requested ${cleanList.length} PSPERSNR(s), found ${tisowareRows.length} PERSTAMM row(s)`);

  const matched = await matchTisowareEmployees(masterDb, tisowareRows);

  const matchedEmployees = matched.filter((e: Record<string, unknown>) => e.match_status === 'matched');
  const unmatchedEmployees = matched.filter((e: Record<string, unknown>) => e.match_status !== 'matched');

  console.log(`[Tisoware import] preview: match stats — ${matchedEmployees.length} matched, ${unmatchedEmployees.length} unmatched (total ${matched.length})`);

  const matchedPsPersNr = matchedEmployees.map((e: Record<string, unknown>) => String(e.PSPERSNR).trim());

  // Build PSNR ↔ PSPERSNR maps (ABWKAL links via PSNR, not PSPERSNR)
  const psnrToPsPersNr = new Map<string, string>();
  const psPersNrToPsnr = new Map<string, string>();
  const psnrToEindat = new Map<string, string>(); // PSNR → PSEINDAT for filtering stale PSNR-reuse data
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

  // 3. Process each employee one-by-one to avoid PHP proxy row limits.
  //    Each individual employee has <1000 ABWKAL rows — well within all limits.

  await ensureCentralAbsenceTables(masterDb);

  // Build employeeId map
  const employeeIdByPsPersNr = new Map<string, unknown>(
    matchedEmployees.map((e: Record<string, unknown>) => [String(e.PSPERSNR).trim(), e.employee_id])
  );

  const newAbsences: Record<string, unknown>[] = [];
  const conflicts: Record<string, unknown>[] = [];
  const alreadyExists: Record<string, unknown>[] = [];
  const unparseableDates: Record<string, unknown>[] = [];
  let totalAbsenceRows = 0;

  const employeeCount = matchedEmployees.length;
  for (let empIdx = 0; empIdx < employeeCount; empIdx++) {
    const emp = matchedEmployees[empIdx];
    const psnr = String(emp.PSNR || '').trim();
    const psPersNr = String(emp.PSPERSNR || '').trim();
    const employeeId = emp.employee_id;
    const eindat = psnrToEindat.get(psnr);

    // Fetch absences for this single employee
    const employeeRows = await fetchTisowareAbsences([psnr], dateFrom, dateTo);

    // Filter by PSEINDAT
    const filtered = eindat
      ? employeeRows.filter((row: Record<string, unknown>) => {
          const rawFrom = row.ABWDATVON ? String(row.ABWDATVON).trim() : '';
          return !rawFrom || rawFrom >= eindat;
        })
      : employeeRows;

    totalAbsenceRows += filtered.length;

    if ((empIdx + 1) % 100 === 0 || empIdx === employeeCount - 1) {
      console.log(`[Tisoware import] preview: employee ${empIdx + 1}/${employeeCount} done, ${totalAbsenceRows} total ABWKAL rows so far — ${newAbsences.length} new, ${conflicts.length} conflicts, ${alreadyExists.length} already_exist`);
    }

    // Analyze each absence row for this employee
    for (const row of filtered) {
      const fromDate = parseTisowareDate(row.ABWDATVON as string | null | undefined);
      const toDate = parseTisowareDate(row.ABWDATBIS as string | null | undefined);
      if (!fromDate) {
        unparseableDates.push({ psPersNr, loanr: row.LOANR, rawFrom: row.ABWDATVON, rawTo: row.ABWDATBIS, reason: 'invalid_from_date' });
        continue;
      }

      const dates = expandDateRange(fromDate, toDate || fromDate);
      const loanr = String(row.LOANR || '').trim();
      const { position } = mapLoanrToPosition(loanr);

      for (const date of dates) {
        // Check if already exists in CentralAbsenceEntry
        const [existingRows] = await masterDb.execute(
          'SELECT id, position, note FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ? LIMIT 1',
          [employeeId, date]
        ) as [RowDataPacket[], unknown];

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
            loanr,
          });
        }
      }
    }
  }

  console.log(`[Tisoware import] preview: analysis complete — ${newAbsences.length} new, ${conflicts.length} conflicts, ${alreadyExists.length} already_exist`);
  console.log(`[Tisoware import] preview: processed ${employeeCount} employees one-by-one, ${totalAbsenceRows} total ABWKAL rows`);

  return {
    total_source_employees: tisowareRows.length,
    matched_employees: matchedEmployees.length,
    unmatched_employees: unmatchedEmployees.length,
    total_absence_rows: totalAbsenceRows,
    new_absences: newAbsences,
    conflicts,
    already_exists: alreadyExists,
    unparseable_dates: unparseableDates,
    unmatched_details: unmatchedEmployees.map((e: Record<string, unknown>) => ({
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
export async function executeTisowareImport(masterDb: Pool, psPersNrList: string[], options: ExecuteTisowareImportOptions = {}): Promise<Record<string, unknown>> {
  const { dateFrom, dateTo, resolveConflicts = false, createdBy = null } = options;

  // 1. Match employees — query PERSTAMM directly by PSPERSNR
  const cleanList = [...new Set(psPersNrList.map((p: string) => String(p || '').trim()).filter(Boolean))];

  let tisowareRows: Record<string, unknown>[] = [];
  if (cleanList.length > 0) {
    tisowareRows = await searchTisowareByPsPersNr(cleanList);
  }

  console.log(`[Tisoware import] execute: requested ${cleanList.length} PSPERSNR(s), found ${tisowareRows.length} PERSTAMM row(s)`);

  const matched = await matchTisowareEmployees(masterDb, tisowareRows);
  const matchedEmployees = matched.filter((e: Record<string, unknown>) => e.match_status === 'matched');
  const matchedPsPersNr = matchedEmployees.map((e: Record<string, unknown>) => String(e.PSPERSNR).trim());

  // Build PSNR ↔ PSPERSNR maps (ABWKAL links via PSNR, not PSPERSNR)
  const psnrToPsPersNr = new Map<string, string>();
  const psnrToEindat = new Map<string, string>(); // PSNR → PSEINDAT for filtering stale PSNR-reuse data
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

  // 3. Process each employee one-by-one to avoid PHP proxy row limits.
  //    Each individual employee has <1000 ABWKAL rows — well within all limits.

  await ensureCentralAbsenceTables(masterDb);

  const employeeIdByPsPersNr = new Map<string, unknown>(
    matchedEmployees.map((e: Record<string, unknown>) => [String(e.PSPERSNR).trim(), e.employee_id])
  );

  const { absencePriority, updateCentralAbsencePosition } = await import('./centralAbsences.js');

  let imported = 0;
  let skippedExisting = 0;
  let resolvedConflicts = 0;
  let unresolvedConflicts = 0;
  let unparseableDates = 0;
  const errors: Record<string, unknown>[] = [];

  const employeeCount = matchedEmployees.length;
  for (let empIdx = 0; empIdx < employeeCount; empIdx++) {
    const emp = matchedEmployees[empIdx];
    const psnr = String(emp.PSNR || '').trim();
    const psPersNr = String(emp.PSPERSNR || '').trim();
    const employeeId = emp.employee_id;
    const eindat = psnrToEindat.get(psnr);

    // Fetch absences for this single employee
    const employeeRows = await fetchTisowareAbsences([psnr], dateFrom, dateTo);

    // Filter by PSEINDAT
    const filtered = eindat
      ? employeeRows.filter((row: Record<string, unknown>) => {
          const rawFrom = row.ABWDATVON ? String(row.ABWDATVON).trim() : '';
          return !rawFrom || rawFrom >= eindat;
        })
      : employeeRows;

    if ((empIdx + 1) % 100 === 0 || empIdx === employeeCount - 1) {
      console.log(`[Tisoware import] execute: employee ${empIdx + 1}/${employeeCount} done — ${imported} imported, ${skippedExisting} skipped, ${resolvedConflicts} resolved, ${unresolvedConflicts} unresolved, ${unparseableDates} unparseable`);
    }

    // Write each absence row for this employee
    for (const row of filtered) {
      const fromDate = parseTisowareDate(row.ABWDATVON as string | null | undefined);
      const toDate = parseTisowareDate(row.ABWDATBIS as string | null | undefined);
      if (!fromDate) {
        unparseableDates++;
        errors.push({ psPersNr, loanr: row.LOANR, rawFrom: row.ABWDATVON, error: 'invalid_from_date' });
        continue;
      }

      const dates = expandDateRange(fromDate, toDate || fromDate);
      const loanr = String(row.LOANR || '').trim();
      const { position } = mapLoanrToPosition(loanr);

      for (const date of dates) {
        try {
          const [existingRows] = await masterDb.execute(
            'SELECT id, position FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ? LIMIT 1',
            [employeeId, date]
          ) as [RowDataPacket[], unknown];

          if (existingRows.length > 0) {
            const existing = existingRows[0];
            const samePosition = existing.position === position;

            if (samePosition) {
              // Already exists with same position — skip (no note write; Datenschutz)
              skippedExisting++;
              continue;
            }

            // Conflict resolution
            const localPrio = absencePriority(position);
            const centralPrio = absencePriority(existing.position);

            if (resolveConflicts && localPrio > centralPrio) {
              // Tisoware has higher priority — update central position only
              await masterDb.execute(
                'UPDATE CentralAbsenceEntry SET position = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?',
                [position, existing.id]
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
            // New entry — insert (note stays NULL: Krankheits-Subtypen werden
            // bewusst nicht importiert, Datenschutz Art. 9 DSGVO)
            const id = crypto.randomUUID();

            await masterDb.execute(
              `INSERT INTO CentralAbsenceEntry (
                id, employee_id, date, position, note,
                created_date, updated_date, created_by,
                source_tenant_id, source_tenant_doctor_id
              ) VALUES (?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, NULL, NULL)
              ON DUPLICATE KEY UPDATE
                position = VALUES(position),
                updated_date = CURRENT_TIMESTAMP`,
              [id, employeeId, date, position, createdBy]
            );
            imported++;
          }
        } catch (err) {
          errors.push({
            psPersNr,
            date,
            loanr,
            position,
            error: (err as Error).message,
          });
        }
      }
    }
  }

  console.log(`[Tisoware import] execute: complete — ${imported} imported, ${skippedExisting} skipped, ${resolvedConflicts} resolved, ${unresolvedConflicts} unresolved`);

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
