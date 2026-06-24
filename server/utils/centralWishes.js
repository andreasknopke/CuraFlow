// Central wish storage for cross-tenant (Verbundsdienst) requests.
//
// Mirrors the CentralAbsenceEntry pattern: the data lives in the master DB
// so wishes follow the central employee across tenants, but maintenance is
// done from the tenant frontend (Wunschbox) just like tenant-internal wishes.
//
// See Migration 023 for the canonical schema. This helper is a safety net
// for fresh deploys and is idempotent (CREATE TABLE IF NOT EXISTS).

let centralWishTableEnsured = false;

export async function ensureCentralWishTables(masterDb) {
  if (centralWishTableEnsured) return;
  await masterDb.execute(`
    CREATE TABLE IF NOT EXISTS CentralWishRequest (
      id VARCHAR(36) PRIMARY KEY,
      employee_id VARCHAR(36) NOT NULL,
      shared_workplace_id VARCHAR(36) DEFAULT NULL,
      group_id INT DEFAULT NULL,
      date DATE NOT NULL,
      target_month VARCHAR(7) DEFAULT NULL,
      start_date DATE DEFAULT NULL,
      end_date DATE DEFAULT NULL,
      range_start DATE DEFAULT NULL,
      range_end DATE DEFAULT NULL,
      \`position\` VARCHAR(255) DEFAULT NULL,
      type VARCHAR(50) DEFAULT 'service',
      status VARCHAR(32) DEFAULT 'pending',
      priority VARCHAR(32) DEFAULT 'medium',
      reason TEXT DEFAULT NULL,
      admin_comment TEXT DEFAULT NULL,
      comment TEXT DEFAULT NULL,
      user_viewed TINYINT(1) DEFAULT 0,
      approved_by VARCHAR(255) DEFAULT NULL,
      approved_date DATETIME DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT NULL,
      source_tenant_id VARCHAR(36) DEFAULT NULL,
      source_tenant_doctor_id VARCHAR(255) DEFAULT NULL,
      UNIQUE KEY uk_central_wish_employee_wp_date (employee_id, shared_workplace_id, date),
      INDEX idx_central_wish_employee (employee_id),
      INDEX idx_central_wish_workplace (shared_workplace_id),
      INDEX idx_central_wish_date (date),
      INDEX idx_central_wish_status (status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  centralWishTableEnsured = true;
}

// Whitelist of columns the API is allowed to write. Anything outside this
// set is rejected — never spread req.body straight into an INSERT/UPDATE.
export const CENTRAL_WISH_WRITABLE_COLUMNS = new Set([
  'employee_id',
  'shared_workplace_id',
  'group_id',
  'date',
  'target_month',
  'start_date',
  'end_date',
  'range_start',
  'range_end',
  'position',
  'type',
  'status',
  'priority',
  'reason',
  'admin_comment',
  'comment',
  'user_viewed',
  'approved_by',
  'approved_date',
  'source_tenant_id',
  'source_tenant_doctor_id',
  'created_by',
]);
