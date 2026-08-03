import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Request, Response, NextFunction } from 'express';
import { db, removeTenantPool } from '../index.js';
import { runMasterMigrations } from '../utils/masterMigrations.js';
import { authMiddleware } from './auth.js';
import { requirePermission } from '../utils/permissions.js';
import { clearColumnsCache, writeAuditLog } from './dbProxy.js';
import { isValidIdentifier } from '../utils/schema.js';
import { checkAndSendWishReminders } from '../utils/wishReminder.js';
import { runTenantMigrations } from '../utils/tenantMigrations.js';
import { resolveMasterDbConfig } from '../utils/mysqlConfig.js';
import { ensureTenantBaseTables } from '../scripts/seed-runtime-shared.js';

interface CuraRequest extends Request {
  db: Pool;
  dbToken?: string;
  isCustomDb?: boolean;
  user?: {
    sub?: string;
    email?: string;
    role?: string;
    permissions?: Record<string, boolean>;
    [key: string]: unknown;
  };
}

const router = express.Router();

/**
 * Build the `ssl` option for an admin-configured tenant DB connection
 * (Finding S6). Historically every admin "ssl" toggle stored
 * `{ rejectUnauthorized: false }`, disabling certificate verification for all
 * tenant connections — including those whose servers present a valid cert,
 * making them blind to MITM. We keep the permissive behaviour as the default
 * (so existing shared-hosting tenants with self-signed certs keep connecting)
 * but expose `DB_ALLOW_INSECURE_TLS=0` so deployments whose tenant servers use
 * valid certificates can enforce verification. A warning is logged whenever
 * verification is disabled.
 */
export function buildTenantSslOption(): { rejectUnauthorized: boolean } {
  const flag = (process.env.DB_ALLOW_INSECURE_TLS ?? '').trim().toLowerCase();
  const allowInsecure = !(flag === '0' || flag === 'false' || flag === 'no' || flag === 'off');
  if (allowInsecure) {
    console.warn('[admin] Tenant DB TLS certificate verification is DISABLED (DB_ALLOW_INSECURE_TLS default). Set DB_ALLOW_INSECURE_TLS=0 to enforce verification for tenant servers with a valid certificate.');
  }
  return { rejectUnauthorized: !allowInsecure };
}

// Test endpoint without middleware
router.get('/test', (req: Request, res: Response) => {
  res.json({ message: 'Admin routes working', timestamp: new Date().toISOString() });
});

