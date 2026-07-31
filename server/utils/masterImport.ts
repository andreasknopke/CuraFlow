/**
 * Stammdaten-Import Utility
 *
 * Connects to the external "stammdat" personnel master table
 * (database "mitarbeiter", same server as PPUGV), matches employees
 * against the MasterDB Employee table, and provides a migration
 * workflow with three categories:
 *   - EXACT_MATCH:  unambiguous match → automatic update
 *   - AMBIGUOUS:    same last name, multiple candidates → manual review
 *   - NO_MATCH:     no existing employee found → create new
 *
 * Employees with multiple cost-center rows (ma_arbeits_kst > 1) are
 * consolidated: the first row (kst=1) becomes the Employee record,
 * additional rows are stored in EmployeeCostCenter.
 */

import crypto from 'crypto';
import { createPool } from 'mysql2/promise';
import type { Pool, RowDataPacket, ResultSetHeader, FieldPacket } from 'mysql2/promise';

// ============ TYPES ============

interface StammdatConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface StammdatRow extends RowDataPacket {
  id: number;
  personalnummer: number | string;
  ma_arbeits_kst: number;
  anrede: string | null;
  titel: string | null;
  vorname: string | null;
  nachname: string | null;
  beschaeftigt_als: string | null;
  kst: string | null;
  kst_bez: string | null;
  an_personal_gesendete_mail: string | null;
  von: string | null;
  bis: string | null;
  eintrittsmail_gesendet: number | string;
  austrittsmail_gesendet: number | string;
  ma_kst_anteil: number | string;
}

interface EmployeeData {
  stammdat_id: number;
  payroll_id: string;
  salutation: string | null;
  title: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  cost_center: string | null;
  cost_center_name: string | null;
  email: string | null;
  contract_start: string | null;
  contract_end: string | null;
  entry_email_sent: boolean;
  exit_email_sent: boolean;
  source_system: string;
  contract_type: null;
  is_active: boolean;
  exit_date?: string | null;
  exit_reason?: string | null;
}

interface CostCenterData {
  cost_center_number: number;
  cost_center_share: number;
  cost_center_code: string | null;
  cost_center_name: string | null;
  valid_from: string | null;
  valid_until: string | null;
}

interface EmployeeBuildResult {
  employee: EmployeeData;
  costCenters: CostCenterData[];
}

interface ExistingEmployeeRow extends RowDataPacket {
  id: string;
  last_name: string | null;
  first_name: string | null;
  payroll_id: string | null;
  email: string | null;
  stammdat_id: number | null;
}

type MatchCategory = 'EXACT_MATCH' | 'AMBIGUOUS' | 'NO_MATCH';

interface MatchResult {
  category: MatchCategory;
  matches: ExistingEmployeeRow[];
  employee: EmployeeData;
}

interface CandidateInfo {
  id: string;
  last_name: string | null;
  first_name: string | null;
  payroll_id: string | null;
  email: string | null;
}

interface AnalyzeEntry {
  stammdat_id: number;
  personalnummer: number;
  last_name: string | null;
  first_name: string | null;
  position: string | null;
  cost_center: string | null;
  cost_center_name: string | null;
  email: string | null;
  contract_start: string | null;
  contract_end: string | null;
  is_active: boolean;
  cost_center_splits: number;
  source_data: EmployeeData;
  cost_centers: CostCenterData[];
  existing_employee_id?: string;
  existing_last_name?: string | null;
  existing_first_name?: string | null;
  candidates?: CandidateInfo[];
}

interface UnmatchedEmployee {
  id: string;
  last_name: string | null;
  first_name: string | null;
  payroll_id: string | null;
  email: string | null;
  stammdat_id: number | null;
  has_stammdat_id: boolean;
}

interface AnalyzeImportResults {
  total_source_employees: number;
  total_source_rows: number;
  exact_matches: AnalyzeEntry[];
  ambiguous: AnalyzeEntry[];
  no_match: AnalyzeEntry[];
  unmatched_in_curaflow: UnmatchedEmployee[];
}

interface ImportDecision {
  stammdat_id: number;
  action: string;
  existing_employee_id?: string | null;
}

interface ExecuteImportOptions {
  dryRun?: boolean;
}

interface FieldChange {
  old: unknown;
  new: unknown;
}

interface ImportPreview {
  creates: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  skips: Record<string, unknown>[];
  cost_center_changes: Record<string, unknown>[];
}

