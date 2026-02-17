import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../index.js';
import { authMiddleware, adminMiddleware } from './auth.js';
import { clearColumnsCache, writeAuditLog } from './dbProxy.js';
import { checkAndSendWishReminders } from '../utils/wishReminder.js';

const router = express.Router();

// Test endpoint without middleware
router.get('/test', (req, res) => {
  res.json({ message: 'Admin routes working', timestamp: new Date().toISOString() });
});

// ===== ADMIN TOOLS - Simplified with inline auth check =====
router.post('/tools', async (req, res, next) => {
  try {
    // Quick inline auth check
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nicht autorisiert' });
    }
    
    const token = authHeader.split(' ')[1];
    let user;
    try {
      user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Token ungültig' });
    }
    
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin-Berechtigung erforderlich' });
    }
    
    console.log('Admin tools request:', { action: req.body.action, user: user.email });
    
    const { action, data } = req.body;

    switch (action) {
      case 'generate_db_token': {
        console.log('Generating DB token from environment variables...');
        // Generate token from environment variables
        const config = {
          host: process.env.MYSQL_HOST?.trim(),
          user: process.env.MYSQL_USER?.trim(),
          password: process.env.MYSQL_PASSWORD?.trim(),
          database: process.env.MYSQL_DATABASE?.trim(),
          port: parseInt(process.env.MYSQL_PORT?.trim() || '3306')
        };

        if (!config.host || !config.user) {
          console.error('Missing DB configuration');
          return res.status(400).json({ error: 'Keine Secrets gefunden' });
        }

        if (!process.env.JWT_SECRET) {
          console.error('JWT_SECRET not configured');
          return res.status(500).json({ error: 'Server nicht korrekt konfiguriert (JWT_SECRET fehlt)' });
        }

        // Import encryption utility
        const { encryptToken } = await import('../utils/crypto.js');
        
        const json = JSON.stringify(config);
        const token = encryptToken(json);
        
        console.log('Encrypted DB token generated successfully');
        console.log('[generate_db_token] Token length:', token.length);
        console.log('[generate_db_token] Token first 50 chars:', token.substring(0, 50));
        return res.json({ token });
      }

      case 'encrypt_db_token': {
        // Encrypt manually provided DB credentials
        const { host, user, password, database, port, ssl } = data || {};
        
        if (!host || !user || !database) {
          return res.status(400).json({ error: 'Host, Benutzer und Datenbank sind erforderlich' });
        }

        if (!process.env.JWT_SECRET) {
          console.error('JWT_SECRET not configured');
          return res.status(500).json({ error: 'Server nicht korrekt konfiguriert (JWT_SECRET fehlt)' });
        }

        const config = {
          host: host.trim(),
          user: user.trim(),
          password: password || '',
          database: database.trim(),
          port: parseInt(port || '3306')
        };

        if (ssl) {
          config.ssl = { rejectUnauthorized: false };
        }

        const { encryptToken } = await import('../utils/crypto.js');
        const json = JSON.stringify(config);
        const token = encryptToken(json);
        
        console.log('Encrypted manual DB token for:', { host: config.host, database: config.database });
        console.log('[encrypt_db_token] Generated token length:', token.length);
        console.log('[encrypt_db_token] Token first 50 chars:', token.substring(0, 50));
        return res.json({ token });
      }

      case 'export_mysql_as_json': {
        // Export all tables as JSON - uses tenant DB if X-DB-Token provided
        const dbPool = req.db || db;
        const [tables] = await dbPool.execute('SHOW TABLES');
        const exportData = {};

        for (const table of tables) {
          const tableName = Object.values(table)[0];
          const [rows] = await dbPool.execute(`SELECT * FROM \`${tableName}\``);
          exportData[tableName] = rows;
        }

        console.log(`[export] Exported ${Object.keys(exportData).length} tables from ${req.db ? 'tenant' : 'master'} database`);
        return res.json(exportData);
      }

      case 'check': {
        // Database integrity check - runs on tenant database if X-DB-Token is provided
        const dbPool = req.db || db; // req.db is set by tenantDbMiddleware
        const issues = [];

        try {
          // Load all data from the correct database
          const [doctors] = await dbPool.execute('SELECT id, name FROM Doctor');
          const [shifts] = await dbPool.execute('SELECT id, doctor_id, date, position, note, created_date FROM ShiftEntry');
          const [staffing] = await dbPool.execute('SELECT id, doctor_id, year, month FROM StaffingPlanEntry');
          const [workplaces] = await dbPool.execute('SELECT id, name FROM Workplace');

          const doctorIds = new Set(doctors.map(d => d.id));
          const validPositions = new Set([
            "Verfügbar", "Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar", "Sonstiges",
            ...workplaces.map(w => w.name)
          ]);

          // Check for orphaned shifts (doctor doesn't exist)
          shifts.forEach(s => {
            if (!doctorIds.has(s.doctor_id)) {
              issues.push({ 
                type: 'orphaned_shift', 
                id: s.id, 
                description: `Schicht am ${s.date} referenziert nicht existierenden Arzt (${s.doctor_id})`
              });
            }
            if (!validPositions.has(s.position)) {
              issues.push({ 
                type: 'orphaned_position', 
                id: s.id, 
                description: `Schicht am ${s.date} hat unbekannte Position "${s.position}"`
              });
            }
          });

          // Check for orphaned staffing entries
          staffing.forEach(s => {
            if (!doctorIds.has(s.doctor_id)) {
              issues.push({ 
                type: 'orphaned_staffing', 
                id: s.id, 
                description: `Stellenplan ${s.month}/${s.year} referenziert nicht existierenden Arzt (${s.doctor_id})`
              });
            }
          });

          // Check for duplicates
          const checkDuplicates = (entityName, items, keyFields, tableName) => {
            const map = new Map();
            items.forEach(item => {
              const key = keyFields.map(f => item[f]).join('|');
              if (!map.has(key)) map.set(key, []);
              map.get(key).push(item);
            });

            for (const [key, group] of map.entries()) {
              if (group.length > 1) {
                // Sort by created_date if available, keep the oldest
                group.sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0));
                const toDelete = group.slice(1); // All except first (oldest)
                issues.push({
                  type: `duplicate_${entityName.toLowerCase()}`,
                  ids: toDelete.map(i => i.id),
                  table: tableName,
                  count: group.length,
                  description: `${group.length} doppelte ${entityName} Einträge (${key})`
                });
              }
            }
          };

          checkDuplicates('ShiftEntry', shifts, ['doctor_id', 'date', 'position'], 'ShiftEntry');
          checkDuplicates('Doctor', doctors, ['name'], 'Doctor');
          checkDuplicates('Workplace', workplaces, ['name'], 'Workplace');
          checkDuplicates('StaffingPlanEntry', staffing, ['doctor_id', 'year', 'month'], 'StaffingPlanEntry');

          console.log(`[check] Found ${issues.length} issues in ${req.db ? 'tenant' : 'master'} database`);

          return res.json({ 
            issues,
            dataSource: req.db ? 'tenant' : 'master',
            stats: {
              doctors: doctors.length,
              shifts: shifts.length,
              staffing: staffing.length,
              workplaces: workplaces.length
            }
          });
        } catch (err) {
          console.error('[check] Error:', err.message);
          return res.status(500).json({ error: 'Fehler bei Integritätsprüfung: ' + err.message });
        }
      }

      case 'repair': {
        // Database repair - delete orphaned entries and duplicates
        const dbPool = req.db || db;
        const { issuesToFix } = data || {};
        const results = [];

        if (!issuesToFix || issuesToFix.length === 0) {
          return res.json({ 
            message: 'Keine Probleme ausgewählt',
            results: []
          });
        }

        const userEmail = req.user?.email || 'unknown';
        const timestamp = new Date().toISOString();

        for (const issue of issuesToFix) {
          try {
            if (issue.type === 'orphaned_shift' || issue.type === 'orphaned_position') {
              const [rows] = await dbPool.execute('SELECT * FROM ShiftEntry WHERE id = ?', [issue.id]);
              await dbPool.execute('DELETE FROM ShiftEntry WHERE id = ?', [issue.id]);
              console.log(`[AUDIT][DELETE][REPAIR] ${timestamp} | User: ${userEmail} | Table: ShiftEntry | ID: ${issue.id} | Type: ${issue.type} | Data: ${JSON.stringify(rows[0] || null)}`);
              results.push(`✓ Gelöscht: ShiftEntry ${issue.id}`);
            } else if (issue.type === 'orphaned_staffing') {
              const [rows] = await dbPool.execute('SELECT * FROM StaffingPlanEntry WHERE id = ?', [issue.id]);
              await dbPool.execute('DELETE FROM StaffingPlanEntry WHERE id = ?', [issue.id]);
              console.log(`[AUDIT][DELETE][REPAIR] ${timestamp} | User: ${userEmail} | Table: StaffingPlanEntry | ID: ${issue.id} | Type: ${issue.type} | Data: ${JSON.stringify(rows[0] || null)}`);
              results.push(`✓ Gelöscht: StaffingPlanEntry ${issue.id}`);
            } else if (issue.type.startsWith('duplicate_')) {
              // Delete all duplicate IDs (keeping the first/oldest one)
              const table = issue.table || 'ShiftEntry';
              if (issue.ids && issue.ids.length > 0) {
                for (const id of issue.ids) {
                  const [rows] = await dbPool.execute(`SELECT * FROM \`${table}\` WHERE id = ?`, [id]);
                  await dbPool.execute(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
                  console.log(`[AUDIT][DELETE][REPAIR] ${timestamp} | User: ${userEmail} | Table: ${table} | ID: ${id} | Type: ${issue.type} | Data: ${JSON.stringify(rows[0] || null)}`);
                }
                results.push(`✓ ${issue.ids.length} Duplikate gelöscht aus ${table}`);
              }
            }
          } catch (err) {
            results.push(`✗ Fehler: ${err.message}`);
          }
        }

        console.log(`[AUDIT][REPAIR] ${timestamp} | User: ${userEmail} | Processed ${issuesToFix.length} issues, results:`, results);

        // Write summary to SystemLog table
        const dbPoolForLog = req.db || db;
        await writeAuditLog(dbPoolForLog, {
          level: 'audit',
          source: 'DB-Reparatur',
          message: `${results.filter(r => r.startsWith('\u2713')).length} Einträge repariert/gelöscht von ${userEmail}`,
          details: { issues: issuesToFix.length, results, timestamp },
          userEmail
        });

        return res.json({ 
          message: `${results.filter(r => r.startsWith('✓')).length} Probleme behoben`,
          results
        });
      }

      case 'wipe_database': {
        // Wipe all data from tables (DANGEROUS!) - uses tenant DB if X-DB-Token provided
        const dbPool = req.db || db;
        const [tables] = await dbPool.execute('SHOW TABLES');
        
        const wipedTables = [];
        for (const table of tables) {
          const tableName = Object.values(table)[0];
          // Skip user tables to keep admin access
          if (tableName === 'User' || tableName === 'app_users' || tableName === 'db_tokens') continue;
          const [countRows] = await dbPool.execute(`SELECT COUNT(*) as cnt FROM \`${tableName}\``);
          const rowCount = countRows[0]?.cnt || 0;
          await dbPool.execute(`DELETE FROM \`${tableName}\``);
          if (rowCount > 0) wipedTables.push({ table: tableName, deletedRows: rowCount });
        }

        const wipeTimestamp = new Date().toISOString();
        const wipeUser = req.user?.email || 'unknown';
        console.log(`[AUDIT][DELETE][WIPE] ${wipeTimestamp} | User: ${wipeUser} | Target: ${req.db ? 'tenant' : 'master'} | Tables: ${JSON.stringify(wipedTables)}`);

        // Write to SystemLog (re-create since we may have wiped it)
        try {
          await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS SystemLog (
              id VARCHAR(36) PRIMARY KEY,
              level VARCHAR(50),
              source VARCHAR(255),
              message TEXT,
              details TEXT,
              created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              created_by VARCHAR(255)
            )
          `);
          await writeAuditLog(dbPool, {
            level: 'audit',
            source: 'Datenbankbereinigung',
            message: `Datenbank bereinigt von ${wipeUser} (${req.db ? 'Mandant' : 'Master'})`,
            details: { target: req.db ? 'tenant' : 'master', wiped_tables: wipedTables, timestamp: wipeTimestamp },
            userEmail: wipeUser
          });
        } catch (logErr) {
          console.error('[AUDIT] Failed to write wipe audit log:', logErr.message);
        }
        return res.json({ 
          message: 'Database wiped successfully',
          warning: 'User/Token tables preserved',
          dataSource: req.db ? 'tenant' : 'master'
        });
      }

      case 'register_change': {
        // Register a database change count (for auto-backup trigger)
        // This is a no-op in Railway - backups are handled differently
        const { count } = data || {};
        console.log(`Change registered: ${count || 1} changes`);
        return res.json({ 
          success: true, 
          message: 'Change registered',
          count: count || 1
        });
      }

      case 'perform_auto_backup': {
        // Auto-backup is not needed in Railway - MySQL handles this
        // Just log and return success
        console.log('Auto-backup requested - not needed in Railway (MySQL handles backups)');
        return res.json({ 
          success: true, 
          message: 'Backup not needed - Railway MySQL has automatic backups',
          skipped: true
        });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (error) {
    next(error);
  }
});

// Apply middleware to all remaining routes
router.use(authMiddleware);
router.use(adminMiddleware);

// ===== GET SYSTEM LOGS =====
router.get('/logs', async (req, res, next) => {
  try {
    const { limit = 100 } = req.query;
    const dbPool = req.db || db;
    
    // Could query a logs table or return server logs
    const [rows] = await dbPool.execute(
      'SELECT * FROM system_logs ORDER BY created_date DESC LIMIT ?',
      [parseInt(limit)]
    );
    
    res.json(rows);
  } catch (error) {
    // If logs table doesn't exist, return empty array
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.json([]);
    }
    next(error);
  }
});

// ===== DATABASE MANAGEMENT =====
router.post('/database/backup', async (req, res, next) => {
  try {
    // Placeholder for database backup logic
    res.json({ success: true, message: 'Backup initiated' });
  } catch (error) {
    next(error);
  }
});

router.get('/database/stats', async (req, res, next) => {
  try {
    const dbPool = req.db || db;
    const [tables] = await dbPool.execute('SHOW TABLES');
    const stats = [];
    
    for (const table of tables) {
      const tableName = Object.values(table)[0];
      const [rows] = await dbPool.execute(`SELECT COUNT(*) as count FROM \`${tableName}\``);
      stats.push({ table: tableName, rows: rows[0].count });
    }
    
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// ===== SYSTEM SETTINGS =====
router.get('/settings', async (req, res, next) => {
  try {
    const dbPool = req.db || db;
    const [rows] = await dbPool.execute('SELECT * FROM system_settings');
    res.json(rows);
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.json([]);
    }
    next(error);
  }
});