// ===== ADMIN TOOLS - Simplified with inline auth check =====
router.post('/tools', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Quick inline auth check
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nicht autorisiert' });
    }
    
    const token = authHeader.split(' ')[1];
    let user;
    try {
      user = jwt.verify(token, process.env.JWT_SECRET!) as Record<string, unknown>;
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
        const masterDbConfig = resolveMasterDbConfig();
        const config = {
          host: masterDbConfig.host,
          user: masterDbConfig.user,
          password: masterDbConfig.password,
          database: masterDbConfig.database,
          port: masterDbConfig.port,
        };

        if (!config.host || !config.user) {
          console.error('Missing DB configuration');
          return res.status(400).json({ error: 'Keine Secrets gefunden' });
        }

        if (!process.env.JWT_SECRET!) {
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

        if (!process.env.JWT_SECRET!) {
          console.error('JWT_SECRET not configured');
          return res.status(500).json({ error: 'Server nicht korrekt konfiguriert (JWT_SECRET fehlt)' });
        }

        const config: Record<string, unknown> = {
          host: host.trim(),
          user: user.trim(),
          password: password || '',
          database: database.trim(),
          port: parseInt(port || '3306'),
        };

        if (ssl) {
          config.ssl = buildTenantSslOption();
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
        const dbPool = (req as unknown as CuraRequest).db || db;
        const [tables] = await dbPool.execute('SHOW TABLES') as [RowDataPacket[], unknown];
        const exportData: Record<string, unknown> = {};

        for (const table of tables) {
          const tableName = Object.values(table)[0] as string;
          const [rows] = await dbPool.execute(`SELECT * FROM \`${tableName}\``) as [RowDataPacket[], unknown];
          exportData[tableName] = rows;
        }

        console.log(`[export] Exported ${Object.keys(exportData).length} tables from ${(req as unknown as CuraRequest).db ? 'tenant' : 'master'} database`);
        return res.json(exportData);
      }

      case 'check': {
        // Database integrity check - runs on tenant database if X-DB-Token is provided
        const dbPool = (req as unknown as CuraRequest).db || db; // (req as unknown as CuraRequest).db is set by tenantDbMiddleware
        const issues: Record<string, unknown>[] = [];

        try {
          // Load all data from the correct database
          const [doctors] = await dbPool.execute('SELECT id, name FROM Doctor') as [RowDataPacket[], unknown];
          const [shifts] = await dbPool.execute('SELECT id, doctor_id, date, position, created_date FROM ShiftEntry') as [RowDataPacket[], unknown];
          const [staffing] = await dbPool.execute('SELECT id, doctor_id, year, month FROM StaffingPlanEntry') as [RowDataPacket[], unknown];
          const [workplaces] = await dbPool.execute('SELECT id, name FROM Workplace') as [RowDataPacket[], unknown];

          const doctorIds = new Set(doctors.map((d: RowDataPacket) => d.id));
          const validPositions = new Set([
            "Verfügbar", "Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar", "Sonstiges",
            ...workplaces.map((w: RowDataPacket) => w.name)
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
          const checkDuplicates = (entityName: string, items: Record<string, unknown>[], keyFields: string[], tableName: string) => {
            const map = new Map();
              items.forEach((item: Record<string, unknown>) => {
              const key = keyFields.map((f: string) => item[f]).join('|');
              if (!map.has(key)) map.set(key, []);
              map.get(key).push(item);
            });

            for (const [key, group] of map.entries()) {
              if (group.length > 1) {
                // Sort by created_date if available, keep the oldest
                group.sort((a: Record<string, unknown>, b: Record<string, unknown>) => new Date(String(a.created_date || 0)).getTime() - new Date(String(b.created_date || 0)).getTime());
                const toDelete = group.slice(1); // All except first (oldest)
                issues.push({
                  type: `duplicate_${entityName.toLowerCase()}`,
                  ids: toDelete.map((i: Record<string, unknown>) => i.id),
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

          console.log(`[check] Found ${issues.length} issues in ${(req as unknown as CuraRequest).db ? 'tenant' : 'master'} database`);

          return res.json({ 
            issues,
            dataSource: (req as unknown as CuraRequest).db ? 'tenant' : 'master',
            stats: {
              doctors: doctors.length,
              shifts: shifts.length,
              staffing: staffing.length,
              workplaces: workplaces.length
            }
          });
        } catch (err) {
          console.error('[check] Error:', (err as Error).message);
          return res.status(500).json({ error: 'Fehler bei Integritätsprüfung' });
        }
      }

      case 'repair': {
        // Database repair - delete orphaned entries and duplicates
        const dbPool = (req as unknown as CuraRequest).db || db;
        const { issuesToFix } = data || {};
        const results = [];

        if (!issuesToFix || issuesToFix.length === 0) {
          return res.json({ 
            message: 'Keine Probleme ausgewählt',
            results: []
          });
        }

        const userEmail = (req as unknown as CuraRequest).user?.email || 'unknown';
        const timestamp = new Date().toISOString();

        for (const issue of issuesToFix) {
          try {
            if (issue.type === 'orphaned_shift' || issue.type === 'orphaned_position') {
              const [rows] = await dbPool.execute('SELECT * FROM ShiftEntry WHERE id = ?', [issue.id]) as [RowDataPacket[], unknown];
              await dbPool.execute('DELETE FROM ShiftEntry WHERE id = ?', [issue.id]);
              console.log(`[AUDIT][DELETE][REPAIR] ${timestamp} | User: ${userEmail} | Table: ShiftEntry | ID: ${issue.id} | Type: ${issue.type} | Data: ${JSON.stringify(rows[0] || null)}`);
              results.push(`✓ Gelöscht: ShiftEntry ${issue.id}`);
            } else if (issue.type === 'orphaned_staffing') {
              const [rows] = await dbPool.execute('SELECT * FROM StaffingPlanEntry WHERE id = ?', [issue.id]) as [RowDataPacket[], unknown];
              await dbPool.execute('DELETE FROM StaffingPlanEntry WHERE id = ?', [issue.id]);
              console.log(`[AUDIT][DELETE][REPAIR] ${timestamp} | User: ${userEmail} | Table: StaffingPlanEntry | ID: ${issue.id} | Type: ${issue.type} | Data: ${JSON.stringify(rows[0] || null)}`);
              results.push(`✓ Gelöscht: StaffingPlanEntry ${issue.id}`);
            } else if (issue.type.startsWith('duplicate_')) {
              // Delete all duplicate IDs (keeping the first/oldest one)
              const table = issue.table || 'ShiftEntry';
              // issue.table comes from the request body and is interpolated
              // into a backtick-quoted identifier; validate before use.
              if (!isValidIdentifier(table)) {
                results.push(`✗ Ungültiger Tabellenname: ${table}`);
                continue;
              }
              if (issue.ids && issue.ids.length > 0) {
                for (const id of issue.ids) {
                  const [rows] = await dbPool.execute(`SELECT * FROM \`${table}\` WHERE id = ?`, [id]) as [RowDataPacket[], unknown];
                  await dbPool.execute(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
                  console.log(`[AUDIT][DELETE][REPAIR] ${timestamp} | User: ${userEmail} | Table: ${table} | ID: ${id} | Type: ${issue.type} | Data: ${JSON.stringify(rows[0] || null)}`);
                }
                results.push(`✓ ${issue.ids.length} Duplikate gelöscht aus ${table}`);
              }
            }
          } catch (err) {
            results.push(`✗ Fehler: ${(err as Error).message}`);
          }
        }

        console.log(`[AUDIT][REPAIR] ${timestamp} | User: ${userEmail} | Processed ${issuesToFix.length} issues, results:`, results);

        // Write summary to SystemLog table
        const dbPoolForLog = (req as unknown as CuraRequest).db || db;
        await writeAuditLog(dbPoolForLog, {
          level: 'audit',
          source: 'DB-Reparatur',
          message: `${results.filter((r: string) => r.startsWith('\u2713')).length} Einträge repariert/gelöscht von ${userEmail}`,
          details: { issues: issuesToFix.length, results, timestamp },
          userEmail
        });

        return res.json({ 
          message: `${results.filter((r: string) => r.startsWith('✓')).length} Probleme behoben`,
          results
        });
      }

      case 'wipe_database': {
        // Wipe all data from tables (DANGEROUS!) - uses tenant DB if X-DB-Token provided
        const dbPool = (req as unknown as CuraRequest).db || db;
        const [tables] = await dbPool.execute('SHOW TABLES') as [RowDataPacket[], unknown];
        
        const wipedTables = [];
        for (const table of tables) {
          const tableName = Object.values(table)[0] as string;
          // Skip user tables to keep admin access
          if (tableName === 'User' || tableName === 'app_users' || tableName === 'db_tokens') continue;
          const [countRows] = await dbPool.execute(`SELECT COUNT(*) as cnt FROM \`${tableName}\``) as [RowDataPacket[], unknown];
          const rowCount = countRows[0]?.cnt || 0;
          await dbPool.execute(`DELETE FROM \`${tableName}\``);
          if (rowCount > 0) wipedTables.push({ table: tableName, deletedRows: rowCount });
        }

        const wipeTimestamp = new Date().toISOString();
        const wipeUser = (req as unknown as CuraRequest).user?.email || 'unknown';
        console.log(`[AUDIT][DELETE][WIPE] ${wipeTimestamp} | User: ${wipeUser} | Target: ${(req as unknown as CuraRequest).db ? 'tenant' : 'master'} | Tables: ${JSON.stringify(wipedTables)}`);

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
            message: `Datenbank bereinigt von ${wipeUser} (${(req as unknown as CuraRequest).db ? 'Mandant' : 'Master'})`,
            details: { target: (req as unknown as CuraRequest).db ? 'tenant' : 'master', wiped_tables: wipedTables, timestamp: wipeTimestamp },
            userEmail: wipeUser
          });
        } catch (logErr) {
          console.error('[AUDIT] Failed to write wipe audit log:', (logErr as Error).message);
        }
        return res.json({ 
          message: 'Database wiped successfully',
          warning: 'User/Token tables preserved',
          dataSource: (req as unknown as CuraRequest).db ? 'tenant' : 'master'
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
router.use(requirePermission('can_manage_system'));

// ===== GET USERS (with optional tenant filter) =====
// Optional query param: tenantId -> filters users whose allowed_tenants JSON array contains this id.
// Users with allowed_tenants NULL or empty array are treated as having access to all tenants
// and are therefore always included in the result (backwards compatibility).
router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dbPool = (req as unknown as CuraRequest).db || db;
    const { tenantId } = req.query;

    const [rows] = await dbPool.execute('SELECT * FROM app_users ORDER BY email ASC') as [RowDataPacket[], unknown];

    if (!tenantId) {
      return res.json(rows);
    }

    // Filter in JS to safely handle JSON column variations (string vs. array, NULL, empty array)
    const filtered = rows.filter((u: RowDataPacket) => {
      const raw = u.allowed_tenants;
      if (raw === null || raw === undefined || raw === '') return true; // full access
      let parsed = raw;
      if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (e) { return false; }
      }
      if (!Array.isArray(parsed)) return false;
      if (parsed.length === 0) return true; // empty array = full access
      // Compare as strings to be tolerant of numeric/string IDs
      return parsed.map(String).includes(String(tenantId));
    });

    res.json(filtered);
  } catch (error) {
    if ((error as Record<string, unknown>).code === 'ER_NO_SUCH_TABLE') {
      return res.json([]);
    }
    next(error);
  }
});

// ===== GET SYSTEM LOGS =====
router.get('/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = 100 } = req.query;
    const dbPool = (req as unknown as CuraRequest).db || db;
    
    // Could query a logs table or return server logs
    const [rows] = await dbPool.execute(
      'SELECT * FROM system_logs ORDER BY created_date DESC LIMIT ?',
      [parseInt(String(limit))]
    ) as [RowDataPacket[], unknown];
    
    res.json(rows);
  } catch (error) {
    // If logs table doesn't exist, return empty array
    if ((error as Record<string, unknown>).code === 'ER_NO_SUCH_TABLE') {
      return res.json([]);
    }
    next(error);
  }
});

// ===== DATABASE MANAGEMENT =====
router.post('/database/backup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Placeholder for database backup logic
    res.json({ success: true, message: 'Backup initiated' });
  } catch (error) {
    next(error);
  }
});

router.get('/database/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dbPool = (req as unknown as CuraRequest).db || db;
    const [tables] = await dbPool.execute('SHOW TABLES') as [RowDataPacket[], unknown];
    const stats = [];
    
    for (const table of tables) {
      const tableName = Object.values(table)[0] as string;
      const [rows] = await dbPool.execute(`SELECT COUNT(*) as count FROM \`${tableName}\``) as [RowDataPacket[], unknown];
      stats.push({ table: tableName, rows: rows[0].count });
    }
    
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// ===== SYSTEM SETTINGS =====
router.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dbPool = (req as unknown as CuraRequest).db || db;
    const [rows] = await dbPool.execute('SELECT * FROM system_settings') as [RowDataPacket[], unknown];
    res.json(rows);
  } catch (error) {
    if ((error as Record<string, unknown>).code === 'ER_NO_SUCH_TABLE') {
      return res.json([]);
    }
    next(error);
  }
});

