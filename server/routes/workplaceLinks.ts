import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Request, Response, NextFunction } from 'express';
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
import { authMiddleware } from './auth.js';
import { requirePermission } from '../utils/permissions.js';
import { parseDbToken } from '../utils/crypto.js';
import { resolveTenantIdFromToken } from '../utils/tenantGroups.js';
import {
  listWorkplaceLinkGroups,
  loadLinkedWorkplacesForTenant,
} from '../utils/workplaceLinks.js';

const router = express.Router();

router.use(authMiddleware);

type ExtendedRequest = Request & {
  user?: { sub?: string; role?: string; doctor_id?: string; [key: string]: unknown };
};

interface TokenRow extends RowDataPacket {
  id: string;
  name?: string;
  token: string;
}

interface PartnerShiftRow {
  date: string;
  position: string;
  start_time: string | null;
  end_time: string | null;
  doctor_name: string | null;
  timeslot_id?: string | null;
}

interface PartnerShiftResult {
  date: string | null;
  position: string;
  start_time: string | null;
  end_time: string | null;
  doctor_name: string;
}

interface TimeslotRow extends RowDataPacket {
  id: string;
  start_time?: string;
  end_time?: string;
}

function handleError(res: Response, error: unknown): void {
  if (error && (error as { status?: number }).status) {
    res.status((error as { status: number }).status).json({ error: (error as Error).message });
    return;
  }
  console.error('[workplace-links]', error);
  res.status(500).json({ error: 'Interner Fehler' });
}

function createHttpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

async function loadTenantTokenById(tenantId: string): Promise<TokenRow | null> {
  const [rows] = await db.execute('SELECT * FROM db_tokens WHERE id = ? LIMIT 1', [String(tenantId)]) as [TokenRow[], unknown];
  return rows[0] || null;
}