router.post('/settings', async (req, res, next) => {
  try {
    const dbPool = req.db || db;
    const { key, value } = req.body;
    
    await dbPool.execute(
      'INSERT INTO system_settings (id, setting_key, setting_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
      [crypto.randomUUID(), key, value, value]
    );
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ===== MIGRATE USERS FROM BASE44 =====
router.post('/migrate-users', async (req, res, next) => {
  try {
    // Prüfe ob User-Tabelle existiert, wenn nicht erstellen
    await db.execute(`
      CREATE TABLE IF NOT EXISTS User (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('user', 'admin') DEFAULT 'user',
        theme VARCHAR(50) DEFAULT 'default',
        is_active BOOLEAN DEFAULT TRUE,
        doctor_id INT NULL,
        collapsed_sections JSON,
        schedule_hidden_rows JSON,
        schedule_show_sidebar BOOLEAN DEFAULT TRUE,
        highlight_my_name BOOLEAN DEFAULT FALSE,
        wish_show_occupied BOOLEAN DEFAULT TRUE,
        wish_show_absences BOOLEAN DEFAULT TRUE,
        wish_hidden_doctors JSON,
        settings JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Base44 Benutzer
    const users = [
      { name: 'Dreamspell Publishing', email: 'andreasknopke@gmail.com', role: 'admin', theme: 'coffee', collapsed_sections: '[]', settings: '{"sections":[{"id":"misc","defaultName":"Sonstiges","order":0,"customName":"Wichtiges"},{"id":"services","defaultName":"Dienste","order":1},{"id":"rotations","defaultName":"Rotationen","order":2},{"id":"available","defaultName":"Anwesenheiten","order":3},{"id":"demos","defaultName":"Demonstrationen & Konsile","order":4},{"id":"absences","defaultName":"Abwesenheiten","order":5}]}' },
      { name: 'a.bebersdorf', email: 'a.bebersdorf@gmx.de', role: 'user', theme: 'teal', collapsed_sections: '["Anwesenheiten"]' },
      { name: 'andreas.knopke', email: 'andreas.knopke@kliniksued-rostock.de', role: 'admin', theme: 'default', collapsed_sections: '[]', settings: '{"sections":[{"id":"misc","defaultName":"Sonstiges","order":0,"customName":"Wichtiges"},{"id":"services","defaultName":"Dienste","order":1},{"id":"rotations","defaultName":"Rotationen","order":2},{"id":"available","defaultName":"Anwesenheiten","order":3},{"id":"demos","defaultName":"Demonstrationen & Konsile","order":4},{"id":"absences","defaultName":"Abwesenheiten","order":5}]}' },
      { name: 'andreas', email: 'andreas@k-pacs.de', role: 'user', theme: 'default', collapsed_sections: '["Abwesenheiten"]' },
      { name: 'anna.keipke', email: 'anna.keipke@gmx.de', role: 'user', theme: 'default', collapsed_sections: '[]' },
      { name: 'annipanski', email: 'annipanski@googlemail.com', role: 'user', theme: 'default', collapsed_sections: '[]' },
      { name: 'armang21', email: 'armang21@icloud.com', role: 'user', theme: 'default', collapsed_sections: '[]' },
      { name: 'demo.radiologie', email: 'demo.radiologie@kliniksued-rostock.de', role: 'user', theme: 'default', collapsed_sections: '[]', settings: '{"sections":[{"id":"misc","defaultName":"Sonstiges","order":0},{"id":"services","defaultName":"Dienste","order":1},{"id":"rotations","defaultName":"Rotationen","order":2},{"id":"demos","defaultName":"Demonstrationen & Konsile","order":3},{"id":"absences","defaultName":"Abwesenheiten","order":4},{"id":"available","defaultName":"Anwesenheiten","order":5}]}' },
      { name: 'gescheschultek', email: 'gescheschultek@icloud.com', role: 'user', theme: 'default', collapsed_sections: '[]' },
      { name: 'hansen174', email: 'hansen174@gmx.de', role: 'user', theme: 'default', collapsed_sections: '[]' },
      { name: 'hasanarishe', email: 'hasanarishe@gmail.com', role: 'user', theme: 'default', collapsed_sections: '[]' },
      { name: 'idrisdahmani5', email: 'idrisdahmani5@gmail.com', role: 'user', theme: 'default', collapsed_sections: '["Demonstrationen & Konsile"]' },
      { name: 'julia', email: 'julia@schirrwagen.info', role: 'user', theme: 'forest', collapsed_sections: '[]' },
      { name: 'lenard.strecke', email: 'lenard.strecke@web.de', role: 'user', theme: 'default', collapsed_sections: '[]' },
      { name: 'parviz.rikhtehgar', email: 'parviz.rikhtehgar@web.de', role: 'user', theme: 'default', collapsed_sections: '[]' },
      { name: 'radiologie', email: 'radiologie@kliniksued-rostock.de', role: 'admin', theme: 'default', collapsed_sections: '[]' },
      { name: 'sebastianrocher', email: 'sebastianrocher@hotmail.com', role: 'user', theme: 'default', collapsed_sections: '[]' },
      { name: 't-loe', email: 't-loe@gmx.de', role: 'user', theme: 'default', collapsed_sections: '["Abwesenheiten","Anwesenheiten"]' },
      { name: 'teresa.loebsin', email: 'teresa.loebsin@kliniksued-rostock.de', role: 'admin', theme: 'default', collapsed_sections: '["Sonstiges"]', settings: '{"sections":[{"id":"misc","defaultName":"Sonstiges","order":0},{"id":"absences","defaultName":"Abwesenheiten","order":1},{"id":"services","defaultName":"Dienste","order":2},{"id":"rotations","defaultName":"Rotationen","order":3},{"id":"available","defaultName":"Anwesenheiten","order":4},{"id":"demos","defaultName":"Demonstrationen & Konsile","order":5}]}' }
    ];

    const defaultPassword = 'CuraFlow2026!';
    const password_hash = await bcrypt.hash(defaultPassword, 10);

    let inserted = 0;
    let skipped = 0;
    const results = [];

    for (const user of users) {
      try {
        const [existing] = await db.execute('SELECT id FROM User WHERE email = ?', [user.email]);
        
        if (existing.length > 0) {
          results.push({ email: user.email, status: 'skipped', reason: 'already exists' });
          skipped++;
          continue;
        }

        await db.execute(`
          INSERT INTO User (name, email, password_hash, role, theme, is_active, collapsed_sections, settings)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          user.name,
          user.email,
          password_hash,
          user.role,
          user.theme || 'default',
          1,
          user.collapsed_sections || '[]',
          user.settings || null
        ]);

        results.push({ email: user.email, status: 'inserted', role: user.role });
        inserted++;
      } catch (err) {
        results.push({ email: user.email, status: 'error', error: err.message });
      }
    }

    res.json({
      success: true,
      summary: { inserted, skipped, total: users.length },
      defaultPassword: defaultPassword,
      warning: 'Users should change their password after first login!',
      results
    });
  } catch (error) {
    next(error);
  }
});

