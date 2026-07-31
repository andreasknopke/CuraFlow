export async function runMasterMigrations(dbPool) {
  const results = [];
  const SKIPPED = Symbol('skipped');

  const hasColumn = async (tableName, columnName) => {
    const [rows] = await dbPool.execute(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tableName, columnName]
    );
    return Number(rows[0]?.cnt || 0) > 0;
  };

  const addColumnIfMissing = async (tableName, columnName, definition) => {
    if (await hasColumn(tableName, columnName)) {
      return false;
    }

    await dbPool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
    return true;
  };

  const getColumnInfo = async (tableName, columnName) => {
    const [rows] = await dbPool.execute(
      `SELECT COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tableName, columnName]
    );
    return rows[0] || null;
  };

  const run = async (migration, execute, options = {}) => {
    const {
      duplicateCodes = [],
      duplicateReason = 'Bereits vorhanden',
      skippedReason = 'Bereits vorhanden',
    } = options;

    try {
      const outcome = await execute();
      if (outcome === SKIPPED || outcome === false) {
        results.push({ migration, status: 'skipped', reason: skippedReason });
        return;
      }
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
    const changed = await addColumnIfMissing('app_users', 'allowed_tenants', 'JSON DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_must_change_password', async () => {
    const changed = await addColumnIfMissing('app_users', 'must_change_password', 'BOOLEAN DEFAULT FALSE');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_email_verified', async () => {
    const addedEmailVerified = await addColumnIfMissing('app_users', 'email_verified', 'TINYINT(1) DEFAULT 0');
    const addedEmailVerifiedDate = await addColumnIfMissing('app_users', 'email_verified_date', 'DATETIME DEFAULT NULL');
    return addedEmailVerified || addedEmailVerifiedDate || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalten bereits vorhanden', skippedReason: 'Spalten bereits vorhanden' });

  await run('add_last_seen_at', async () => {
    const changed = await addColumnIfMissing('app_users', 'last_seen_at', 'DATETIME DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_schedule_initials_only', async () => {
    const changed = await addColumnIfMissing('app_users', 'schedule_initials_only', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_schedule_sort_doctors_alphabetically', async () => {
    const changed = await addColumnIfMissing('app_users', 'schedule_sort_doctors_alphabetically', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_schedule_show_time_account', async () => {
    const changed = await addColumnIfMissing('app_users', 'schedule_show_time_account', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_wish_default_position', async () => {
    const changed = await addColumnIfMissing('app_users', 'wish_default_position', 'VARCHAR(255) DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

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

  await run('create_schedule_block_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS ScheduleBlock (
        id VARCHAR(36) PRIMARY KEY,
        date DATE NOT NULL,
        position VARCHAR(255) NOT NULL,
        timeslot_id VARCHAR(36) DEFAULT NULL,
        reason VARCHAR(500) DEFAULT NULL,
        created_by VARCHAR(255) DEFAULT NULL,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_block (date, position, timeslot_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // ===== PHASE 0: Central Employee Management =====

  await run('create_employee_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS Employee (
        id VARCHAR(36) PRIMARY KEY,
        payroll_id VARCHAR(50),
        last_name VARCHAR(200) NOT NULL,
        first_name VARCHAR(100),
        former_name VARCHAR(200),
        date_of_birth DATE,
        email VARCHAR(255),
        phone VARCHAR(50),
        address TEXT,
        contract_type ENUM('vollzeit','teilzeit','minijob','werkstudent','praktikant','honorar') DEFAULT NULL,
        contract_start DATE,
        contract_end DATE,
        probation_end DATE,
        target_hours_per_week DECIMAL(4,1) DEFAULT 38.5,
        vacation_days_annual INT DEFAULT 30,
        is_active BOOLEAN DEFAULT TRUE,
        exit_date DATE,
        exit_reason VARCHAR(255),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_by VARCHAR(255),
        INDEX idx_payroll (payroll_id),
        INDEX idx_active (is_active),
        INDEX idx_name (last_name, first_name)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_employee_tenant_assignment_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS EmployeeTenantAssignment (
        id VARCHAR(36) PRIMARY KEY,
        employee_id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        tenant_doctor_id VARCHAR(255),
        assigned_since DATE,
        is_primary BOOLEAN DEFAULT FALSE,
        fte_share DECIMAL(3,2) DEFAULT 1.00,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_employee_tenant (employee_id, tenant_id),
        INDEX idx_employee (employee_id),
        INDEX idx_tenant (tenant_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_central_absence_entry_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS CentralAbsenceEntry (
        id VARCHAR(36) PRIMARY KEY,
        employee_id VARCHAR(36) NOT NULL,
        date DATE NOT NULL,
        position VARCHAR(255) NOT NULL,
        note TEXT,
        start_time TIME DEFAULT NULL,
        end_time TIME DEFAULT NULL,
        break_minutes INT DEFAULT NULL,
        timeslot_id VARCHAR(36) DEFAULT NULL,
        \`order\` INT DEFAULT NULL,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_by VARCHAR(255) DEFAULT NULL,
        source_tenant_id VARCHAR(36) DEFAULT NULL,
        source_tenant_doctor_id VARCHAR(255) DEFAULT NULL,
        UNIQUE KEY uk_central_absence_employee_date (employee_id, date),
        INDEX idx_central_absence_employee (employee_id),
        INDEX idx_central_absence_date (date)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // ===== Employee Relationships =====

  await run('create_employee_relationship_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS EmployeeRelationship (
        id VARCHAR(36) PRIMARY KEY,
        employee_id VARCHAR(36) NOT NULL,
        related_employee_id VARCHAR(36) NOT NULL,
        relationship_type VARCHAR(100) NOT NULL DEFAULT 'lebensgemeinschaft',
        shift_conflict BOOLEAN NOT NULL DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_by VARCHAR(255) DEFAULT NULL,
        UNIQUE KEY uk_relationship_pair (employee_id, related_employee_id),
        INDEX idx_relationship_employee (employee_id),
        INDEX idx_relationship_related (related_employee_id),
        CONSTRAINT fk_relationship_employee FOREIGN KEY (employee_id) REFERENCES Employee(id) ON DELETE CASCADE,
        CONSTRAINT fk_relationship_related FOREIGN KEY (related_employee_id) REFERENCES Employee(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_employee_vacation_year_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS EmployeeVacationYear (
        employee_id VARCHAR(36) NOT NULL,
        year INT NOT NULL,
        shift_vacation_days INT NOT NULL DEFAULT 0,
        carried_over BOOLEAN NOT NULL DEFAULT FALSE,
        carried_over_from_year INT DEFAULT NULL,
        expires_at DATE DEFAULT NULL,
        note TEXT,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        updated_by VARCHAR(255) DEFAULT NULL,
        PRIMARY KEY (employee_id, year),
        INDEX idx_employee_vacation_year (employee_id),
        CONSTRAINT fk_employee_vacation_year_employee
          FOREIGN KEY (employee_id) REFERENCES Employee(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('add_employee_vacation_year_expires_at', async () => {
    const changed = await addColumnIfMissing('EmployeeVacationYear', 'expires_at', 'DATE DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  // ===== AbsenceRequest (Read-Only-User Approval) =====

  await run('create_absence_request_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS AbsenceRequest (
        id VARCHAR(36) PRIMARY KEY,
        employee_id VARCHAR(36) NOT NULL,
        source_tenant_id VARCHAR(36) DEFAULT NULL,
        source_tenant_doctor_id VARCHAR(255) DEFAULT NULL,
        date DATE NOT NULL,
        position VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        reason TEXT DEFAULT NULL,
        admin_comment TEXT DEFAULT NULL,
        user_viewed TINYINT(1) DEFAULT 0,
        approved_by VARCHAR(255) DEFAULT NULL,
        approved_date DATETIME DEFAULT NULL,
        created_by VARCHAR(255) DEFAULT NULL,
        created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY uk_absence_request_employee_date (employee_id, date),
        INDEX idx_absence_request_employee (employee_id),
        INDEX idx_absence_request_status (status),
        INDEX idx_absence_request_date (date),
        INDEX idx_absence_request_source_tenant (source_tenant_id),
        CONSTRAINT fk_absence_request_employee
          FOREIGN KEY (employee_id) REFERENCES Employee(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // ===== PHASE 1: Work Time Models =====

  await run('create_work_time_model_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS WorkTimeModel (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        hours_per_week DECIMAL(4,1) NOT NULL,
        hours_per_day DECIMAL(4,2) NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        description VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_default (is_default)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // Seed standard work time models (idempotent via INSERT IGNORE)
    const models = [
      { id: 'wtm-vz-39', name: 'Vollzeit 39h', hpw: 39.0, hpd: 7.80, def: true },
      { id: 'wtm-vz-40', name: 'Vollzeit 40h', hpw: 40.0, hpd: 8.00, def: false },
      { id: 'wtm-tz-35', name: 'Teilzeit 35h', hpw: 35.0, hpd: 7.00, def: false },
      { id: 'wtm-tz-30', name: 'Teilzeit 30h', hpw: 30.0, hpd: 6.00, def: false },
      { id: 'wtm-tz-20', name: 'Teilzeit 20h', hpw: 20.0, hpd: 4.00, def: false },
      { id: 'wtm-mini-8', name: 'Minijob 8h', hpw: 8.0, hpd: 8.00, def: false },
      { id: 'wtm-tz-385', name: 'Vollzeit 38.5h (Pflege)', hpw: 38.5, hpd: 7.70, def: false },
    ];
    for (const m of models) {
      await dbPool.execute(
        `INSERT IGNORE INTO WorkTimeModel (id, name, hours_per_week, hours_per_day, is_default, description) VALUES (?, ?, ?, ?, ?, ?)`,
        [m.id, m.name, m.hpw, m.hpd, m.def, null]
      );
    }
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('add_employee_work_time_model_id', async () => {
    const changed = await addColumnIfMissing('Employee', 'work_time_model_id', 'VARCHAR(36) DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  // ===== PHASE 4: Time Accounts (Master-DB) =====

  // ===== Qualification Certificates (central, multi-tenant) =====
  // Stores certificate files (PDF/JPEG/PNG) for qualifications that require proof
  // (e.g. Strahlenschutz). tenant_key = sha256(host:database) of the tenant DB.
  await run('create_qualification_certificate_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS QualificationCertificate (
        id VARCHAR(36) PRIMARY KEY,
        tenant_key VARCHAR(64) NOT NULL,
        doctor_id VARCHAR(255) NOT NULL,
        qualification_id VARCHAR(255) NOT NULL,
        doctor_qualification_id VARCHAR(255) DEFAULT NULL,
        evidence_role VARCHAR(32) DEFAULT 'single',
        file_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        file_size INT NOT NULL,
        file_data MEDIUMBLOB NOT NULL,
        granted_date DATE DEFAULT NULL,
        expiry_date DATE DEFAULT NULL,
        notes VARCHAR(500) DEFAULT NULL,
        uploaded_by VARCHAR(36) DEFAULT NULL,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_qc_tenant (tenant_key),
        INDEX idx_qc_doctor (tenant_key, doctor_id),
        INDEX idx_qc_qual (tenant_key, qualification_id),
        INDEX idx_qc_expiry (tenant_key, expiry_date)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // Add LLM analysis columns to QualificationCertificate (idempotent)
  await run('add_qc_analysis_columns', async () => {
    const columns = [
      ['evidence_role', `VARCHAR(32) DEFAULT 'single'`],
      ['analysis_status', `ENUM('pending','passed','warning','failed','skipped','error') DEFAULT 'pending'`],
      ['analysis_is_certificate', 'TINYINT(1) DEFAULT NULL'],
      ['analysis_scope_match', 'TINYINT(1) DEFAULT NULL'],
      ['analysis_scope_detected', 'VARCHAR(255) DEFAULT NULL'],
      ['analysis_confidence', 'FLOAT DEFAULT NULL'],
      ['analysis_reasoning', 'TEXT DEFAULT NULL'],
      ['analysis_detected_granted', 'DATE DEFAULT NULL'],
      ['analysis_detected_expiry', 'DATE DEFAULT NULL'],
      ['analyzed_at', 'DATETIME DEFAULT NULL'],
    ];
    let changed = false;

    for (const [columnName, definition] of columns) {
      const added = await addColumnIfMissing('QualificationCertificate', columnName, definition);
      changed = changed || added;
    }

    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalten bereits vorhanden', skippedReason: 'Spalten bereits vorhanden' });


  await run('create_time_account_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS TimeAccount (
        id VARCHAR(36) PRIMARY KEY,
        employee_id VARCHAR(36) NOT NULL,
        year INT NOT NULL,
        month INT NOT NULL,
        target_minutes INT DEFAULT 0,
        actual_minutes INT DEFAULT 0,
        balance_minutes INT DEFAULT 0,
        carry_over_minutes INT DEFAULT 0,
        status ENUM('open','provisional','closed') DEFAULT 'open',
        closed_by VARCHAR(255),
        closed_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_employee_period (employee_id, year, month),
        INDEX idx_employee (employee_id),
        INDEX idx_period (year, month),
        INDEX idx_status (status)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // ===== Tenant Groups (Cross-Department Pools) =====
  // See docs/features/TENANT_GROUPS.md
  // A tenant_group bundles several db_tokens (departments) so that
  // cross-department admins can manage shared pool shifts (AD, KWE, OD, ...).
  //
  // FK note: db_tokens.id was originally created without an explicit
  // collation, so it inherits whatever the schema default is (commonly
  // utf8mb4_0900_ai_ci on MySQL 8). InnoDB FKs require referencing and
  // referenced VARCHAR columns to share charset+collation. We therefore
  // detect db_tokens.id's actual collation and clone it onto every new
  // table that needs to FK against it.
  const [collRows] = await dbPool.execute(
    `SELECT CHARACTER_SET_NAME AS cs, COLLATION_NAME AS co
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'db_tokens'
        AND COLUMN_NAME = 'id'`
  );
  const dbTokensCharset = collRows[0]?.cs || 'utf8mb4';
  const dbTokensCollation = collRows[0]?.co || 'utf8mb4_0900_ai_ci';
  const fkTableSuffix = `CHARACTER SET ${dbTokensCharset} COLLATE ${dbTokensCollation}`;

  await run('create_tenant_group_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS tenant_group (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        description TEXT DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY uk_tenant_group_name (name)
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // Idempotent fix-up: if any of these tables were created in a previous
  // deploy with the wrong collation (so the FK to db_tokens(id) can't be
  // formed), drop them in dependency order if they are still empty. The
  // create migrations below will then rebuild them with the correct
  // collation. Tables that already hold data are left untouched and any
  // mismatch will surface in the subsequent create step.
  await run('fix_tenant_group_tables_collation', async () => {
    // Child-first order
    const tables = [
      'shared_workplace_quota',
      'shared_shift_entry',
      'shared_workplace',
      'tenant_group_member',
    ];
    let changed = false;
    for (const t of tables) {
      const [tRows] = await dbPool.execute(
        `SELECT TABLE_COLLATION AS co FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [t]
      );
      const current = tRows[0]?.co;
      if (!current || current === dbTokensCollation) continue;

      const [cntRows] = await dbPool.execute(`SELECT COUNT(*) AS cnt FROM \`${t}\``);
      const rowCount = Number(cntRows[0]?.cnt || 0);
      if (rowCount > 0) {
        // Leave non-empty tables alone — operator must migrate data manually.
        continue;
      }

      await dbPool.query(`DROP TABLE \`${t}\``);
      changed = true;
    }
    return changed || SKIPPED;
  }, { skippedReason: 'Collation bereits korrekt' });

  await run('create_tenant_group_member_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS tenant_group_member (
        group_id INT NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        role ENUM('member','observer') NOT NULL DEFAULT 'member',
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (group_id, tenant_id),
        INDEX idx_tgm_tenant (tenant_id),
        CONSTRAINT fk_tgm_group FOREIGN KEY (group_id) REFERENCES tenant_group(id) ON DELETE CASCADE,
        CONSTRAINT fk_tgm_tenant FOREIGN KEY (tenant_id) REFERENCES db_tokens(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_shared_workplace_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS shared_workplace (
        id VARCHAR(36) PRIMARY KEY,
        group_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT NULL,
        start_time TIME DEFAULT NULL,
        end_time TIME DEFAULT NULL,
        active_days JSON DEFAULT NULL,
        allows_multiple TINYINT(1) DEFAULT 0,
        min_staff INT NOT NULL DEFAULT 1,
        optimal_staff INT NOT NULL DEFAULT 1,
        default_overlap_tolerance_minutes INT DEFAULT 15,
        work_time_percentage DECIMAL(5,2) DEFAULT 100.00,
        service_type INT DEFAULT NULL,
        auto_off TINYINT(1) DEFAULT 0,
        allows_rotation_concurrently TINYINT(1) DEFAULT 0,
        affects_availability TINYINT(1) NOT NULL DEFAULT 1,
        allows_absence_overlap TINYINT(1) DEFAULT 0,
        timeslots_enabled TINYINT(1) DEFAULT 0,
        consecutive_days_mode VARCHAR(20) DEFAULT 'allowed',
        constraints_json JSON DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT NULL,
        INDEX idx_shared_workplace_group (group_id, is_active),
        CONSTRAINT fk_swp_group FOREIGN KEY (group_id) REFERENCES tenant_group(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_shared_workplace_timeslot_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS shared_workplace_timeslot (
        id VARCHAR(36) PRIMARY KEY,
        shared_workplace_id VARCHAR(36) NOT NULL,
        label VARCHAR(100) NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        \`order\` INT DEFAULT 0,
        overlap_tolerance_minutes INT DEFAULT 0,
        spans_midnight TINYINT(1) DEFAULT 0,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT NULL,
        INDEX idx_swt_workplace (shared_workplace_id),
        CONSTRAINT fk_swt_workplace FOREIGN KEY (shared_workplace_id) REFERENCES shared_workplace(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_shared_shift_entry_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS shared_shift_entry (
        id VARCHAR(36) PRIMARY KEY,
        shared_workplace_id VARCHAR(36) NOT NULL,
        date DATE NOT NULL,
        employee_id VARCHAR(36) NOT NULL,
        billing_tenant_id VARCHAR(36) NOT NULL,
        start_time TIME DEFAULT NULL,
        end_time TIME DEFAULT NULL,
        note TEXT DEFAULT NULL,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT NULL,
        INDEX idx_sse_date (date),
        INDEX idx_sse_emp_date (employee_id, date),
        INDEX idx_sse_billing (billing_tenant_id, date),
        INDEX idx_sse_workplace_date (shared_workplace_id, date),
        CONSTRAINT fk_sse_workplace FOREIGN KEY (shared_workplace_id) REFERENCES shared_workplace(id) ON DELETE CASCADE,
        CONSTRAINT fk_sse_billing FOREIGN KEY (billing_tenant_id) REFERENCES db_tokens(id)
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('align_shared_shift_entry_billing_tenant_id', async () => {
    const sourceColumn = await getColumnInfo('db_tokens', 'id');
    const targetColumn = await getColumnInfo('shared_shift_entry', 'billing_tenant_id');
    if (!sourceColumn || !targetColumn) {
      return SKIPPED;
    }

    const sameType = sourceColumn.COLUMN_TYPE === targetColumn.COLUMN_TYPE;
    const sameCharset = (sourceColumn.CHARACTER_SET_NAME || null) === (targetColumn.CHARACTER_SET_NAME || null);
    const sameCollation = (sourceColumn.COLLATION_NAME || null) === (targetColumn.COLLATION_NAME || null);
    if (sameType && sameCharset && sameCollation) {
      return SKIPPED;
    }

    const charsetSql = sourceColumn.CHARACTER_SET_NAME ? ` CHARACTER SET ${sourceColumn.CHARACTER_SET_NAME}` : '';
    const collationSql = sourceColumn.COLLATION_NAME ? ` COLLATE ${sourceColumn.COLLATION_NAME}` : '';
    await dbPool.execute(
      `ALTER TABLE \`shared_shift_entry\` MODIFY COLUMN \`billing_tenant_id\` ${sourceColumn.COLUMN_TYPE}${charsetSql}${collationSql} NOT NULL`
    );
    return true;
  }, { skippedReason: 'Spaltentyp bereits kompatibel' });

  await run('create_shared_workplace_qualification_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS shared_workplace_qualification (
        id INT AUTO_INCREMENT PRIMARY KEY,
        shared_workplace_id VARCHAR(36) NOT NULL,
        qualification_name VARCHAR(255) NOT NULL,
        is_excluded TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_swq_workplace_name (shared_workplace_id, qualification_name),
        CONSTRAINT fk_swq_qual_workplace FOREIGN KEY (shared_workplace_id) REFERENCES shared_workplace(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_shared_workplace_quota_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS shared_workplace_quota (
        shared_workplace_id VARCHAR(36) NOT NULL,
        scope ENUM('person','tenant','role') NOT NULL,
        scope_key VARCHAR(64) NOT NULL,
        period ENUM('month','quarter','year') NOT NULL DEFAULT 'month',
        max_count INT DEFAULT NULL,
        target_count INT DEFAULT NULL,
        weight DECIMAL(4,2) NOT NULL DEFAULT 1.00,
        PRIMARY KEY (shared_workplace_id, scope, scope_key, period),
        CONSTRAINT fk_swq_workplace FOREIGN KEY (shared_workplace_id) REFERENCES shared_workplace(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('add_app_users_allowed_groups', async () => {
    const changed = await addColumnIfMissing('app_users', 'allowed_groups', 'JSON DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_app_users_group_admin_groups', async () => {
    const changed = await addColumnIfMissing('app_users', 'group_admin_groups', 'JSON DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_active_days', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'active_days', 'JSON DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_allows_multiple', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'allows_multiple', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_overlap_tolerance', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'default_overlap_tolerance_minutes', 'INT DEFAULT 15');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_work_time_percentage', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'work_time_percentage', 'DECIMAL(5,2) DEFAULT 100.00');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_service_type', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'service_type', 'INT DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_auto_off', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'auto_off', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_allows_rotation_concurrently', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'allows_rotation_concurrently', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_allows_absence_overlap', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'allows_absence_overlap', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_timeslots_enabled', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'timeslots_enabled', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  // ===== PHASE: Pay Scale Tariffs (Tarifverträge) =====

  await run('create_pay_scale_tariff_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS PayScaleTariff (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        short_name VARCHAR(20) NOT NULL,
        default_weekly_hours DECIMAL(4,1) DEFAULT NULL,
        default_vacation_days INT DEFAULT NULL,
        description VARCHAR(255) DEFAULT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        sort_order INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_pay_scale_group_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS PayScaleGroup (
        id VARCHAR(36) PRIMARY KEY,
        tariff_id VARCHAR(36) NOT NULL,
        name VARCHAR(50) NOT NULL,
        description VARCHAR(255) DEFAULT NULL,
        sort_order INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_group_tariff (tariff_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // Seed pay scale tariffs (idempotent via INSERT IGNORE)
  await run('seed_pay_scale_tariffs', async () => {
    const tariffs = [
      { id: 'pst-tv-aerzte',   name: 'TV-Ärzte',     short_name: 'TV-Ärzte',  hpw: 40.0, vacation: 30, sort: 1 },
      { id: 'pst-tvoed-k',     name: 'TVöD-K',        short_name: 'TVöD-K',    hpw: 38.5, vacation: 30, sort: 2 },
      { id: 'pst-tvoed-p',     name: 'TVöD-P (Pflege)', short_name: 'TVöD-P', hpw: 38.5, vacation: 30, sort: 3 },
      { id: 'pst-tvoed-vka',   name: 'TVöD-VKA',      short_name: 'TVöD-VKA', hpw: 39.0, vacation: 30, sort: 4 },
      { id: 'pst-haustarif',   name: 'Haustarifvertrag', short_name: 'Haustarif', hpw: 38.5, vacation: 30, sort: 5 },
      { id: 'pst-at',          name: 'Außertariflich', short_name: 'AT',        hpw: null, vacation: null, sort: 6 },
    ];
    for (const t of tariffs) {
      await dbPool.execute(
        `INSERT IGNORE INTO PayScaleTariff (id, name, short_name, default_weekly_hours, default_vacation_days, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [t.id, t.name, t.short_name, t.hpw, t.vacation, t.sort]
      );
    }
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Bereits vorhanden' });

  // Seed pay scale groups (idempotent)
  await run('seed_pay_scale_groups', async () => {
    const groups = [
      { id: 'psg-aerzte-a1', tariff: 'pst-tv-aerzte', name: 'Ä1', sort: 1 },
      { id: 'psg-aerzte-a2', tariff: 'pst-tv-aerzte', name: 'Ä2', sort: 2 },
      { id: 'psg-aerzte-a3', tariff: 'pst-tv-aerzte', name: 'Ä3', sort: 3 },
      { id: 'psg-aerzte-a4', tariff: 'pst-tv-aerzte', name: 'Ä4', sort: 4 },
      // TVöD-K: E1–E15
      { id: 'psg-k-e1',  tariff: 'pst-tvoed-k', name: 'E1',  sort: 1 },
      { id: 'psg-k-e2',  tariff: 'pst-tvoed-k', name: 'E2',  sort: 2 },
      { id: 'psg-k-e3',  tariff: 'pst-tvoed-k', name: 'E3',  sort: 3 },
      { id: 'psg-k-e4',  tariff: 'pst-tvoed-k', name: 'E4',  sort: 4 },
      { id: 'psg-k-e5',  tariff: 'pst-tvoed-k', name: 'E5',  sort: 5 },
      { id: 'psg-k-e6',  tariff: 'pst-tvoed-k', name: 'E6',  sort: 6 },
      { id: 'psg-k-e7',  tariff: 'pst-tvoed-k', name: 'E7',  sort: 7 },
      { id: 'psg-k-e8',  tariff: 'pst-tvoed-k', name: 'E8',  sort: 8 },
      { id: 'psg-k-e9',  tariff: 'pst-tvoed-k', name: 'E9',  sort: 9 },
      { id: 'psg-k-e10', tariff: 'pst-tvoed-k', name: 'E10', sort: 10 },
      { id: 'psg-k-e11', tariff: 'pst-tvoed-k', name: 'E11', sort: 11 },
      { id: 'psg-k-e12', tariff: 'pst-tvoed-k', name: 'E12', sort: 12 },
      { id: 'psg-k-e13', tariff: 'pst-tvoed-k', name: 'E13', sort: 13 },
      { id: 'psg-k-e14', tariff: 'pst-tvoed-k', name: 'E14', sort: 14 },
      { id: 'psg-k-e15', tariff: 'pst-tvoed-k', name: 'E15', sort: 15 },
      // TVöD-P: P5–P16
      { id: 'psg-p-p5',  tariff: 'pst-tvoed-p', name: 'P5',  sort: 1 },
      { id: 'psg-p-p6',  tariff: 'pst-tvoed-p', name: 'P6',  sort: 2 },
      { id: 'psg-p-p7',  tariff: 'pst-tvoed-p', name: 'P7',  sort: 3 },
      { id: 'psg-p-p8',  tariff: 'pst-tvoed-p', name: 'P8',  sort: 4 },
      { id: 'psg-p-p9',  tariff: 'pst-tvoed-p', name: 'P9',  sort: 5 },
      { id: 'psg-p-p10', tariff: 'pst-tvoed-p', name: 'P10', sort: 6 },
      { id: 'psg-p-p11', tariff: 'pst-tvoed-p', name: 'P11', sort: 7 },
      { id: 'psg-p-p12', tariff: 'pst-tvoed-p', name: 'P12', sort: 8 },
      { id: 'psg-p-p13', tariff: 'pst-tvoed-p', name: 'P13', sort: 9 },
      { id: 'psg-p-p14', tariff: 'pst-tvoed-p', name: 'P14', sort: 10 },
      { id: 'psg-p-p15', tariff: 'pst-tvoed-p', name: 'P15', sort: 11 },
      { id: 'psg-p-p16', tariff: 'pst-tvoed-p', name: 'P16', sort: 12 },
      // TVöD-VKA: E1–E15
      { id: 'psg-vka-e1',  tariff: 'pst-tvoed-vka', name: 'E1',  sort: 1 },
      { id: 'psg-vka-e2',  tariff: 'pst-tvoed-vka', name: 'E2',  sort: 2 },
      { id: 'psg-vka-e3',  tariff: 'pst-tvoed-vka', name: 'E3',  sort: 3 },
      { id: 'psg-vka-e4',  tariff: 'pst-tvoed-vka', name: 'E4',  sort: 4 },
      { id: 'psg-vka-e5',  tariff: 'pst-tvoed-vka', name: 'E5',  sort: 5 },
      { id: 'psg-vka-e6',  tariff: 'pst-tvoed-vka', name: 'E6',  sort: 6 },
      { id: 'psg-vka-e7',  tariff: 'pst-tvoed-vka', name: 'E7',  sort: 7 },
      { id: 'psg-vka-e8',  tariff: 'pst-tvoed-vka', name: 'E8',  sort: 8 },
      { id: 'psg-vka-e9',  tariff: 'pst-tvoed-vka', name: 'E9',  sort: 9 },
      { id: 'psg-vka-e10', tariff: 'pst-tvoed-vka', name: 'E10', sort: 10 },
      { id: 'psg-vka-e11', tariff: 'pst-tvoed-vka', name: 'E11', sort: 11 },
      { id: 'psg-vka-e12', tariff: 'pst-tvoed-vka', name: 'E12', sort: 12 },
      { id: 'psg-vka-e13', tariff: 'pst-tvoed-vka', name: 'E13', sort: 13 },
      { id: 'psg-vka-e14', tariff: 'pst-tvoed-vka', name: 'E14', sort: 14 },
      { id: 'psg-vka-e15', tariff: 'pst-tvoed-vka', name: 'E15', sort: 15 },
    ];
    for (const g of groups) {
      await dbPool.execute(
        `INSERT IGNORE INTO PayScaleGroup (id, tariff_id, name, sort_order) VALUES (?, ?, ?, ?)`,
        [g.id, g.tariff, g.name, g.sort]
      );
    }
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Bereits vorhanden' });

  // Add pay scale columns to Employee
  await run('add_employee_payscale_tariff_id', async () => {
    const changed = await addColumnIfMissing('Employee', 'payscale_tariff_id', 'VARCHAR(36) DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_employee_payscale_group_id', async () => {
    const changed = await addColumnIfMissing('Employee', 'payscale_group_id', 'VARCHAR(36) DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_employee_payscale_level', async () => {
    const changed = await addColumnIfMissing('Employee', 'payscale_level', 'INT DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  // ===== PHASE: Stammdaten-Import (Master Data from external personnel DB) =====
  // Diese Spalten speichern Daten aus der externen Stammdaten-DB (PHP/stammdat.sql),
  // auch wenn sie im CuraFlow-Frontend aktuell noch nicht genutzt werden.
  // Ziel: vollstàndige Persistierung aller Quelldaten für spàtere Auswertungen.

  await run('add_employee_stammdat_source_fields', async () => {
    let changed = false;

    if (!(await hasColumn('Employee', 'stammdat_id'))) {
      await dbPool.execute('ALTER TABLE Employee ADD COLUMN stammdat_id INT DEFAULT NULL');
      changed = true;
    }
    if (!(await hasColumn('Employee', 'salutation'))) {
      await dbPool.execute('ALTER TABLE Employee ADD COLUMN salutation VARCHAR(10) DEFAULT NULL');
      changed = true;
    }
    if (!(await hasColumn('Employee', 'title'))) {
      await dbPool.execute('ALTER TABLE Employee ADD COLUMN title VARCHAR(35) DEFAULT NULL');
      changed = true;
    }
    if (!(await hasColumn('Employee', 'position'))) {
      await dbPool.execute('ALTER TABLE Employee ADD COLUMN position VARCHAR(50) DEFAULT NULL');
      changed = true;
    }
    if (!(await hasColumn('Employee', 'cost_center'))) {
      await dbPool.execute('ALTER TABLE Employee ADD COLUMN cost_center VARCHAR(8) DEFAULT NULL');
      changed = true;
    }
    if (!(await hasColumn('Employee', 'cost_center_name'))) {
      await dbPool.execute('ALTER TABLE Employee ADD COLUMN cost_center_name VARCHAR(50) DEFAULT NULL');
      changed = true;
    }
    if (!(await hasColumn('Employee', 'entry_email_sent'))) {
      await dbPool.execute('ALTER TABLE Employee ADD COLUMN entry_email_sent BOOLEAN DEFAULT FALSE');
      changed = true;
    }
    if (!(await hasColumn('Employee', 'exit_email_sent'))) {
      await dbPool.execute('ALTER TABLE Employee ADD COLUMN exit_email_sent BOOLEAN DEFAULT FALSE');
      changed = true;
    }
    if (!(await hasColumn('Employee', 'source_system'))) {
      await dbPool.execute('ALTER TABLE Employee ADD COLUMN source_system VARCHAR(50) DEFAULT NULL');
      changed = true;
    }

    // Index for stammdat lookup
    await dbPool.execute(
      'CREATE INDEX IF NOT EXISTS idx_employee_stammdat_id ON Employee (stammdat_id)'
    ).catch(() => { /* older MySQL without IF NOT EXISTS on index */ });

    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalten bereits vorhanden', skippedReason: 'Spalten bereits vorhanden' });

  // Employees with multiple cost centers (one row per cost-center split)
  await run('create_employee_cost_center_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS EmployeeCostCenter (
        id VARCHAR(36) PRIMARY KEY,
        employee_id VARCHAR(36) NOT NULL,
        cost_center_number TINYINT UNSIGNED NOT NULL COMMENT 'ma_arbeits_kst: 1=primary, 2=secondary, etc.',
        cost_center_share DECIMAL(5,2) NOT NULL DEFAULT 100 COMMENT 'ma_kst_anteil: percentage on this KST',
        cost_center_code VARCHAR(8) DEFAULT NULL COMMENT 'kst',
        cost_center_name VARCHAR(50) DEFAULT NULL COMMENT 'kst_bez',
        valid_from DATE DEFAULT NULL COMMENT 'von',
        valid_until DATE DEFAULT NULL COMMENT 'bis',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ecc_employee (employee_id),
        INDEX idx_ecc_cost_center (cost_center_code),
        CONSTRAINT fk_ecc_employee FOREIGN KEY (employee_id) REFERENCES Employee(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('add_employee_cost_center_cascade_indexes', async () => {
    // Additional index for unique constraint per employee+cost_center_number
    await dbPool.execute(
      'CREATE INDEX IF NOT EXISTS idx_ecc_employee_kst_num ON EmployeeCostCenter (employee_id, cost_center_number)'
    ).catch(() => { /* older MySQL */ });
  }, { duplicateCodes: ['ER_DUP_KEYNAME'], duplicateReason: 'Index bereits vorhanden' });

  // ===== PHASE: Springerpool-Rotationen (separates System, analog tenant_group) =====
  // Rotationen sind KEINE Dienste — sie haben eigene Tabellen, eigene Routes,
  // eigene Berechtigungen. Sie nutzen tenant_group als Vorbild, sind aber
  // vollständig getrennt, um die bestehenden Cross-Tenant-Dienste nicht zu
  // beeinflussen. Siehe docs/features/SPRINGERPOOL_ROTATION_V2.md.

  // app_users: Berechtigungen für Rotationsverbünde (analog allowed_groups / group_admin_groups)
  await run('add_app_users_allowed_rotation_groups', async () => {
    const changed = await addColumnIfMissing('app_users', 'allowed_rotation_groups', 'JSON DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_app_users_rotation_admin_groups', async () => {
    const changed = await addColumnIfMissing('app_users', 'rotation_admin_groups', 'JSON DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('create_rotation_group_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS rotation_group (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        description TEXT DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY uk_rotation_group_name (name)
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_rotation_group_member_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS rotation_group_member (
        group_id INT NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        role ENUM('pool','ward') NOT NULL DEFAULT 'ward',
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (group_id, tenant_id),
        INDEX idx_rgm_tenant (tenant_id),
        CONSTRAINT fk_rgm_group FOREIGN KEY (group_id) REFERENCES rotation_group(id) ON DELETE CASCADE,
        CONSTRAINT fk_rgm_tenant FOREIGN KEY (tenant_id) REFERENCES db_tokens(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_rotation_workplace_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS rotation_workplace (
        id VARCHAR(36) PRIMARY KEY,
        group_id INT NOT NULL,
        ward_tenant_id VARCHAR(36) NOT NULL,
        name VARCHAR(255) NOT NULL,
        timeslots_enabled TINYINT(1) DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT NULL,
        INDEX idx_rw_group (group_id, is_active),
        INDEX idx_rw_ward (ward_tenant_id),
        CONSTRAINT fk_rw_group FOREIGN KEY (group_id) REFERENCES rotation_group(id) ON DELETE CASCADE,
        CONSTRAINT fk_rw_ward FOREIGN KEY (ward_tenant_id) REFERENCES db_tokens(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_rotation_timeslot_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS rotation_timeslot (
        id VARCHAR(36) PRIMARY KEY,
        rotation_workplace_id VARCHAR(36) NOT NULL,
        label VARCHAR(100) NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        \`order\` INT DEFAULT 0,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX idx_rt_workplace (rotation_workplace_id),
        CONSTRAINT fk_rt_workplace FOREIGN KEY (rotation_workplace_id) REFERENCES rotation_workplace(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_rotation_assignment_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS rotation_assignment (
        id VARCHAR(36) PRIMARY KEY,
        rotation_workplace_id VARCHAR(36) NOT NULL,
        date DATE NOT NULL,
        employee_id VARCHAR(36) NOT NULL,
        timeslot_id VARCHAR(36) DEFAULT NULL,
        note TEXT DEFAULT NULL,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT NULL,
        INDEX idx_ra_date (date),
        INDEX idx_ra_workplace_date (rotation_workplace_id, date),
        INDEX idx_ra_emp_date (employee_id, date),
        CONSTRAINT fk_ra_workplace FOREIGN KEY (rotation_workplace_id) REFERENCES rotation_workplace(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });


  await run('create_rotation_demand_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS rotation_demand (
        id VARCHAR(36) PRIMARY KEY,
        rotation_workplace_id VARCHAR(36) NOT NULL,
        group_id INT NOT NULL,
        ward_tenant_id VARCHAR(36) NOT NULL,
        date DATE NOT NULL,
        timeslot_id VARCHAR(36) DEFAULT NULL,
        note TEXT DEFAULT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        fulfilled_by_assignment_id VARCHAR(36) DEFAULT NULL,
        created_by VARCHAR(255) DEFAULT NULL,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX idx_rd_status (status),
        INDEX idx_rd_workplace_date (rotation_workplace_id, date),
        INDEX idx_rd_ward (ward_tenant_id, date),
        INDEX idx_rd_fulfilled (fulfilled_by_assignment_id),
        CONSTRAINT fk_rd_workplace FOREIGN KEY (rotation_workplace_id) REFERENCES rotation_workplace(id) ON DELETE CASCADE,
        CONSTRAINT fk_rd_group FOREIGN KEY (group_id) REFERENCES rotation_group(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // Return-request flavour on rotation_demand. A ward can request the pool
  // to take a Springer back (see docs/features/SPRINGERPOOL_ROTATION_V2.md).
  // When non-null, this row is a "Rückgabe anfordern" request for that assignment.
  await run('add_rotation_demand_return_requested_assignment_id', async () => {
    await addColumnIfMissing(
      'rotation_demand',
      'return_requested_assignment_id',
      'VARCHAR(36) DEFAULT NULL'
    );
    await dbPool.execute(
      'CREATE INDEX IF NOT EXISTS idx_rd_return_req ON rotation_demand (return_requested_assignment_id)'
    ).catch(() => { /* older MySQL without IF NOT EXISTS on index — ignore */ });
  }, { duplicateCodes: ['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'], duplicateReason: 'Spalte/Index bereits vorhanden' });

  // Joker-transfer flavour on rotation_demand. A ward can offer one of
  // their own employees to the pool by dragging the doctor chip onto a
  // pool-timeslot cell. The demand stores the central employee_id of the
  // offered doctor in offered_employee_id.
  await run('add_rotation_demand_offered_employee_id', async () => {
    await addColumnIfMissing(
      'rotation_demand',
      'offered_employee_id',
      'VARCHAR(36) DEFAULT NULL'
    );
    await dbPool.execute(
      'CREATE INDEX IF NOT EXISTS idx_rd_offered_emp ON rotation_demand (offered_employee_id)'
    ).catch(() => { /* older MySQL without IF NOT EXISTS on index — ignore */ });
  }, { duplicateCodes: ['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'], duplicateReason: 'Spalte/Index bereits vorhanden' });

  // ===== PHASE: Workplace Links (read-only cross-tenant staffing mirror) =====
  // Lets e.g. a Radiology tenant's "CT" workplace show the staffing of the
  // MTR tenant's "CT1"/"CT2" workplaces (and vice versa) in the day view.
  // Read-only, no shared shift storage — just a name↔tenant mapping table;
  // the backend fetches same-day ShiftEntry rows from the linked tenant DB
  // on demand. See docs/features/WORKPLACE_LINKS.md.
  await run('create_workplace_link_group_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS workplace_link_group (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        description TEXT DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_workplace_link_member_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS workplace_link_member (
        id VARCHAR(36) PRIMARY KEY,
        link_group_id INT NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        workplace_name VARCHAR(255) NOT NULL,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uk_wlm_group_tenant_wp (link_group_id, tenant_id, workplace_name),
        INDEX idx_wlm_tenant (tenant_id),
        CONSTRAINT fk_wlm_group FOREIGN KEY (link_group_id) REFERENCES workplace_link_group(id) ON DELETE CASCADE,
        CONSTRAINT fk_wlm_tenant FOREIGN KEY (tenant_id) REFERENCES db_tokens(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // ===== PPUGV Daily Cache (Pflegepersonaluntergrenzen-Verordnung) =====
  // Speichert taeglich gecachte PPUGV-Exportdaten aus der legacy ppugv-Datenbank.
  // Wird 1x taeglich per Cron-Job (server/scripts/refresh-ppugv-cache.js) aktualisiert.
  await run('create_ppugv_daily_cache_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS ppugv_daily_cache (
        id INT NOT NULL AUTO_INCREMENT,
        cache_date DATE NOT NULL,
        stationsname VARCHAR(100) NOT NULL,
        fabschluessel INT NOT NULL,
        fabname VARCHAR(50) NOT NULL,
        monat VARCHAR(15) NOT NULL,
        schicht VARCHAR(20) NOT NULL,
        anzahl INT NOT NULL,
        betten INT NOT NULL,
        pfl_sen_ber VARCHAR(100) NOT NULL DEFAULT '',
        patienten INT NOT NULL,
        belegung DECIMAL(5,2) NOT NULL,
        pflegekraefte_ist DECIMAL(5,2) NOT NULL,
        hebammen_ist DECIMAL(5,2) NOT NULL,
        hilfskraefte_ist DECIMAL(5,2) NOT NULL,
        anmerkungen VARCHAR(50) NOT NULL DEFAULT '',
        frostung VARCHAR(4) NOT NULL,
        frostungsdatum DATETIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_cache_date (cache_date),
        KEY idx_station (stationsname),
        KEY idx_monat (monat)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('add_ppugv_cache_metadata', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS ppugv_cache_meta (
        id INT PRIMARY KEY AUTO_INCREMENT,
        cache_date DATE NOT NULL,
        refreshed_at DATETIME NOT NULL,
        status ENUM('ok','error','running') DEFAULT 'ok',
        row_count INT DEFAULT 0,
        error_message TEXT DEFAULT NULL,
        UNIQUE KEY idx_cache_date (cache_date)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // PPUGV: Jahr-Spalte hinzufügen (für year-over-year Vergleiche)
  await run('add_ppugv_daily_cache_jahr_column', async () => {
    const changed = await addColumnIfMissing('ppugv_daily_cache', 'jahr', 'INT NOT NULL DEFAULT 0');
    if (changed) {
      // Nachträglich befüllen aus frostungsdatum
      try {
        await dbPool.execute(
          'UPDATE ppugv_daily_cache SET jahr = YEAR(frostungsdatum) WHERE jahr = 0 AND frostungsdatum IS NOT NULL'
        );
      } catch (err) {
        // nicht kritisch – die Spalte existiert dann, wird nach und nach gefüllt
        console.warn('[Migration] ppugv_daily_cache.jahr backfill warning:', err.message);
      }
    }
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME', 'ER_DUP_COLUMN'], duplicateReason: 'Spalte existiert bereits' });

  // ===== PPBV Daily Cache (Pflegepersonaluntergrenzen-Besetzung-Vergleich) =====
  // Die ppbv-Datenbank enthaelt die VOLLSTAENDIGE Version der InEK-Meldung
  // mit Soll/Ist-Vergleich, Ausfallzeiten und Azubis – quasi der Nachfolger
  // von ppugv mit deutlich mehr Spalten. Wir cachen wie bei ppugv daily.
  await run('create_ppbv_daily_cache_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS ppbv_daily_cache (
        id INT NOT NULL AUTO_INCREMENT,
        cache_date DATE NOT NULL,
        stationsname VARCHAR(100) NOT NULL,
        fabschluessel INT NOT NULL,
        fabname VARCHAR(50) NOT NULL,
        kategorie VARCHAR(50) NOT NULL DEFAULT '',
        monat VARCHAR(15) NOT NULL,
        schicht VARCHAR(20) NOT NULL,
        jahr INT NOT NULL DEFAULT 0,
        anzahl INT NOT NULL,
        betten INT NOT NULL,
        teilstat INT NOT NULL DEFAULT 0,
        gyngeb VARCHAR(5) NOT NULL DEFAULT 'nein',
        patienten INT NOT NULL,
        belegung DECIMAL(5,2) NOT NULL,
        fachkraefte_soll DECIMAL(5,2) NOT NULL DEFAULT 0,
        ausfall_soll_1 DECIMAL(5,2) NOT NULL DEFAULT 0,
        ausfall_soll_2 DECIMAL(5,2) NOT NULL DEFAULT 0,
        ausfall_soll_3 DECIMAL(5,2) NOT NULL DEFAULT 0,
        fuehrungskraft DECIMAL(5,2) NOT NULL DEFAULT 0,
        ausfall_ist_1 DECIMAL(5,2) NOT NULL DEFAULT 0,
        ausfall_ist_2 DECIMAL(5,2) NOT NULL DEFAULT 0,
        ausfall_ist_3 DECIMAL(5,2) NOT NULL DEFAULT 0,
        fachkraefte_ist DECIMAL(5,2) NOT NULL DEFAULT 0,
        hebammen_ist DECIMAL(5,2) NOT NULL DEFAULT 0,
        hilfskraefte_ist DECIMAL(5,2) NOT NULL DEFAULT 0,
        azubi_ist DECIMAL(5,2) NOT NULL DEFAULT 0,
        anmerkungen VARCHAR(50) NOT NULL DEFAULT '',
        frostung VARCHAR(4) NOT NULL DEFAULT 'nein',
        frostungsdatum DATETIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_ppbv_cache_date (cache_date),
        KEY idx_ppbv_station (stationsname),
        KEY idx_ppbv_jahr (jahr),
        KEY idx_ppbv_monat (monat)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_ppbv_cache_metadata', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS ppbv_cache_meta (
        id INT PRIMARY KEY AUTO_INCREMENT,
        cache_date DATE NOT NULL,
        refreshed_at DATETIME NOT NULL,
        status ENUM('ok','error','running') DEFAULT 'ok',
        row_count INT DEFAULT 0,
        error_message TEXT DEFAULT NULL,
        UNIQUE KEY idx_ppbv_cache_date (cache_date)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // ===== Cost Center Lookup & Tenant-CostCenter Linking =====
  // CostCenter holds unique KST codes imported from the external
  // stammdat personnel database. TenantCostCenter links each department
  // (tenant) to one or more cost centers for reporting/PPUGV purposes.
  await run('create_cost_center_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS CostCenter (
        code VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        source_system VARCHAR(50) DEFAULT 'stammdat',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_tenant_cost_center_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS TenantCostCenter (
        tenant_id VARCHAR(255) ${fkTableSuffix} NOT NULL,
        cost_center_code VARCHAR(50) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, cost_center_code),
        CONSTRAINT fk_tcc_tenant FOREIGN KEY (tenant_id) REFERENCES db_tokens(id) ON DELETE CASCADE,
        CONSTRAINT fk_tcc_cost_center FOREIGN KEY (cost_center_code) REFERENCES CostCenter(code) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // ===== Permission-Spalte für Admin-Feinscoping =====
  await run('add_app_user_permissions', async () => {
    const changed = await addColumnIfMissing('app_users', 'permissions', 'JSON DEFAULT NULL');
    // Backfill: alle bestehenden Admins (ohne gesetzte permissions) kriegen alle Rechte
    await dbPool.execute(
      `UPDATE app_users SET permissions = ? WHERE role = 'admin' AND (permissions IS NULL OR permissions = '')`,
      [JSON.stringify({
        can_manage_users: true,
        can_approve_absence: true,
        can_manage_master_data: true,
        can_link_employees: true,
        can_manage_groups: true,
        can_manage_workplace_links: true,
        can_manage_shift_vacation: true,
        can_manage_system: true,
        can_manage_cowork: true,
      })]
    );
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  return results;
}
