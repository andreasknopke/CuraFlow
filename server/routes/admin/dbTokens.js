import express from 'express';
import crypto from 'crypto';
import { db } from '../../db/pool.js';
import { writeAuditLog } from '../dbProxy.js';
import {
  ensureDbTokensTable,
  filterTokensByTenantAccess,
  getUserTenantAccess,
} from '../../utils/tenantAccess.js';

const router = express.Router();

router.get('/db-tokens', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);

    const { found, access } = await getUserTenantAccess(db, req.user.sub);
    if (!found) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    if (!access.isValid) {
      return res.status(403).json({ error: 'Mandantenzugriff fehlerhaft konfiguriert' });
    }

    const [rows] = await db.execute(`
      SELECT id, name, host, db_name, description, is_active, created_by, created_date, updated_date
      FROM db_tokens
      ORDER BY name ASC
    `);

    const filteredRows = filterTokensByTenantAccess(rows, access);

    const tokens = filteredRows.map((row) => ({
      ...row,
      is_active: Boolean(row.is_active),
    }));

    res.json(tokens);
  } catch (error) {
    next(error);
  }
});

router.get('/db-tokens/:id', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);

    const [rows] = await db.execute('SELECT * FROM db_tokens WHERE id = ?', [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Token nicht gefunden' });
    }

    const token = { ...rows[0], is_active: Boolean(rows[0].is_active) };

    res.json(token);
  } catch (error) {
    next(error);
  }
});

router.get('/db-tokens/active/current', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);

    const [rows] = await db.execute('SELECT * FROM db_tokens WHERE is_active = TRUE LIMIT 1');

    if (rows.length === 0) {
      return res.json(null);
    }

    const token = { ...rows[0], is_active: Boolean(rows[0].is_active) };

    res.json(token);
  } catch (error) {
    next(error);
  }
});

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

    const { encryptToken } = await import('../../utils/crypto.js');

    const dbConfig = {
      host: host.trim(),
      user: user.trim(),
      password: password || '',
      database: dbName.trim(),
      port: parseInt(port || '3306', 10),
    };

    if (ssl) {
      dbConfig.ssl = { rejectUnauthorized: false };
    }

    const encryptedToken = encryptToken(JSON.stringify(dbConfig));
    const id = crypto.randomUUID();

    await db.execute(
      `
      INSERT INTO db_tokens (id, name, token, host, db_name, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      [
        id,
        name.trim(),
        encryptedToken,
        host.trim(),
        dbName.trim(),
        description || null,
        req.user.email,
      ],
    );

    console.log(`[DB-Tokens] Created token "${name}" for ${host}/${dbName} by ${req.user.email}`);

    res.json({
      id,
      name: name.trim(),
      host: host.trim(),
      db_name: dbName.trim(),
      description: description || null,
      token: encryptedToken,
      created_by: req.user.email,
    });
  } catch (error) {
    next(error);
  }
});

router.put('/db-tokens/:id', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);

    const { name, description, credentials } = req.body;
    const { id } = req.params;

    const [existing] = await db.execute('SELECT * FROM db_tokens WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Token nicht gefunden' });
    }

    let encryptedToken = existing[0].token;
    let host = existing[0].host;
    let dbName = existing[0].db_name;

    if (credentials && credentials.host && credentials.user && credentials.database) {
      const { encryptToken } = await import('../../utils/crypto.js');

      const dbConfig = {
        host: credentials.host.trim(),
        user: credentials.user.trim(),
        password: credentials.password || '',
        database: credentials.database.trim(),
        port: parseInt(credentials.port || '3306', 10),
      };

      if (credentials.ssl) {
        dbConfig.ssl = { rejectUnauthorized: false };
      }

      encryptedToken = encryptToken(JSON.stringify(dbConfig));
      host = credentials.host.trim();
      dbName = credentials.database.trim();
    }

    await db.execute(
      `
      UPDATE db_tokens
      SET name = ?, token = ?, host = ?, db_name = ?, description = ?, updated_date = NOW()
      WHERE id = ?
    `,
      [
        name?.trim() || existing[0].name,
        encryptedToken,
        host,
        dbName,
        description ?? existing[0].description,
        id,
      ],
    );

    console.log(`[DB-Tokens] Updated token "${name || existing[0].name}" by ${req.user.email}`);

    res.json({ success: true, id });
  } catch (error) {
    next(error);
  }
});

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
    console.log(
      `[AUDIT][DELETE][DB-TOKEN] ${tokenTimestamp} | User: ${req.user.email} | Token: "${existing[0].name}" | ID: ${id}`,
    );

    await writeAuditLog(db, {
      level: 'audit',
      source: 'Mandantenverwaltung',
      message: `DB-Token "${existing[0].name}" gelöscht von ${req.user.email}`,
      details: { token_name: existing[0].name, token_id: id, timestamp: tokenTimestamp },
      userEmail: req.user.email,
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/db-tokens/:id/activate', async (req, res, next) => {
  try {
    await ensureDbTokensTable(db);

    const { id } = req.params;

    const [existing] = await db.execute('SELECT * FROM db_tokens WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Token nicht gefunden' });
    }

    await db.execute('UPDATE db_tokens SET is_active = FALSE');
    await db.execute('UPDATE db_tokens SET is_active = TRUE WHERE id = ?', [id]);

    console.log(`[DB-Tokens] Activated token "${existing[0].name}" by ${req.user.email}`);

    res.json({
      success: true,
      token: existing[0].token,
      name: existing[0].name,
      host: existing[0].host,
      db_name: existing[0].db_name,
    });
  } catch (error) {
    next(error);
  }
});

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

router.post('/db-tokens/test', async (req, res, next) => {
  try {
    const { credentials, token } = req.body;

    let dbConfig;

    if (credentials) {
      dbConfig = {
        host: credentials.host?.trim(),
        user: credentials.user?.trim(),
        password: credentials.password || '',
        database: credentials.database?.trim(),
        port: parseInt(credentials.port || '3306', 10),
      };
    } else if (token) {
      const { parseDbToken } = await import('../../utils/crypto.js');
      dbConfig = parseDbToken(token);
    } else {
      return res.status(400).json({ error: 'Credentials oder Token erforderlich' });
    }

    if (!dbConfig || !dbConfig.host || !dbConfig.user || !dbConfig.database) {
      return res.status(400).json({ error: 'Ungültige Zugangsdaten' });
    }

    const { createPool } = await import('mysql2/promise');

    const testPool = createPool({
      host: dbConfig.host,
      port: dbConfig.port || 3306,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: 1,
      connectTimeout: 10000,
    });

    try {
      await testPool.execute('SELECT 1 as test');
      await testPool.end();

      res.json({
        success: true,
        message: 'Verbindung erfolgreich',
        host: dbConfig.host,
        database: dbConfig.database,
      });
    } catch (connectionError) {
      await testPool.end().catch(() => {});
      res.status(400).json({
        success: false,
        error: `Verbindung fehlgeschlagen: ${connectionError.message}`,
      });
    }
  } catch (error) {
    next(error);
  }
});

export default router;