// ===== RENAME POSITION =====
// Renames a position/workplace across all related tables
router.post('/rename-position', async (req, res, next) => {
  try {
    const { oldName, newName } = req.body;
    
    if (!oldName || !newName) {
      return res.status(400).json({ error: 'oldName und newName sind erforderlich' });
    }
    
    if (oldName === newName) {
      return res.json({ success: true, message: 'Keine Änderung nötig', stats: {} });
    }
    
    // Use tenant DB if available (req.db is set by tenantDbMiddleware)
    const dbPool = req.db;
    
    let shiftsUpdated = 0;
    let notesUpdated = 0;
    let rotationsUpdated = 0;
    
    // Update ShiftEntry
    try {
      const [r1] = await dbPool.execute(
        'UPDATE ShiftEntry SET position = ? WHERE position = ?',
        [newName, oldName]
      );
      shiftsUpdated = r1.affectedRows || 0;
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }
    
    // Update ScheduleNote
    try {
      const [r2] = await dbPool.execute(
        'UPDATE ScheduleNote SET position = ? WHERE position = ?',
        [newName, oldName]
      );
      notesUpdated = r2.affectedRows || 0;
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }
    
    // Update TrainingRotation (modality field)
    try {
      const [r3] = await dbPool.execute(
        'UPDATE TrainingRotation SET modality = ? WHERE modality = ?',
        [newName, oldName]
      );
      rotationsUpdated = r3.affectedRows || 0;
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }
    
    const stats = {
      updatedShifts: shiftsUpdated,
      updatedNotes: notesUpdated,
      updatedRotations: rotationsUpdated
    };
    
    console.log(`Renamed position "${oldName}" to "${newName}":`, stats);
    
    res.json({
      success: true,
      message: `Position "${oldName}" wurde zu "${newName}" umbenannt`,
      ...stats
    });
  } catch (error) {
    next(error);
  }
});

