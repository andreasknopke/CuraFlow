import express from 'express';
import { db } from '../../db/pool.js';
import { writeAuditLog } from '../dbProxy.js';
import { checkAndSendWishReminders } from '../../utils/wishReminder.js';
import config from '../../config.js';
import { verifyAccessToken } from '../../utils/authTokens.js';

const router = express.Router();

function verifyInlineAdmin(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Nicht autorisiert' });
    return null;
  }

  const token = authHeader.split(' ')[1];
  const user = verifyAccessToken(token);
  if (!user) {
    res.status(401).json({ error: 'Token ungültig' });
    return null;
  }

  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Admin-Berechtigung erforderlich' });
    return null;
  }

  req.user = user;
  return user;
}

async function logInlineAdminAction(req, source, details = {}) {
  const dbPool = req.db || db;
  const userEmail = req.user?.email || 'unknown';

  await writeAuditLog(dbPool, {
    level: 'audit',
    source,
    message: `${source} von ${userEmail}`,
    details: {
      ...details,
      target: req.db ? 'tenant' : 'master',
      timestamp: new Date().toISOString(),
    },
    userEmail,
  });
}

router.get('/test', (req, res) => {
  res.json({ message: 'Admin routes working', timestamp: new Date().toISOString() });
});

router.post('/tools', async (req, res, next) => {
  try {
    const user = verifyInlineAdmin(req, res);
    if (!user) return;

    console.log('Admin tools request:', { action: req.body.action, user: user.email });

    const { action, data } = req.body;

    switch (action) {
      case 'generate_db_token': {
        console.log('Generating DB token from environment variables...');
        const dbConfig = {
          host: config.db.host,
          user: config.db.user,
          password: config.db.password,
          database: config.db.database,
          port: config.db.port,
        };

        if (!dbConfig.host || !dbConfig.user) {
          console.error('Missing DB configuration');
          return res.status(400).json({ error: 'Keine Secrets gefunden' });
        }

        if (!config.jwt.secret) {
          console.error('JWT_SECRET not configured');
          return res
            .status(500)
            .json({ error: 'Server nicht korrekt konfiguriert (JWT_SECRET fehlt)' });
        }

        const { encryptToken } = await import('../../utils/crypto.js');

        const json = JSON.stringify(dbConfig);
        const token = encryptToken(json);

        console.log('Encrypted DB token generated successfully');
        console.log('[generate_db_token] Token length:', token.length);
        console.log('[generate_db_token] Token first 50 chars:', token.substring(0, 50));
        await logInlineAdminAction(req, 'DB-Token aus Standardverbindung erzeugt');
        return res.json({ token });
      }

      case 'encrypt_db_token': {
        const { host, user, password, database, port, ssl } = data || {};

        if (!host || !user || !database) {
          return res.status(400).json({ error: 'Host, Benutzer und Datenbank sind erforderlich' });
        }

        if (!config.jwt.secret) {
          console.error('JWT_SECRET not configured');
          return res
            .status(500)
            .json({ error: 'Server nicht korrekt konfiguriert (JWT_SECRET fehlt)' });
        }

        const dbConfig = {
          host: host.trim(),
          user: user.trim(),
          password: password || '',
          database: database.trim(),
          port: parseInt(port || '3306', 10),
        };

        if (ssl) {
          dbConfig.ssl = { rejectUnauthorized: false };
        }

        const { encryptToken } = await import('../../utils/crypto.js');
        const json = JSON.stringify(dbConfig);
        const token = encryptToken(json);

        console.log('Encrypted manual DB token for:', {
          host: dbConfig.host,
          database: dbConfig.database,
        });
        console.log('[encrypt_db_token] Generated token length:', token.length);
        console.log('[encrypt_db_token] Token first 50 chars:', token.substring(0, 50));
        await logInlineAdminAction(req, 'Manuellen DB-Token verschlüsselt', {
          host: dbConfig.host,
          database: dbConfig.database,
        });
        return res.json({ token });
      }

      case 'export_mysql_as_json': {
        const dbPool = req.db || db;
        const [tables] = await dbPool.execute('SHOW TABLES');
        const exportData = {};

        for (const table of tables) {
          const tableName = Object.values(table)[0];
          const [rows] = await dbPool.execute(`SELECT * FROM \`${tableName}\``);
          exportData[tableName] = rows;
        }

        console.log(
          `[export] Exported ${Object.keys(exportData).length} tables from ${req.db ? 'tenant' : 'master'} database`,
        );
        await logInlineAdminAction(req, 'MySQL nach JSON exportiert', {
          tableCount: Object.keys(exportData).length,
        });
        return res.json(exportData);
      }

      case 'check': {
        const dbPool = req.db || db;
        const issues = [];

        try {
          const [doctors] = await dbPool.execute('SELECT id, name FROM Doctor');
          const [shifts] = await dbPool.execute(
            'SELECT id, doctor_id, date, position, note, created_date FROM ShiftEntry',
          );
          const [staffing] = await dbPool.execute(
            'SELECT id, doctor_id, year, month FROM StaffingPlanEntry',
          );
          const [workplaces] = await dbPool.execute('SELECT id, name FROM Workplace');

          const doctorIds = new Set(doctors.map((doctor) => doctor.id));
          const validPositions = new Set([
            'Verfügbar',
            'Frei',
            'Krank',
            'Urlaub',
            'Dienstreise',
            'Nicht verfügbar',
            'Sonstiges',
            ...workplaces.map((workplace) => workplace.name),
          ]);

          shifts.forEach((shift) => {
            if (!doctorIds.has(shift.doctor_id)) {
              issues.push({
                type: 'orphaned_shift',
                id: shift.id,
                description: `Schicht am ${shift.date} referenziert nicht existierenden Arzt (${shift.doctor_id})`,
              });
            }
            if (!validPositions.has(shift.position)) {
              issues.push({
                type: 'orphaned_position',
                id: shift.id,
                description: `Schicht am ${shift.date} hat unbekannte Position "${shift.position}"`,
              });
            }
          });

          staffing.forEach((entry) => {
            if (!doctorIds.has(entry.doctor_id)) {
              issues.push({
                type: 'orphaned_staffing',
                id: entry.id,
                description: `Stellenplan ${entry.month}/${entry.year} referenziert nicht existierenden Arzt (${entry.doctor_id})`,
              });
            }
          });

          const checkDuplicates = (entityName, items, keyFields, tableName) => {
            const map = new Map();
            items.forEach((item) => {
              const key = keyFields.map((field) => item[field]).join('|');
              if (!map.has(key)) map.set(key, []);
              map.get(key).push(item);
            });

            for (const [key, group] of map.entries()) {
              if (group.length > 1) {
                group.sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0));
                const toDelete = group.slice(1);
                issues.push({
                  type: `duplicate_${entityName.toLowerCase()}`,
                  ids: toDelete.map((item) => item.id),
                  table: tableName,
                  count: group.length,
                  description: `${group.length} doppelte ${entityName} Einträge (${key})`,
                });
              }
            }
          };

          checkDuplicates('ShiftEntry', shifts, ['doctor_id', 'date', 'position'], 'ShiftEntry');
          checkDuplicates('Doctor', doctors, ['name'], 'Doctor');
          checkDuplicates('Workplace', workplaces, ['name'], 'Workplace');
          checkDuplicates(
            'StaffingPlanEntry',
            staffing,
            ['doctor_id', 'year', 'month'],
            'StaffingPlanEntry',
          );

          console.log(
            `[check] Found ${issues.length} issues in ${req.db ? 'tenant' : 'master'} database`,
          );
          await logInlineAdminAction(req, 'Integritätsprüfung ausgeführt', {
            issueCount: issues.length,
          });

          return res.json({
            issues,
            dataSource: req.db ? 'tenant' : 'master',
            stats: {
              doctors: doctors.length,
              shifts: shifts.length,
              staffing: staffing.length,
              workplaces: workplaces.length,
            },
          });
        } catch (error) {
          console.error('[check] Error:', error.message);
          return res.status(500).json({ error: `Fehler bei Integritätsprüfung: ${error.message}` });
        }
      }

      case 'repair': {
        const dbPool = req.db || db;
        const { issuesToFix } = data || {};
        const results = [];

        if (!issuesToFix || issuesToFix.length === 0) {
          return res.json({
            message: 'Keine Probleme ausgewählt',
            results: [],
          });
        }

        const userEmail = req.user?.email || 'unknown';
        const timestamp = new Date().toISOString();

        for (const issue of issuesToFix) {
          try {
            if (issue.type === 'orphaned_shift' || issue.type === 'orphaned_position') {
              const [rows] = await dbPool.execute('SELECT * FROM ShiftEntry WHERE id = ?', [
                issue.id,
              ]);
              await dbPool.execute('DELETE FROM ShiftEntry WHERE id = ?', [issue.id]);
              console.log(
                `[AUDIT][DELETE][REPAIR] ${timestamp} | User: ${userEmail} | Table: ShiftEntry | ID: ${issue.id} | Type: ${issue.type} | Data: ${JSON.stringify(rows[0] || null)}`,
              );
              results.push(`✓ Gelöscht: ShiftEntry ${issue.id}`);
            } else if (issue.type === 'orphaned_staffing') {
              const [rows] = await dbPool.execute('SELECT * FROM StaffingPlanEntry WHERE id = ?', [
                issue.id,
              ]);
              await dbPool.execute('DELETE FROM StaffingPlanEntry WHERE id = ?', [issue.id]);
              console.log(
                `[AUDIT][DELETE][REPAIR] ${timestamp} | User: ${userEmail} | Table: StaffingPlanEntry | ID: ${issue.id} | Type: ${issue.type} | Data: ${JSON.stringify(rows[0] || null)}`,
              );
              results.push(`✓ Gelöscht: StaffingPlanEntry ${issue.id}`);
            } else if (issue.type.startsWith('duplicate_')) {
              const table = issue.table || 'ShiftEntry';
              if (issue.ids && issue.ids.length > 0) {
                for (const id of issue.ids) {
                  const [rows] = await dbPool.execute(`SELECT * FROM \`${table}\` WHERE id = ?`, [
                    id,
                  ]);
                  await dbPool.execute(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
                  console.log(
                    `[AUDIT][DELETE][REPAIR] ${timestamp} | User: ${userEmail} | Table: ${table} | ID: ${id} | Type: ${issue.type} | Data: ${JSON.stringify(rows[0] || null)}`,
                  );
                }
                results.push(`✓ ${issue.ids.length} Duplikate gelöscht aus ${table}`);
              }
            }
          } catch (error) {
            results.push(`✗ Fehler: ${error.message}`);
          }
        }

        console.log(
          `[AUDIT][REPAIR] ${timestamp} | User: ${userEmail} | Processed ${issuesToFix.length} issues, results:`,
          results,
        );

        const dbPoolForLog = req.db || db;
        await writeAuditLog(dbPoolForLog, {
          level: 'audit',
          source: 'DB-Reparatur',
          message: `${results.filter((result) => result.startsWith('✓')).length} Einträge repariert/gelöscht von ${userEmail}`,
          details: { issues: issuesToFix.length, results, timestamp },
          userEmail,
        });

        return res.json({
          message: `${results.filter((result) => result.startsWith('✓')).length} Probleme behoben`,
          results,
        });
      }

      case 'wipe_database': {
        const dbPool = req.db || db;
        const [tables] = await dbPool.execute('SHOW TABLES');

        const wipedTables = [];
        for (const table of tables) {
          const tableName = Object.values(table)[0];
          if (tableName === 'User' || tableName === 'app_users' || tableName === 'db_tokens') {
            continue;
          }
          const [countRows] = await dbPool.execute(`SELECT COUNT(*) as cnt FROM \`${tableName}\``);
          const rowCount = countRows[0]?.cnt || 0;
          await dbPool.execute(`DELETE FROM \`${tableName}\``);
          if (rowCount > 0) {
            wipedTables.push({ table: tableName, deletedRows: rowCount });
          }
        }

        const wipeTimestamp = new Date().toISOString();
        const wipeUser = req.user?.email || 'unknown';
        console.log(
          `[AUDIT][DELETE][WIPE] ${wipeTimestamp} | User: ${wipeUser} | Target: ${req.db ? 'tenant' : 'master'} | Tables: ${JSON.stringify(wipedTables)}`,
        );

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
            details: {
              target: req.db ? 'tenant' : 'master',
              wiped_tables: wipedTables,
              timestamp: wipeTimestamp,
            },
            userEmail: wipeUser,
          });
        } catch (error) {
          console.error('[AUDIT] Failed to write wipe audit log:', error.message);
        }
        return res.json({
          message: 'Database wiped successfully',
          warning: 'User/Token tables preserved',
          dataSource: req.db ? 'tenant' : 'master',
        });
      }

      case 'register_change': {
        const { count } = data || {};
        console.log(`Change registered: ${count || 1} changes`);
        await logInlineAdminAction(req, 'Änderungen registriert', { count: count || 1 });
        return res.json({
          success: true,
          message: 'Change registered',
          count: count || 1,
        });
      }

      case 'perform_auto_backup': {
        console.log('Auto-backup requested - not needed in Railway (MySQL handles backups)');
        await logInlineAdminAction(req, 'Automatisches Backup angefordert', { skipped: true });
        return res.json({
          success: true,
          message: 'Backup not needed - Railway MySQL has automatic backups',
          skipped: true,
        });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (error) {
    next(error);
  }
});

router.post('/wish-reminder/check', async (req, res, next) => {
  try {
    const user = verifyInlineAdmin(req, res);
    if (!user) return;

    const dbPool = req.db || db;
    const result = await checkAndSendWishReminders(dbPool, 'manual');

    await logInlineAdminAction(req, 'Wunsch-Erinnerungen geprüft', {
      summary: {
        sent: result?.sent ?? null,
        checked: result?.checked ?? null,
      },
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