async function withTenantDb<T>(token: TokenRow, callback: (pool: Pool, token: TokenRow) => Promise<T>): Promise<T> {
  let pool: Pool | null = null;
  try {
    const config = parseDbToken(token.token);
    if (!config || !config.host || !config.database) {
      throw createHttpError(422, `Ungültige Mandanten-Konfiguration für ${token.name || token.id}`);
    }
    pool = createPool({
      host: config.host as string,
      port: parseInt(String(config.port || '3306'), 10),
      user: config.user as string,
      password: config.password as string,
      database: config.database as string,
      ssl: (config.ssl as Record<string, unknown>) || undefined,
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
 * Resolves start_time/end_time from WorkplaceTimeslot when ShiftEntry's
 * own columns are NULL (timeslot-based schedules), using a separate
 * lookup query instead of a LEFT JOIN to avoid issues when the
 * WorkplaceTimeslot table does not exist in the partner tenant.
 * Read-only, no employee ids or other fields are exposed.
 */
async function fetchPartnerShifts(
  token: TokenRow,
  workplaceNames: string[],
  from: string | undefined,
  to: string | undefined
): Promise<PartnerShiftResult[]> {
  if (workplaceNames.length === 0) return [];
  return withTenantDb(token, async (pool) => {
    const placeholders = workplaceNames.map(() => '?').join(',');
    const params: (string | number)[] = [...workplaceNames];
    const dateFilter: string[] = [];
    if (from) { dateFilter.push('s.date >= ?'); params.push(from); }
    if (to) { dateFilter.push('s.date <= ?'); params.push(to); }
    const dateWhere = dateFilter.length > 0 ? `AND ${dateFilter.join(' AND ')}` : '';

    const [rows] = await pool.execute(
      `SELECT s.date, s.position, s.start_time, s.end_time, s.timeslot_id, d.name AS doctor_name
         FROM ShiftEntry s
         LEFT JOIN Doctor d ON d.id = s.doctor_id
        WHERE s.position IN (${placeholders})
          ${dateWhere}
        ORDER BY s.date ASC`,
      params as (string | number)[]
    ) as [(PartnerShiftRow & RowDataPacket)[], unknown];

    // Collect distinct timeslot_ids that need time resolution
    const timeslotIds = rows
      .filter((r) => !r.start_time && r.timeslot_id)
      .map((r) => String(r.timeslot_id))
      .filter(Boolean);
    const uniqueTsIds = [...new Set(timeslotIds)];

    // Look up timeslot times in a separate query (safe — no JOIN = no crash on missing table)
    const timeslotMap = new Map<string, TimeslotRow>();
    if (uniqueTsIds.length > 0) {
      try {
        const tsPlaceholders = uniqueTsIds.map(() => '?').join(',');
        const [tsRows] = await pool.execute(
          `SELECT id, start_time, end_time FROM WorkplaceTimeslot WHERE id IN (${tsPlaceholders})`,
          uniqueTsIds
        ) as [TimeslotRow[], unknown];
        for (const ts of tsRows) {
          timeslotMap.set(String(ts.id), ts);
        }
      } catch {
        // WorkplaceTimeslot table does not exist — no times to resolve
      }
    }

    // Fill in missing start_time/end_time from the timeslot lookup
    return rows.map((r) => {
      let startTime: string | null = r.start_time;
      let endTime: string | null = r.end_time;
      if (!startTime && r.timeslot_id && timeslotMap.has(String(r.timeslot_id))) {
        const ts = timeslotMap.get(String(r.timeslot_id))!;
        if (ts.start_time) startTime = ts.start_time;
        if (ts.end_time) endTime = ts.end_time;
      }
      return {
        date: r.date,
        position: r.position,
        start_time: startTime,
        end_time: endTime,
        doctor_name: r.doctor_name || '',
      };
    });
  });
}

/**
 * Fetch the distinct Workplace names of a tenant — used by the admin UI to
 * offer a dropdown instead of free-text entry.
 */
async function fetchTenantWorkplaceNames(token: TokenRow): Promise<string[]> {
  return withTenantDb(token, async (pool) => {
    try {
      const [rows] = await pool.execute('SELECT name FROM Workplace WHERE is_active = 1 ORDER BY name ASC') as [RowDataPacket[], unknown];
      return rows.map((r) => String(r.name));
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_NO_SUCH_TABLE') return [];
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
router.get('/visible-links', async (req: Request, res: Response): Promise<void> => {
  try {
    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token'] as string | undefined);
    if (!activeTenantId) {
      res.json({ linkedWorkplaces: {}, tenantId: null });
      return;
    }

    const linksByOwnName = await loadLinkedWorkplacesForTenant(db, activeTenantId);
    if (linksByOwnName.size === 0) {
      res.json({ linkedWorkplaces: {}, tenantId: activeTenantId });
      return;
    }

    const { from, to } = req.query as Record<string, unknown>;

    // Group partner workplace names by tenant to minimize DB connections.
    const namesByTenant = new Map<string, Set<string>>();
    for (const partners of linksByOwnName.values()) {
      for (const partner of partners) {
        const set = namesByTenant.get(partner.tenant_id) || new Set<string>();
        set.add(partner.workplace_name);
        namesByTenant.set(partner.tenant_id, set);
      }
    }

    const shiftsByTenant = new Map<string, Map<string, { date: string | null; doctor_name: string; start_time: string | null; end_time: string | null }[]>>(); // tenantId -> Map(workplaceName -> shifts[])
    for (const [tenantId, namesSet] of namesByTenant.entries()) {
      const byName = new Map<string, { date: string | null; doctor_name: string; start_time: string | null; end_time: string | null }[]>();
      try {
        const token = await loadTenantTokenById(tenantId);
        if (token) {
          const rows = await fetchPartnerShifts(token, [...namesSet], from as string | undefined, to as string | undefined);
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
        console.error(`[workplace-links] Failed to load partner shifts for tenant ${tenantId}:`, (err as Error).message);
      }
      shiftsByTenant.set(tenantId, byName);
    }

    const linkedWorkplaces: Record<string, Record<string, unknown>[]> = {};
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

router.get('/', requirePermission('can_manage_workplace_links'), async (req: Request, res: Response): Promise<void> => {
  try {
    const groups = await listWorkplaceLinkGroups(db);
    res.json({ groups });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', requirePermission('can_manage_workplace_links'), async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const { name, description } = body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Name ist erforderlich' });
      return;
    }
    const [result] = await db.execute(
      'INSERT INTO workplace_link_group (name, description) VALUES (?, ?)',
      [name.trim(), description ? String(description).trim() : null]
    ) as [{ insertId: number }, unknown];
    res.status(201).json({
      group: {
        id: Number(result.insertId),
        name: name.trim(),
        description: description ? String(description).trim() : null,
        is_active: true,
        members: [],
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/:groupId', requirePermission('can_manage_workplace_links'), async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const { name, description, is_active } = body;
    const fields: string[] = [];
    const params: (string | number)[] = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description ? String(description).trim() : ''); }
    if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (fields.length === 0) { res.status(400).json({ error: 'Keine Änderungen angegeben' }); return; }
    params.push(req.params.groupId as string);
    await db.execute(`UPDATE workplace_link_group SET ${fields.join(', ')} WHERE id = ?`, params as (string | number)[]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:groupId', requirePermission('can_manage_workplace_links'), async (req: Request, res: Response): Promise<void> => {
  try {
    await db.execute('DELETE FROM workplace_link_group WHERE id = ?', [req.params.groupId]);
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:groupId/members', requirePermission('can_manage_workplace_links'), async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const { tenant_id, workplace_name } = body;
    if (!tenant_id || !workplace_name || !String(workplace_name).trim()) {
      res.status(400).json({ error: 'tenant_id und workplace_name sind erforderlich' });
      return;
    }
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO workplace_link_member (id, link_group_id, tenant_id, workplace_name)
       VALUES (?, ?, ?, ?)`,
      [id, req.params.groupId, String(tenant_id), String(workplace_name).trim()]
    );
    res.status(201).json({ id });
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Dieser Arbeitsplatz ist in diesem Verbund bereits verknüpft' });
      return;
    }
    handleError(res, err);
  }
});

router.delete('/:groupId/members/:memberId', requirePermission('can_manage_workplace_links'), async (req: Request, res: Response): Promise<void> => {
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
router.get('/tenant-workplaces/:tenantId', requirePermission('can_manage_workplace_links'), async (req: Request, res: Response): Promise<void> => {
  try {
    const token = await loadTenantTokenById(req.params.tenantId as string);
    if (!token) { res.status(404).json({ error: 'Mandant nicht gefunden' }); return; }
    const names = await fetchTenantWorkplaceNames(token);
    res.json({ names });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