// ===== DATABASE MIGRATIONS =====
// Run pending migrations on the master database

router.post('/run-migrations', async (req, res, next) => {
  try {
    const results = [];
    
    // Migration 1: Add allowed_tenants to app_users
    try {
      await db.execute(`
        ALTER TABLE app_users 
        ADD COLUMN IF NOT EXISTS allowed_tenants JSON DEFAULT NULL
      `);
      results.push({ migration: 'add_allowed_tenants', status: 'success' });
    } catch (err) {
      // Column might already exist
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: 'add_allowed_tenants', status: 'skipped', reason: 'Column already exists' });
      } else {
        results.push({ migration: 'add_allowed_tenants', status: 'error', error: err.message });
      }
    }
    
    // Migration 2: Add must_change_password to app_users (if not exists)
    try {
      await db.execute(`
        ALTER TABLE app_users 
        ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE
      `);
      results.push({ migration: 'add_must_change_password', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: 'add_must_change_password', status: 'skipped', reason: 'Column already exists' });
      } else {
        results.push({ migration: 'add_must_change_password', status: 'error', error: err.message });
      }
    }

    // Migration 3: Add email_verified columns to app_users
    try {
      await db.execute(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verified TINYINT(1) DEFAULT 0`);
      await db.execute(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verified_date DATETIME DEFAULT NULL`);
      results.push({ migration: 'add_email_verified', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: 'add_email_verified', status: 'skipped', reason: 'Columns already exist' });
      } else {
        results.push({ migration: 'add_email_verified', status: 'error', error: err.message });
      }
    }

    // Migration 4: Create EmailVerification table
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
      results.push({ migration: 'create_email_verification_table', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_TABLE_EXISTS_ERROR') {
        results.push({ migration: 'create_email_verification_table', status: 'skipped', reason: 'Table already exists' });
      } else {
        results.push({ migration: 'create_email_verification_table', status: 'error', error: err.message });
      }
    }
    
    console.log(`[Migrations] Executed by ${req.user?.email}:`, results);
    
    res.json({
      success: true,
      message: 'Migrationen ausgeführt',
      results
    });
  } catch (error) {
    next(error);
  }
});