router.post('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dbPool = (req as unknown as CuraRequest).db || db;
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
router.post('/migrate-users', async (req: Request, res: Response, next: NextFunction) => {
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
        wish_default_position VARCHAR(255) DEFAULT NULL,
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
        const [existing] = await db.execute('SELECT id FROM User WHERE email = ?', [user.email]) as [RowDataPacket[], unknown];
        
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
        results.push({ email: user.email, status: 'error', error: (err as Error).message });
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
router.post('/rename-position', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { oldName, newName } = req.body;
    
    if (!oldName || !newName) {
      return res.status(400).json({ error: 'oldName und newName sind erforderlich' });
    }
    
    if (oldName === newName) {
      return res.json({ success: true, message: 'Keine Änderung nötig', stats: {} });
    }
    
    // Use tenant DB if available ((req as unknown as CuraRequest).db is set by tenantDbMiddleware)
    const dbPool = (req as unknown as CuraRequest).db;

    // Ensure all base tables exist before attempting updates (needed for new tenants)
    if ((req as unknown as CuraRequest).isCustomDb) {
      try {
        await ensureTenantBaseTables(dbPool);
      } catch (e) {
        console.warn('[rename-position] ensureTenantBaseTables warning:', (e as Error).message);
        // Non-fatal - continue anyway
      }
    }
    
    let shiftsUpdated = 0;
    let rotationsUpdated = 0;
    
    // Update ShiftEntry
    try {
      const [r1] = await dbPool.execute(
        'UPDATE ShiftEntry SET position = ? WHERE position = ?',
        [newName, oldName]
      ) as [ResultSetHeader, unknown];
      shiftsUpdated = r1.affectedRows || 0;
    } catch (e) {
      if ((e as Record<string, unknown>).code !== 'ER_NO_SUCH_TABLE' && (e as Record<string, unknown>).code !== 'ER_BAD_FIELD_ERROR') throw e;
    }
    
    // Update TrainingRotation (modality field)
    try {
      const [r3] = await dbPool.execute(
        'UPDATE TrainingRotation SET modality = ? WHERE modality = ?',
        [newName, oldName]
      ) as [ResultSetHeader, unknown];
      rotationsUpdated = r3.affectedRows || 0;
    } catch (e) {
      if ((e as Record<string, unknown>).code !== 'ER_NO_SUCH_TABLE' && (e as Record<string, unknown>).code !== 'ER_BAD_FIELD_ERROR') throw e;
    }
    
    const stats = {
      updatedShifts: shiftsUpdated,
      updatedRotations: rotationsUpdated
    };
    
    console.log(`Renamed position "${oldName}" to "${newName}":`, stats);
    
    res.json({
      success: true,
      message: `Position "${oldName}" wurde zu "${newName}" umbenannt`,
      ...stats
    });
  } catch (error) {
    console.error('[rename-position] Failed:', (error as Error).message, (error as Record<string, unknown>).code);
    next(error);
  }
});

// ===== DATABASE MIGRATIONS =====
// Run pending migrations on the master database

router.post('/run-migrations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const results = await runMasterMigrations(db);
    
    console.log(`[Migrations] Executed by ${(req as unknown as CuraRequest).user?.email}:`, results);
    
    res.json({
      success: true,
      message: 'Migrationen ausgeführt',
      results
    });
  } catch (error) {
    next(error);
  }
});

