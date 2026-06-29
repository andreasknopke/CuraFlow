/**
 * Pool Ward Demand — cross-tenant Bedarf-Meldung für Springerpool-Rotationen.
 *
 * Ward staff on a department tenant can register demand ("Bedarf") for a
 * float-pool nurse on a specific date+timeslot. The pool scheduler sees
 * open demands and fulfils them by assigning a shared_shift_entry to that
 * cell (shared_workplace_id + date + timeslot_id), which auto-transitions
 * the demand to "fulfilled".
 *
 * Data lives in the master DB, modelled on CentralWishRequest.
 */

let poolWardDemandTableEnsured = false;

/**
 * Idempotent table creation. Guarded by a module-level flag so we only
 * attempt CREATE TABLE once per process (but the SQL itself is also
 * IF NOT EXISTS for safety across restarts).
 */
export async function ensurePoolWardDemandTables(masterDb) {
  if (poolWardDemandTableEnsured) return;
  await masterDb.execute(`
    CREATE TABLE IF NOT EXISTS pool_ward_demand (
      id VARCHAR(36) PRIMARY KEY,
      shared_workplace_id VARCHAR(36) NOT NULL,
      group_id INT NOT NULL,
      ward_tenant_id VARCHAR(36) NOT NULL,
      date DATE NOT NULL,
      timeslot_id VARCHAR(36) DEFAULT NULL,
      note TEXT DEFAULT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'open',
      fulfilled_by_shift_id VARCHAR(36) DEFAULT NULL,
      created_by VARCHAR(255) DEFAULT NULL,
      created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_demand_status (status),
      INDEX idx_demand_workplace_date (shared_workplace_id, date),
      INDEX idx_demand_ward (ward_tenant_id, date),
      INDEX idx_demand_fulfilled (fulfilled_by_shift_id),
      CONSTRAINT fk_demand_workplace FOREIGN KEY (shared_workplace_id)
        REFERENCES shared_workplace(id) ON DELETE CASCADE,
      CONSTRAINT fk_demand_group FOREIGN KEY (group_id)
        REFERENCES tenant_group(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  poolWardDemandTableEnsured = true;
}

/**
 * Whitelist of columns the API is allowed to write via POST/PATCH.
 * Never spread req.body directly into SQL — this is the security boundary.
 */
export const POOL_WARD_DEMAND_WRITABLE_COLUMNS = new Set([
  'shared_workplace_id',
  'group_id',
  'ward_tenant_id',
  'date',
  'timeslot_id',
  'note',
  'status',
  'fulfilled_by_shift_id',
  'created_by',
]);

/**
 * Assert that no open demand exists for the same cell (shared_workplace_id +
 * ward_tenant_id + date + timeslot_id). This prevents duplicate open demands
 * via application logic rather than a DB unique constraint, allowing status
 * history (the same cell can have → fulfilled → open again → fulfilled).
 *
 * @param {import('mysql2/promise').Pool} masterDb
 * @param {object} params
 * @param {string} params.sharedWorkplaceId
 * @param {string} params.wardTenantId
 * @param {string} params.date — YYYY-MM-DD
 * @param {string|null} params.timeslotId
 * @throws {Error} with status 409 if a matching open demand exists
 */
export async function assertNoOpenDemandForCell(masterDb, { sharedWorkplaceId, wardTenantId, date, timeslotId }) {
  const [rows] = await masterDb.execute(
    `SELECT id FROM pool_ward_demand
      WHERE shared_workplace_id = ?
        AND ward_tenant_id = ?
        AND date = ?
        AND (timeslot_id = ? OR (timeslot_id IS NULL AND ? IS NULL))
        AND status = 'open'
      LIMIT 1`,
    [sharedWorkplaceId, wardTenantId, date, timeslotId || null, timeslotId || null]
  );
  if (rows.length > 0) {
    const err = new Error('Für diese Zelle existiert bereits ein offener Bedarf');
    err.status = 409;
    err.existingId = rows[0].id;
    throw err;
  }
}

/**
 * Mark any open demand for the given cell as fulfilled, linking it to the
 * shared_shift_entry that fulfilled it. If multiple open demands somehow
 * exist (should not happen thanks to assertNoOpenDemandForCell), fulfils
 * the most recent one.
 *
 * @param {import('mysql2/promise').Pool} masterDb
 * @param {object} params
 * @param {string} params.sharedWorkplaceId
 * @param {string} params.wardTenantId — the billing_tenant_id of the shift (= the ward)
 * @param {string} params.date — YYYY-MM-DD
 * @param {string|null} params.timeslotId
 * @param {string} params.shiftId — the shared_shift_entry.id that fulfils it
 * @returns {Promise<string|null>} the demand id that was fulfilled, or null if none
 */
export async function markDemandFulfilledForCell(masterDb, { sharedWorkplaceId, wardTenantId, date, timeslotId, shiftId }) {
  const [result] = await masterDb.execute(
    `UPDATE pool_ward_demand
        SET status = 'fulfilled',
            fulfilled_by_shift_id = ?
      WHERE shared_workplace_id = ?
        AND ward_tenant_id = ?
        AND date = ?
        AND (timeslot_id = ? OR (timeslot_id IS NULL AND ? IS NULL))
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1`,
    [shiftId, sharedWorkplaceId, wardTenantId, date, timeslotId || null, timeslotId || null]
  );
  if (result.affectedRows > 0) {
    // Fetch the id of the fulfilled demand
    const [rows] = await masterDb.execute(
      `SELECT id FROM pool_ward_demand
        WHERE fulfilled_by_shift_id = ? AND status = 'fulfilled'
        LIMIT 1`,
      [shiftId]
    );
    return rows.length > 0 ? rows[0].id : null;
  }
  return null;
}

/**
 * When a shared_shift_entry is deleted, reopen any demand that was fulfilled
 * by it (so the ward knows the slot is vacant again).
 *
 * @param {import('mysql2/promise').Pool} masterDb
 * @param {string} shiftId — the shared_shift_entry.id being deleted
 * @returns {Promise<number>} number of demands reopened
 */
export async function reopenDemandOnShiftDelete(masterDb, shiftId) {
  const [result] = await masterDb.execute(
    `UPDATE pool_ward_demand
        SET status = 'open',
            fulfilled_by_shift_id = NULL
      WHERE fulfilled_by_shift_id = ?
        AND status = 'fulfilled'`,
    [shiftId]
  );
  return result.affectedRows;
}
