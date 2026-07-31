/**
 * Routes for Springerpool-Rotationen (rotation_group).
 *
 * This is a SEPARATE system from the cross-tenant Dienste (tenant_group).
 * Rotationen sind keine Dienste — they have their own tables, routes, and
 * permissions. See docs/features/SPRINGERPOOL_ROTATION_V2.md.
 *
 * Permission model:
 *  - read access  → user.allowed_rotation_groups includes :groupId, OR role='admin'
 *  - write access → user.rotation_admin_groups includes :groupId, OR role='admin'
 *  - group CRUD (create/delete) → master admin only
 *  - demand create → ward user (authMiddleware + own tenant check)
 *  - demand cancel → ward user (own) or rotation admin
 *
 * Membership roles in rotation_group_member:
 *  - 'pool'  → the Springerpool tenant (exactly one per group)
 *  - 'ward'  → a department tenant served by the pool (N per group)
 */
import express from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../index.js';
import { authMiddleware } from './auth.js';
import { requirePermission } from '../utils/permissions.js';
import type { UserRotationContext } from '../utils/rotationGroups.js';
import {
  loadUserRotationContext,
  listUserRotationGroups,
  loadRotationGroupMembers,
  resolvePoolTenantId,
  requireRotationGroupReadAccess,
  requireRotationGroupWriteAccess,
  resolveTenantIdFromToken,
  loadVisibleRotationGroupIdsForTenant,
  canWriteRotationGroup,
  getRotationAdminUserIds,
} from '../utils/rotationGroups.js';
import {
  ROTATION_DEMAND_WRITABLE_COLUMNS,
  assertNoOpenDemandForCell,
  assertNoOpenReturnRequestForAssignment,
  cancelReturnRequestOnAssignmentDelete,
  markDemandFulfilledForCell,
  reopenDemandOnAssignmentDelete,
} from '../utils/rotationDemand.js';
import { syncRotationAssignmentQualifications } from '../utils/rotationQualificationSync.js';
import { broadcastUserEvent, broadcastPlanUpdate, buildRealtimeScope } from '../utils/realtime.js';

const router = express.Router();

router.use(authMiddleware);

type AuthRequest = Request & { user?: Record<string, unknown> };

function handleError(res: Response, error: unknown): void {
  const err = error as Record<string, unknown> | null | undefined;
  if (err && err.status) {
    res.status(err.status as number).json({ error: err.message });
    return;
  }
  console.error('[rotations] Error:', error instanceof Error ? error.message : String(error));
  res.status(500).json({ error: 'Interner Serverfehler' });
}

async function loadCtx(req: AuthRequest, res: Response): Promise<UserRotationContext | null> {
  const ctx = await loadUserRotationContext(db, req.user?.sub as string | null | undefined);
  if (!ctx) {
    res.status(401).json({ error: 'Benutzer nicht gefunden' });
    return null;
  }
  return ctx;
}

// ============================================================
//  GROUP CRUD (master admin only)
// ============================================================

// GET / — list rotation groups the user can see
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    const groups = await listUserRotationGroups(db, ctx);
    res.json({ groups });
  } catch (err) {
    handleError(res, err);
  }
});

// POST / — create a rotation group (master admin only)
router.post('/', requirePermission('can_manage_groups'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Name ist erforderlich' });
      return;
    }
    const [result] = await db.execute(
      'INSERT INTO rotation_group (name, description) VALUES (?, ?)',
      [name.trim(), description?.trim() || null]
    ) as [Record<string, unknown>[], unknown];
    res.status(201).json({
      group: {
        id: Number((result as unknown as { insertId: number }).insertId),
        name: name.trim(),
        description: description?.trim() || null,
        is_active: true,
      },
    });
  } catch (err) {
    if ((err as Record<string, unknown>).code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Ein Rotationsverbund mit diesem Namen existiert bereits' });
      return;
    }
    handleError(res, err);
  }
});

// NOTE: GET/PATCH/DELETE /:groupId are registered at the END of this file
// to avoid shadowing named routes like /visible-rotations and /demands.
// Express matches routes in registration order, so /:groupId must come last.

// ============================================================
//  MEMBERS (master admin only)
// ============================================================

