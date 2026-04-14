import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.MYSQL_HOST,
  port: Number.parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  charset: 'utf8mb4',
};

const adminEmail = (process.env.CURAFLOW_ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
const adminPassword = process.env.CURAFLOW_ADMIN_PASSWORD?.trim() || '';
const adminName = (process.env.CURAFLOW_ADMIN_NAME || 'Local Administrator').trim();
const shouldSeedDemoData = (process.env.CURAFLOW_SEED_DEMO_DATA || 'true') !== 'false';
const waitRetries = Number.parseInt(process.env.CURAFLOW_DB_WAIT_RETRIES || '60', 10);
const waitMs = Number.parseInt(process.env.CURAFLOW_DB_WAIT_MS || '2000', 10);

const LOCAL_ADMIN_DOCTOR_ID = 'local-admin-doctor';
const LOCAL_ASSISTANT_DOCTOR_ID = 'local-assistant-doc';

const demoDoctors = [
  {
    id: LOCAL_ADMIN_DOCTOR_ID,
    name: 'Local Admin',
    initials: 'ADM',
    role: 'Chefarzt',
    email: adminEmail,
    google_email: adminEmail,
    fte: 1.0,
    target_weekly_hours: 40.0,
    exclude_from_staffing_plan: 0,
  },
  {
    id: LOCAL_ASSISTANT_DOCTOR_ID,
    name: 'Demo Assistant',
    initials: 'DMA',
    role: 'Assistenzarzt',
    email: 'assistant@example.com',
    google_email: 'assistant@example.com',
    fte: 1.0,
    target_weekly_hours: 38.5,
    exclude_from_staffing_plan: 0,
  },
];

const demoWorkplaces = [
  {
    id: 'wp-vordergrund',
    name: 'Dienst Vordergrund',
    category: 'Dienste',
    order: 1,
    allows_multiple: 0,
    service_type: 1,
  },
  {
    id: 'wp-hintergrund',
    name: 'Dienst Hintergrund',
    category: 'Dienste',
    order: 2,
    allows_multiple: 0,
    service_type: 2,
  },
  {
    id: 'wp-ct',
    name: 'CT',
    category: 'Rotationen',
    order: 1,
    allows_multiple: 1,
    service_type: null,
  },
  {
    id: 'wp-mrt',
    name: 'MRT',
    category: 'Rotationen',
    order: 2,
    allows_multiple: 1,
    service_type: null,
  },
  {
    id: 'wp-demo',
    name: 'Chir-Demo',
    category: 'Demonstrationen & Konsile',
    order: 1,
    allows_multiple: 0,
    service_type: null,
  },
];

const defaultSystemSettings = [
  ['wish_deadline_months', '2'],
  [
    'overview_visible_types',
    JSON.stringify(['Urlaub', 'Krank', 'Frei', 'Dienstreise', 'Nicht verfügbar']),
  ],
  [
    'absence_blocking_rules',
    JSON.stringify({
      Urlaub: true,
      Krank: true,
      Frei: true,
      Dienstreise: false,
      'Nicht verfügbar': false,
    }),
  ],
  [
    'wish_approval_rules',
    JSON.stringify({
      service_requires_approval: true,
      no_service_requires_approval: false,
      auto_create_shift_on_approval: false,
      position_overrides: {},
    }),
  ],
  ['show_school_holidays', 'true'],
  ['min_present_specialists', '2'],
  ['min_present_assistants', '1'],
  ['vacation_months_per_row', '3'],
];

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS app_users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) DEFAULT '',
    role ENUM('admin', 'user', 'readonly') NOT NULL DEFAULT 'user',
    doctor_id VARCHAR(36) DEFAULT NULL,
    theme VARCHAR(50) DEFAULT 'default',
    section_config LONGTEXT DEFAULT NULL,
    collapsed_sections LONGTEXT DEFAULT NULL,
    schedule_hidden_rows LONGTEXT DEFAULT NULL,
    schedule_show_sidebar TINYINT(1) DEFAULT 1,
    schedule_initials_only TINYINT(1) DEFAULT 0,
    schedule_sort_doctors_alphabetically TINYINT(1) DEFAULT 0,
    highlight_my_name TINYINT(1) DEFAULT 0,
    grid_font_size VARCHAR(20) DEFAULT NULL,
    wish_hidden_doctors LONGTEXT DEFAULT NULL,
    wish_show_occupied TINYINT(1) DEFAULT 1,
    wish_show_absences TINYINT(1) DEFAULT 1,
    allowed_tenants LONGTEXT DEFAULT NULL,
    must_change_password TINYINT(1) DEFAULT 0,
    email_verified TINYINT(1) DEFAULT 1,
    email_verified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME DEFAULT NULL,
    last_seen_at DATETIME DEFAULT NULL,
    is_active TINYINT(1) DEFAULT 1,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS db_tokens (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    token TEXT NOT NULL,
    host VARCHAR(255) DEFAULT NULL,
    db_name VARCHAR(100) DEFAULT NULL,
    description TEXT DEFAULT NULL,
    is_active TINYINT(1) DEFAULT 0,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS Doctor (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    initials VARCHAR(16) DEFAULT NULL,
    role VARCHAR(100) DEFAULT NULL,
    color VARCHAR(50) DEFAULT NULL,
    email VARCHAR(255) DEFAULT NULL,
    google_email VARCHAR(255) DEFAULT NULL,
    fte DECIMAL(4,2) DEFAULT 1.00,
    target_weekly_hours DECIMAL(4,1) DEFAULT NULL,
    contract_end_date DATE DEFAULT NULL,
    exclude_from_staffing_plan TINYINT(1) DEFAULT 0,
    central_employee_id VARCHAR(36) DEFAULT NULL,
    work_time_model_id VARCHAR(36) DEFAULT NULL,
    \`order\` INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS Workplace (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    category VARCHAR(100) NOT NULL,
    color VARCHAR(50) DEFAULT NULL,
    active_days LONGTEXT DEFAULT NULL,
    time VARCHAR(20) DEFAULT NULL,
    allows_multiple TINYINT(1) DEFAULT 1,
    timeslots_enabled TINYINT(1) DEFAULT 0,
    default_overlap_tolerance_minutes INT DEFAULT 15,
    work_time_percentage DECIMAL(5,2) DEFAULT 100.00,
    affects_availability TINYINT(1) DEFAULT 1,
    min_staff INT DEFAULT 1,
    optimal_staff INT DEFAULT 1,
    service_type INT DEFAULT NULL,
    \`order\` INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ShiftEntry (
    id VARCHAR(36) PRIMARY KEY,
    doctor_id VARCHAR(36) DEFAULT NULL,
    date DATE NOT NULL,
    position VARCHAR(255) NOT NULL,
    section VARCHAR(255) DEFAULT NULL,
    timeslot_id VARCHAR(36) DEFAULT NULL,
    note TEXT DEFAULT NULL,
    start_time TIME DEFAULT NULL,
    end_time TIME DEFAULT NULL,
    break_minutes INT DEFAULT NULL,
    is_free_text TINYINT(1) DEFAULT 0,
    free_text_value TEXT DEFAULT NULL,
    \`order\` INT DEFAULT 0,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_shift_date (date),
    INDEX idx_shift_doctor_date (doctor_id, date),
    INDEX idx_shift_position_date (position, date)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ScheduleNote (
    id VARCHAR(36) PRIMARY KEY,
    date DATE NOT NULL,
    position VARCHAR(255) NOT NULL,
    content TEXT DEFAULT NULL,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_schedule_note (date, position)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS WishRequest (
    id VARCHAR(36) PRIMARY KEY,
    doctor_id VARCHAR(36) NOT NULL,
    date DATE NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'service',
    position VARCHAR(255) DEFAULT NULL,
    priority VARCHAR(20) DEFAULT 'medium',
    reason TEXT DEFAULT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    admin_comment TEXT DEFAULT NULL,
    range_start DATE DEFAULT NULL,
    range_end DATE DEFAULT NULL,
    user_viewed TINYINT(1) DEFAULT 0,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_wish_doctor_date (doctor_id, date),
    INDEX idx_wish_status (status)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS StaffingPlanEntry (
    id VARCHAR(36) PRIMARY KEY,
    doctor_id VARCHAR(36) NOT NULL,
    year INT NOT NULL,
    month INT NOT NULL,
    value VARCHAR(32) DEFAULT NULL,
    reason VARCHAR(255) DEFAULT NULL,
    note TEXT DEFAULT NULL,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_staffing_plan (doctor_id, year, month)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS SystemSetting (
    id VARCHAR(36) PRIMARY KEY,
    \`key\` VARCHAR(255) NOT NULL UNIQUE,
    \`value\` LONGTEXT DEFAULT NULL,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ColorSetting (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL,
    bg_color VARCHAR(20) DEFAULT NULL,
    text_color VARCHAR(20) DEFAULT NULL,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_color_setting (name, category)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS DemoSetting (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    active_days LONGTEXT DEFAULT NULL,
    time VARCHAR(20) DEFAULT NULL,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS SystemLog (
    id VARCHAR(36) PRIMARY KEY,
    level VARCHAR(50) DEFAULT NULL,
    source VARCHAR(255) DEFAULT NULL,
    message TEXT DEFAULT NULL,
    details TEXT DEFAULT NULL,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ScheduleRule (
    id VARCHAR(36) PRIMARY KEY,
    content TEXT NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ShiftNotification (
    id VARCHAR(36) PRIMARY KEY,
    doctor_id VARCHAR(36) NOT NULL,
    date DATE NOT NULL,
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    acknowledged TINYINT(1) DEFAULT 0,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_shift_notification_doctor (doctor_id, acknowledged)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS TrainingRotation (
    id VARCHAR(36) PRIMARY KEY,
    doctor_id VARCHAR(36) NOT NULL,
    modality VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS VoiceAlias (
    id VARCHAR(36) PRIMARY KEY,
    doctor_id VARCHAR(36) NOT NULL,
    detected_text VARCHAR(255) NOT NULL,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS Qualification (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    short_label VARCHAR(10) DEFAULT NULL,
    description VARCHAR(255) DEFAULT NULL,
    color_bg VARCHAR(20) DEFAULT '#e0e7ff',
    color_text VARCHAR(20) DEFAULT '#3730a3',
    category VARCHAR(50) DEFAULT 'Allgemein',
    is_active TINYINT(1) DEFAULT 1,
    \`order\` INT NOT NULL DEFAULT 99,
    created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by VARCHAR(255) DEFAULT 'system'
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS DoctorQualification (
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
    INDEX idx_doctor (doctor_id),
    INDEX idx_qualification (qualification_id)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS WorkplaceQualification (
    id VARCHAR(255) PRIMARY KEY,
    workplace_id VARCHAR(255) NOT NULL,
    qualification_id VARCHAR(255) NOT NULL,
    is_mandatory TINYINT(1) NOT NULL DEFAULT 1,
    is_excluded TINYINT(1) NOT NULL DEFAULT 0,
    created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by VARCHAR(255) DEFAULT 'system',
    UNIQUE KEY uq_workplace_qual (workplace_id, qualification_id),
    INDEX idx_workplace (workplace_id),
    INDEX idx_qualification (qualification_id)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS WorkplaceTimeslot (
    id VARCHAR(255) PRIMARY KEY,
    workplace_id VARCHAR(255) NOT NULL,
    label VARCHAR(100) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    \`order\` INT DEFAULT 0,
    overlap_tolerance_minutes INT DEFAULT 0,
    spans_midnight TINYINT(1) DEFAULT 0,
    created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by VARCHAR(255),
    INDEX idx_timeslot_workplace (workplace_id)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS TimeslotTemplate (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slots_json TEXT NOT NULL,
    created_by VARCHAR(255) DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ShiftTimeRule (
    id VARCHAR(36) PRIMARY KEY,
    workplace_id VARCHAR(36) NOT NULL,
    work_time_model_id VARCHAR(36) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_minutes INT DEFAULT 0,
    label VARCHAR(100) DEFAULT NULL,
    short_code VARCHAR(20) DEFAULT NULL,
    spans_midnight TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function connectWithRetry() {
  for (let attempt = 1; attempt <= waitRetries; attempt += 1) {
    try {
      const connection = await mysql.createConnection(dbConfig);
      console.log(`[docker-seed] Connected to MySQL on attempt ${attempt}`);
      return connection;
    } catch (error) {
      if (attempt === waitRetries) {
        throw error;
      }
      console.log(
        `[docker-seed] Waiting for MySQL (${attempt}/${waitRetries})... ${error.message}`,
      );
      await sleep(waitMs);
    }
  }

  throw new Error('Unable to connect to MySQL');
}

async function ensureSchema(connection) {
  for (const statement of schemaStatements) {
    await connection.execute(statement);
  }
  console.log(`[docker-seed] Ensured ${schemaStatements.length} schema objects`);
}

async function getAdminDoctorId(connection) {
  const [rows] = await connection.execute('SELECT id FROM Doctor WHERE id = ? LIMIT 1', [
    LOCAL_ADMIN_DOCTOR_ID,
  ]);
  return rows[0]?.id || null;
}

async function ensureAdminUser(connection) {
  const adminDoctorId = await getAdminDoctorId(connection);
  const [rows] = await connection.execute(
    'SELECT id, doctor_id FROM app_users WHERE email = ? LIMIT 1',
    [adminEmail],
  );

  if (rows.length > 0) {
    if (!rows[0].doctor_id && adminDoctorId) {
      await connection.execute(
        'UPDATE app_users SET doctor_id = ?, updated_date = NOW() WHERE id = ?',
        [adminDoctorId, rows[0].id],
      );
    }
    console.log(`[docker-seed] Admin user already exists: ${adminEmail}`);
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await connection.execute(
    `INSERT INTO app_users (
      id, email, password_hash, full_name, role, doctor_id, theme,
      collapsed_sections, schedule_hidden_rows, wish_hidden_doctors,
      schedule_show_sidebar, wish_show_occupied, wish_show_absences,
      email_verified, is_active, created_date, updated_date
    ) VALUES (?, ?, ?, ?, 'admin', ?, 'default', '[]', '[]', '[]', 1, 1, 1, 1, 1, NOW(), NOW())`,
    [crypto.randomUUID(), adminEmail, passwordHash, adminName, adminDoctorId],
  );
  console.log(`[docker-seed] Created admin user: ${adminEmail}`);
}

async function ensureDemoRows(connection) {
  if (!shouldSeedDemoData) {
    console.log('[docker-seed] Demo data seeding disabled');
    return;
  }

  const [[doctorCountRow]] = await connection.execute('SELECT COUNT(*) AS count FROM Doctor');
  if (doctorCountRow.count === 0) {
    for (const doctor of demoDoctors) {
      await connection.execute(
        `INSERT INTO Doctor (
          id, name, initials, role, email, google_email, fte, target_weekly_hours,
          exclude_from_staffing_plan, \`order\`, is_active, created_by, created_date, updated_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'docker-seed', NOW(), NOW())`,
        [
          doctor.id,
          doctor.name,
          doctor.initials,
          doctor.role,
          doctor.email,
          doctor.google_email,
          doctor.fte,
          doctor.target_weekly_hours,
          doctor.exclude_from_staffing_plan,
          demoDoctors.findIndex((item) => item.id === doctor.id),
        ],
      );
    }
    console.log(`[docker-seed] Inserted ${demoDoctors.length} demo doctors`);
  }

  const [[workplaceCountRow]] = await connection.execute('SELECT COUNT(*) AS count FROM Workplace');
  if (workplaceCountRow.count === 0) {
    for (const workplace of demoWorkplaces) {
      await connection.execute(
        `INSERT INTO Workplace (
          id, name, category, allows_multiple, service_type,
          active_days, time, \`order\`, is_active, created_by, created_date, updated_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'docker-seed', NOW(), NOW())`,
        [
          workplace.id,
          workplace.name,
          workplace.category,
          workplace.allows_multiple,
          workplace.service_type,
          JSON.stringify([1, 2, 3, 4, 5]),
          '',
          workplace.order,
        ],
      );
    }
    console.log(`[docker-seed] Inserted ${demoWorkplaces.length} demo workplaces`);
  }

  const [[settingsCountRow]] = await connection.execute(
    'SELECT COUNT(*) AS count FROM SystemSetting',
  );
  if (settingsCountRow.count === 0) {
    for (const [key, value] of defaultSystemSettings) {
      await connection.execute(
        'INSERT INTO SystemSetting (id, `key`, `value`, created_by, created_date, updated_date) VALUES (?, ?, ?, ?, NOW(), NOW())',
        [crypto.randomUUID(), key, value, 'docker-seed'],
      );
    }
    console.log(`[docker-seed] Inserted ${defaultSystemSettings.length} system settings`);
  }
}

async function main() {
  if (!dbConfig.host || !dbConfig.user || !dbConfig.database) {
    throw new Error('Missing required MySQL environment variables for local Docker bootstrap');
  }

  if (!adminPassword) {
    throw new Error('CURAFLOW_ADMIN_PASSWORD must be set for local Docker bootstrap');
  }

  if (adminPassword.length < 8) {
    throw new Error('CURAFLOW_ADMIN_PASSWORD must be at least 8 characters long');
  }

  const connection = await connectWithRetry();

  try {
    await ensureSchema(connection);
    await ensureDemoRows(connection);
    await ensureAdminUser(connection);
    console.log('[docker-seed] Local Docker bootstrap completed');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('[docker-seed] Bootstrap failed:', error);
  process.exit(1);
});