router.get('/migration-status', async (req, res, next) => {
  try {
    // Check which columns exist in app_users
    const [columns] = await db.execute(`SHOW COLUMNS FROM app_users`);
    const columnNames = columns.map(c => c.Field);
    
    const migrations = [
      { 
        name: 'add_allowed_tenants', 
        description: 'Mandanten-Zuordnung für User',
        applied: columnNames.includes('allowed_tenants')
      },
      { 
        name: 'add_must_change_password', 
        description: 'Passwort-Änderung erzwingen',
        applied: columnNames.includes('must_change_password')
      },
      { 
        name: 'add_email_verified', 
        description: 'E-Mail-Verifizierung für Benutzer',
        applied: columnNames.includes('email_verified') && columnNames.includes('email_verified_date')
      }
    ];

    // Check EmailVerification table
    let emailVerificationTableExists = false;
    try {
      const [tables] = await db.execute(`SHOW TABLES LIKE 'EmailVerification'`);
      emailVerificationTableExists = tables.length > 0;
    } catch (err) {
      // ignore
    }
    migrations.push({
      name: 'create_email_verification_table',
      description: 'E-Mail-Verifizierung & Passwort-Versand Tabelle',
      applied: emailVerificationTableExists
    });
    
    res.json({
      migrations,
      allApplied: migrations.every(m => m.applied)
    });
  } catch (error) {
    next(error);
  }
});

