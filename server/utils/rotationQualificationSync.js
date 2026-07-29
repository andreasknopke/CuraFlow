/**
 * Inherit Springerpool qualifications into ward tenants on rotation assignment.
 *
 * Qualifications are tenant-local (Qualification + DoctorQualification).
 * Matching is by qualification name (case-insensitive), same approach as
 * cross-tenant eligible-staff in groups.js.
 *
 * Identity used in rotation_assignment.employee_id may be:
 *   - a pool-tenant Doctor.id (picker in RotationAssignmentDialog)
 *   - a central Employee UUID (Joker offers / direct Employee link)
 *
 * We write DoctorQualification rows in the ward tenant for:
 *   1. the assignment employee_id (used as doctor_id on ward ShiftEntry / chips)
 *   2. any linked ward Doctor (central_employee_id / EmployeeTenantAssignment)
 * so both schedule validation and the staff matrix benefit when a local
 * Doctor record exists.
 */

import crypto from 'crypto';
import { createPool } from 'mysql2/promise';
import { parseDbToken } from './crypto.js';
import { resolvePoolTenantId } from './rotationGroups.js';

/**
 * Open a short-lived pool for a tenant token row and run callback.
 * Mirrors the helper used in groups.js / master.js.
 */
export async function withTenantDb(token, callback) {
  let pool = null;
  try {
    const config = parseDbToken(token.token);
    if (!config || !config.host || !config.database) {
      throw new Error(`Invalid tenant DB config for ${token.name || token.id}`);
    }
    pool = createPool({
      host: config.host,
      port: parseInt(config.port || '3306', 10),
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl || undefined,
      waitForConnections: true,
      connectionLimit: 2,
      queueLimit: 0,
      dateStrings: true,
      timezone: '+00:00',
      connectTimeout: 10000,
    });
    return await callback(pool, token);
  } finally {
    if (pool) {
      await pool.end().catch(() => {});
    }
  }
}

export async function loadTenantTokenById(masterDb, tenantId) {
  if (!tenantId) return null;
  const [rows] = await masterDb.execute(
    'SELECT * FROM db_tokens WHERE id = ? LIMIT 1',
    [String(tenantId)]
  );
  return rows[0] || null;
}

/**
 * Resolve central Employee id for a rotation assignment employee_id value.
 * @returns {Promise<string|null>}
 */
export async function resolveCentralEmployeeId(masterDb, employeeId) {
  if (!employeeId) return null;
  const id = String(employeeId);

  const [direct] = await masterDb.execute(
    'SELECT id FROM Employee WHERE id = ? LIMIT 1',
    [id]
  );
  if (direct.length > 0) return String(direct[0].id);

  const [etaRows] = await masterDb.execute(
    `SELECT employee_id FROM EmployeeTenantAssignment
      WHERE tenant_doctor_id = ?
      LIMIT 1`,
    [id]
  );
  if (etaRows.length > 0 && etaRows[0].employee_id) {
    return String(etaRows[0].employee_id);
  }
  return null;
}

/**
 * Load distinct qualification names held by the springer in the pool tenant.
 */