router.get('/migration-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check which columns exist in app_users
    const [columns] = await db.execute(`SHOW COLUMNS FROM app_users`) as [RowDataPacket[], unknown];
    const columnNames = columns.map((c: RowDataPacket) => c.Field);
    
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
      },
      {
        name: 'add_last_seen_at',
        description: 'Praesenz-Zeitstempel fuer CoWork',
        applied: columnNames.includes('last_seen_at')
      },
      {
        name: 'add_schedule_initials_only',
        description: 'Ansichtseinstellung nur fuer Kuerzel',
        applied: columnNames.includes('schedule_initials_only')
      },
      {
        name: 'add_schedule_sort_doctors_alphabetically',
        description: 'Ansichtseinstellung fuer alphabetische Mitarbeitersortierung',
        applied: columnNames.includes('schedule_sort_doctors_alphabetically')
      }
    ];

    // Check EmailVerification table
    let emailVerificationTableExists = false;
    try {
      const [tables] = await db.execute(`SHOW TABLES LIKE 'EmailVerification'`) as [RowDataPacket[], unknown];
      emailVerificationTableExists = tables.length > 0;
    } catch (err) {
      // ignore
    }
    migrations.push({
      name: 'create_email_verification_table',
      description: 'E-Mail-Verifizierung & Passwort-Versand Tabelle',
      applied: emailVerificationTableExists
    });

    let coworkInviteTableExists = false;
    try {
      const [tables] = await db.execute(`SHOW TABLES LIKE 'CoWorkInvite'`) as [RowDataPacket[], unknown];
      coworkInviteTableExists = tables.length > 0;
    } catch (err) {
      // ignore
    }
    migrations.push({
      name: 'create_cowork_invite_table',
      description: 'CoWork-Einladungen fuer Support-Sessions',
      applied: coworkInviteTableExists
    });
    
    res.json({
      migrations,
      allApplied: migrations.every((m: Record<string, unknown>) => m.applied)
    });
  } catch (error) {
    next(error);
  }
});