// ===== TIMESLOT MIGRATIONS (Tenant-specific) =====
// Run timeslot migrations on the currently active tenant database
router.post('/run-timeslot-migrations', async (req, res, next) => {
  try {
    // Use tenant DB if available (req.db is set by tenantDbMiddleware)
    const dbPool = req.db || db;
    const results = [];

    // Migration 1: Create WorkplaceTimeslot table
    try {
      await dbPool.execute(`
        CREATE TABLE IF NOT EXISTS WorkplaceTimeslot (
          id VARCHAR(255) PRIMARY KEY,
          workplace_id VARCHAR(255) NOT NULL,
          label VARCHAR(100) NOT NULL,
          start_time TIME NOT NULL,
          end_time TIME NOT NULL,
          \`order\` INT DEFAULT 0,
          overlap_tolerance_minutes INT DEFAULT 0,
          spans_midnight BOOLEAN DEFAULT FALSE,
          created_date DATETIME(3),
          updated_date DATETIME(3),
          created_by VARCHAR(255),
          INDEX idx_timeslot_workplace (workplace_id)
        )
      `);
      results.push({ migration: 'create_workplace_timeslot_table', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_TABLE_EXISTS_ERROR') {
        results.push({ migration: 'create_workplace_timeslot_table', status: 'skipped', reason: 'Table already exists' });
      } else {
        results.push({ migration: 'create_workplace_timeslot_table', status: 'error', error: err.message });
      }
    }

    // Migration 2: Add timeslots_enabled to Workplace
    try {
      await dbPool.execute(`
        ALTER TABLE Workplace 
        ADD COLUMN timeslots_enabled BOOLEAN DEFAULT FALSE
      `);
      results.push({ migration: 'add_workplace_timeslots_enabled', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: 'add_workplace_timeslots_enabled', status: 'skipped', reason: 'Column already exists' });
      } else {
        results.push({ migration: 'add_workplace_timeslots_enabled', status: 'error', error: err.message });
      }
    }

    // Migration 3: Add default_overlap_tolerance_minutes to Workplace
    try {
      await dbPool.execute(`
        ALTER TABLE Workplace 
        ADD COLUMN default_overlap_tolerance_minutes INT DEFAULT 15
      `);
      results.push({ migration: 'add_workplace_overlap_tolerance', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: 'add_workplace_overlap_tolerance', status: 'skipped', reason: 'Column already exists' });
      } else {
        results.push({ migration: 'add_workplace_overlap_tolerance', status: 'error', error: err.message });
      }
    }

    // Migration 4: Add timeslot_id to ShiftEntry
    try {
      await dbPool.execute(`
        ALTER TABLE ShiftEntry 
        ADD COLUMN timeslot_id VARCHAR(255) DEFAULT NULL
      `);
      results.push({ migration: 'add_shiftentry_timeslot_id', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: 'add_shiftentry_timeslot_id', status: 'skipped', reason: 'Column already exists' });
      } else {
        results.push({ migration: 'add_shiftentry_timeslot_id', status: 'error', error: err.message });
      }
    }

    // Migration 5: Add index on timeslot_id in ShiftEntry
    try {
      await dbPool.execute(`
        CREATE INDEX idx_shiftentry_timeslot ON ShiftEntry(timeslot_id)
      `);
      results.push({ migration: 'add_shiftentry_timeslot_index', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME') {
        results.push({ migration: 'add_shiftentry_timeslot_index', status: 'skipped', reason: 'Index already exists' });
      } else {
        results.push({ migration: 'add_shiftentry_timeslot_index', status: 'error', error: err.message });
      }
    }

    // Migration 6: Create TimeslotTemplate table for custom templates
    try {
      await dbPool.execute(`
        CREATE TABLE IF NOT EXISTS TimeslotTemplate (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          slots_json TEXT NOT NULL,
          created_date DATETIME(3),
          updated_date DATETIME(3),
          created_by VARCHAR(255)
        )
      `);
      results.push({ migration: 'create_timeslot_template_table', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_TABLE_EXISTS_ERROR') {
        results.push({ migration: 'create_timeslot_template_table', status: 'skipped', reason: 'Table already exists' });
      } else {
        results.push({ migration: 'create_timeslot_template_table', status: 'error', error: err.message });
      }
    }

    // Migration 7: Add work_time_percentage to Workplace (for services like on-call = 70%)
    try {
      await dbPool.execute(`
        ALTER TABLE Workplace 
        ADD COLUMN work_time_percentage DECIMAL(5,2) DEFAULT 100.00
      `);
      results.push({ migration: 'add_workplace_work_time_percentage', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: 'add_workplace_work_time_percentage', status: 'skipped', reason: 'Column already exists' });
      } else {
        results.push({ migration: 'add_workplace_work_time_percentage', status: 'error', error: err.message });
      }
    }

    // Migration 8: Add permission columns to TeamRole for dynamic role permissions
    try {
      const alterStatements = [
        `ALTER TABLE TeamRole ADD COLUMN can_do_foreground_duty BOOLEAN NOT NULL DEFAULT TRUE`,
        `ALTER TABLE TeamRole ADD COLUMN can_do_background_duty BOOLEAN NOT NULL DEFAULT FALSE`,
        `ALTER TABLE TeamRole ADD COLUMN excluded_from_statistics BOOLEAN NOT NULL DEFAULT FALSE`,
        `ALTER TABLE TeamRole ADD COLUMN description VARCHAR(255) DEFAULT NULL`
      ];
      
      let addedColumns = 0;
      for (const stmt of alterStatements) {
        try {
          await dbPool.execute(stmt);
          addedColumns++;
        } catch (alterErr) {
          // Column might already exist
        }
      }
      
      if (addedColumns > 0) {
        // Update existing roles with default permissions
        await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = FALSE, can_do_background_duty = TRUE, description = 'Oberste Führungsebene' WHERE name = 'Chefarzt' AND description IS NULL`);
        await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = FALSE, can_do_background_duty = TRUE, description = 'Kann Hintergrunddienste übernehmen' WHERE name = 'Oberarzt' AND description IS NULL`);
        await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = TRUE, can_do_background_duty = TRUE, description = 'Kann alle Dienste übernehmen' WHERE name = 'Facharzt' AND description IS NULL`);
        await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = TRUE, can_do_background_duty = FALSE, description = 'Kann Vordergrunddienste übernehmen' WHERE name = 'Assistenzarzt' AND description IS NULL`);
        await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = FALSE, can_do_background_duty = FALSE, excluded_from_statistics = TRUE, description = 'Wird in Statistiken nicht gezählt' WHERE name = 'Nicht-Radiologe' AND description IS NULL`);
        
        results.push({ migration: 'add_team_role_permissions', status: 'success', message: `${addedColumns} columns added` });
      } else {
        results.push({ migration: 'add_team_role_permissions', status: 'skipped', reason: 'Columns already exist' });
      }
    } catch (err) {
      results.push({ migration: 'add_team_role_permissions', status: 'error', error: err.message });
    }

    // Migration 9: Add affects_availability to Workplace (for non-blocking positions like "Demo Chirurgie")
    try {
      await dbPool.execute(`
        ALTER TABLE Workplace 
        ADD COLUMN affects_availability BOOLEAN DEFAULT TRUE
      `);
      results.push({ migration: 'add_workplace_affects_availability', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: 'add_workplace_affects_availability', status: 'skipped', reason: 'Column already exists' });
      } else {
        results.push({ migration: 'add_workplace_affects_availability', status: 'error', error: err.message });
      }
    }

    // Migration 10: Add min_staff and optimal_staff to Workplace (for auto-fill engine)
    try {
      await dbPool.execute(`
        ALTER TABLE Workplace 
        ADD COLUMN min_staff INT DEFAULT 1
      `);
      results.push({ migration: 'add_workplace_min_staff', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: 'add_workplace_min_staff', status: 'skipped', reason: 'Column already exists' });
      } else {
        results.push({ migration: 'add_workplace_min_staff', status: 'error', error: err.message });
      }
    }

    try {
      await dbPool.execute(`
        ALTER TABLE Workplace 
        ADD COLUMN optimal_staff INT DEFAULT 1
      `);
      results.push({ migration: 'add_workplace_optimal_staff', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: 'add_workplace_optimal_staff', status: 'skipped', reason: 'Column already exists' });
      } else {
        results.push({ migration: 'add_workplace_optimal_staff', status: 'error', error: err.message });
      }
    }

    // Migration 11: Add is_excluded to WorkplaceQualification (for NOT-qualifications)
    try {
      await dbPool.execute(`
        ALTER TABLE WorkplaceQualification 
        ADD COLUMN is_excluded BOOLEAN NOT NULL DEFAULT FALSE
      `);
      results.push({ migration: 'add_workplace_qualification_is_excluded', status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: 'add_workplace_qualification_is_excluded', status: 'skipped', reason: 'Column already exists' });
      } else {
        results.push({ migration: 'add_workplace_qualification_is_excluded', status: 'error', error: err.message });
      }
    }

    // Migration 12: Add service_type to Workplace (Bereitschaftsdienst/Rufbereitschaft/Schichtdienst/Andere)
    // service_type: 1=Bereitschaftsdienst (Vordergrund), 2=Rufbereitschaftsdienst (Hintergrund), 3=Schichtdienst, 4=Andere
    try {
      await dbPool.execute(`
        ALTER TABLE Workplace 
        ADD COLUMN service_type INT DEFAULT NULL
      `);
      results.push({ migration: 'add_workplace_service_type', status: 'success' });
      
      // Auto-migrate existing data: first service (by order) gets type 1, all others get type 2
      try {
        const [serviceWps] = await dbPool.execute(
          `SELECT id, \`order\` FROM Workplace WHERE category = 'Dienste' ORDER BY COALESCE(\`order\`, 0) ASC`
        );
        if (serviceWps.length > 0) {
          // First service = Bereitschaftsdienst (1)
          await dbPool.execute(
            `UPDATE Workplace SET service_type = 1 WHERE id = ?`,
            [serviceWps[0].id]
          );
          // All others = Rufbereitschaftsdienst (2)
          if (serviceWps.length > 1) {
            const otherIds = serviceWps.slice(1).map(w => w.id);
            const placeholders = otherIds.map(() => '?').join(',');
            await dbPool.execute(
              `UPDATE Workplace SET service_type = 2 WHERE id IN (${placeholders})`,
              otherIds
            );
          }
          results.push({ migration: 'migrate_service_types_data', status: 'success', message: `${serviceWps.length} services migrated` });
        }
      } catch (dataErr) {
        results.push({ migration: 'migrate_service_types_data', status: 'error', error: dataErr.message });
      }
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: 'add_workplace_service_type', status: 'skipped', reason: 'Column already exists' });
      } else {
        results.push({ migration: 'add_workplace_service_type', status: 'error', error: err.message });
      }
    }

    // Clear column cache for affected tables so new columns are recognized
    const cacheKey = req.headers['x-db-token'] || 'default';
    clearColumnsCache(['Workplace', 'WorkplaceTimeslot', 'ShiftEntry', 'TimeslotTemplate', 'TeamRole', 'WorkplaceQualification'], cacheKey);

    console.log(`[Timeslot Migrations] Executed by ${req.user?.email}:`, results);

    res.json({
      success: true,
      message: 'Timeslot-Migrationen ausgeführt',
      results
    });
  } catch (error) {
    next(error);
  }
});

