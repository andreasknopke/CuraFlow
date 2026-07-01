/**
 * Routes for workplace_link_group (read-only cross-tenant staffing mirror).
 *
 * Use case: a "CT" workplace in the Radiology tenant and "CT1"/"CT2"
 * workplaces in the MTR tenant are the same physical room. This feature
 * lets one tenant's day view show a read-only staffing summary (name +
 * time range) of the linked workplace(s) in the other tenant(s) — no
 * shared storage, no writing across tenants.
 *
 * Permission model:
 *  - link management (CRUD groups/members) → master admin only
 *  - reading the partner staffing feed (/visible-links) → any authenticated
 *    user of a tenant that participates in a link. There is no per-user
 *    allow-list: visibility is entirely scoped by which links a master
 *    admin has configured, and only the linked workplace's name + the
 *    assigned person's name/time range are exposed (nothing else).
 */
import express from 'express';
import crypto from 'crypto';
import { createPool } from 'mysql2/promise';
import { db } from '../index.js';
import { authMiddleware, adminMiddleware } from './auth.js';
import { parseDbToken } from '../utils/crypto.js';
import { resolveTenantIdFromToken } from '../utils/tenantGroups.js';
import {
  listWorkplaceLinkGroups,
  loadLinkedWorkplacesForTenant,
} from '../utils/workplaceLinks.js';

const router = express.Router();

router.use(authMiddleware);