// ===== TIMESLOT MIGRATIONS (Tenant-specific) =====
// Run timeslot migrations on the currently active tenant database
router.post('/run-timeslot-migrations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Use tenant DB if available ((req as unknown as CuraRequest).db is set by tenantDbMiddleware)
    const dbPool = (req as unknown as CuraRequest).db || db;
    const cacheKey = String(req.headers['x-db-token'] || '') || 'default';
    const results = await runTenantMigrations(dbPool, cacheKey);

    console.log(`[Timeslot Migrations] Executed by ${(req as unknown as CuraRequest).user?.email}:`, results);

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
router.get('/timeslot-migration-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Use tenant DB if available
    const dbPool = (req as unknown as CuraRequest).db || db;
    const migrations = [];

    // Check WorkplaceTimeslot table
    try {
      const [tables] = await dbPool.execute(`SHOW TABLES LIKE 'WorkplaceTimeslot'`) as [RowDataPacket[], unknown];
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
        error: (err as Error).message
      });
    }

    // Check Workplace columns
    try {
      const [columns] = await dbPool.execute(`SHOW COLUMNS FROM Workplace`) as [RowDataPacket[], unknown];
      const columnNames = columns.map((c: RowDataPacket) => c.Field);
      
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

      migrations.push({
        name: 'add_workplace_allows_absence_overlap',
        description: 'Erlaubt dienstspezifische Überschneidungen mit Abwesenheiten',
        applied: columnNames.includes('allows_absence_overlap')
      });
    } catch (err) {
      migrations.push({
        name: 'workplace_columns',
        description: 'Workplace-Spalten prüfen',
        applied: false,
        error: (err as Error).message
      });
    }

    // Check ShiftEntry columns
    try {
      const [columns] = await dbPool.execute(`SHOW COLUMNS FROM ShiftEntry`) as [RowDataPacket[], unknown];
      const columnNames = columns.map((c: RowDataPacket) => c.Field);
      
      migrations.push({
        name: 'add_shiftentry_timeslot_id',
        description: 'Timeslot-Zuordnung für ShiftEntries',
        applied: columnNames.includes('timeslot_id')
      });

      migrations.push({
        name: 'add_shiftentry_start_time',
        description: 'Automatisch berechnete Startzeit pro Schicht',
        applied: columnNames.includes('start_time')
      });

      migrations.push({
        name: 'add_shiftentry_end_time',
        description: 'Automatisch berechnete Endzeit pro Schicht',
        applied: columnNames.includes('end_time')
      });

      migrations.push({
        name: 'add_shiftentry_break_minutes',
        description: 'Pausenminuten pro Schicht',
        applied: columnNames.includes('break_minutes')
      });
    } catch (err) {
      migrations.push({
        name: 'shiftentry_columns',
        description: 'ShiftEntry-Spalten prüfen',
        applied: false,
        error: (err as Error).message
      });
    }

    // Check TeamRole columns for permissions
    try {
      const [columns] = await dbPool.execute(`SHOW COLUMNS FROM TeamRole`) as [RowDataPacket[], unknown];
      const columnNames = columns.map((c: RowDataPacket) => c.Field);
      
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
        error: (err as Error).message
      });
    }

    // Check service_type column in Workplace
    try {
      const [columns] = await dbPool.execute(`SHOW COLUMNS FROM Workplace WHERE Field = 'service_type'`) as [RowDataPacket[], unknown];
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
        error: (err as Error).message
      });
    }

    // Check central_employee_id column in Doctor
    try {
      const [columns] = await dbPool.execute(`SHOW COLUMNS FROM Doctor WHERE Field = 'central_employee_id'`) as [RowDataPacket[], unknown];
      migrations.push({
        name: 'add_doctor_central_employee_id',
        description: 'Verknüpfung zur zentralen Mitarbeiterverwaltung',
        applied: columns.length > 0
      });
    } catch (err) {
      migrations.push({
        name: 'add_doctor_central_employee_id',
        description: 'Verknüpfung zur zentralen Mitarbeiterverwaltung',
        applied: false,
        error: (err as Error).message
      });
    }

    // Check work_time_model_id column in Doctor
    try {
      const [columns] = await dbPool.execute(`SHOW COLUMNS FROM Doctor WHERE Field = 'work_time_model_id'`) as [RowDataPacket[], unknown];
      migrations.push({
        name: 'add_doctor_work_time_model_id',
        description: 'Arbeitszeitmodell-Zuordnung pro Mitarbeiter',
        applied: columns.length > 0
      });
    } catch (err) {
      migrations.push({
        name: 'add_doctor_work_time_model_id',
        description: 'Arbeitszeitmodell-Zuordnung pro Mitarbeiter',
        applied: false,
        error: (err as Error).message
      });
    }

    // Check ShiftTimeRule table
    try {
      const [tables] = await dbPool.execute(`SHOW TABLES LIKE 'ShiftTimeRule'`) as [RowDataPacket[], unknown];
      migrations.push({
        name: 'create_shift_time_rule_table',
        description: 'Schichtzeitregeln pro Arbeitsplatz und Arbeitszeitmodell',
        applied: tables.length > 0
      });
    } catch (err) {
      migrations.push({
        name: 'create_shift_time_rule_table',
        description: 'Schichtzeitregeln pro Arbeitsplatz und Arbeitszeitmodell',
        applied: false,
        error: (err as Error).message
      });
    }

    res.json({
      migrations,
      allApplied: migrations.every((m: Record<string, unknown>) => m.applied)
    });
  } catch (error) {
    next(error);
  }
});