interface ImportResult {
  dry_run: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: Record<string, unknown>[];
  details: Record<string, unknown>[];
  preview?: ImportPreview;
}

type UpsertableEmployeeField =
  | 'stammdat_id'
  | 'salutation'
  | 'title'
  | 'position'
  | 'cost_center'
  | 'cost_center_name'
  | 'email'
  | 'contract_start'
  | 'contract_end'
  | 'entry_email_sent'
  | 'exit_email_sent'
  | 'source_system'
  | 'is_active'
  | 'exit_date'
  | 'exit_reason';

// ============ HELPERS ============

/**
 * Connect to the external MySQL server where the "mitarbeiter" database lives.
 * Reuses the same credentials as PPUGV/PPBV – only the database name differs.
 *
 * @param {{ host, port, user, password, database }} config
 */
function getStammdatPool(config: StammdatConfig): Pool {
  return createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
    dateStrings: true,
    timezone: '+00:00',
    connectTimeout: 15000,
  });
}

/**
 * Fetch all rows from stammdat table
 */
async function fetchStammdatRows(config: StammdatConfig): Promise<StammdatRow[]> {
  const pool = getStammdatPool(config);
  try {
    const [rows] = await pool.query<StammdatRow[]>('SELECT * FROM stammdat ORDER BY personalnummer, ma_arbeits_kst');
    return rows;
  } finally {
    await pool.end();
  }
}

/**
 * Group stammdat rows by personalnummer.
 * Each employee may have multiple rows (one per cost center split).
 */
function groupByPersonalnummer(rows: StammdatRow[]): Map<number | string, StammdatRow[]> {
  const grouped = new Map<number | string, StammdatRow[]>();
  for (const row of rows) {
    const pn = row.personalnummer;
    if (!grouped.has(pn)) {
      grouped.set(pn, []);
    }
    grouped.get(pn)?.push(row);
  }
  return grouped;
}

/**
 * Build a consolidated employee object from a group of stammdat rows.
 * The first row (ma_arbeits_kst = 1) is the primary.
 */
function buildEmployeeFromRows(rows: StammdatRow[]): EmployeeBuildResult {
  // Sort: primary cost center first
  const sorted = [...rows].sort((a, b) => a.ma_arbeits_kst - b.ma_arbeits_kst);
  const primary = sorted[0];

  const employee: EmployeeData = {
    stammdat_id: primary.id,
    payroll_id: String(primary.personalnummer),
    salutation: primary.anrede || null,
    title: primary.titel && primary.titel !== '-' ? primary.titel : null,
    first_name: primary.vorname || null,
    last_name: primary.nachname || null,
    position: primary.beschaeftigt_als || null,
    cost_center: primary.kst || null,
    cost_center_name: primary.kst_bez || null,
    email: primary.an_personal_gesendete_mail || null,
    contract_start: primary.von && primary.von !== '0000-00-00' ? primary.von : null,
    contract_end: primary.bis && primary.bis !== '0000-00-00' ? primary.bis : null,
    entry_email_sent: primary.eintrittsmail_gesendet === 1 || primary.eintrittsmail_gesendet === '1',
    exit_email_sent: primary.austrittsmail_gesendet === 1 || primary.austrittsmail_gesendet === '1',
    source_system: 'stammdat',
    // Determine contract_type from position/job title if possible
    contract_type: null,
    is_active: true,
  };

  // Mark as inactive if contract_end is in the past
  if (employee.contract_end) {
    const endDate = new Date(employee.contract_end);
    if (endDate < new Date()) {
      employee.is_active = false;
      employee.exit_date = employee.contract_end;
      employee.exit_reason = 'Vertragsende laut Stammdaten';
    }
  }

  // Cost center splits (all rows)
  const costCenters: CostCenterData[] = sorted.map(row => ({
    cost_center_number: row.ma_arbeits_kst,
    cost_center_share: Number(row.ma_kst_anteil) || 100,
    cost_center_code: row.kst || null,
    cost_center_name: row.kst_bez || null,
    valid_from: row.von && row.von !== '0000-00-00' ? row.von : null,
    valid_until: row.bis && row.bis !== '0000-00-00' ? row.bis : null,
  }));

  return { employee, costCenters };
}

/**
 * Normalize a name for comparison (lowercase, trimmed, umlauts preserved).
 */
function normalizeName(name: unknown): string {
  return String(name || '')
    .trim()
    .toLowerCase();
}