function handleError(res, error) {
  if (error && error.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error('[workplace-links]', error);
  return res.status(500).json({ error: 'Interner Fehler' });
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function loadTenantTokenById(tenantId) {
  const [rows] = await db.execute('SELECT * FROM db_tokens WHERE id = ? LIMIT 1', [String(tenantId)]);
  return rows[0] || null;
}

async function withTenantDb(token, callback) {
  let pool = null;
  try {
    const config = parseDbToken(token.token);
    if (!config || !config.host || !config.database) {
      throw createHttpError(422, `Ungültige Mandanten-Konfiguration für ${token.name || token.id}`);
    }
    pool = createPool({
      host: config.host,
      port: parseInt(config.port || '3306', 10),
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl || undefined,
      waitForConnections: true,
      connectionLimit: 2,
      queueLimit: 0,
      dateStrings: true,
      timezone: '+00:00',
      connectTimeout: 10000,
    });
    return await callback(pool, token);
  } finally {
    if (pool) {
      await pool.end().catch(() => {});
    }
  }
}

/**
 * Load ShiftEntry rows for the given workplace names (by exact position
 * match) from a partner tenant, joined with the local Doctor name.
 * Tries to resolve start_time/end_time from WorkplaceTimeslot when
 * ShiftEntry's own columns are NULL (timeslot-based schedules).
 * Falls back gracefully if the WorkplaceTimeslot table does not exist
 * in the partner tenant.
 * Read-only, no employee ids or other fields are exposed.
 */
async function fetchPartnerShifts(token, workplaceNames, from, to) {
  if (workplaceNames.length === 0) return [];
  return withTenantDb(token, async (pool) => {
    const placeholders = workplaceNames.map(() => '?').join(',');
    const params = [...workplaceNames];
    const dateFilter = [];
    if (from) { dateFilter.push('s.date >= ?'); params.push(from); }
    if (to) { dateFilter.push('s.date <= ?'); params.push(to); }
    const dateWhere = dateFilter.length > 0 ? `AND ${dateFilter.join(' AND ')}` : '';
    let rows;
    try {
      // Attempt JOIN with WorkplaceTimeslot to resolve times from slot-based schedules
      [rows] = await pool.execute(
        `SELECT s.date, s.position,
                COALESCE(s.start_time, wt.start_time) AS start_time,
                COALESCE(s.end_time, wt.end_time) AS end_time,
                d.name AS doctor_name
           FROM ShiftEntry s
           LEFT JOIN Doctor d ON d.id = s.doctor_id
           LEFT JOIN WorkplaceTimeslot wt ON wt.id = s.timeslot_id
          WHERE s.position IN (${placeholders})
            ${dateWhere}
          ORDER BY s.date ASC`,
        params
      );
    } catch (joinErr) {
      // Fallback: WorkplaceTimeslot table may not exist — read ShiftEntry columns directly
      [rows] = await pool.execute(
        `SELECT s.date, s.position, s.start_time, s.end_time, d.name AS doctor_name
           FROM ShiftEntry s
           LEFT JOIN Doctor d ON d.id = s.doctor_id
          WHERE s.position IN (${placeholders})
            ${dateWhere}
          ORDER BY s.date ASC`,
        params
      );
    }
    return rows;
  });
}

/**
 * Fetch the distinct Workplace names of a tenant — used by the admin UI to
 * offer a dropdown instead of free-text entry.
 */
async function fetchTenantWorkplaceNames(token) {
  return withTenantDb(token, async (pool) => {
    try {
      const [rows] = await pool.execute('SELECT name FROM Workplace WHERE is_active = 1 ORDER BY name ASC');
      return rows.map((r) => r.name);
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') return [];
      throw err;
    }
  });
}

// ============================================================
//  READ-ONLY PARTNER STAFFING FEED (any authenticated tenant user)
// ============================================================

// GET /visible-links?from=&to=
// Returns, for every own workplace that participates in a link, the linked
// partner workplace(s) (other tenant) with their staffing in the date range.
router.get('/visible-links', async (req, res) => {
  try {
    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token']);
    if (!activeTenantId) {
      return res.json({ linkedWorkplaces: {}, tenantId: null });
    }

    const linksByOwnName = await loadLinkedWorkplacesForTenant(db, activeTenantId);
    if (linksByOwnName.size === 0) {
      return res.json({ linkedWorkplaces: {}, tenantId: activeTenantId });
    }

    const { from, to } = req.query;

    // Group partner workplace names by tenant to minimize DB connections.
    const namesByTenant = new Map();
    for (const partners of linksByOwnName.values()) {
      for (const partner of partners) {
        const set = namesByTenant.get(partner.tenant_id) || new Set();
        set.add(partner.workplace_name);
        namesByTenant.set(partner.tenant_id, set);
      }
    }

    const shiftsByTenant = new Map(); // tenantId -> Map(workplaceName -> shifts[])
    for (const [tenantId, namesSet] of namesByTenant.entries()) {
      const byName = new Map();
      try {
        const token = await loadTenantTokenById(tenantId);
        if (token) {
          const rows = await fetchPartnerShifts(token, [...namesSet], from, to);
          for (const row of rows) {
            const list = byName.get(row.position) || [];
            list.push({
              date: row.date ? String(row.date).slice(0, 10) : null,
              doctor_name: row.doctor_name || 'Unbekannt',
              start_time: row.start_time,
              end_time: row.end_time,
            });
            byName.set(row.position, list);
          }
        }
      } catch (err) {
        console.error(`[workplace-links] Failed to load partner shifts for tenant ${tenantId}:`, err.message);
      }
      shiftsByTenant.set(tenantId, byName);
    }

    const linkedWorkplaces = {};
    for (const [ownName, partners] of linksByOwnName.entries()) {
      linkedWorkplaces[ownName] = partners.map((partner) => ({
        tenant_id: partner.tenant_id,
        tenant_name: partner.tenant_name,
        workplace_name: partner.workplace_name,
        shifts: shiftsByTenant.get(partner.tenant_id)?.get(partner.workplace_name) || [],
      }));
    }

    res.json({ linkedWorkplaces, tenantId: activeTenantId });
  } catch (err) {
    handleError(res, err);
  }
});

// ============================================================
//  ADMIN CRUD (master admin only)
// ============================================================

router.get('/', adminMiddleware, async (req, res) => {
  try {
    const groups = await listWorkplaceLinkGroups(db);
    res.json({ groups });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', adminMiddleware, async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }
    const [result] = await db.execute(
      'INSERT INTO workplace_link_group (name, description) VALUES (?, ?)',
      [name.trim(), description?.trim() || null]
    );
    res.status(201).json({
      group: {
        id: Number(result.insertId),
        name: name.trim(),
        description: description?.trim() || null,
        is_active: true,
        members: [],
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/:groupId', adminMiddleware, async (req, res) => {
  try {
    const { name, description, is_active } = req.body || {};
    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description?.trim() || null); }
    if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (fields.length === 0) return res.status(400).json({ error: 'Keine Änderungen angegeben' });
    params.push(req.params.groupId);
    await db.execute(`UPDATE workplace_link_group SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:groupId', adminMiddleware, async (req, res) => {
  try {
    await db.execute('DELETE FROM workplace_link_group WHERE id = ?', [req.params.groupId]);
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:groupId/members', adminMiddleware, async (req, res) => {
  try {
    const { tenant_id, workplace_name } = req.body || {};
    if (!tenant_id || !workplace_name || !String(workplace_name).trim()) {
      return res.status(400).json({ error: 'tenant_id und workplace_name sind erforderlich' });
    }
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO workplace_link_member (id, link_group_id, tenant_id, workplace_name)
       VALUES (?, ?, ?, ?)`,
      [id, req.params.groupId, String(tenant_id), String(workplace_name).trim()]
    );
    res.status(201).json({ id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Dieser Arbeitsplatz ist in diesem Verbund bereits verknüpft' });
    }
    handleError(res, err);
  }
});

router.delete('/:groupId/members/:memberId', adminMiddleware, async (req, res) => {
  try {
    await db.execute(
      'DELETE FROM workplace_link_member WHERE id = ? AND link_group_id = ?',
      [req.params.memberId, req.params.groupId]
    );
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// GET /tenant-workplaces/:tenantId — convenience lookup for the admin UI
// dropdown (lists the tenant's own Workplace names).
router.get('/tenant-workplaces/:tenantId', adminMiddleware, async (req, res) => {
  try {
    const token = await loadTenantTokenById(req.params.tenantId);
    if (!token) return res.status(404).json({ error: 'Mandant nicht gefunden' });
    const names = await fetchTenantWorkplaceNames(token);
    res.json({ names });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