// GET /:groupId/members
router.get('/:groupId/members', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    await requireRotationGroupReadAccess(db, ctx, req.params.groupId as string);
    const members = await loadRotationGroupMembers(db, req.params.groupId as string);
    // Enrich with tenant name from db_tokens
    const tenantIds = members.map((m) => m.tenant_id);
    const tenantNames = new Map<string, string>();
    if (tenantIds.length > 0) {
      const placeholders = tenantIds.map(() => '?').join(',');
      const [tRows] = await db.execute(
        `SELECT id, name FROM db_tokens WHERE id IN (${placeholders})`,
        tenantIds
      ) as [Record<string, unknown>[], unknown];
      for (const t of tRows) {
        tenantNames.set(String(t.id), (t.name || t.id) as string);
      }
    }
    res.json({
      members: members.map((m) => ({
        tenant_id: m.tenant_id,
        role: m.role,
        name: tenantNames.get(m.tenant_id) || m.tenant_id,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:groupId/members (master admin only)
router.post('/:groupId/members', requirePermission('can_manage_groups'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenant_id, role } = req.body || {};
    if (!tenant_id) {
      res.status(400).json({ error: 'tenant_id ist erforderlich' });
      return;
    }
    const memberRole = role === 'pool' ? 'pool' : 'ward';
    // Enforce exactly one pool member per group
    if (memberRole === 'pool') {
      const existingPool = await resolvePoolTenantId(db, req.params.groupId as string);
      if (existingPool && String(existingPool) !== String(tenant_id)) {
        res.status(409).json({ error: 'Dieser Rotationsverbund hat bereits einen Springerpool-Mandanten' });
        return;
      }
    }
    await db.execute(
      'INSERT INTO rotation_group_member (group_id, tenant_id, role) VALUES (?, ?, ?)',
      [req.params.groupId as string, String(tenant_id), memberRole]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    if ((err as Record<string, unknown>).code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Mandant ist bereits Mitglied' });
      return;
    }
    handleError(res, err);
  }
});

// DELETE /:groupId/members/:tenantId (master admin only)
router.delete('/:groupId/members/:tenantId', requirePermission('can_manage_groups'), async (req: Request, res: Response): Promise<void> => {
  try {
    await db.execute(
      'DELETE FROM rotation_group_member WHERE group_id = ? AND tenant_id = ?',
      [req.params.groupId as string, String(req.params.tenantId)]
    );
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============================================================
//  ROTATION WORKPLACES (the rotation rows: Gyn1, Gyn2, Gyn3)
// ============================================================

// GET /:groupId/workplaces
router.get('/:groupId/workplaces', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    await requireRotationGroupReadAccess(db, ctx, req.params.groupId as string);
    const [rows] = await db.execute(
      `SELECT id, group_id, ward_tenant_id, name, timeslots_enabled, is_active
         FROM rotation_workplace
        WHERE group_id = ? AND is_active = 1
        ORDER BY name ASC`,
      [req.params.groupId as string]
    ) as [Record<string, unknown>[], unknown];
    res.json({
      workplaces: rows.map((r) => ({
        ...r,
        group_id: Number(r.group_id),
        timeslots_enabled: Boolean(r.timeslots_enabled),
        is_active: Boolean(r.is_active),
        canWrite: canWriteRotationGroup(ctx, Number(r.group_id)),
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:groupId/workplaces (rotation admin)
router.post('/:groupId/workplaces', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId as string);
    const { name, ward_tenant_id, timeslots_enabled } = req.body || {};
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Name ist erforderlich' });
      return;
    }
    if (!ward_tenant_id) {
      res.status(400).json({ error: 'ward_tenant_id ist erforderlich' });
      return;
    }
    // Verify ward_tenant_id is a ward member of this group
    const [memberRows] = await db.execute(
      "SELECT tenant_id FROM rotation_group_member WHERE group_id = ? AND tenant_id = ? AND role = 'ward'",
      [req.params.groupId as string, String(ward_tenant_id)]
    ) as [Record<string, unknown>[], unknown];
    if (memberRows.length === 0) {
      res.status(400).json({ error: 'Der Mandant ist keine Station in diesem Rotationsverbund' });
      return;
    }
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO rotation_workplace (id, group_id, ward_tenant_id, name, timeslots_enabled, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.params.groupId as string, String(ward_tenant_id), String(name).trim(),
       Boolean(timeslots_enabled) ? 1 : 0, (req as AuthRequest).user?.email || (req as AuthRequest).user?.sub || null]
    );
    res.status(201).json({
      workplace: {
        id,
        group_id: Number(req.params.groupId as string),
        ward_tenant_id: String(ward_tenant_id),
        name: String(name).trim(),
        timeslots_enabled: Boolean(timeslots_enabled),
        is_active: true,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /:groupId/workplaces/:workplaceId (rotation admin)
router.patch('/:groupId/workplaces/:workplaceId', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId as string);
    const { name, timeslots_enabled, is_active } = req.body || {};
    const fields: string[] = [];
    const values: unknown[] = [];
    if (name !== undefined) {
      if (!String(name).trim()) {
        res.status(400).json({ error: 'Name darf nicht leer sein' });
        return;
      }
      fields.push('name = ?');
      values.push(String(name).trim());
    }
    if (timeslots_enabled !== undefined) {
      fields.push('timeslots_enabled = ?');
      values.push(Boolean(timeslots_enabled) ? 1 : 0);
    }
    if (is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(Boolean(is_active) ? 1 : 0);
    }
    if (fields.length === 0) {
      res.status(400).json({ error: 'Keine Änderungen' });
      return;
    }
    values.push(req.params.workplaceId, req.params.groupId as string);
    await db.execute(
      `UPDATE rotation_workplace SET ${fields.join(', ')} WHERE id = ? AND group_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /:groupId/workplaces/:workplaceId (rotation admin)
router.delete('/:groupId/workplaces/:workplaceId', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId as string);
    await db.execute(
      'DELETE FROM rotation_workplace WHERE id = ? AND group_id = ?',
      [req.params.workplaceId, req.params.groupId as string]
    );
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============================================================
//  TIMESLOTS (Früh-/Mittel-/Spätdienst pro Rotation)
// ============================================================

// GET /:groupId/workplaces/:workplaceId/timeslots
router.get('/:groupId/workplaces/:workplaceId/timeslots', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    await requireRotationGroupReadAccess(db, ctx, req.params.groupId as string);
    const [rows] = await db.execute(
      `SELECT id, rotation_workplace_id, label, start_time, end_time, \`order\`
         FROM rotation_timeslot
        WHERE rotation_workplace_id = ?
        ORDER BY COALESCE(\`order\`, 0) ASC, start_time ASC`,
      [req.params.workplaceId]
    ) as [Record<string, unknown>[], unknown];
    res.json({
      timeslots: rows.map((r) => ({
        ...r,
        order: (r as Record<string, unknown>).order ?? 0,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:groupId/workplaces/:workplaceId/timeslots (rotation admin)
router.post('/:groupId/workplaces/:workplaceId/timeslots', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId as string);
    const { label, start_time, end_time, order } = req.body || {};
    if (!label || !start_time || !end_time) {
      res.status(400).json({ error: 'label, start_time und end_time sind erforderlich' });
      return;
    }
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO rotation_timeslot (id, rotation_workplace_id, label, start_time, end_time, \`order\`)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.params.workplaceId, String(label), String(start_time), String(end_time), Number(order) || 0]
    );
    res.status(201).json({
      timeslot: { id, rotation_workplace_id: req.params.workplaceId, label, start_time, end_time, order: Number(order) || 0 },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /:groupId/workplaces/:workplaceId/timeslots/:timeslotId (rotation admin)
router.patch('/:groupId/workplaces/:workplaceId/timeslots/:timeslotId', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId as string);
    const { label, start_time, end_time, order } = req.body || {};
    const fields: string[] = [];
    const values: unknown[] = [];
    if (label !== undefined) { fields.push('label = ?'); values.push(String(label)); }
    if (start_time !== undefined) { fields.push('start_time = ?'); values.push(String(start_time)); }
    if (end_time !== undefined) { fields.push('end_time = ?'); values.push(String(end_time)); }
    if (order !== undefined) { fields.push('`order` = ?'); values.push(Number(order) || 0); }
    if (fields.length === 0) {
      res.status(400).json({ error: 'Keine Änderungen' });
      return;
    }
    values.push(req.params.timeslotId, req.params.workplaceId);
    await db.execute(
      `UPDATE rotation_timeslot SET ${fields.join(', ')} WHERE id = ? AND rotation_workplace_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /:groupId/workplaces/:workplaceId/timeslots/:timeslotId (rotation admin)
router.delete('/:groupId/workplaces/:workplaceId/timeslots/:timeslotId', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId as string);
    await db.execute(
      'DELETE FROM rotation_timeslot WHERE id = ? AND rotation_workplace_id = ?',
      [req.params.timeslotId, req.params.workplaceId]
    );
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============================================================
//  VISIBLE ROTATIONS — the key scoping endpoint
// ============================================================

// GET /visible-rotations?from=&to=
// Returns rotation workplaces + assignments + demands scoped to the caller:
//   - Pool tenant: sees ALL workplaces + all assignments + all demands
//   - Ward tenant: sees ONLY workplaces with ward_tenant_id = active tenant
//                   + assignments for those + own demands
router.get('/visible-rotations', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;

    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token'] as string | undefined);
    if (!activeTenantId) {
      res.json({ workplaces: [], assignments: [], demands: [], tenantId: null, groupIds: [] });
      return;
    }

    const accessibleGroupIds = await loadVisibleRotationGroupIdsForTenant(db, ctx, activeTenantId);
    if (accessibleGroupIds.length === 0) {
      res.json({ workplaces: [], assignments: [], demands: [], tenantId: activeTenantId, groupIds: [] });
      return;
    }

    const { from, to } = req.query;
    const dateFilter: string[] = [];
    const dateParams: unknown[] = [];
    if (from) { dateFilter.push('a.date >= ?'); dateParams.push(from); }
    if (to) { dateFilter.push('a.date <= ?'); dateParams.push(to); }
    const dateWhere = dateFilter.length > 0 ? `AND ${dateFilter.join(' AND ')}` : '';

    const placeholders = accessibleGroupIds.map(() => '?').join(',');

    // Determine if the active tenant is the pool tenant in any group.
    // Pool tenants see all workplaces; ward tenants see only their own.
    const [poolRows] = await db.execute(
      `SELECT DISTINCT group_id FROM rotation_group_member
        WHERE tenant_id = ? AND role = 'pool' AND group_id IN (${placeholders})`,
      [activeTenantId, ...accessibleGroupIds]
    ) as [Record<string, unknown>[], unknown];
    const poolGroupIds = new Set((poolRows as Array<{ group_id: number }>).map((r) => Number(r.group_id)));
    const isPoolForAnyGroup = poolGroupIds.size > 0;

    // Load workplaces
    let workplaceWhere = `w.group_id IN (${placeholders}) AND w.is_active = 1`;
    const workplaceParams: unknown[] = [...accessibleGroupIds];
    // If the tenant is NOT a pool tenant in a group, restrict to own ward_tenant_id
    if (!isPoolForAnyGroup) {
      workplaceWhere += ' AND w.ward_tenant_id = ?';
      workplaceParams.push(activeTenantId);
    }
    const [workplaceRows] = await db.execute(
      `SELECT w.id, w.group_id, w.ward_tenant_id, w.name, w.timeslots_enabled
         FROM rotation_workplace w
        WHERE ${workplaceWhere}
        ORDER BY w.name ASC`,
      workplaceParams
    ) as [Record<string, unknown>[], unknown];

    // Load timeslots for these workplaces
    const wpIds = workplaceRows.map((r) => r.id);
    const timeslotsByWpId = new Map<string, Array<Record<string, unknown>>>();
    if (wpIds.length > 0) {
      const wpPlaceholders = wpIds.map(() => '?').join(',');
      const [tsRows] = await db.execute(
        `SELECT id, rotation_workplace_id, label, start_time, end_time, \`order\`
           FROM rotation_timeslot
          WHERE rotation_workplace_id IN (${wpPlaceholders})
          ORDER BY \`order\` ASC`,
        wpIds
      ) as [Record<string, unknown>[], unknown];
      for (const ts of tsRows) {
        const list = timeslotsByWpId.get(ts.rotation_workplace_id as string) || [];
        list.push({ id: ts.id, label: ts.label, start_time: ts.start_time, end_time: ts.end_time, order: (ts as Record<string, unknown>).order });
        timeslotsByWpId.set(ts.rotation_workplace_id as string, list);
      }
    }

    const workplaces = workplaceRows.map((r) => ({
      id: r.id,
      group_id: Number(r.group_id),
      ward_tenant_id: String(r.ward_tenant_id),
      name: r.name,
      timeslots_enabled: Boolean(r.timeslots_enabled),
      timeslots: timeslotsByWpId.get(String(r.id)) || [],
      canWrite: poolGroupIds.has(Number(r.group_id)) && canWriteRotationGroup(ctx, Number(r.group_id)),
      canDemand: canReadRotationGroupForDemand(ctx, Number(r.group_id)),
    }));

    // Load assignments for these workplaces in date range
    let assignments: Array<Record<string, unknown>> = [];
    if (wpIds.length > 0) {
      const wpPlaceholders = wpIds.map(() => '?').join(',');
      const [aRows] = await db.execute(
        `SELECT a.id, a.rotation_workplace_id, a.date, a.employee_id,
                a.timeslot_id, a.note,
                w.name AS workplace_name, w.group_id,
                COALESCE(e.first_name, e_direct.first_name) AS first_name,
                COALESCE(e.last_name, e_direct.last_name) AS last_name
           FROM rotation_assignment a
           JOIN rotation_workplace w ON w.id = a.rotation_workplace_id
           LEFT JOIN EmployeeTenantAssignment eta
                  ON eta.tenant_doctor_id COLLATE utf8mb4_general_ci = a.employee_id COLLATE utf8mb4_general_ci
           LEFT JOIN Employee e ON e.id = eta.employee_id
           LEFT JOIN Employee e_direct ON e_direct.id COLLATE utf8mb4_unicode_ci = a.employee_id COLLATE utf8mb4_unicode_ci
          WHERE a.rotation_workplace_id IN (${wpPlaceholders})
            ${dateWhere}
          ORDER BY a.date ASC, w.name ASC`,
        [...wpIds, ...dateParams]
      ) as [Record<string, unknown>[], unknown];
      assignments = aRows.map((r) => ({
        id: r.id,
        rotation_workplace_id: r.rotation_workplace_id,
        group_id: Number(r.group_id),
        date: r.date ? String(r.date).slice(0, 10) : null,
        employee_id: r.employee_id,
        employee_name: [r.first_name, r.last_name].filter(Boolean).join(' ') || `#${r.employee_id}`,
        timeslot_id: r.timeslot_id ? String(r.timeslot_id) : null,
        note: r.note || null,
        workplace_name: r.workplace_name,
        canManage: poolGroupIds.has(Number(r.group_id)) && canWriteRotationGroup(ctx, Number(r.group_id)),
      }));
    }

    // Load demands — ward tenants see only own; pool tenants see all in their groups
    let demands: Array<Record<string, unknown>> = [];
    if (wpIds.length > 0) {
      const wpPlaceholders = wpIds.map(() => '?').join(',');
      let demandWhere = `d.rotation_workplace_id IN (${wpPlaceholders})`;
      const demandParams: unknown[] = [...wpIds];
      if (!isPoolForAnyGroup) {
        demandWhere += ' AND d.ward_tenant_id = ?';
        demandParams.push(activeTenantId);
      }
      if (from) { demandWhere += ' AND d.date >= ?'; demandParams.push(from); }
      if (to) { demandWhere += ' AND d.date <= ?'; demandParams.push(to); }
      const [dRows] = await db.execute(
        `SELECT d.id, d.rotation_workplace_id, d.group_id, d.ward_tenant_id, d.date,
                d.timeslot_id, d.note, d.status, d.fulfilled_by_assignment_id,
                d.return_requested_assignment_id,
                d.offered_employee_id,
                e_offer.first_name AS offered_first, e_offer.last_name AS offered_last,
                w.name AS workplace_name, ts.label AS timeslot_label
           FROM rotation_demand d
           JOIN rotation_workplace w ON w.id = d.rotation_workplace_id
           LEFT JOIN rotation_timeslot ts ON ts.id = d.timeslot_id
           LEFT JOIN Employee e_offer ON e_offer.id COLLATE utf8mb4_unicode_ci = d.offered_employee_id COLLATE utf8mb4_unicode_ci
          WHERE ${demandWhere}
          ORDER BY d.date ASC`,
        demandParams
      ) as [Record<string, unknown>[], unknown];
      demands = dRows.map((r) => ({
        id: String(r.id),
        rotation_workplace_id: String(r.rotation_workplace_id),
        group_id: Number(r.group_id),
        ward_tenant_id: String(r.ward_tenant_id),
        date: r.date ? String(r.date).slice(0, 10) : null,
        timeslot_id: r.timeslot_id ? String(r.timeslot_id) : null,
        note: r.note || null,
        status: r.status,
        fulfilled_by_assignment_id: r.fulfilled_by_assignment_id ? String(r.fulfilled_by_assignment_id) : null,
        return_requested_assignment_id: r.return_requested_assignment_id ? String(r.return_requested_assignment_id) : null,
        offered_employee_id: r.offered_employee_id ? String(r.offered_employee_id) : null,
        offered_employee_name: [r.offered_first, r.offered_last].filter(Boolean).join(' ') || null,
        workplace_name: r.workplace_name,
        timeslot_label: r.timeslot_label || null,
        canManage: canWriteRotationGroup(ctx, Number(r.group_id)),
      }));
    }

    res.json({
      workplaces,
      assignments,
      demands,
      tenantId: activeTenantId,
      groupIds: accessibleGroupIds,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ============================================================
//  ASSIGNMENTS (Springer-Einsatz — Pool-Planer weist Springer zu)
// ============================================================

// POST /:groupId/assignments (rotation admin)
router.post('/:groupId/assignments', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId as string);
    const { rotation_workplace_id, date, employee_id, timeslot_id, note } = req.body || {};
    if (!rotation_workplace_id) {
      res.status(400).json({ error: 'rotation_workplace_id ist erforderlich' });
      return;
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date (YYYY-MM-DD) ist erforderlich' });
      return;
    }
    if (!employee_id) {
      res.status(400).json({ error: 'employee_id ist erforderlich' });
      return;
    }

    // Verify workplace belongs to this group
    const [wpRows] = await db.execute(
      'SELECT id FROM rotation_workplace WHERE id = ? AND group_id = ? AND is_active = 1',
      [String(rotation_workplace_id), req.params.groupId as string]
    ) as [Record<string, unknown>[], unknown];
    if (wpRows.length === 0) {
      res.status(404).json({ error: 'Rotation nicht gefunden' });
      return;
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO rotation_assignment (id, rotation_workplace_id, date, employee_id, timeslot_id, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, String(rotation_workplace_id), date, String(employee_id),
       timeslot_id ? String(timeslot_id) : null, note || null,
       (req as AuthRequest).user?.email || (req as AuthRequest).user?.sub || null]
    );

    // Auto-fulfil any open demand for this cell
    let fulfilledDemandId: string | null = null;
    try {
      fulfilledDemandId = await markDemandFulfilledForCell(db, {
        rotationWorkplaceId: String(rotation_workplace_id),
        date,
        timeslotId: timeslot_id || null,
        assignmentId: id,
      });
    } catch (demandErr) {
      console.error('[rotations] markDemandFulfilledForCell error:', (demandErr as Error).message);
    }

    // Inherit matching qualifications from the pool tenant into the ward tenant
    try {
      await syncRotationAssignmentQualifications({
        masterDb: db,
        groupId: req.params.groupId as string as string,
        rotationWorkplaceId: String(rotation_workplace_id),
        employeeId: String(employee_id),
        actor: (req as AuthRequest).user || null,
        buildRealtimeScope,
        broadcastPlanUpdate: broadcastPlanUpdate as (opts: { scope: unknown; entity: string; action: string; recordId: string; actor: unknown; }) => void,
      });
    } catch (qualErr) {
      console.error('[rotations] syncRotationAssignmentQualifications error:', (qualErr as Error).message);
    }

    res.status(201).json({
      id,
      ...(fulfilledDemandId ? { fulfilled_demand_id: fulfilledDemandId } : {}),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /:groupId/assignments/:assignmentId (rotation admin)
router.patch('/:groupId/assignments/:assignmentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId as string);
    const allowed = ['date', 'employee_id', 'timeslot_id', 'note'];
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      fields.push(`${key} = ?`);
      values.push(req.body[key]);
    }
    if (fields.length === 0) {
      res.status(400).json({ error: 'Keine Änderungen' });
      return;
    }
    values.push(req.params.assignmentId, req.params.groupId as string);
    await db.execute(
      `UPDATE rotation_assignment a
         JOIN rotation_workplace w ON w.id = a.rotation_workplace_id
        SET ${fields.join(', ')}
        WHERE a.id = ? AND w.group_id = ?`,
      values
    );

    // When the assigned Springer changes, re-inherit pool qualifications
    if (req.body.employee_id !== undefined) {
      try {
        const [aRows] = await db.execute(
          `SELECT a.employee_id, a.rotation_workplace_id
             FROM rotation_assignment a
             JOIN rotation_workplace w ON w.id = a.rotation_workplace_id
            WHERE a.id = ? AND w.group_id = ?
            LIMIT 1`,
          [req.params.assignmentId, req.params.groupId as string]
        ) as [Record<string, unknown>[], unknown];
        if (aRows.length > 0) {
          await syncRotationAssignmentQualifications({
            masterDb: db,
            groupId: req.params.groupId as string as string,
            rotationWorkplaceId: String(aRows[0].rotation_workplace_id),
            employeeId: String(aRows[0].employee_id),
            actor: (req as AuthRequest).user || null,
            buildRealtimeScope,
            broadcastPlanUpdate: broadcastPlanUpdate as (opts: { scope: unknown; entity: string; action: string; recordId: string; actor: unknown; }) => void,
          });
        }
      } catch (qualErr) {
        console.error('[rotations] syncRotationAssignmentQualifications (patch) error:', (qualErr as Error).message);
      }
    }

    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /:groupId/assignments/:assignmentId (rotation admin)
router.delete('/:groupId/assignments/:assignmentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId as string);
    // Reopen any demand fulfilled by this assignment
    try {
      const reopened = await reopenDemandOnAssignmentDelete(db, req.params.assignmentId as string);
      if (reopened > 0) {
        console.log(`[rotations] Reopened ${reopened} demand(s) for deleted assignment ${req.params.assignmentId}`);
      }
    } catch (demandErr) {
      console.error('[rotations] reopenDemandOnAssignmentDelete error:', (demandErr as Error).message);
    }
    // Cancel any open return-request ("Rückgabe anfordern") for this assignment
    try {
      const cancelled = await cancelReturnRequestOnAssignmentDelete(db, req.params.assignmentId as string);
      if (cancelled > 0) {
        console.log(`[rotations] Cancelled ${cancelled} return-request(s) for deleted assignment ${req.params.assignmentId}`);
      }
    } catch (retErr) {
      console.error('[rotations] cancelReturnRequestOnAssignmentDelete error:', (retErr as Error).message);
    }
    await db.execute(
      `DELETE a FROM rotation_assignment a
         JOIN rotation_workplace w ON w.id = a.rotation_workplace_id
        WHERE a.id = ? AND w.group_id = ?`,
      [req.params.assignmentId, req.params.groupId as string]
    );
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============================================================
//  DEMANDS (Bedarfsanmeldung — Stations-Mitarbeiter)
// ============================================================

// POST /demands — ward staff registers demand for their own tenant
router.post('/demands', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;

    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token'] as string | undefined);
    if (!activeTenantId) {
      res.status(400).json({ error: 'Kein aktiver Mandant (x-db-token fehlt)' });
      return;
    }

    const { rotation_workplace_id, date, timeslot_id, note, return_requested_assignment_id, offered_employee_id } = req.body || {};
    if (!rotation_workplace_id) {
      res.status(400).json({ error: 'rotation_workplace_id ist erforderlich' });
      return;
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date (YYYY-MM-DD) ist erforderlich' });
      return;
    }

    // Resolve workplace and verify it belongs to a group the caller can access
    const [wpRows] = await db.execute(
      'SELECT id, group_id, ward_tenant_id FROM rotation_workplace WHERE id = ? AND is_active = 1 LIMIT 1',
      [String(rotation_workplace_id)]
    ) as [Record<string, unknown>[], unknown];
    if (wpRows.length === 0) {
      res.status(404).json({ error: 'Rotation nicht gefunden' });
      return;
    }
    const wp = wpRows[0];
    const groupId = Number(wp.group_id);

    // ── Joker-offer branch ("Mitarbeiter an den Pool übergeben") ──
    // A ward can offer one of their own employees to the pool by dropping
    // on ANY workplace in the group (including pool workplaces). This must
    // run BEFORE the ward_tenant_id guard, which only allows ward→own-workplace.
    if (offered_employee_id) {
      // Verify the workplace belongs to a group the caller can access
      if (!canReadRotationGroupForDemand(ctx, groupId)) {
        res.status(403).json({ error: 'Kein Zugriff auf diesen Rotationsverbund' });
        return;
      }

      if (String(wp.group_id) !== String(groupId)) {
        res.status(403).json({ error: 'Workplace gehört nicht zur selben Gruppe' });
        return;
      }

      if (!offered_employee_id || typeof offered_employee_id !== 'string' || !offered_employee_id.trim()) {
        res.status(400).json({ error: 'employee_id ist erforderlich für eine Joker-Übergabe' });
        return;
      }

      // Dedup: no open Joker offer for the same employee on the same cell
      const [existingOffer] = await db.execute(
        `SELECT id FROM rotation_demand
          WHERE rotation_workplace_id = ? AND date = ?
            AND (timeslot_id = ? OR (timeslot_id IS NULL AND ? IS NULL))
            AND offered_employee_id = ? AND status = 'open' LIMIT 1`,
        [String(rotation_workplace_id), date, timeslot_id || null, timeslot_id || null, String(offered_employee_id)]
      ) as [Record<string, unknown>[], unknown];
      if (existingOffer.length > 0) {
        const err = new Error('Für diesen Mitarbeiter existiert bereits ein offenes Übergabe-Angebot in dieser Zelle');
        (err as unknown as Record<string, unknown>).status = 409;
        throw err;
      }

      const jokerId = crypto.randomUUID();
      const jokerRow: Record<string, unknown> = {
        id: jokerId,
        rotation_workplace_id: String(rotation_workplace_id),
        group_id: groupId,
        ward_tenant_id: activeTenantId,
        date,
        timeslot_id: timeslot_id || null,
        note: note || `Übergabe an den Pool gewünscht`,
        status: 'open',
        fulfilled_by_assignment_id: null,
        offered_employee_id: String(offered_employee_id),
        created_by: (req as AuthRequest).user?.email || (req as AuthRequest).user?.sub || null,
      };

      const jokerColumns = Object.keys(jokerRow);
      const jokerValues = jokerColumns.map((k) => jokerRow[k]);
      const jokerColList = jokerColumns.join(', ');
      const jokerPlaceholders = jokerColumns.map(() => '?').join(', ');
      await db.execute(
        `INSERT INTO rotation_demand (${jokerColList}) VALUES (${jokerPlaceholders})`,
        jokerValues
      );

      try {
        const adminUserIds = await getRotationAdminUserIds(db, groupId);
        if (adminUserIds.length > 0) {
          broadcastUserEvent({
            eventName: 'rotation-demand',
            payload: { demand: jokerRow, groupId, kind: 'joker-offer' },
            userIds: adminUserIds,
          });
        }
      } catch (realtimeErr) {
        console.error('[rotations] broadcastUserEvent error:', (realtimeErr as Error).message);
      }

      res.status(201).json({ demand: jokerRow });
      return;
    }

    // ── Return-request branch ("Rückgabe an den Pool anfordern") ──
    // Must also run BEFORE the ward_tenant_id guard because the ward
    // drops onto a pool workplace cell, not their own workplace.
    if (return_requested_assignment_id) {
      if (!canReadRotationGroupForDemand(ctx, groupId)) {
        res.status(403).json({ error: 'Kein Zugriff auf diesen Rotationsverbund' });
        return;
      }

      if (String(wp.group_id) !== String(groupId)) {
        res.status(403).json({ error: 'Workplace gehört nicht zur selben Gruppe' });
        return;
      }

      const [asgRows] = await db.execute(
        'SELECT a.id, a.rotation_workplace_id, a.date, a.timeslot_id, w.group_id FROM rotation_assignment a JOIN rotation_workplace w ON w.id = a.rotation_workplace_id WHERE a.id = ? LIMIT 1',
        [String(return_requested_assignment_id)]
      ) as [Record<string, unknown>[], unknown];
      if (asgRows.length === 0) {
        res.status(404).json({ error: 'Zuweisung nicht gefunden' });
        return;
      }
      const asg = asgRows[0];
      // Assignment must be in the same group (the ward drops onto a pool
      // workplace, so rotation_workplace_id won't match — only group matters).
      if (String(asg.group_id) !== String(groupId)
          || String(asg.date) !== String(date)
          || String(asg.timeslot_id || '') !== String(timeslot_id || '')) {
        res.status(422).json({ error: 'Die Rückgabe-Zuweisung passt nicht zur angeforderten Zelle' });
        return;
      }

      await assertNoOpenReturnRequestForAssignment(db, String(return_requested_assignment_id));

      const id = crypto.randomUUID();
      const row: Record<string, unknown> = {
        id,
        rotation_workplace_id: String(rotation_workplace_id),
        group_id: groupId,
        ward_tenant_id: activeTenantId,
        date,
        timeslot_id: timeslot_id || null,
        note: note || 'Rückgabe an den Pool angefordert',
        status: 'open',
        fulfilled_by_assignment_id: null,
        return_requested_assignment_id: String(return_requested_assignment_id),
        created_by: (req as AuthRequest).user?.email || (req as AuthRequest).user?.sub || null,
      };

      const columns = Object.keys(row);
      const values = columns.map((k) => row[k]);
      const colList = columns.join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      await db.execute(
        `INSERT INTO rotation_demand (${colList}) VALUES (${placeholders})`,
        values
      );

      try {
        const adminUserIds = await getRotationAdminUserIds(db, groupId);
        if (adminUserIds.length > 0) {
          broadcastUserEvent({
            eventName: 'rotation-demand',
            payload: { demand: row, groupId, kind: 'return-request' },
            userIds: adminUserIds,
          });
        }
      } catch (realtimeErr) {
        console.error('[rotations] broadcastUserEvent error:', (realtimeErr as Error).message);
      }

      res.status(201).json({ demand: row });
      return;
    }

    // ── Guards for regular demand only (ward → own workplace) ──
    // Joker offers and return-requests (above) are exempt because they
    // target pool workplaces.
    if (String(wp.ward_tenant_id) !== String(activeTenantId)) {
      res.status(403).json({ error: 'Sie können nur Bedarf für Ihre eigene Station anmelden' });
      return;
    }

    if (!canReadRotationGroupForDemand(ctx, groupId)) {
      res.status(403).json({ error: 'Kein Zugriff auf diesen Rotationsverbund' });
      return;
    }

    await assertNoOpenDemandForCell(db, {
      rotationWorkplaceId: String(rotation_workplace_id),
      date,
      timeslotId: timeslot_id || null,
    });

    const id = crypto.randomUUID();
    const row: Record<string, unknown> = {
      id,
      rotation_workplace_id: String(rotation_workplace_id),
      group_id: groupId,
      ward_tenant_id: activeTenantId,
      date,
      timeslot_id: timeslot_id || null,
      note: note || null,
      status: 'open',
      fulfilled_by_assignment_id: null,
      created_by: (req as AuthRequest).user?.email || (req as AuthRequest).user?.sub || null,
    };

    const columns = Object.keys(row);
    const values = columns.map((k) => row[k]);
    const colList = columns.join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    await db.execute(
      `INSERT INTO rotation_demand (${colList}) VALUES (${placeholders})`,
      values
    );

    // Notify rotation admins via realtime
    try {
      const adminUserIds = await getRotationAdminUserIds(db, groupId);
      if (adminUserIds.length > 0) {
        broadcastUserEvent({
          eventName: 'rotation-demand',
          payload: { demand: row, groupId },
          userIds: adminUserIds,
        });
      }
    } catch (realtimeErr) {
      console.error('[rotations] broadcastUserEvent error:', (realtimeErr as Error).message);
    }

    res.status(201).json({ demand: row });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /demands?from=&to=&status=
router.get('/demands', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token'] as string | undefined);
    if (!activeTenantId) {
      res.json({ demands: [] });
      return;
    }

    const accessibleGroupIds = await loadVisibleRotationGroupIdsForTenant(db, ctx, activeTenantId);
    if (accessibleGroupIds.length === 0) {
      res.json({ demands: [] });
      return;
    }

    const { from, to, status } = req.query;
    const conditions: string[] = [`d.group_id IN (${accessibleGroupIds.map(() => '?').join(',')})`];
    const params: unknown[] = [...accessibleGroupIds];

    // Determine if active tenant is pool tenant in any accessible group
    const [poolRows] = await db.execute(
      `SELECT DISTINCT group_id FROM rotation_group_member
        WHERE tenant_id = ? AND role = 'pool' AND group_id IN (${accessibleGroupIds.map(() => '?').join(',')})`,
      [activeTenantId, ...accessibleGroupIds]
    ) as [Record<string, unknown>[], unknown];
    const poolGroupIdsDemands = new Set((poolRows as Array<{ group_id: number }>).map((r) => Number(r.group_id)));
    const isPoolForAny = poolGroupIdsDemands.size > 0;

    // Pool tenants see all demands; ward users see only own
    if (!isPoolForAny) {
      conditions.push('d.ward_tenant_id = ?');
      params.push(activeTenantId);
    }
    if (from) { conditions.push('d.date >= ?'); params.push(from); }
    if (to) { conditions.push('d.date <= ?'); params.push(to); }
    if (status) { conditions.push('d.status = ?'); params.push(status); }

    const [rows] = await db.execute(
      `SELECT d.id, d.rotation_workplace_id, d.group_id, d.ward_tenant_id, d.date,
              d.timeslot_id, d.note, d.status, d.fulfilled_by_assignment_id,
              d.return_requested_assignment_id,
              d.offered_employee_id,
              d.created_by, d.created_at, d.updated_at,
              w.name AS workplace_name, ts.label AS timeslot_label,
              a.employee_id AS fulfilled_employee_id,
              e.first_name AS fulfilled_first, e.last_name AS fulfilled_last
         FROM rotation_demand d
         JOIN rotation_workplace w ON w.id = d.rotation_workplace_id
         LEFT JOIN rotation_timeslot ts ON ts.id = d.timeslot_id
         LEFT JOIN rotation_assignment a ON a.id = d.fulfilled_by_assignment_id
         LEFT JOIN EmployeeTenantAssignment eta
                ON eta.tenant_doctor_id COLLATE utf8mb4_general_ci = a.employee_id COLLATE utf8mb4_general_ci
         LEFT JOIN Employee e ON e.id = eta.employee_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY d.date ASC, w.name ASC`,
      params
    ) as [Record<string, unknown>[], unknown];

    const demands = rows.map((r) => ({
      id: String(r.id),
      rotation_workplace_id: String(r.rotation_workplace_id),
      group_id: Number(r.group_id),
      ward_tenant_id: String(r.ward_tenant_id),
      date: r.date ? String(r.date).slice(0, 10) : null,
      timeslot_id: r.timeslot_id ? String(r.timeslot_id) : null,
      note: r.note || null,
      status: r.status,
      fulfilled_by_assignment_id: r.fulfilled_by_assignment_id ? String(r.fulfilled_by_assignment_id) : null,
      return_requested_assignment_id: r.return_requested_assignment_id ? String(r.return_requested_assignment_id) : null,
      offered_employee_id: r.offered_employee_id ? String(r.offered_employee_id) : null,
      created_by: r.created_by || null,
      created_at: r.created_at || null,
      updated_at: r.updated_at || null,
      workplace_name: r.workplace_name,
      timeslot_label: r.timeslot_label || null,
      fulfilled_employee_name: r.fulfilled_first
        ? [r.fulfilled_first, r.fulfilled_last].filter(Boolean).join(' ')
        : null,
      canManage: poolGroupIdsDemands.has(Number(r.group_id)) && canWriteRotationGroup(ctx, Number(r.group_id)),
    }));

    res.json({ demands });
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /demands/:id — cancel/reject a demand
router.patch('/demands/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token'] as string | undefined);

    const [existing] = await db.execute(
      'SELECT id, rotation_workplace_id, group_id, ward_tenant_id, status FROM rotation_demand WHERE id = ? LIMIT 1',
      [String(req.params.id)]
    ) as [Record<string, unknown>[], unknown];
    if (existing.length === 0) {
      res.status(404).json({ error: 'Bedarf nicht gefunden' });
      return;
    }
    const current = existing[0];

    const { status: newStatus } = req.body || {};
    if (!newStatus) {
      res.status(400).json({ error: 'status ist erforderlich' });
      return;
    }

    const validTransitions: Record<string, string[]> = {
      open: ['cancelled', 'fulfilled'],
      fulfilled: ['cancelled'],
      cancelled: [],
    };
    if (!validTransitions[current.status as string]?.includes(newStatus)) {
      res.status(422).json({ error: `Ungültiger Status-Übergang: ${current.status} → ${newStatus}` });
      return;
    }

    const isGroupAdmin = canWriteRotationGroup(ctx, Number(current.group_id));
    const isOwnTenant = activeTenantId && String(activeTenantId) === String(current.ward_tenant_id);
    if (!isGroupAdmin && !isOwnTenant) {
      res.status(403).json({ error: 'Keine Berechtigung, diesen Bedarf zu ändern' });
      return;
    }

    await db.execute(
      'UPDATE rotation_demand SET status = ? WHERE id = ?',
      [newStatus, String(req.params.id)]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// Helper: check write-level access for demand creation (Bedarf anmelden,
// Joker-Übergabe, Rückgabe anfordern). Viewing rotations is membership-based
// (any user in a participating tenant can see springer chips read-only), but
// creating demands requires explicit allowed_rotation_groups or master admin.
function canReadRotationGroupForDemand(ctx: UserRotationContext | null, groupId: number): boolean {
  if (!ctx) return false;
  if (ctx.isMasterAdmin) return true;
  const list = ctx.allowedGroups;
  return Array.isArray(list) && list.includes(Number(groupId));
}

// ============================================================
//  GROUP CRUD — registered LAST to avoid shadowing named routes
//  like /visible-rotations and /demands (Express matches in order).
// ============================================================

// GET /:groupId
router.get('/:groupId', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await loadCtx(req as AuthRequest, res);
    if (!ctx) return;
    const group = await requireRotationGroupReadAccess(db, ctx, req.params.groupId as string);
    res.json({ group });
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /:groupId (master admin only)
router.patch('/:groupId', requirePermission('can_manage_groups'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, is_active } = req.body || {};
    const fields: string[] = [];
    const values: unknown[] = [];
    if (name !== undefined) {
      if (!String(name).trim()) {
        res.status(400).json({ error: 'Name darf nicht leer sein' });
        return;
      }
      fields.push('name = ?');
      values.push(String(name).trim());
    }
    if (description !== undefined) {
      fields.push('description = ?');
      values.push(description?.trim() || null);
    }
    if (is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(Boolean(is_active) ? 1 : 0);
    }
    if (fields.length === 0) {
      res.status(400).json({ error: 'Keine Änderungen' });
      return;
    }
    values.push(req.params.groupId as string);
    await db.execute(`UPDATE rotation_group SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    if ((err as Record<string, unknown>).code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Name bereits vergeben' });
      return;
    }
    handleError(res, err);
  }
});

// DELETE /:groupId (master admin only)
router.delete('/:groupId', requirePermission('can_manage_groups'), async (req: Request, res: Response): Promise<void> => {
  try {
    await db.execute('DELETE FROM rotation_group WHERE id = ?', [req.params.groupId as string]);
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