export async function loadPoolQualificationNames(pool, {
  employeeId,
  centralEmployeeId = null,
  poolTenantId = null,
  doctorToEmployee = null,
}) {
  const names = new Set();
  const doctorIds = new Set();

  // Direct id match (assignment stores pool Doctor.id)
  const [byId] = await pool.execute(
    'SELECT id FROM Doctor WHERE id = ? LIMIT 1',
    [String(employeeId)]
  );
  if (byId.length > 0) doctorIds.add(String(byId[0].id));

  if (centralEmployeeId) {
    const [byCentral] = await pool.execute(
      `SELECT id FROM Doctor
        WHERE central_employee_id = ?
        LIMIT 5`,
      [String(centralEmployeeId)]
    );
    for (const row of byCentral) doctorIds.add(String(row.id));
  }

  // Fallback via ETA map when Doctor.central_employee_id is unset
  if (doctorIds.size === 0 && doctorToEmployee && centralEmployeeId && poolTenantId) {
    for (const [key, empId] of doctorToEmployee.entries()) {
      if (String(empId) !== String(centralEmployeeId)) continue;
      if (!key.startsWith(`${poolTenantId}:`)) continue;
      doctorIds.add(key.slice(String(poolTenantId).length + 1));
    }
  }

  if (doctorIds.size === 0) return [];

  const placeholders = [...doctorIds].map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT DISTINCT q.name AS qname
       FROM DoctorQualification dq
       JOIN Qualification q ON q.id = dq.qualification_id
      WHERE dq.doctor_id IN (${placeholders})
        AND q.name IS NOT NULL
        AND (q.is_active IS NULL OR q.is_active = 1)`,
    [...doctorIds]
  );

  for (const row of rows) {
    const name = String(row.qname || '').trim();
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * Resolve ward-local doctor ids that should receive inherited qualifications.
 */
export async function resolveWardDoctorIds(pool, {
  employeeId,
  centralEmployeeId = null,
  wardTenantId = null,
  masterDb = null,
}) {
  const ids = new Set([String(employeeId)]);

  if (centralEmployeeId) {
    const [byCentral] = await pool.execute(
      `SELECT id FROM Doctor
        WHERE central_employee_id = ?`,
      [String(centralEmployeeId)]
    );
    for (const row of byCentral) ids.add(String(row.id));
  }

  if (masterDb && centralEmployeeId && wardTenantId) {
    const [etaRows] = await masterDb.execute(
      `SELECT tenant_doctor_id FROM EmployeeTenantAssignment
        WHERE employee_id = ? AND tenant_id = ?
          AND tenant_doctor_id IS NOT NULL AND tenant_doctor_id != ''`,
      [String(centralEmployeeId), String(wardTenantId)]
    );
    for (const row of etaRows) {
      if (row.tenant_doctor_id) ids.add(String(row.tenant_doctor_id));
    }
  }

  return [...ids];
}

/**
 * Case-insensitive name → qualification id map for a tenant.
 */
export async function loadWardQualificationsByName(pool) {
  const [rows] = await pool.execute(
    `SELECT id, name FROM Qualification
      WHERE name IS NOT NULL
        AND (is_active IS NULL OR is_active = 1)`
  );
  const byLower = new Map();
  for (const row of rows) {
    const name = String(row.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    // First wins — UNIQUE(name) is case-insensitive in MySQL unicode_ci
    if (!byLower.has(key)) {
      byLower.set(key, { id: String(row.id), name });
    }
  }
  return byLower;
}

/**
 * Insert missing DoctorQualification rows. Returns created ids.
 */
export async function ensureDoctorQualifications(pool, {
  doctorIds,
  qualificationIds,
  createdBy = 'system',
  notes = 'Inherited from pool rotation',
}) {
  const created = [];
  if (!doctorIds?.length || !qualificationIds?.length) return created;

  for (const doctorId of doctorIds) {
    for (const qualificationId of qualificationIds) {
      const [existing] = await pool.execute(
        `SELECT id FROM DoctorQualification
          WHERE doctor_id = ? AND qualification_id = ?
          LIMIT 1`,
        [String(doctorId), String(qualificationId)]
      );
      if (existing.length > 0) continue;

      const id = crypto.randomUUID();
      await pool.execute(
        `INSERT INTO DoctorQualification
           (id, doctor_id, qualification_id, notes, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [id, String(doctorId), String(qualificationId), notes, createdBy]
      );
      created.push({
        id,
        doctor_id: String(doctorId),
        qualification_id: String(qualificationId),
      });
    }
  }
  return created;
}

/**
 * Sync pool-tenant qualifications onto the ward tenant for one assignment.
 *
 * @returns {Promise<{
 *   skipped?: string,
 *   poolQualificationNames?: string[],
 *   matchedQualificationIds?: string[],
 *   created?: Array<{id:string,doctor_id:string,qualification_id:string}>,
 *   wardTenantId?: string,
 *   poolTenantId?: string,
 * }>}
 */