// ===== DB TOKEN MANAGEMENT (Server-side Token Storage) =====
// IMPORTANT: These tokens are ALWAYS stored on the MASTER database (from ENV variables)
// NOT on tenant databases! This ensures tokens are available regardless of which
// tenant database is currently active.
// We use `db` (master) instead of `(req as unknown as CuraRequest).db` (tenant) for all token operations.

// Ensure db_tokens table exists on MASTER database
async function ensureDbTokensTable(masterDb: Pool) {
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
router.get('/db-tokens', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureDbTokensTable(db);
    
    // Get the requesting admin's allowed_tenants
    const [adminRows] = await db.execute('SELECT allowed_tenants FROM app_users WHERE id = ?', [(req as unknown as CuraRequest).user?.sub || '']) as [RowDataPacket[], unknown];
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
    `) as [RowDataPacket[], unknown];
    
    // Filter tokens based on admin's allowed_tenants
    // If adminTenantList is null or empty, admin has access to all tenants
    let filteredRows = rows;
    if (adminTenantList && adminTenantList.length > 0) {
      filteredRows = rows.filter((token: RowDataPacket) => adminTenantList.includes(token.id));
    }
    
    // Convert is_active from MySQL tinyint to proper boolean
    const tokens = filteredRows.map((row: RowDataPacket) => ({
      ...row,
      is_active: Boolean(row.is_active)
    }));
    
    res.json(tokens);
  } catch (error) {
    next(error);
  }
});

// GET a specific token (includes the encrypted token value)
router.get('/db-tokens/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureDbTokensTable(db);
    
    const [rows] = await db.execute(
      'SELECT * FROM db_tokens WHERE id = ?',
      [req.params.id]
    ) as [RowDataPacket[], unknown];
    
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
router.get('/db-tokens/active/current', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureDbTokensTable(db);
    
    const [rows] = await db.execute(
      'SELECT * FROM db_tokens WHERE is_active = TRUE LIMIT 1'
    ) as [RowDataPacket[], unknown];
    
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
router.post('/db-tokens', async (req: Request, res: Response, next: NextFunction) => {
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
    
    const config: Record<string, unknown> = {
      host: host.trim(),
      user: user.trim(),
      password: password || '',
      database: dbName.trim(),
      port: parseInt(port || '3306'),
    };
    
    if (ssl) {
      config.ssl = buildTenantSslOption();
    }

    const encryptedToken = encryptToken(JSON.stringify(config));
    const id = crypto.randomUUID();
    
    await db.execute(`
      INSERT INTO db_tokens (id, name, token, host, db_name, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, name.trim(), encryptedToken, host.trim(), dbName.trim(), description || null, (req as unknown as CuraRequest).user?.email || 'unknown']);
    
    console.log(`[DB-Tokens] Created token "${name}" for ${host}/${dbName} by ${(req as unknown as CuraRequest).user?.email || 'unknown'}`);
    
    res.json({
      id,
      name: name.trim(),
      host: host.trim(),
      db_name: dbName.trim(),
      description: description || null,
      token: encryptedToken,
      created_by: (req as unknown as CuraRequest).user?.email || 'unknown'
    });
  } catch (error) {
    next(error);
  }
});

