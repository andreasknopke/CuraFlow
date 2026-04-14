import crypto from 'crypto';
import { runMasterMigrations } from './utils/masterMigrations.js';
import { ensureColumns } from './utils/schema.js';
import { checkAndSendWishReminders } from './utils/wishReminder.js';

const WISH_REMINDER_INTERVAL = 60 * 60 * 1000;

export async function runStartupTasks(db) {
  try {
    const migrationResults = await runMasterMigrations(db);
    const failedMigrations = migrationResults.filter((result) => result.status === 'error');
    console.log('🔧 Master migrations on startup:', migrationResults);
    if (failedMigrations.length > 0) {
      console.error('⚠️  Some startup migrations failed:', failedMigrations);
    }
  } catch (error) {
    console.error('⚠️  Startup migration error:', error.message);
  }

  try {
    await ensureTablesExist(db);
  } catch (error) {
    console.error('⚠️  Table initialization error:', error.message);
  }

  setInterval(async () => {
    try {
      const hour = new Date().getUTCHours();
      if (hour < 7 || hour > 8) return;

      const result = await checkAndSendWishReminders(db, 'cron-default');
      if (result.sent) {
        console.log(
          `📧 [Cron] Wish reminders sent for ${result.targetMonth}: ${result.sentCount} emails`,
        );
      }
    } catch (error) {
      console.error('❌ [Cron] Wish reminder check failed:', error.message);
    }
  }, WISH_REMINDER_INTERVAL);
  console.log('⏰ Wish reminder cron enabled (hourly check, sends between 7-9 UTC)');
}

export function registerShutdown(db) {
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing server gracefully...');
    await db.end();
    process.exit(0);
  });
}

async function ensureTablesExist(db) {
  const tables = [
    {
      name: 'TeamRole',
      sql: `CREATE TABLE IF NOT EXISTS TeamRole (
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
      )`,
    },
    {
      name: 'WishReminderAck',
      sql: `CREATE TABLE IF NOT EXISTS WishReminderAck (
        id VARCHAR(36) PRIMARY KEY,
        doctor_id VARCHAR(36) NOT NULL,
        target_month VARCHAR(7) NOT NULL,
        token VARCHAR(64) NOT NULL UNIQUE,
        status ENUM('sent', 'acknowledged') NOT NULL DEFAULT 'sent',
        acknowledged_date TIMESTAMP NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_target_month (target_month),
        INDEX idx_doctor_month (doctor_id, target_month),
        INDEX idx_token (token)
      )`,
    },
    {
      name: 'EmailVerification',
      sql: `CREATE TABLE IF NOT EXISTS EmailVerification (
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
      )`,
    },
    {
      name: 'CoWorkInvite',
      sql: `CREATE TABLE IF NOT EXISTS CoWorkInvite (
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
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    },
    {
      name: 'ScheduleBlock',
      sql: `CREATE TABLE IF NOT EXISTS ScheduleBlock (
        id VARCHAR(36) PRIMARY KEY,
        date DATE NOT NULL,
        position VARCHAR(255) NOT NULL,
        timeslot_id VARCHAR(36) DEFAULT NULL,
        reason VARCHAR(500) DEFAULT NULL,
        created_by VARCHAR(255) DEFAULT NULL,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_block (date, position, timeslot_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    },
  ];

  for (const table of tables) {
    try {
      await db.execute(table.sql);

      if (table.name === 'TeamRole') {
        try {
          await ensureColumns(db, 'TeamRole', [
            { name: 'can_do_foreground_duty', definition: 'BOOLEAN NOT NULL DEFAULT TRUE' },
            { name: 'can_do_background_duty', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'excluded_from_statistics', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'description', definition: 'VARCHAR(255) DEFAULT NULL' },
          ]);
        } catch (alterError) {
          // Columns might already exist or TeamRole may not be ready yet.
        }
      }

      if (table.name === 'TeamRole') {
        const [existing] = await db.execute('SELECT COUNT(*) as cnt FROM TeamRole');
        if (existing[0].cnt === 0) {
          const defaultRoles = [
            {
              id: crypto.randomUUID(),
              name: 'Chefarzt',
              priority: 0,
              is_specialist: true,
              can_do_foreground_duty: false,
              can_do_background_duty: true,
              excluded_from_statistics: false,
              description: 'Oberste Führungsebene',
            },
            {
              id: crypto.randomUUID(),
              name: 'Oberarzt',
              priority: 1,
              is_specialist: true,
              can_do_foreground_duty: false,
              can_do_background_duty: true,
              excluded_from_statistics: false,
              description: 'Kann Hintergrunddienste übernehmen',
            },
            {
              id: crypto.randomUUID(),
              name: 'Facharzt',
              priority: 2,
              is_specialist: true,
              can_do_foreground_duty: true,
              can_do_background_duty: true,
              excluded_from_statistics: false,
              description: 'Kann alle Dienste übernehmen',
            },
            {
              id: crypto.randomUUID(),
              name: 'Assistenzarzt',
              priority: 3,
              is_specialist: false,
              can_do_foreground_duty: true,
              can_do_background_duty: false,
              excluded_from_statistics: false,
              description: 'Kann Vordergrunddienste übernehmen',
            },
            {
              id: crypto.randomUUID(),
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
            await db.execute(
              'INSERT IGNORE INTO TeamRole (id, name, priority, is_specialist, can_do_foreground_duty, can_do_background_duty, excluded_from_statistics, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [
                role.id,
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
          console.log('✅ TeamRole table seeded with defaults');
        }
      }
      console.log(`✅ Table ${table.name} ready`);
    } catch (error) {
      console.error(`❌ Failed to ensure ${table.name}:`, error.message);
    }
  }

  try {
    await ensureColumns(db, 'app_users', [
      { name: 'email_verified', definition: 'TINYINT(1) DEFAULT 0' },
      { name: 'email_verified_date', definition: 'DATETIME DEFAULT NULL' },
      { name: 'last_seen_at', definition: 'DATETIME DEFAULT NULL' },
    ]);
  } catch (error) {
    // This migration is also available elsewhere and may already be applied.
  }

  try {
    await db.execute(`
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
  } catch (error) {
    // Table may already exist.
  }

  try {
    await db.execute(`
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
    await db.execute(
      'ALTER TABLE CoWorkInvite CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    );
  } catch (error) {
    // Table may already exist.
  }
}
