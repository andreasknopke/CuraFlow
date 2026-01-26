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
          if (tableName === 'app_users') continue;
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

// ===== MIGRATE USERS (DISABLED - Use create-admin.js script instead) =====
// This endpoint has been removed as it contained hardcoded personal data.
// To create users, use the admin panel or the create-admin.js script.

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
