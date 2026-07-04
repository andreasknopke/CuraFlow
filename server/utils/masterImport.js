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

// ============ HELPERS ============

/**
 * Connect to the external MySQL server where the "mitarbeiter" database lives.
 * Reuses the same credentials as PPUGV/PPBV – only the database name differs.
 *
 * @param {{ host, port, user, password, database }} config
 */
function getStammdatPool(config) {
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
async function fetchStammdatRows(config) {
  const pool = getStammdatPool(config);
  try {
    const [rows] = await pool.query('SELECT * FROM stammdat ORDER BY personalnummer, ma_arbeits_kst');
    return rows;
  } finally {
    await pool.end();
  }
}

/**
 * Group stammdat rows by personalnummer.
 * Each employee may have multiple rows (one per cost center split).
 */
function groupByPersonalnummer(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const pn = row.personalnummer;
    if (!grouped.has(pn)) {
      grouped.set(pn, []);
    }
    grouped.get(pn).push(row);
  }
  return grouped;
}

/**
 * Build a consolidated employee object from a group of stammdat rows.
 * The first row (ma_arbeits_kst = 1) is the primary.
 */
function buildEmployeeFromRows(rows) {
  // Sort: primary cost center first
  const sorted = [...rows].sort((a, b) => a.ma_arbeits_kst - b.ma_arbeits_kst);
  const primary = sorted[0];

  const employee = {
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
  const costCenters = sorted.map(row => ({
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
function normalizeName(name) {
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
function matchEmployee(sourceEmployee, existingEmployees) {
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

// ============ IMPORT OPERATIONS ============

/**
 * Fetch all existing Employee rows from MasterDB (for matching).
 */
async function fetchExistingEmployees(dbPool) {
  const [rows] = await dbPool.execute(
    'SELECT id, last_name, first_name, payroll_id, email, stammdat_id FROM Employee ORDER BY last_name, first_name'
  );
  return rows;
}

/**
 * Upsert an employee into the MasterDB.
 * If the employee already has a stammdat_id match, update; otherwise insert new.
 */
async function upsertEmployee(dbPool, employeeData, existingEmployeeId = null, createdBy = null) {
  if (existingEmployeeId) {
    // Update existing employee
    const fields = [
      'stammdat_id', 'salutation', 'title', 'position',
      'cost_center', 'cost_center_name', 'email',
      'contract_start', 'contract_end',
      'entry_email_sent', 'exit_email_sent',
      'source_system', 'is_active', 'exit_date', 'exit_reason',
    ];

    const updates = [];
    const values = [];
    for (const field of fields) {
      if (employeeData[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(employeeData[field] ?? null);
      }
    }
    // Always update payroll_id
    if (!fields.includes('payroll_id')) {
      updates.push('payroll_id = ?');
      values.push(employeeData.payroll_id ?? null);
    }
    // Always update names
    updates.push('last_name = ?', 'first_name = ?');
    values.push(employeeData.last_name, employeeData.first_name);

    values.push(existingEmployeeId);
    await dbPool.execute(
      `UPDATE Employee SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    return { action: 'updated', id: existingEmployeeId };
  }

  // Create new employee
  const id = crypto.randomUUID();
  await dbPool.execute(
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
async function syncCostCenters(dbPool, employeeId, costCenters) {
  // Delete existing cost center rows for this employee
  await dbPool.execute('DELETE FROM EmployeeCostCenter WHERE employee_id = ?', [employeeId]);

  // Insert new rows
  for (const cc of costCenters) {
    const id = crypto.randomUUID();
    await dbPool.execute(
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
export async function analyzeStammdatImport(dbPool, stammdatConfig) {
  const sourceRows = await fetchStammdatRows(stammdatConfig);
  const grouped = groupByPersonalnummer(sourceRows);
  const existingEmployees = await fetchExistingEmployees(dbPool);

  const results = {
    total_source_employees: grouped.size,
    total_source_rows: sourceRows.length,
    exact_matches: [],
    ambiguous: [],
    no_match: [],
  };

  for (const [personalnummer, rows] of grouped) {
    const { employee, costCenters } = buildEmployeeFromRows(rows);
    const matchResult = matchEmployee(employee, existingEmployees);

    const entry = {
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
      cost_centers,
    };

    switch (matchResult.category) {
      case 'EXACT_MATCH':
        entry.existing_employee_id = matchResult.matches[0].id;
        entry.existing_last_name = matchResult.matches[0].last_name;
        entry.existing_first_name = matchResult.matches[0].first_name;
        results.exact_matches.push(entry);
        break;

      case 'AMBIGUOUS':
        entry.candidates = matchResult.matches.map(m => ({
          id: m.id,
          last_name: m.last_name,
          first_name: m.first_name,
          payroll_id: m.payroll_id,
          email: m.email,
        }));
        results.ambiguous.push(entry);
        break;

      case 'NO_MATCH':
        results.no_match.push(entry);
        break;
    }
  }

  return results;
}

/**
 * Execute the import for a specific set of entries.
 *
 * @param {object} dbPool - MasterDB pool
 * @param {Array} decisions - Array of { stammdat_id, action: 'apply'|'skip', existing_employee_id? }
 * @param {string} createdBy - User ID performing the import
 */
export async function executeStammdatImport(dbPool, decisions, createdBy, stammdatConfig) {
  // Fetch source data
  const sourceRows = await fetchStammdatRows(stammdatConfig);
  const grouped = groupByPersonalnummer(sourceRows);
  const existingEmployees = await fetchExistingEmployees(dbPool);

  const decisionMap = new Map();
  for (const d of decisions) {
    decisionMap.set(d.stammdat_id, d);
  }

  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  for (const [personalnummer, rows] of grouped) {
    const { employee, costCenters } = buildEmployeeFromRows(rows);
    const matchResult = matchEmployee(employee, existingEmployees);

    // Check if this employee matches a decision
    let decision = null;
    for (const [sid, d] of decisionMap) {
      if (sid === employee.stammdat_id) {
        decision = d;
        break;
      }
    }

    if (!decision || decision.action === 'skip') {
      result.skipped++;
      result.details.push({
        stammdat_id: employee.stammdat_id,
        personalnummer: Number(personalnummer),
        name: `${employee.first_name} ${employee.last_name}`,
        action: 'skipped',
      });
      continue;
    }

    try {
      // Determine which existing employee to update (if any)
      let existingId = null;
      if (decision.existing_employee_id) {
        existingId = decision.existing_employee_id;
      } else if (matchResult.category === 'EXACT_MATCH') {
        existingId = matchResult.matches[0].id;
      }

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
      result.errors.push({
        stammdat_id: employee.stammdat_id,
        personalnummer: Number(personalnummer),
        name: `${employee.first_name} ${employee.last_name}`,
        error: err.message,
      });
    }
  }

  return result;
}
