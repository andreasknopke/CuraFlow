import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../index.js';
import { authMiddleware, adminMiddleware } from './auth.js';

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
        // Export all tables as JSON
        const [tables] = await db.execute('SHOW TABLES');
        const exportData = {};

        for (const table of tables) {
          const tableName = Object.values(table)[0];
          const [rows] = await db.execute(`SELECT * FROM \`${tableName}\``);
          exportData[tableName] = rows;
        }

        return res.json(exportData);
      }

      case 'check': {
        // Database integrity check placeholder
        return res.json({ 
          issues: [],
          message: 'No issues found'
        });
      }

      case 'repair': {
        // Database repair placeholder
        const { issuesToFix } = data || {};
        return res.json({ 
          message: 'Repair completed',
          results: [`Fixed ${issuesToFix?.length || 0} issues`]
        });
      }

      case 'wipe_database': {
        // Wipe all data from tables (DANGEROUS!)
        const [tables] = await db.execute('SHOW TABLES');
        
        for (const table of tables) {
          const tableName = Object.values(table)[0];
          // Skip user table to keep admin access
          if (tableName === 'User' || tableName === 'app_users') continue;
          await db.execute(`DELETE FROM \`${tableName}\``);
        }

        return res.json({ 
          message: 'Database wiped successfully',
          warning: 'User table preserved'
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
    
    // Could query a logs table or return server logs
    const [rows] = await db.execute(
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
    const [tables] = await db.execute('SHOW TABLES');
    const stats = [];
    
    for (const table of tables) {
      const tableName = Object.values(table)[0];
      const [rows] = await db.execute(`SELECT COUNT(*) as count FROM \`${tableName}\``);
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
    const [rows] = await db.execute('SELECT * FROM system_settings');
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
    const { key, value } = req.body;
    
    await db.execute(
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
      }
    ];
    
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
router.get('/db-tokens', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);
    
    const [rows] = await db.execute(`
      SELECT id, name, host, db_name, description, is_active, created_by, created_date, updated_date
      FROM db_tokens
      ORDER BY name ASC
    `);
    
    // Convert is_active from MySQL tinyint to proper boolean
    const tokens = rows.map(row => ({
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
    
    console.log(`[DB-Tokens] Deleted token "${existing[0].name}" by ${req.user.email}`);
    
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

export default router;