// UPDATE a DB token
router.put('/db-tokens/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureDbTokensTable(db);
    
    const { name, description, credentials } = req.body;
    const { id } = req.params;
    
    // Check if token exists
    const [existing] = await db.execute('SELECT * FROM db_tokens WHERE id = ?', [id]) as [RowDataPacket[], unknown];
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Token nicht gefunden' });
    }
    
    // If credentials are provided, re-encrypt
    let encryptedToken = existing[0].token;
    let host = existing[0].host;
    let dbName = existing[0].db_name;
    let newConfig = null;
    
    if (credentials && credentials.host && credentials.user && credentials.database) {
      const { encryptToken, computeTenantKeyFromConfig } = await import('../utils/crypto.js');
      
      newConfig = {
        host: credentials.host.trim(),
        user: credentials.user.trim(),
        password: credentials.password || '',
        database: credentials.database.trim(),
        port: parseInt(credentials.port || '3306'),
      } as Record<string, unknown>;
      
      if (credentials.ssl) {
        newConfig.ssl = buildTenantSslOption();
      }
      
      encryptedToken = encryptToken(JSON.stringify(newConfig));
      host = credentials.host.trim();
      dbName = credentials.database.trim();
    }
    
    await db.execute(`
      UPDATE db_tokens 
      SET name = ?, token = ?, host = ?, db_name = ?, description = ?, updated_date = NOW()
      WHERE id = ?
    `, [name?.trim() || existing[0].name, encryptedToken, host, dbName, description ?? existing[0].description, id]);

    // Cascade-Update for tables that store the derived tenant_key.
    // When host or database change, sha256(host:database) changes too, so any
    // persisted tenant_key must be remapped or the rows become orphaned.
    // Currently QualificationCertificate is the only such table.
    if (newConfig) {
      try {
        const { computeTenantKeyFromConfig } = await import('../utils/crypto.js');
        const { parseDbToken } = await import('../utils/crypto.js');
        const oldKey = computeTenantKeyFromConfig(parseDbToken(existing[0].token));
        const newKey = computeTenantKeyFromConfig(newConfig);
        if (oldKey && newKey && oldKey !== newKey) {
          const [result] = await db.execute(
            `UPDATE QualificationCertificate
                SET tenant_key = ?
              WHERE tenant_key = ?`,
            [newKey, oldKey]
          ) as [ResultSetHeader, unknown];
          if (result.affectedRows > 0) {
            console.log(
              `[DB-Tokens] Remapped ${result.affectedRows} QualificationCertificate row(s) ` +
              `from tenant_key ${oldKey.substring(0, 8)}… to ${newKey.substring(0, 8)}… ` +
              `(token "${name || existing[0].name}" updated by ${(req as unknown as CuraRequest).user?.email || 'unknown'})`
            );
          }
        }
      } catch (cascadeError) {
        // Do not fail the whole update if the cascade can't run; surface in the
        // server log so the operator can run a manual remap.
        console.error(
          '[DB-Tokens] tenant_key cascade remap failed (manual remap may be required):',
          (cascadeError as Error).message
        );
      }
    }

    removeTenantPool(existing[0].token);
    if (encryptedToken !== existing[0].token) {
      removeTenantPool(encryptedToken);
    }
    
    console.log(`[DB-Tokens] Updated token "${name || existing[0].name}" by ${(req as unknown as CuraRequest).user?.email || 'unknown'}`);
    
    res.json({ success: true, id });
  } catch (error) {
    next(error);
  }
});

// DELETE a DB token
router.delete('/db-tokens/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureDbTokensTable(db);
    
    const { id } = req.params;
    
    const [existing] = await db.execute('SELECT name FROM db_tokens WHERE id = ?', [id]) as [RowDataPacket[], unknown];
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Token nicht gefunden' });
    }

    const [existingTokenRows] = await db.execute('SELECT token FROM db_tokens WHERE id = ?', [id]) as [RowDataPacket[], unknown];
    
    await db.execute('DELETE FROM db_tokens WHERE id = ?', [id]);

    if (existingTokenRows[0]?.token) {
      removeTenantPool(existingTokenRows[0].token);
    }
    
    const tokenTimestamp = new Date().toISOString();
    console.log(`[AUDIT][DELETE][DB-TOKEN] ${tokenTimestamp} | User: ${(req as unknown as CuraRequest).user?.email || 'unknown'} | Token: "${existing[0].name}" | ID: ${id}`);
    
    // Write to SystemLog in master db
    await writeAuditLog(db, {
      level: 'audit',
      source: 'Mandantenverwaltung',
      message: `DB-Token "${existing[0].name}" gelöscht von ${(req as unknown as CuraRequest).user?.email || 'unknown'}`,
      details: { token_name: existing[0].name, token_id: id, timestamp: tokenTimestamp },
      userEmail: (req as unknown as CuraRequest).user?.email || 'unknown'
    });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// SET a token as active (and deactivate all others)
router.post('/db-tokens/:id/activate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureDbTokensTable(db);
    
    const { id } = req.params;
    
    const [existing] = await db.execute('SELECT * FROM db_tokens WHERE id = ?', [id]) as [RowDataPacket[], unknown];
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Token nicht gefunden' });
    }
    
    // Deactivate all tokens
    await db.execute('UPDATE db_tokens SET is_active = FALSE');
    
    // Activate the selected one
    await db.execute('UPDATE db_tokens SET is_active = TRUE WHERE id = ?', [id]);
    
    console.log(`[DB-Tokens] Activated token "${existing[0].name}" by ${(req as unknown as CuraRequest).user?.email || 'unknown'}`);
    
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
router.post('/db-tokens/deactivate-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureDbTokensTable(db);
    
    await db.execute('UPDATE db_tokens SET is_active = FALSE');
    
    console.log(`[DB-Tokens] All tokens deactivated by ${(req as unknown as CuraRequest).user?.email || 'unknown'}`);
    
    res.json({ success: true, message: 'Alle Tokens deaktiviert - Standard-DB wird verwendet' });
  } catch (error) {
    next(error);
  }
});

