export async function runMasterMigrations(dbPool) {
  const results = [];

  const run = async (migration, execute, options = {}) => {
    const { duplicateCodes = [], duplicateReason = 'Bereits vorhanden' } = options;

    try {
      await execute();
      results.push({ migration, status: 'success' });
    } catch (err) {
      if (duplicateCodes.includes(err.code)) {
        results.push({ migration, status: 'skipped', reason: duplicateReason });
        return;
      }

      results.push({ migration, status: 'error', error: err.message });
    }
  };

  await run('add_allowed_tenants', async () => {
    await dbPool.execute(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS allowed_tenants JSON DEFAULT NULL
    `);
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden' });

  await run('add_must_change_password', async () => {
    await dbPool.execute(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE
    `);
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden' });

  await run('add_email_verified', async () => {
    await dbPool.execute(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verified TINYINT(1) DEFAULT 0`);
    await dbPool.execute(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verified_date DATETIME DEFAULT NULL`);
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalten bereits vorhanden' });

  await run('add_last_seen_at', async () => {
    await dbPool.execute(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_seen_at DATETIME DEFAULT NULL`);
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden' });

  await run('add_schedule_initials_only', async () => {
    await dbPool.execute(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS schedule_initials_only TINYINT(1) DEFAULT 0`);
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden' });

  await run('add_schedule_sort_doctors_alphabetically', async () => {
    await dbPool.execute(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS schedule_sort_doctors_alphabetically TINYINT(1) DEFAULT 0`);
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden' });

  await run('create_email_verification_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS EmailVerification (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        token VARCHAR(64) NOT NULL UNIQUE,
        type ENUM('email_verify', 'password_sent') NOT NULL DEFAULT 'email_verify',
        status ENUM('pending', 'verified', 'expired') NOT NULL DEFAULT 'pending',
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verified_date TIMESTAMP NULL,
        expires_date TIMESTAMP NULL,
        INDEX idx_token (token),
        INDEX idx_user_id (user_id)
      )
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_cowork_invite_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS CoWorkInvite (
        id VARCHAR(36) PRIMARY KEY,
        room_name VARCHAR(128) NOT NULL,
        tenant_slug VARCHAR(64) NOT NULL,
        inviter_user_id VARCHAR(36) NOT NULL,
        invitee_user_id VARCHAR(36) NOT NULL,
        status ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
        responded_date TIMESTAMP NULL,
        expires_date TIMESTAMP NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_invitee_status (invitee_user_id, status),
        INDEX idx_inviter_status (inviter_user_id, status),
        INDEX idx_room_name (room_name),
        INDEX idx_expires_date (expires_date)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await dbPool.execute(`ALTER TABLE CoWorkInvite CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  return results;
}