// Check timeslot migration status
router.get('/timeslot-migration-status', async (req, res, next) => {
  try {
    // Use tenant DB if available
    const dbPool = req.db || db;
    const migrations = [];

    // Check WorkplaceTimeslot table
    try {
      const [tables] = await dbPool.execute(`SHOW TABLES LIKE 'WorkplaceTimeslot'`);
      migrations.push({
        name: 'create_workplace_timeslot_table',
        description: 'Erstellt WorkplaceTimeslot-Tabelle',
        applied: tables.length > 0
      });
    } catch (err) {
      migrations.push({
        name: 'create_workplace_timeslot_table',
        description: 'Erstellt WorkplaceTimeslot-Tabelle',
        applied: false,
        error: err.message
      });
    }

    // Check Workplace columns
    try {
      const [columns] = await dbPool.execute(`SHOW COLUMNS FROM Workplace`);
      const columnNames = columns.map(c => c.Field);
      
      migrations.push({
        name: 'add_workplace_timeslots_enabled',
        description: 'Aktiviert Zeitfenster-Option pro Arbeitsplatz',
        applied: columnNames.includes('timeslots_enabled')
      });
      
      migrations.push({
        name: 'add_workplace_overlap_tolerance',
        description: 'Übergangszeit-Einstellung pro Arbeitsplatz',
        applied: columnNames.includes('default_overlap_tolerance_minutes')
      });
      
      migrations.push({
        name: 'add_workplace_work_time_percentage',
        description: 'Arbeitszeit-Prozentsatz pro Dienst (z.B. Rufbereitschaft = 70%)',
        applied: columnNames.includes('work_time_percentage')
      });
      
      migrations.push({
        name: 'add_workplace_affects_availability',
        description: 'Verfügbarkeitsrelevanz pro Arbeitsplatz (z.B. Demo Chirurgie = nicht relevant)',
        applied: columnNames.includes('affects_availability')
      });
    } catch (err) {
      migrations.push({
        name: 'workplace_columns',
        description: 'Workplace-Spalten prüfen',
        applied: false,
        error: err.message
      });
    }

    // Check ShiftEntry columns
    try {
      const [columns] = await dbPool.execute(`SHOW COLUMNS FROM ShiftEntry`);
      const columnNames = columns.map(c => c.Field);
      
      migrations.push({
        name: 'add_shiftentry_timeslot_id',
        description: 'Timeslot-Zuordnung für ShiftEntries',
        applied: columnNames.includes('timeslot_id')
      });
    } catch (err) {
      migrations.push({
        name: 'shiftentry_columns',
        description: 'ShiftEntry-Spalten prüfen',
        applied: false,
        error: err.message
      });
    }

    // Check TeamRole columns for permissions
    try {
      const [columns] = await dbPool.execute(`SHOW COLUMNS FROM TeamRole`);
      const columnNames = columns.map(c => c.Field);
      
      migrations.push({
        name: 'add_team_role_permissions',
        description: 'Dynamische Berechtigungen für Team-Rollen (VG/HG-Dienste, Statistik-Ausschluss)',
        applied: columnNames.includes('can_do_foreground_duty') && 
                 columnNames.includes('can_do_background_duty') && 
                 columnNames.includes('excluded_from_statistics')
      });
    } catch (err) {
      migrations.push({
        name: 'teamrole_columns',
        description: 'TeamRole-Spalten prüfen',
        applied: false,
        error: err.message
      });
    }

    // Check service_type column in Workplace
    try {
      const [columns] = await dbPool.execute(`SHOW COLUMNS FROM Workplace WHERE Field = 'service_type'`);
      migrations.push({
        name: 'add_workplace_service_type',
        description: 'Diensttyp pro Dienst (Bereitschaftsdienst/Rufbereitschaft/Schichtdienst/Andere)',
        applied: columns.length > 0
      });
    } catch (err) {
      migrations.push({
        name: 'add_workplace_service_type',
        description: 'Diensttyp pro Dienst',
        applied: false,
        error: err.message
      });
    }

    res.json({
      migrations,
      allApplied: migrations.every(m => m.applied)
    });
  } catch (error) {
    next(error);
  }
});

// ===== DB TOKEN MANAGEMENT (Server-side Token Storage) =====
// IMPORTANT: These tokens are ALWAYS stored on the MASTER database (from ENV variables)
// NOT on tenant databases! This ensures tokens are available regardless of which
// tenant database is currently active.
// We use `db` (master) instead of `req.db` (tenant) for all token operations.

// Ensure db_tokens table exists on MASTER database
async function ensureDbTokensTable(masterDb) {
  await masterDb.execute(`
    CREATE TABLE IF NOT EXISTS db_tokens (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      token TEXT NOT NULL,
      host VARCHAR(255),
      db_name VARCHAR(100),
      description TEXT,
      is_active BOOLEAN DEFAULT FALSE,
      created_by VARCHAR(255),
      created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

// GET all stored DB tokens (metadata only, not the actual token value for security)
// Filters tokens based on admin's allowed_tenants
router.get('/db-tokens', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);
    
    // Get the requesting admin's allowed_tenants
    const [adminRows] = await db.execute('SELECT allowed_tenants FROM app_users WHERE id = ?', [req.user.sub]);
    const adminTenants = adminRows[0]?.allowed_tenants;
    
    // Parse admin tenants (could be JSON string, array, or null)
    let adminTenantList = null;
    if (adminTenants) {
      adminTenantList = typeof adminTenants === 'string' ? JSON.parse(adminTenants) : adminTenants;
    }
    
    const [rows] = await db.execute(`
      SELECT id, name, host, db_name, description, is_active, created_by, created_date, updated_date
      FROM db_tokens
      ORDER BY name ASC
    `);
    
    // Filter tokens based on admin's allowed_tenants
    // If adminTenantList is null or empty, admin has access to all tenants
    let filteredRows = rows;
    if (adminTenantList && adminTenantList.length > 0) {
      filteredRows = rows.filter(token => adminTenantList.includes(token.id));
    }
    
    // Convert is_active from MySQL tinyint to proper boolean
    const tokens = filteredRows.map(row => ({
      ...row,
      is_active: Boolean(row.is_active)
    }));
    
    res.json(tokens);
  } catch (error) {
    next(error);
  }
});

// GET a specific token (includes the encrypted token value)
router.get('/db-tokens/:id', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);
    
    const [rows] = await db.execute(
      'SELECT * FROM db_tokens WHERE id = ?',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Token nicht gefunden' });
    }
    
    // Convert is_active from MySQL tinyint to proper boolean
    const token = { ...rows[0], is_active: Boolean(rows[0].is_active) };
    
    res.json(token);
  } catch (error) {
    next(error);
  }
});

// GET the currently active token
router.get('/db-tokens/active/current', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);
    
    const [rows] = await db.execute(
      'SELECT * FROM db_tokens WHERE is_active = TRUE LIMIT 1'
    );
    
    if (rows.length === 0) {
      return res.json(null);
    }
    
    // Convert is_active from MySQL tinyint to proper boolean
    const token = { ...rows[0], is_active: Boolean(rows[0].is_active) };
    
    res.json(token);
  } catch (error) {
    next(error);
  }
});

// CREATE a new DB token
router.post('/db-tokens', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);
    
    const { name, credentials, description } = req.body;
    
    if (!name || !credentials) {
      return res.status(400).json({ error: 'Name und Zugangsdaten sind erforderlich' });
    }
    
    const { host, user, password, database: dbName, port, ssl } = credentials;
    
    if (!host || !user || !dbName) {
      return res.status(400).json({ error: 'Host, Benutzer und Datenbank sind erforderlich' });
    }
    
    // Encrypt the credentials
    const { encryptToken } = await import('../utils/crypto.js');
    
    const config = {
      host: host.trim(),
      user: user.trim(),
      password: password || '',
      database: dbName.trim(),
      port: parseInt(port || '3306')
    };
    
    if (ssl) {
      config.ssl = { rejectUnauthorized: false };
    }
    
    const encryptedToken = encryptToken(JSON.stringify(config));
    const id = crypto.randomUUID();
    
    await db.execute(`
      INSERT INTO db_tokens (id, name, token, host, db_name, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, name.trim(), encryptedToken, host.trim(), dbName.trim(), description || null, req.user.email]);
    
    console.log(`[DB-Tokens] Created token "${name}" for ${host}/${dbName} by ${req.user.email}`);
    
    res.json({
      id,
      name: name.trim(),
      host: host.trim(),
      db_name: dbName.trim(),
      description: description || null,
      token: encryptedToken,
      created_by: req.user.email
    });
  } catch (error) {
    next(error);
  }
});

