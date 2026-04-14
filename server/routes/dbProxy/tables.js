import crypto from 'crypto';
import { ensureColumns } from '../../utils/schema.js';
import { COLUMNS_CACHE } from './cache.js';

export const ensureScheduleBlockTable = async (dbPool, cacheKey) => {
  const tableCheckKey = `${cacheKey}:ScheduleBlock:checked`;
  if (COLUMNS_CACHE[tableCheckKey]) return;

  try {
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
    COLUMNS_CACHE[tableCheckKey] = true;
  } catch (error) {
    console.warn('ensureScheduleBlockTable error:', error.message);
  }
};

export const ensureTeamRoleTable = async (dbPool, cacheKey) => {
  const tableCheckKey = `${cacheKey}:TeamRole:checked`;
  if (COLUMNS_CACHE[tableCheckKey]) return;

  try {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS TeamRole (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        priority INT NOT NULL DEFAULT 99,
        is_specialist BOOLEAN NOT NULL DEFAULT FALSE,
        can_do_foreground_duty BOOLEAN NOT NULL DEFAULT TRUE,
        can_do_background_duty BOOLEAN NOT NULL DEFAULT FALSE,
        excluded_from_statistics BOOLEAN NOT NULL DEFAULT FALSE,
        description VARCHAR(255) DEFAULT NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    try {
      const addedColumns = await ensureColumns(dbPool, 'TeamRole', [
        { name: 'can_do_foreground_duty', definition: 'BOOLEAN NOT NULL DEFAULT TRUE' },
        { name: 'can_do_background_duty', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
        { name: 'excluded_from_statistics', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
        { name: 'description', definition: 'VARCHAR(255) DEFAULT NULL' },
      ]);
      if (addedColumns > 0) {
        delete COLUMNS_CACHE[`${cacheKey}:TeamRole`];
      }
    } catch (error) {
      // Columns may already exist.
    }

    try {
      await dbPool.execute(
        "UPDATE TeamRole SET can_do_background_duty = TRUE WHERE name IN ('Chefarzt', 'Oberarzt', 'Facharzt') AND can_do_background_duty = FALSE",
      );
      await dbPool.execute(
        "UPDATE TeamRole SET can_do_foreground_duty = FALSE WHERE name IN ('Chefarzt', 'Oberarzt', 'Nicht-Radiologe') AND can_do_foreground_duty = TRUE AND is_specialist = TRUE",
      );
      await dbPool.execute(
        "UPDATE TeamRole SET can_do_foreground_duty = FALSE WHERE name = 'Nicht-Radiologe' AND can_do_foreground_duty = TRUE",
      );
      await dbPool.execute(
        "UPDATE TeamRole SET excluded_from_statistics = TRUE WHERE name = 'Nicht-Radiologe' AND excluded_from_statistics = FALSE",
      );
    } catch (error) {
      console.warn('TeamRole defaults migration update skipped:', error.message);
    }

    const [existing] = await dbPool.execute('SELECT COUNT(*) as cnt FROM TeamRole');
    if (existing[0].cnt === 0) {
      const defaultRoles = [
        {
          name: 'Chefarzt',
          priority: 0,
          is_specialist: true,
          can_do_foreground_duty: false,
          can_do_background_duty: true,
          excluded_from_statistics: false,
          description: 'Oberste Führungsebene',
        },
        {
          name: 'Oberarzt',
          priority: 1,
          is_specialist: true,
          can_do_foreground_duty: false,
          can_do_background_duty: true,
          excluded_from_statistics: false,
          description: 'Kann Hintergrunddienste übernehmen',
        },
        {
          name: 'Facharzt',
          priority: 2,
          is_specialist: true,
          can_do_foreground_duty: true,
          can_do_background_duty: true,
          excluded_from_statistics: false,
          description: 'Kann alle Dienste übernehmen',
        },
        {
          name: 'Assistenzarzt',
          priority: 3,
          is_specialist: false,
          can_do_foreground_duty: true,
          can_do_background_duty: false,
          excluded_from_statistics: false,
          description: 'Kann Vordergrunddienste übernehmen',
        },
        {
          name: 'Nicht-Radiologe',
          priority: 4,
          is_specialist: false,
          can_do_foreground_duty: false,
          can_do_background_duty: false,
          excluded_from_statistics: true,
          description: 'Wird in Statistiken nicht gezählt',
        },
      ];
      for (const role of defaultRoles) {
        const id = crypto.randomUUID();
        await dbPool.execute(
          'INSERT IGNORE INTO TeamRole (id, name, priority, is_specialist, can_do_foreground_duty, can_do_background_duty, excluded_from_statistics, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [
            id,
            role.name,
            role.priority,
            role.is_specialist,
            role.can_do_foreground_duty,
            role.can_do_background_duty,
            role.excluded_from_statistics,
            role.description,
          ],
        );
      }
      console.log('✅ TeamRole table created and seeded for tenant');
    }
    COLUMNS_CACHE[tableCheckKey] = true;
  } catch (error) {
    console.error('Failed to ensure TeamRole table:', error.message);
    COLUMNS_CACHE[tableCheckKey] = true;
  }
};

export const ensureQualificationTables = async (dbPool, cacheKey) => {
  const tableCheckKey = `${cacheKey}:Qualification:checked`;
  if (COLUMNS_CACHE[tableCheckKey]) return;

  try {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS Qualification (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        short_label VARCHAR(10) DEFAULT NULL,
        description VARCHAR(255) DEFAULT NULL,
        color_bg VARCHAR(20) DEFAULT '#e0e7ff',
        color_text VARCHAR(20) DEFAULT '#3730a3',
        category VARCHAR(50) DEFAULT 'Allgemein',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        \`order\` INT NOT NULL DEFAULT 99,
        created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT 'system'
      )
    `);

    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS DoctorQualification (
        id VARCHAR(255) PRIMARY KEY,
        doctor_id VARCHAR(255) NOT NULL,
        qualification_id VARCHAR(255) NOT NULL,
        granted_date DATE DEFAULT NULL,
        expiry_date DATE DEFAULT NULL,
        notes VARCHAR(255) DEFAULT NULL,
        created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT 'system',
        UNIQUE KEY uq_doctor_qual (doctor_id, qualification_id),
        INDEX idx_dq_doctor (doctor_id),
        INDEX idx_dq_qualification (qualification_id)
      )
    `);

    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS WorkplaceQualification (
        id VARCHAR(255) PRIMARY KEY,
        workplace_id VARCHAR(255) NOT NULL,
        qualification_id VARCHAR(255) NOT NULL,
        is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
        is_excluded BOOLEAN NOT NULL DEFAULT FALSE,
        created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT 'system',
        UNIQUE KEY uq_workplace_qual (workplace_id, qualification_id),
        INDEX idx_wq_workplace (workplace_id),
        INDEX idx_wq_qualification (qualification_id)
      )
    `);

    try {
      const addedColumns = await ensureColumns(dbPool, 'WorkplaceQualification', [
        { name: 'is_excluded', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
      ]);
      if (addedColumns > 0) {
        delete COLUMNS_CACHE[`${cacheKey}:WorkplaceQualification`];
      }
    } catch (error) {
      // Column may already exist.
    }

    COLUMNS_CACHE[tableCheckKey] = true;
    console.log('✅ Qualification tables ensured for tenant');
  } catch (error) {
    console.error('Failed to ensure Qualification tables:', error.message);
    COLUMNS_CACHE[tableCheckKey] = true;
  }
};

export const ensureWorkplaceStaffColumns = async (dbPool, cacheKey) => {
  const checkKey = `${cacheKey}:Workplace:staff_cols_checked`;
  if (COLUMNS_CACHE[checkKey]) return;

  try {
    await ensureColumns(dbPool, 'Workplace', [
      { name: 'min_staff', definition: 'INT DEFAULT 1' },
      { name: 'optimal_staff', definition: 'INT DEFAULT 1' },
      { name: 'consecutive_days_mode', definition: "VARCHAR(20) DEFAULT 'allowed'" },
    ]);
    await dbPool
      .execute(
        "UPDATE Workplace SET consecutive_days_mode = 'forbidden' WHERE consecutive_days_mode = 'allowed' AND allows_consecutive_days = 0",
      )
      .catch(() => {});
    delete COLUMNS_CACHE[`${cacheKey}:Workplace`];
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') {
      console.warn('[dbProxy] ensureWorkplaceStaffColumns:', error.message);
    }
  }
  COLUMNS_CACHE[checkKey] = true;
};