// ============ MATCHING LOGIC ============

/**
 * Match a source employee against existing MasterDB employees.
 *
 * @param {object} sourceEmployee - Employee data from stammdat
 * @param {Array} existingEmployees - All active Employee rows from MasterDB
 * @returns {{ category: 'EXACT_MATCH'|'AMBIGUOUS'|'NO_MATCH', matches: Array, employee: object }}
 */
function matchEmployee(sourceEmployee: EmployeeData, existingEmployees: ExistingEmployeeRow[]): MatchResult {
  const srcLast = normalizeName(sourceEmployee.last_name);
  const srcFirst = normalizeName(sourceEmployee.first_name);

  // Find all employees with matching last name
  const lastNameMatches = existingEmployees.filter(
    emp => normalizeName(emp.last_name) === srcLast
  );

  if (lastNameMatches.length === 0) {
    return { category: 'NO_MATCH', matches: [], employee: sourceEmployee };
  }

  // Among last-name matches, find first-name matches
  const fullNameMatches = lastNameMatches.filter(
    emp => normalizeName(emp.first_name) === srcFirst
  );

  if (fullNameMatches.length === 1) {
    return { category: 'EXACT_MATCH', matches: fullNameMatches, employee: sourceEmployee };
  }

  if (fullNameMatches.length > 1) {
    return { category: 'AMBIGUOUS', matches: fullNameMatches, employee: sourceEmployee };
  }

  // Same last name, different first name → ambiguous
  return { category: 'AMBIGUOUS', matches: lastNameMatches, employee: sourceEmployee };
}

/**
 * Bootstrap: import all unique cost center codes from the stammdat
 * source DB into the CostCenter lookup table.
 *
 * @param {object} dbPool         - MasterDB pool
 * @param {object} stammdatConfig - DB connection config for source
 * @returns {{ imported: number, total: number }}
 */
export async function importCostCentersFromStammdat(dbPool: Pool, stammdatConfig: StammdatConfig): Promise<{ success: boolean; imported: number; total: number }> {
  const rows = await fetchStammdatRows(stammdatConfig);
  const seen = new Map<string, string>();
  for (const row of rows) {
    const code = String(row.kst || '').trim();
    const name = String(row.kst_bez || '').trim();
    if (code && !seen.has(code)) {
      seen.set(code, name);
    }
  }

  let imported = 0;
  for (const [code, name] of seen) {
    try {
      await dbPool.execute<ResultSetHeader>(
        'INSERT IGNORE INTO CostCenter (code, name, source_system) VALUES (?, ?, ?)',
        [code, name, 'stammdat']
      );
      imported++;
    } catch { /* skip duplicates */ }
  }

  return { success: true, imported, total: seen.size };
}

// ============ IMPORT OPERATIONS ============

/**
 * Fetch all existing Employee rows from MasterDB (for matching).
 */
async function fetchExistingEmployees(dbPool: Pool): Promise<ExistingEmployeeRow[]> {
  const [rows] = await dbPool.execute<ExistingEmployeeRow[]>(
    'SELECT id, last_name, first_name, payroll_id, email, stammdat_id FROM Employee ORDER BY last_name, first_name'
  );
  return rows;
}

/**
 * Upsert an employee into the MasterDB.
 * If the employee already has a stammdat_id match, update; otherwise insert new.
 */