export async function syncRotationAssignmentQualifications({
  masterDb,
  groupId,
  rotationWorkplaceId,
  employeeId,
  withTenantDb: withTenantDbFn = withTenantDb,
  actor = null,
  buildRealtimeScope = null,
  broadcastPlanUpdate = null,
}) {
  if (!masterDb || !groupId || !rotationWorkplaceId || !employeeId) {
    return { skipped: 'missing_params' };
  }

  const [wpRows] = await masterDb.execute(
    `SELECT id, group_id, ward_tenant_id
       FROM rotation_workplace
      WHERE id = ? AND group_id = ?
      LIMIT 1`,
    [String(rotationWorkplaceId), String(groupId)]
  );
  if (wpRows.length === 0) return { skipped: 'workplace_not_found' };

  const wardTenantId = wpRows[0].ward_tenant_id ? String(wpRows[0].ward_tenant_id) : null;
  if (!wardTenantId) return { skipped: 'no_ward_tenant' };

  const poolTenantId = await resolvePoolTenantId(masterDb, groupId);
  if (!poolTenantId) return { skipped: 'no_pool_tenant' };
  if (String(poolTenantId) === String(wardTenantId)) {
    return { skipped: 'pool_equals_ward' };
  }

  const poolToken = await loadTenantTokenById(masterDb, poolTenantId);
  const wardToken = await loadTenantTokenById(masterDb, wardTenantId);
  if (!poolToken || !wardToken) return { skipped: 'tenant_token_missing' };

  const centralEmployeeId = await resolveCentralEmployeeId(masterDb, employeeId);

  // Optional ETA fallback map for pool doctors without central_employee_id
  let doctorToEmployee = null;
  if (centralEmployeeId) {
    doctorToEmployee = new Map();
    const [etaRows] = await masterDb.execute(
      `SELECT tenant_id, tenant_doctor_id, employee_id
         FROM EmployeeTenantAssignment
        WHERE tenant_id = ?
          AND tenant_doctor_id IS NOT NULL`,
      [String(poolTenantId)]
    );
    for (const eta of etaRows) {
      doctorToEmployee.set(
        `${eta.tenant_id}:${eta.tenant_doctor_id}`,
        String(eta.employee_id)
      );
    }
  }

  let poolQualificationNames = [];
  try {
    poolQualificationNames = await withTenantDbFn(poolToken, async (pool) =>
      loadPoolQualificationNames(pool, {
        employeeId,
        centralEmployeeId,
        poolTenantId,
        doctorToEmployee,
      })
    );
  } catch (err) {
    console.warn('[rotationQualificationSync] pool scan failed:', err.message);
    return { skipped: 'pool_scan_failed', error: err.message };
  }

  if (poolQualificationNames.length === 0) {
    return {
      skipped: 'no_pool_qualifications',
      poolTenantId,
      wardTenantId,
      poolQualificationNames: [],
    };
  }

  let created = [];
  let matchedQualificationIds = [];
  let wardDoctorIds = [];

  try {
    const result = await withTenantDbFn(wardToken, async (pool) => {
      const qualsByName = await loadWardQualificationsByName(pool);
      const matchedIds = [];
      for (const name of poolQualificationNames) {
        const match = qualsByName.get(name.toLowerCase());
        if (match) matchedIds.push(match.id);
      }
      if (matchedIds.length === 0) {
        return { matchedIds: [], doctorIds: [], createdRows: [] };
      }

      const doctorIds = await resolveWardDoctorIds(pool, {
        employeeId,
        centralEmployeeId,
        wardTenantId,
        masterDb,
      });

      const createdRows = await ensureDoctorQualifications(pool, {
        doctorIds,
        qualificationIds: matchedIds,
        createdBy: actor?.email || actor?.sub || 'system',
      });

      return { matchedIds, doctorIds, createdRows };
    });

    matchedQualificationIds = result.matchedIds;
    wardDoctorIds = result.doctorIds;
    created = result.createdRows;
  } catch (err) {
    console.warn('[rotationQualificationSync] ward sync failed:', err.message);
    return {
      skipped: 'ward_sync_failed',
      error: err.message,
      poolTenantId,
      wardTenantId,
      poolQualificationNames,
    };
  }

  if (
    created.length > 0 &&
    buildRealtimeScope &&
    broadcastPlanUpdate &&
    wardToken.token
  ) {
    const scope = buildRealtimeScope(wardToken.token);
    const touchedDoctors = new Set(created.map((row) => row.doctor_id));
    for (const doctorId of touchedDoctors) {
      broadcastPlanUpdate({
        scope,
        entity: 'DoctorQualification',
        action: 'create',
        recordId: doctorId,
        actor,
      });
    }
  }

  return {
    poolTenantId,
    wardTenantId,
    centralEmployeeId,
    poolQualificationNames,
    matchedQualificationIds,
    wardDoctorIds,
    created,
  };
}
