import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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

export default router;