async function upsertEmployee(
  dbPool: Pool,
  employeeData: EmployeeData,
  existingEmployeeId: string | null = null,
  createdBy: string | null = null
): Promise<{ action: 'created' | 'updated'; id: string }> {
  if (existingEmployeeId) {
    // Update existing employee
    const fieldsToUpdate: UpsertableEmployeeField[] = [
      'stammdat_id', 'salutation', 'title', 'position',
      'cost_center', 'cost_center_name', 'email',
      'contract_start', 'contract_end',
      'entry_email_sent', 'exit_email_sent',
      'source_system', 'is_active', 'exit_date', 'exit_reason',
    ];

    const updates: string[] = [];
    const values: (string | number | boolean | null)[] = [];
    for (const field of fieldsToUpdate) {
      if (employeeData[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(employeeData[field] ?? null);
      }
    }
    // Always update payroll_id
    if (!fieldsToUpdate.some((f: string) => f === 'payroll_id')) {
      updates.push('payroll_id = ?');
      values.push(employeeData.payroll_id ?? null);
    }
    // Always update names
    updates.push('last_name = ?', 'first_name = ?');
    values.push(employeeData.last_name, employeeData.first_name);

    values.push(existingEmployeeId);
    await dbPool.execute<ResultSetHeader>(
      `UPDATE Employee SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    return { action: 'updated', id: existingEmployeeId };
  }

  // Create new employee
  const id = crypto.randomUUID();
  await dbPool.execute<ResultSetHeader>(
    `INSERT INTO Employee (
      id, payroll_id, last_name, first_name, salutation, title, position,
      cost_center, cost_center_name, email,
      contract_start, contract_end,
      entry_email_sent, exit_email_sent,
      source_system, stammdat_id, is_active, exit_date, exit_reason, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      employeeData.payroll_id ?? null,
      employeeData.last_name,
      employeeData.first_name ?? null,
      employeeData.salutation ?? null,
      employeeData.title ?? null,
      employeeData.position ?? null,
      employeeData.cost_center ?? null,
      employeeData.cost_center_name ?? null,
      employeeData.email ?? null,
      employeeData.contract_start ?? null,
      employeeData.contract_end ?? null,
      employeeData.entry_email_sent ? 1 : 0,
      employeeData.exit_email_sent ? 1 : 0,
      employeeData.source_system ?? null,
      employeeData.stammdat_id ?? null,
      employeeData.is_active ?? true,
      employeeData.exit_date ?? null,
      employeeData.exit_reason ?? null,
      createdBy,
    ]
  );
  return { action: 'created', id };
}

/**
 * Sync cost center rows for an employee.
 */
async function syncCostCenters(dbPool: Pool, employeeId: string, costCenters: CostCenterData[]): Promise<void> {
  // Delete existing cost center rows for this employee
  await dbPool.execute<ResultSetHeader>('DELETE FROM EmployeeCostCenter WHERE employee_id = ?', [employeeId]);

  // Insert new rows
  for (const cc of costCenters) {
    const id = crypto.randomUUID();
    await dbPool.execute<ResultSetHeader>(
      `INSERT INTO EmployeeCostCenter (
        id, employee_id, cost_center_number, cost_center_share,
        cost_center_code, cost_center_name, valid_from, valid_until
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        employeeId,
        cc.cost_center_number,
        cc.cost_center_share,
        cc.cost_center_code ?? null,
        cc.cost_center_name ?? null,
        cc.valid_from ?? null,
        cc.valid_until ?? null,
      ]
    );
  }
}

// ============ MAIN IMPORT PIPELINE ============

/**
 * Full import pipeline:
 * 1. Fetch source data from stammdat
 * 2. Group by personalnummer
 * 3. Match against MasterDB
 * 4. Categorize into EXACT_MATCH / AMBIGUOUS / NO_MATCH
 * 5. Return results for UI review
 */
export async function analyzeStammdatImport(dbPool: Pool, stammdatConfig: StammdatConfig): Promise<AnalyzeImportResults> {
  const sourceRows = await fetchStammdatRows(stammdatConfig);
  const grouped = groupByPersonalnummer(sourceRows);
  const existingEmployees = await fetchExistingEmployees(dbPool);

  // Track which existing Employee IDs were matched from stammdat
  const matchedEmployeeIds = new Set<string>();

  const results: AnalyzeImportResults = {
    total_source_employees: grouped.size,
    total_source_rows: sourceRows.length,
    exact_matches: [],
    ambiguous: [],
    no_match: [],
    unmatched_in_curaflow: [],
  };

  for (const [personalnummer, rows] of grouped) {
    const { employee, costCenters } = buildEmployeeFromRows(rows);
    const matchResult = matchEmployee(employee, existingEmployees);

    const entry: AnalyzeEntry = {
      stammdat_id: employee.stammdat_id,
      personalnummer: Number(personalnummer),
      last_name: employee.last_name,
      first_name: employee.first_name,
      position: employee.position,
      cost_center: employee.cost_center,
      cost_center_name: employee.cost_center_name,
      email: employee.email,
      contract_start: employee.contract_start,
      contract_end: employee.contract_end,
      is_active: employee.is_active,
      cost_center_splits: costCenters.filter(cc => cc.cost_center_number > 1).length,
      source_data: employee,
      cost_centers: costCenters,
    };

    switch (matchResult.category) {
      case 'EXACT_MATCH':
        entry.existing_employee_id = matchResult.matches[0].id;
        entry.existing_last_name = matchResult.matches[0].last_name;
        entry.existing_first_name = matchResult.matches[0].first_name;
        matchedEmployeeIds.add(matchResult.matches[0].id);
        results.exact_matches.push(entry);
        break;

      case 'AMBIGUOUS':
        // Ausgeschiedene MA (> contract_end) nicht zur händischen Zuordnung
        // zwingen – sie werden direkt als neue Einträge behandelt.
        if (!employee.is_active) {
          results.no_match.push(entry);
          break;
        }
        entry.candidates = matchResult.matches.map(m => ({
          id: m.id,
          last_name: m.last_name,
          first_name: m.first_name,
          payroll_id: m.payroll_id,
          email: m.email,
        }));
        // Track all candidates as "matched" since they DO appear in stammdat under
        // a name variant — the ambiguity is already visible in the AMBIGUOUS tab.
        matchResult.matches.forEach(m => matchedEmployeeIds.add(m.id));
        results.ambiguous.push(entry);
        break;

      case 'NO_MATCH':
        results.no_match.push(entry);
        break;
    }
  }

  // Find CuraFlow employees that were NEVER referenced by any stammdat row
  results.unmatched_in_curaflow = existingEmployees
    .filter(emp => !matchedEmployeeIds.has(emp.id))
    .map(emp => ({
      id: emp.id,
      last_name: emp.last_name,
      first_name: emp.first_name,
      payroll_id: emp.payroll_id,
      email: emp.email,
      stammdat_id: emp.stammdat_id,
      has_stammdat_id: !!emp.stammdat_id,
    }));

  return results;
}

/**
 * Link an existing CuraFlow Employee to a stammdat entry (by stammdat_id).
 * Fetches the stammdat source row, builds employee data, and updates the
 * Employee record with position, email, cost-centers, etc.
 *
 * @param {object}   dbPool          - MasterDB pool
 * @param {string}   employeeId      - UUID of the existing Employee record
 * @param {number}   stammdatId      - stammdat.id to link to
 * @param {string}   createdBy       - User ID performing the action
 * @param {object}   stammdatConfig  - DB connection config for source
 * @returns {{ success: boolean, employee: object }}
 */
export async function linkStammdatToEmployee(
  dbPool: Pool,
  employeeId: string,
  stammdatId: number,
  createdBy: string | null,
  stammdatConfig: StammdatConfig
): Promise<{ success: boolean; employee: Record<string, unknown> }> {
  // Fetch the stammdat row(s) for this ID
  const pool = getStammdatPool(stammdatConfig);
  let rows: StammdatRow[];
  try {
    const [result] = await pool.query<StammdatRow[]>(
      'SELECT * FROM stammdat WHERE id = ? ORDER BY ma_arbeits_kst',
      [stammdatId]
    );
    rows = result;
  } finally {
    await pool.end();
  }

  if (!rows || rows.length === 0) {
    throw new Error(`Stammdat-Eintrag mit ID ${stammdatId} nicht gefunden`);
  }

  const { employee: stammdatEmployee, costCenters } = buildEmployeeFromRows(rows);

  // Verify the CuraFlow Employee exists
  const [existing] = await dbPool.execute<RowDataPacket[]>('SELECT id FROM Employee WHERE id = ?', [employeeId]);
  if (existing.length === 0) {
    throw new Error('Mitarbeiter nicht in CuraFlow gefunden');
  }

  // Update the Employee with stammdat fields
  const fieldsToUpdate: UpsertableEmployeeField[] = [
    'stammdat_id', 'salutation', 'title', 'position',
    'cost_center', 'cost_center_name', 'email',
    'contract_start', 'contract_end',
    'entry_email_sent', 'exit_email_sent',
    'source_system', 'is_active', 'exit_date', 'exit_reason',
  ];

  const updates: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  for (const field of fieldsToUpdate) {
    if (stammdatEmployee[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(stammdatEmployee[field] ?? null);
    }
  }
  // Always sync payroll_id and names
  updates.push('payroll_id = ?', 'last_name = ?', 'first_name = ?');
  values.push(stammdatEmployee.payroll_id ?? null, stammdatEmployee.last_name, stammdatEmployee.first_name ?? null);

  values.push(employeeId);
  await dbPool.execute<ResultSetHeader>(`UPDATE Employee SET ${updates.join(', ')} WHERE id = ?`, values);

  // Sync cost centers
  if (costCenters.length > 0) {
    await syncCostCenters(dbPool, employeeId, costCenters);
  }

  console.log(`[Master stammdat] Linked CuraFlow employee ${employeeId} to stammdat ${stammdatId} by user ${createdBy}`);

  return {
    success: true,
    employee: {
      id: employeeId,
      last_name: stammdatEmployee.last_name,
      first_name: stammdatEmployee.first_name,
      position: stammdatEmployee.position,
      stammdat_id: stammdatId,
    },
  };
}

/**
 * Compute a field-level diff between old and new employee data.
 * Returns only fields that would actually change.
 */
function computeUpdateDiff(existingEmployee: Record<string, unknown>, newData: Record<string, unknown>): Record<string, FieldChange> {
  const fieldMap: Record<string, string> = {
    payroll_id: 'payroll_id',
    last_name: 'last_name',
    first_name: 'first_name',
    salutation: 'salutation',
    title: 'title',
    position: 'position',
    cost_center: 'cost_center',
    cost_center_name: 'cost_center_name',
    email: 'email',
    contract_start: 'contract_start',
    contract_end: 'contract_end',
    entry_email_sent: 'entry_email_sent',
    exit_email_sent: 'exit_email_sent',
    source_system: 'source_system',
    stammdat_id: 'stammdat_id',
    is_active: 'is_active',
    exit_date: 'exit_date',
    exit_reason: 'exit_reason',
  };

  const changes: Record<string, FieldChange> = {};
  for (const [newKey, dbCol] of Object.entries(fieldMap)) {
    const oldVal = existingEmployee[dbCol];
    const newVal = newData[newKey];

    // Normalize for comparison
    const oldNorm = oldVal === null || oldVal === undefined ? null
      : typeof oldVal === 'boolean' ? (oldVal ? 1 : 0)
      : oldVal;
    const newNorm = newVal === null || newVal === undefined ? null
      : typeof newVal === 'boolean' ? (newVal ? 1 : 0)
      : newVal;

    if (String(oldNorm) !== String(newNorm)) {
      changes[dbCol] = { old: oldVal, new: newVal };
    }
  }
  return changes;
}

/**
 * Execute the import for a specific set of entries.
 *
 * @param {object}   dbPool            - MasterDB pool
 * @param {Array}    decisions         - [{ stammdat_id, action, existing_employee_id? }]
 * @param {string}   createdBy         - User ID performing the import
 * @param {object}   stammdatConfig    - DB connection config for source
 * @param {object}   options           - { dryRun?: boolean }
 */
export async function executeStammdatImport(
  dbPool: Pool,
  decisions: ImportDecision[],
  createdBy: string,
  stammdatConfig: StammdatConfig,
  options: ExecuteImportOptions = {}
): Promise<ImportResult> {
  const { dryRun = false } = options;

  // Fetch source data
  const sourceRows = await fetchStammdatRows(stammdatConfig);
  const grouped = groupByPersonalnummer(sourceRows);
  const existingEmployees = await fetchExistingEmployees(dbPool);

  // In dry-run mode, also fetch full employee data for diff computation
  const existingFullDataMap = new Map<string, Record<string, unknown>>();
  if (dryRun) {
    const [fullRows] = await dbPool.execute<RowDataPacket[]>(
      `SELECT id, last_name, first_name, payroll_id, email,
        salutation, title, position, cost_center, cost_center_name,
        contract_start, contract_end, entry_email_sent, exit_email_sent,
        source_system, stammdat_id, is_active, exit_date, exit_reason
       FROM Employee`
    );
    for (const row of fullRows) {
      existingFullDataMap.set(String(row.id), row as Record<string, unknown>);
    }
  }

  const decisionMap = new Map<number, ImportDecision>();
  for (const d of decisions) {
    decisionMap.set(d.stammdat_id, d);
  }

  const result: ImportResult = {
    dry_run: dryRun,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    details: [],
    // Dry-run only: detailed previews
    preview: dryRun ? {
      creates: [],
      updates: [],
      skips: [],
      cost_center_changes: [],
    } : undefined,
  };

  for (const [personalnummer, rows] of grouped) {
    const { employee, costCenters } = buildEmployeeFromRows(rows);
    const matchResult = matchEmployee(employee, existingEmployees);

    // Check if this employee matches a decision
    let decision: ImportDecision | null = null;
    for (const [sid, d] of decisionMap) {
      if (sid === employee.stammdat_id) {
        decision = d;
        break;
      }
    }

    if (!decision || decision.action === 'skip') {
      result.skipped++;
      const detail: Record<string, unknown> = {
        stammdat_id: employee.stammdat_id,
        personalnummer: Number(personalnummer),
        name: `${employee.first_name} ${employee.last_name}`,
        action: 'skipped',
      };
      result.details.push(detail);
      if (dryRun && result.preview) {
        result.preview.skips.push(detail);
      }
      continue;
    }

    // Determine which existing employee to update (if any)
    let existingId: string | null = null;
    if (decision.existing_employee_id) {
      existingId = decision.existing_employee_id;
    } else if (matchResult.category === 'EXACT_MATCH') {
      existingId = matchResult.matches[0].id;
    }

    // ========== DRY-RUN: compute preview without writing ==========
    if (dryRun) {
      if (existingId) {
        const oldData = existingFullDataMap.get(existingId);
        const diff = computeUpdateDiff(oldData || {}, employee as unknown as Record<string, unknown>);

        if (Object.keys(diff).length === 0) {
          // No changes — would be a no-op update
          const detail: Record<string, unknown> = {
            stammdat_id: employee.stammdat_id,
            personalnummer: Number(personalnummer),
            name: `${employee.first_name} ${employee.last_name}`,
            action: 'update_noop',
            existing_employee_id: existingId,
            changes: {},
          };
          result.details.push(detail);
          if (result.preview) {
            result.preview.updates.push(detail);
          }
          result.skipped++;
        } else {
          const detail: Record<string, unknown> = {
            stammdat_id: employee.stammdat_id,
            personalnummer: Number(personalnummer),
            name: `${employee.first_name} ${employee.last_name}`,
            action: 'update_preview',
            existing_employee_id: existingId,
            existing_name: oldData ? `${oldData.first_name || ''} ${oldData.last_name || ''}`.trim() : '',
            changes: diff,
            cost_centers: costCenters.length,
          };
          result.details.push(detail);
          if (result.preview) {
            result.preview.updates.push(detail);
          }
          result.updated++;
        }
      } else {
        const detail: Record<string, unknown> = {
          stammdat_id: employee.stammdat_id,
          personalnummer: Number(personalnummer),
          name: `${employee.first_name} ${employee.last_name}`,
          action: 'create_preview',
          data: {
            payroll_id: employee.payroll_id,
            last_name: employee.last_name,
            first_name: employee.first_name,
            salutation: employee.salutation,
            title: employee.title,
            position: employee.position,
            cost_center: employee.cost_center,
            cost_center_name: employee.cost_center_name,
            email: employee.email,
            contract_start: employee.contract_start,
            contract_end: employee.contract_end,
            is_active: employee.is_active,
            entry_email_sent: employee.entry_email_sent,
            exit_email_sent: employee.exit_email_sent,
            source_system: employee.source_system,
            cost_centers: costCenters.length,
          },
        };
        result.details.push(detail);
        if (result.preview) {
          result.preview.creates.push(detail);
        }
        result.created++;
      }

      if (costCenters.length > 1) {
        const ccChange: Record<string, unknown> = {
          name: `${employee.first_name} ${employee.last_name}`,
          personalnummer: Number(personalnummer),
          cost_center_count: costCenters.length,
          splits: costCenters.map(cc => ({
            number: cc.cost_center_number,
            share: cc.cost_center_share,
            code: cc.cost_center_code,
            name: cc.cost_center_name,
          })),
        };
        if (result.preview) {
          result.preview.cost_center_changes.push(ccChange);
        }
      }
      continue;
    }

    // ========== LIVE MODE: actually write ==========
    try {
      const upsertResult = await upsertEmployee(dbPool, employee, existingId, createdBy);
      const targetId = upsertResult.id;

      // Sync cost centers
      await syncCostCenters(dbPool, targetId, costCenters);

      if (upsertResult.action === 'created') {
        result.created++;
      } else {
        result.updated++;
      }

      result.details.push({
        stammdat_id: employee.stammdat_id,
        personalnummer: Number(personalnummer),
        name: `${employee.first_name} ${employee.last_name}`,
        action: upsertResult.action,
        employee_id: targetId,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      result.errors.push({
        stammdat_id: employee.stammdat_id,
        personalnummer: Number(personalnummer),
        name: `${employee.first_name} ${employee.last_name}`,
        error: errorMessage,
      });
    }
  }

  return result;
}