// UPDATE a DB token
router.put('/db-tokens/:id', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);
    
    const { name, description, credentials } = req.body;
    const { id } = req.params;
    
    // Check if token exists
    const [existing] = await db.execute('SELECT * FROM db_tokens WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Token nicht gefunden' });
    }
    
    // If credentials are provided, re-encrypt
    let encryptedToken = existing[0].token;
    let host = existing[0].host;
    let dbName = existing[0].db_name;
    
    if (credentials && credentials.host && credentials.user && credentials.database) {
      const { encryptToken } = await import('../utils/crypto.js');
      
      const config = {
        host: credentials.host.trim(),
        user: credentials.user.trim(),
        password: credentials.password || '',
        database: credentials.database.trim(),
        port: parseInt(credentials.port || '3306')
      };
      
      if (credentials.ssl) {
        config.ssl = { rejectUnauthorized: false };
      }
      
      encryptedToken = encryptToken(JSON.stringify(config));
      host = credentials.host.trim();
      dbName = credentials.database.trim();
    }
    
    await db.execute(`
      UPDATE db_tokens 
      SET name = ?, token = ?, host = ?, db_name = ?, description = ?, updated_date = NOW()
      WHERE id = ?
    `, [name?.trim() || existing[0].name, encryptedToken, host, dbName, description ?? existing[0].description, id]);
    
    console.log(`[DB-Tokens] Updated token "${name || existing[0].name}" by ${req.user.email}`);
    
    res.json({ success: true, id });
  } catch (error) {
    next(error);
  }
});

// DELETE a DB token
router.delete('/db-tokens/:id', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);
    
    const { id } = req.params;
    
    const [existing] = await db.execute('SELECT name FROM db_tokens WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Token nicht gefunden' });
    }
    
    await db.execute('DELETE FROM db_tokens WHERE id = ?', [id]);
    
    const tokenTimestamp = new Date().toISOString();
    console.log(`[AUDIT][DELETE][DB-TOKEN] ${tokenTimestamp} | User: ${req.user.email} | Token: "${existing[0].name}" | ID: ${id}`);
    
    // Write to SystemLog in master db
    await writeAuditLog(db, {
      level: 'audit',
      source: 'Mandantenverwaltung',
      message: `DB-Token "${existing[0].name}" gelöscht von ${req.user.email}`,
      details: { token_name: existing[0].name, token_id: id, timestamp: tokenTimestamp },
      userEmail: req.user.email
    });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// SET a token as active (and deactivate all others)
router.post('/db-tokens/:id/activate', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);
    
    const { id } = req.params;
    
    const [existing] = await db.execute('SELECT * FROM db_tokens WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Token nicht gefunden' });
    }
    
    // Deactivate all tokens
    await db.execute('UPDATE db_tokens SET is_active = FALSE');
    
    // Activate the selected one
    await db.execute('UPDATE db_tokens SET is_active = TRUE WHERE id = ?', [id]);
    
    console.log(`[DB-Tokens] Activated token "${existing[0].name}" by ${req.user.email}`);
    
    res.json({
      success: true,
      token: existing[0].token,
      name: existing[0].name,
      host: existing[0].host,
      db_name: existing[0].db_name
    });
  } catch (error) {
    next(error);
  }
});

// DEACTIVATE all tokens (return to default DB)
router.post('/db-tokens/deactivate-all', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);
    
    await db.execute('UPDATE db_tokens SET is_active = FALSE');
    
    console.log(`[DB-Tokens] All tokens deactivated by ${req.user.email}`);
    
    res.json({ success: true, message: 'Alle Tokens deaktiviert - Standard-DB wird verwendet' });
  } catch (error) {
    next(error);
  }
});

// TEST a token connection
router.post('/db-tokens/test', async (req, res, next) => {
  try {
    const { credentials, token } = req.body;
    
    let config;
    
    if (credentials) {
      // Test with provided credentials
      config = {
        host: credentials.host?.trim(),
        user: credentials.user?.trim(),
        password: credentials.password || '',
        database: credentials.database?.trim(),
        port: parseInt(credentials.port || '3306')
      };
    } else if (token) {
      // Test with encrypted token
      const { parseDbToken } = await import('../utils/crypto.js');
      config = parseDbToken(token);
    } else {
      return res.status(400).json({ error: 'Credentials oder Token erforderlich' });
    }
    
    if (!config || !config.host || !config.user || !config.database) {
      return res.status(400).json({ error: 'Ungültige Zugangsdaten' });
    }
    
    // Try to connect
    const { createPool } = await import('mysql2/promise');
    
    const testPool = createPool({
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 1,
      connectTimeout: 10000
    });
    
    try {
      const [result] = await testPool.execute('SELECT 1 as test');
      await testPool.end();
      
      res.json({
        success: true,
        message: 'Verbindung erfolgreich',
        host: config.host,
        database: config.database
      });
    } catch (connErr) {
      await testPool.end().catch(() => {});
      res.status(400).json({
        success: false,
        error: 'Verbindung fehlgeschlagen: ' + connErr.message
      });
    }
  } catch (error) {
    next(error);
  }
});

// ===== WISH REMINDER - Manual trigger or cron check =====
router.post('/wish-reminder/check', async (req, res, next) => {
  try {
    // Inline auth check (same pattern as /tools)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nicht autorisiert' });
    }

    const token = authHeader.split(' ')[1];
    let user;
    try {
      user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Token ungültig' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin-Berechtigung erforderlich' });
    }

    const dbPool = req.db || db;
    const result = await checkAndSendWishReminders(dbPool, 'manual');

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
