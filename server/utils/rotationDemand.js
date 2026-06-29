/**
 * Rotation Demand — Bedarfsanmeldung für Springerpool-Rotationen.
 *
 * Ward staff on a department tenant can register demand ("Bedarf") for a
 * float-pool nurse on a specific date+timeslot. The pool scheduler sees
 * open demands and fulfils them by assigning a rotation_assignment to that
 * cell (rotation_workplace_id + date + timeslot_id), which auto-transitions
 * the demand to "fulfilled".
 *
 * This is a SEPARATE system from the cross-tenant Dienste. It operates on
 * rotation_demand / rotation_assignment tables only — never on
 * shared_shift_entry or shared_workplace.
 */

/**
 * Whitelist of columns the API is allowed to write via POST/PATCH.
 * Never spread req.body directly into SQL — this is the security boundary.
 */
export const ROTATION_DEMAND_WRITABLE_COLUMNS = new Set([
  'rotation_workplace_id',
  'group_id',
  'ward_tenant_id',
  'date',
  'timeslot_id',
  'note',
  'status',
  'fulfilled_by_assignment_id',
  'created_by',
]);

/**
 * Assert that no open demand exists for the same cell (rotation_workplace_id +
 * date + timeslot_id). This prevents duplicate open demands via application
 * logic, allowing status history (the same cell can have → fulfilled → open
 * again → fulfilled).
 *
 * @param {import('mysql2/promise').Pool} masterDb
 * @param {object} params
 * @param {string} params.rotationWorkplaceId
 * @param {string} params.date — YYYY-MM-DD
 * @param {string|null} params.timeslotId
 * @throws {Error} with status 409 if a matching open demand exists
 */
export async function assertNoOpenDemandForCell(masterDb, { rotationWorkplaceId, date, timeslotId }) {
  const [rows] = await masterDb.execute(
    `SELECT id FROM rotation_demand
      WHERE rotation_workplace_id = ?
        AND date = ?
        AND (timeslot_id = ? OR (timeslot_id IS NULL AND ? IS NULL))
        AND status = 'open'
      LIMIT 1`,
    [rotationWorkplaceId, date, timeslotId || null, timeslotId || null]
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
 * rotation_assignment that fulfilled it.
 *
 * @param {import('mysql2/promise').Pool} masterDb
 * @param {object} params
 * @param {string} params.rotationWorkplaceId
 * @param {string} params.date — YYYY-MM-DD
 * @param {string|null} params.timeslotId
 * @param {string} params.assignmentId — the rotation_assignment.id that fulfils it
 * @returns {Promise<string|null>} the demand id that was fulfilled, or null if none
 */
export async function markDemandFulfilledForCell(masterDb, { rotationWorkplaceId, date, timeslotId, assignmentId }) {
  const [result] = await masterDb.execute(
    `UPDATE rotation_demand
        SET status = 'fulfilled',
            fulfilled_by_assignment_id = ?
      WHERE rotation_workplace_id = ?
        AND date = ?
        AND (timeslot_id = ? OR (timeslot_id IS NULL AND ? IS NULL))
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1`,
    [assignmentId, rotationWorkplaceId, date, timeslotId || null, timeslotId || null]
  );
  if (result.affectedRows > 0) {
    const [rows] = await masterDb.execute(
      `SELECT id FROM rotation_demand
        WHERE fulfilled_by_assignment_id = ? AND status = 'fulfilled'
        LIMIT 1`,
      [assignmentId]
    );
    return rows.length > 0 ? rows[0].id : null;
  }
  return null;
}

/**
 * When a rotation_assignment is deleted, reopen any demand that was fulfilled
 * by it (so the ward knows the slot is vacant again).
 *
 * @param {import('mysql2/promise').Pool} masterDb
 * @param {string} assignmentId — the rotation_assignment.id being deleted
 * @returns {Promise<number>} number of demands reopened
 */
export async function reopenDemandOnAssignmentDelete(masterDb, assignmentId) {
  const [result] = await masterDb.execute(
    `UPDATE rotation_demand
        SET status = 'open',
            fulfilled_by_assignment_id = NULL
      WHERE fulfilled_by_assignment_id = ?
        AND status = 'fulfilled'`,
    [assignmentId]
  );
  return result.affectedRows;
}