// TEST a token connection
router.post('/db-tokens/test', async (req: Request, res: Response, next: NextFunction) => {
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
        port: parseInt(credentials.port || '3306'),
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
      port: Number(config.port) || 3306,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 1,
      connectTimeout: 10000
    });
    
    try {
      const [result] = await testPool.execute('SELECT 1 as test') as [RowDataPacket[], unknown];
      await testPool.end();
      
      res.json({
        success: true,
        message: 'Verbindung erfolgreich',
        host: config.host,
        database: config.database
      });
    } catch (connErr) {
      await testPool.end().catch(() => {});
      console.error('[db-tokens/test] connection failed:', (connErr as Error).message);
      res.status(400).json({
        success: false,
        error: 'Verbindung fehlgeschlagen'
      });
    }
  } catch (error) {
    next(error);
  }
});

// CHECK a database: exists? empty?
router.post('/db-tokens/check-database', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { credentials, database } = req.body;
    if (!credentials || !credentials.host || !credentials.user) {
      return res.status(400).json({ error: 'Host und Benutzer erforderlich' });
    }
    const dbName = (database || credentials.database || '').trim();
    if (!dbName) {
      return res.status(400).json({ error: 'Datenbank-Name erforderlich' });
    }
    // `dbName` is interpolated into a backtick-quoted identifier via
    // `USE \`{dbName}\`` below (counting tables after a schema switch).
    // Validate it for the same injection reason as create-database above.
    if (!isValidIdentifier(dbName)) {
      return res.status(400).json({ error: 'Ungültiger Datenbank-Name' });
    }

    // Connect to mysql server without specifying a database,
    // so we can check schema existence.
    const { createPool } = await import('mysql2/promise');
    const checkPool = createPool({
      host: credentials.host.trim(),
      port: parseInt(credentials.port || '3306'),
      user: credentials.user.trim(),
      password: credentials.password || '',
      database: 'mysql',
      waitForConnections: true,
      connectionLimit: 1,
      connectTimeout: 10000,
    });

    try {
      // Check if the database exists
      const [schemaRows] = await checkPool.execute(
        'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
        [dbName]
      ) as [RowDataPacket[], unknown];
      const exists = schemaRows.length > 0;

      let tableCount = 0;
      if (exists) {
        // Switch to target database to count its tables
        await checkPool.execute(`USE \`${dbName}\``);
        const [tableRows] = await checkPool.execute(
          'SELECT COUNT(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
          [dbName]
        ) as [RowDataPacket[], unknown];
        tableCount = Number(tableRows[0].cnt) || 0;
      }

      await checkPool.end();

      return res.json({
        exists,
        empty: exists ? tableCount === 0 : null,
        tableCount,
        database: dbName,
      });
    } catch (connErr) {
      await checkPool.end().catch(() => {});
      console.error('[db-tokens/check-database] connection failed:', (connErr as Error).message);
      return res.status(400).json({
        error: 'Verbindung fehlgeschlagen',
      });
    }
  } catch (error) {
    next(error);
  }
});

// CREATE a new database
router.post('/db-tokens/create-database', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { credentials, database } = req.body;
    if (!credentials || !credentials.host || !credentials.user) {
      return res.status(400).json({ error: 'Host und Benutzer erforderlich' });
    }
    const dbName = (database || credentials.database || '').trim();
    if (!dbName) {
      return res.status(400).json({ error: 'Datenbank-Name erforderlich' });
    }
    // `dbName` is interpolated into a backtick-quoted identifier in the
    // CREATE DATABASE statement below; a backtick/quote in it would break out
    // of the identifier context (SQL injection). mysql2 parameterizes values,
    // not identifiers, so the name must be validated here. Mirrors the
    // identifier guard already used elsewhere in this file.
    if (!isValidIdentifier(dbName)) {
      return res.status(400).json({ error: 'Ungültiger Datenbank-Name' });
    }

    const { createPool } = await import('mysql2/promise');
    const adminPool = createPool({
      host: credentials.host.trim(),
      port: parseInt(credentials.port || '3306'),
      user: credentials.user.trim(),
      password: credentials.password || '',
      database: 'mysql',
      waitForConnections: true,
      connectionLimit: 1,
      connectTimeout: 10000,
    });

    try {
      await adminPool.execute(
        `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
      await adminPool.end();

      return res.json({
        success: true,
        message: `Datenbank "${dbName}" wurde angelegt.`,
        database: dbName,
      });
    } catch (connErr) {
      await adminPool.end().catch(() => {});
      console.error('[db-tokens/create-database] failed:', (connErr as Error).message);
      return res.status(400).json({
        error: 'Fehler beim Anlegen der Datenbank',
      });
    }
  } catch (error) {
    next(error);
  }
});

// ===== WISH REMINDER - Manual trigger or cron check =====
router.post('/wish-reminder/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Inline auth check (same pattern as /tools)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nicht autorisiert' });
    }

    const token = authHeader.split(' ')[1];
    let user;
    try {
      user = jwt.verify(token, process.env.JWT_SECRET!) as Record<string, unknown>;
    } catch (err) {
      return res.status(401).json({ error: 'Token ungültig' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin-Berechtigung erforderlich' });
    }

    const dbPool = (req as unknown as CuraRequest).db || db;
    const result = await checkAndSendWishReminders(dbPool, 'manual');

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
