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
import crypto from 'crypto';
import { db } from '../index.js';
import { authMiddleware, adminMiddleware } from './auth.js';
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
import { broadcastUserEvent } from '../utils/realtime.js';

const router = express.Router();

router.use(authMiddleware);

function handleError(res, error) {
  if (error && error.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error('[rotations] Error:', error.message);
  return res.status(500).json({ error: 'Interner Serverfehler' });
}

async function loadCtx(req, res) {
  const ctx = await loadUserRotationContext(db, req.user.sub);
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
router.get('/', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    const groups = await listUserRotationGroups(db, ctx);
    res.json({ groups });
  } catch (err) {
    handleError(res, err);
  }
});

// POST / — create a rotation group (master admin only)
router.post('/', adminMiddleware, async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }
    const [result] = await db.execute(
      'INSERT INTO rotation_group (name, description) VALUES (?, ?)',
      [name.trim(), description?.trim() || null]
    );
    res.status(201).json({
      group: {
        id: Number(result.insertId),
        name: name.trim(),
        description: description?.trim() || null,
        is_active: true,
      },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ein Rotationsverbund mit diesem Namen existiert bereits' });
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
router.get('/:groupId/members', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireRotationGroupReadAccess(db, ctx, req.params.groupId);
    const members = await loadRotationGroupMembers(db, req.params.groupId);
    // Enrich with tenant name from db_tokens
    const tenantIds = members.map((m) => m.tenant_id);
    let tenantNames = new Map();
    if (tenantIds.length > 0) {
      const placeholders = tenantIds.map(() => '?').join(',');
      const [tRows] = await db.execute(
        `SELECT id, name FROM db_tokens WHERE id IN (${placeholders})`,
        tenantIds
      );
      for (const t of tRows) {
        tenantNames.set(String(t.id), t.name || t.id);
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
router.post('/:groupId/members', adminMiddleware, async (req, res) => {
  try {
    const { tenant_id, role } = req.body || {};
    if (!tenant_id) return res.status(400).json({ error: 'tenant_id ist erforderlich' });
    const memberRole = role === 'pool' ? 'pool' : 'ward';
    // Enforce exactly one pool member per group
    if (memberRole === 'pool') {
      const existingPool = await resolvePoolTenantId(db, req.params.groupId);
      if (existingPool && String(existingPool) !== String(tenant_id)) {
        return res.status(409).json({ error: 'Dieser Rotationsverbund hat bereits einen Springerpool-Mandanten' });
      }
    }
    await db.execute(
      'INSERT INTO rotation_group_member (group_id, tenant_id, role) VALUES (?, ?, ?)',
      [req.params.groupId, String(tenant_id), memberRole]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Mandant ist bereits Mitglied' });
    }
    handleError(res, err);
  }
});

// DELETE /:groupId/members/:tenantId (master admin only)
router.delete('/:groupId/members/:tenantId', adminMiddleware, async (req, res) => {
  try {
    await db.execute(
      'DELETE FROM rotation_group_member WHERE group_id = ? AND tenant_id = ?',
      [req.params.groupId, String(req.params.tenantId)]
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
router.get('/:groupId/workplaces', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireRotationGroupReadAccess(db, ctx, req.params.groupId);
    const [rows] = await db.execute(
      `SELECT id, group_id, ward_tenant_id, name, timeslots_enabled, is_active
         FROM rotation_workplace
        WHERE group_id = ? AND is_active = 1
        ORDER BY name ASC`,
      [req.params.groupId]
    );
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
router.post('/:groupId/workplaces', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId);
    const { name, ward_tenant_id, timeslots_enabled } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }
    if (!ward_tenant_id) {
      return res.status(400).json({ error: 'ward_tenant_id ist erforderlich' });
    }
    // Verify ward_tenant_id is a ward member of this group
    const [memberRows] = await db.execute(
      "SELECT tenant_id FROM rotation_group_member WHERE group_id = ? AND tenant_id = ? AND role = 'ward'",
      [req.params.groupId, String(ward_tenant_id)]
    );
    if (memberRows.length === 0) {
      return res.status(400).json({ error: 'Der Mandant ist keine Station in diesem Rotationsverbund' });
    }
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO rotation_workplace (id, group_id, ward_tenant_id, name, timeslots_enabled, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.params.groupId, String(ward_tenant_id), String(name).trim(),
       Boolean(timeslots_enabled) ? 1 : 0, req.user?.email || req.user?.sub || null]
    );
    res.status(201).json({
      workplace: {
        id,
        group_id: Number(req.params.groupId),
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
router.patch('/:groupId/workplaces/:workplaceId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId);
    const { name, timeslots_enabled, is_active } = req.body || {};
    const fields = [];
    const values = [];
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Name darf nicht leer sein' });
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
    if (fields.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });
    values.push(req.params.workplaceId, req.params.groupId);
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
router.delete('/:groupId/workplaces/:workplaceId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId);
    await db.execute(
      'DELETE FROM rotation_workplace WHERE id = ? AND group_id = ?',
      [req.params.workplaceId, req.params.groupId]
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
router.get('/:groupId/workplaces/:workplaceId/timeslots', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireRotationGroupReadAccess(db, ctx, req.params.groupId);
    const [rows] = await db.execute(
      `SELECT id, rotation_workplace_id, label, start_time, end_time, \`order\`
         FROM rotation_timeslot
        WHERE rotation_workplace_id = ?
        ORDER BY COALESCE(\`order\`, 0) ASC, start_time ASC`,
      [req.params.workplaceId]
    );
    res.json({
      timeslots: rows.map((r) => ({
        ...r,
        order: r.order ?? 0,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:groupId/workplaces/:workplaceId/timeslots (rotation admin)
router.post('/:groupId/workplaces/:workplaceId/timeslots', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId);
    const { label, start_time, end_time, order } = req.body || {};
    if (!label || !start_time || !end_time) {
      return res.status(400).json({ error: 'label, start_time und end_time sind erforderlich' });
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
router.patch('/:groupId/workplaces/:workplaceId/timeslots/:timeslotId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId);
    const { label, start_time, end_time, order } = req.body || {};
    const fields = [];
    const values = [];
    if (label !== undefined) { fields.push('label = ?'); values.push(String(label)); }
    if (start_time !== undefined) { fields.push('start_time = ?'); values.push(String(start_time)); }
    if (end_time !== undefined) { fields.push('end_time = ?'); values.push(String(end_time)); }
    if (order !== undefined) { fields.push('`order` = ?'); values.push(Number(order) || 0); }
    if (fields.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });
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
router.delete('/:groupId/workplaces/:workplaceId/timeslots/:timeslotId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId);
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
router.get('/visible-rotations', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;

    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token']);
    if (!activeTenantId) {
      return res.json({ workplaces: [], assignments: [], demands: [], tenantId: null, groupIds: [] });
    }

    const accessibleGroupIds = await loadVisibleRotationGroupIdsForTenant(db, ctx, activeTenantId);
    if (accessibleGroupIds.length === 0) {
      return res.json({ workplaces: [], assignments: [], demands: [], tenantId: activeTenantId, groupIds: [] });
    }

    const { from, to } = req.query;
    const dateFilter = [];
    const dateParams = [];
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
    );
    const poolGroupIds = new Set(poolRows.map((r) => Number(r.group_id)));
    const isPoolForAnyGroup = poolGroupIds.size > 0;

    // Load workplaces
    let workplaceWhere = `w.group_id IN (${placeholders}) AND w.is_active = 1`;
    let workplaceParams = [...accessibleGroupIds];
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
    );

    // Load timeslots for these workplaces
    const wpIds = workplaceRows.map((r) => r.id);
    let timeslotsByWpId = new Map();
    if (wpIds.length > 0) {
      const wpPlaceholders = wpIds.map(() => '?').join(',');
      const [tsRows] = await db.execute(
        `SELECT id, rotation_workplace_id, label, start_time, end_time, \`order\`
           FROM rotation_timeslot
          WHERE rotation_workplace_id IN (${wpPlaceholders})
          ORDER BY \`order\` ASC`,
        wpIds
      );
      for (const ts of tsRows) {
        const list = timeslotsByWpId.get(ts.rotation_workplace_id) || [];
        list.push({ id: ts.id, label: ts.label, start_time: ts.start_time, end_time: ts.end_time, order: ts.order });
        timeslotsByWpId.set(ts.rotation_workplace_id, list);
      }
    }

    const workplaces = workplaceRows.map((r) => ({
      id: r.id,
      group_id: Number(r.group_id),
      ward_tenant_id: String(r.ward_tenant_id),
      name: r.name,
      timeslots_enabled: Boolean(r.timeslots_enabled),
      timeslots: timeslotsByWpId.get(r.id) || [],
      canWrite: poolGroupIds.has(Number(r.group_id)) && canWriteRotationGroup(ctx, Number(r.group_id)),
    }));

    // Load assignments for these workplaces in date range
    let assignments = [];
    if (wpIds.length > 0) {
      const wpPlaceholders = wpIds.map(() => '?').join(',');
      const [aRows] = await db.execute(
        `SELECT a.id, a.rotation_workplace_id, a.date, a.employee_id,
                a.timeslot_id, a.note,
                w.name AS workplace_name, w.group_id,
                e.first_name, e.last_name
           FROM rotation_assignment a
           JOIN rotation_workplace w ON w.id = a.rotation_workplace_id
           LEFT JOIN EmployeeTenantAssignment eta
                  ON eta.tenant_doctor_id COLLATE utf8mb4_general_ci = a.employee_id COLLATE utf8mb4_general_ci
           LEFT JOIN Employee e ON e.id = eta.employee_id
          WHERE a.rotation_workplace_id IN (${wpPlaceholders})
            ${dateWhere}
          ORDER BY a.date ASC, w.name ASC`,
        [...wpIds, ...dateParams]
      );
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
    let demands = [];
    if (wpIds.length > 0) {
      const wpPlaceholders = wpIds.map(() => '?').join(',');
      let demandWhere = `d.rotation_workplace_id IN (${wpPlaceholders})`;
      const demandParams = [...wpIds];
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
           LEFT JOIN Employee e_offer ON e_offer.id = d.offered_employee_id
          WHERE ${demandWhere}
          ORDER BY d.date ASC`,
        demandParams
      );
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
router.post('/:groupId/assignments', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId);
    const { rotation_workplace_id, date, employee_id, timeslot_id, note } = req.body || {};
    if (!rotation_workplace_id) return res.status(400).json({ error: 'rotation_workplace_id ist erforderlich' });
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date (YYYY-MM-DD) ist erforderlich' });
    if (!employee_id) return res.status(400).json({ error: 'employee_id ist erforderlich' });

    // Verify workplace belongs to this group
    const [wpRows] = await db.execute(
      'SELECT id FROM rotation_workplace WHERE id = ? AND group_id = ? AND is_active = 1',
      [String(rotation_workplace_id), req.params.groupId]
    );
    if (wpRows.length === 0) return res.status(404).json({ error: 'Rotation nicht gefunden' });

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO rotation_assignment (id, rotation_workplace_id, date, employee_id, timeslot_id, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, String(rotation_workplace_id), date, String(employee_id),
       timeslot_id ? String(timeslot_id) : null, note || null,
       req.user?.email || req.user?.sub || null]
    );

    // Auto-fulfil any open demand for this cell
    let fulfilledDemandId = null;
    try {
      fulfilledDemandId = await markDemandFulfilledForCell(db, {
        rotationWorkplaceId: String(rotation_workplace_id),
        date,
        timeslotId: timeslot_id || null,
        assignmentId: id,
      });
    } catch (demandErr) {
      console.error('[rotations] markDemandFulfilledForCell error:', demandErr.message);
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
router.patch('/:groupId/assignments/:assignmentId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId);
    const allowed = ['date', 'employee_id', 'timeslot_id', 'note'];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      fields.push(`${key} = ?`);
      values.push(req.body[key]);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });
    values.push(req.params.assignmentId, req.params.groupId);
    await db.execute(
      `UPDATE rotation_assignment a
         JOIN rotation_workplace w ON w.id = a.rotation_workplace_id
        SET ${fields.join(', ')}
        WHERE a.id = ? AND w.group_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /:groupId/assignments/:assignmentId (rotation admin)
router.delete('/:groupId/assignments/:assignmentId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireRotationGroupWriteAccess(ctx, req.params.groupId);
    // Reopen any demand fulfilled by this assignment
    try {
      const reopened = await reopenDemandOnAssignmentDelete(db, req.params.assignmentId);
      if (reopened > 0) {
        console.log(`[rotations] Reopened ${reopened} demand(s) for deleted assignment ${req.params.assignmentId}`);
      }
    } catch (demandErr) {
      console.error('[rotations] reopenDemandOnAssignmentDelete error:', demandErr.message);
    }
    // Cancel any open return-request ("Rückgabe anfordern") for this assignment
    try {
      const cancelled = await cancelReturnRequestOnAssignmentDelete(db, req.params.assignmentId);
      if (cancelled > 0) {
        console.log(`[rotations] Cancelled ${cancelled} return-request(s) for deleted assignment ${req.params.assignmentId}`);
      }
    } catch (retErr) {
      console.error('[rotations] cancelReturnRequestOnAssignmentDelete error:', retErr.message);
    }
    await db.execute(
      `DELETE a FROM rotation_assignment a
         JOIN rotation_workplace w ON w.id = a.rotation_workplace_id
        WHERE a.id = ? AND w.group_id = ?`,
      [req.params.assignmentId, req.params.groupId]
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
router.post('/demands', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;

    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token']);
    if (!activeTenantId) {
      return res.status(400).json({ error: 'Kein aktiver Mandant (x-db-token fehlt)' });
    }

    const { rotation_workplace_id, date, timeslot_id, note, return_requested_assignment_id, offered_employee_id } = req.body || {};
    if (!rotation_workplace_id) return res.status(400).json({ error: 'rotation_workplace_id ist erforderlich' });
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date (YYYY-MM-DD) ist erforderlich' });

    // Resolve workplace and verify it belongs to a group the caller can access
    const [wpRows] = await db.execute(
      'SELECT id, group_id, ward_tenant_id FROM rotation_workplace WHERE id = ? AND is_active = 1 LIMIT 1',
      [String(rotation_workplace_id)]
    );
    if (wpRows.length === 0) return res.status(404).json({ error: 'Rotation nicht gefunden' });
    const wp = wpRows[0];
    const groupId = Number(wp.group_id);

    // ── Joker-offer branch ("Mitarbeiter an den Pool übergeben") ──
    // A ward can offer one of their own employees to the pool by dropping
    // on ANY workplace in the group (including pool workplaces). This must
    // run BEFORE the ward_tenant_id guard, which only allows ward→own-workplace.
    if (offered_employee_id) {
      // Verify the workplace belongs to a group the caller can access
      if (!canReadRotationGroupForDemand(ctx, groupId)) {
        return res.status(403).json({ error: 'Kein Zugriff auf diesen Rotationsverbund' });
      }

      if (String(wp.group_id) !== String(groupId)) {
        return res.status(403).json({ error: 'Workplace gehört nicht zur selben Gruppe' });
      }

      if (!offered_employee_id || typeof offered_employee_id !== 'string' || !offered_employee_id.trim()) {
        return res.status(400).json({ error: 'employee_id ist erforderlich für eine Joker-Übergabe' });
      }

      // Dedup: no open Joker offer for the same employee on the same cell
      const [existingOffer] = await db.execute(
        `SELECT id FROM rotation_demand
          WHERE rotation_workplace_id = ? AND date = ?
            AND (timeslot_id = ? OR (timeslot_id IS NULL AND ? IS NULL))
            AND offered_employee_id = ? AND status = 'open' LIMIT 1`,
        [String(rotation_workplace_id), date, timeslot_id || null, timeslot_id || null, String(offered_employee_id)]
      );
      if (existingOffer.length > 0) {
        const err = new Error('Für diesen Mitarbeiter existiert bereits ein offenes Übergabe-Angebot in dieser Zelle');
        err.status = 409;
        throw err;
      }

      const jokerId = crypto.randomUUID();
      const jokerRow = {
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
        created_by: req.user?.email || req.user?.sub || null,
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
        console.error('[rotations] broadcastUserEvent error:', realtimeErr.message);
      }

      return res.status(201).json({ demand: jokerRow });
    }

    // ── Return-request branch ("Rückgabe an den Pool anfordern") ──
    // Must also run BEFORE the ward_tenant_id guard because the ward
    // drops onto a pool workplace cell, not their own workplace.
    if (return_requested_assignment_id) {
      if (!canReadRotationGroupForDemand(ctx, groupId)) {
        return res.status(403).json({ error: 'Kein Zugriff auf diesen Rotationsverbund' });
      }

      if (String(wp.group_id) !== String(groupId)) {
        return res.status(403).json({ error: 'Workplace gehört nicht zur selben Gruppe' });
      }

      const [asgRows] = await db.execute(
        'SELECT a.id, a.rotation_workplace_id, a.date, a.timeslot_id, w.group_id FROM rotation_assignment a JOIN rotation_workplace w ON w.id = a.rotation_workplace_id WHERE a.id = ? LIMIT 1',
        [String(return_requested_assignment_id)]
      );
      if (asgRows.length === 0) {
        return res.status(404).json({ error: 'Zuweisung nicht gefunden' });
      }
      const asg = asgRows[0];
      // Assignment must be in the same group (the ward drops onto a pool
      // workplace, so rotation_workplace_id won't match — only group matters).
      if (String(asg.group_id) !== String(groupId)
          || String(asg.date) !== String(date)
          || String(asg.timeslot_id || '') !== String(timeslot_id || '')) {
        return res.status(422).json({ error: 'Die Rückgabe-Zuweisung passt nicht zur angeforderten Zelle' });
      }

      await assertNoOpenReturnRequestForAssignment(db, String(return_requested_assignment_id));

      const id = crypto.randomUUID();
      const row = {
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
        created_by: req.user?.email || req.user?.sub || null,
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
        console.error('[rotations] broadcastUserEvent error:', realtimeErr.message);
      }

      return res.status(201).json({ demand: row });
    }

    // ── Guards for regular demand only (ward → own workplace) ──
    // Joker offers and return-requests (above) are exempt because they
    // target pool workplaces.
    if (String(wp.ward_tenant_id) !== String(activeTenantId)) {
      return res.status(403).json({ error: 'Sie können nur Bedarf für Ihre eigene Station anmelden' });
    }

    if (!canReadRotationGroupForDemand(ctx, groupId)) {
      return res.status(403).json({ error: 'Kein Zugriff auf diesen Rotationsverbund' });
    }

    await assertNoOpenDemandForCell(db, {
      rotationWorkplaceId: String(rotation_workplace_id),
      date,
      timeslotId: timeslot_id || null,
    });

    const id = crypto.randomUUID();
    const row = {
      id,
      rotation_workplace_id: String(rotation_workplace_id),
      group_id: groupId,
      ward_tenant_id: activeTenantId,
      date,
      timeslot_id: timeslot_id || null,
      note: note || null,
      status: 'open',
      fulfilled_by_assignment_id: null,
      created_by: req.user?.email || req.user?.sub || null,
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
      console.error('[rotations] broadcastUserEvent error:', realtimeErr.message);
    }

    res.status(201).json({ demand: row });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /demands?from=&to=&status=
router.get('/demands', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token']);
    if (!activeTenantId) return res.json({ demands: [] });

    const accessibleGroupIds = await loadVisibleRotationGroupIdsForTenant(db, ctx, activeTenantId);
    if (accessibleGroupIds.length === 0) return res.json({ demands: [] });

    const { from, to, status } = req.query;
    const conditions = [`d.group_id IN (${accessibleGroupIds.map(() => '?').join(',')})`];
    const params = [...accessibleGroupIds];

    // Determine if active tenant is pool tenant in any accessible group
    const [poolRows] = await db.execute(
      `SELECT DISTINCT group_id FROM rotation_group_member
        WHERE tenant_id = ? AND role = 'pool' AND group_id IN (${accessibleGroupIds.map(() => '?').join(',')})`,
      [activeTenantId, ...accessibleGroupIds]
    );
    const poolGroupIdsDemands = new Set(poolRows.map((r) => Number(r.group_id)));
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
    );

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
router.patch('/demands/:id', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token']);

    const [existing] = await db.execute(
      'SELECT id, rotation_workplace_id, group_id, ward_tenant_id, status FROM rotation_demand WHERE id = ? LIMIT 1',
      [String(req.params.id)]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Bedarf nicht gefunden' });
    const current = existing[0];

    const { status: newStatus } = req.body || {};
    if (!newStatus) return res.status(400).json({ error: 'status ist erforderlich' });

    const validTransitions = {
      open: ['cancelled', 'fulfilled'],
      fulfilled: ['cancelled'],
      cancelled: [],
    };
    if (!validTransitions[current.status]?.includes(newStatus)) {
      return res.status(422).json({ error: `Ungültiger Status-Übergang: ${current.status} → ${newStatus}` });
    }

    const isGroupAdmin = canWriteRotationGroup(ctx, Number(current.group_id));
    const isOwnTenant = activeTenantId && String(activeTenantId) === String(current.ward_tenant_id);
    if (!isGroupAdmin && !isOwnTenant) {
      return res.status(403).json({ error: 'Keine Berechtigung, diesen Bedarf zu ändern' });
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

// Helper: check read access for demand creation (ward users may not have
// allowed_rotation_groups set — they just need to be a member of the group
// via their tenant). This is more permissive than canReadRotationGroup.
function canReadRotationGroupForDemand(ctx, groupId) {
  if (!ctx) return false;
  if (ctx.isMasterAdmin) return true;
  // Ward users: allowed if they are a member of the group (checked via tenant
  // membership in the route) — here we accept if allowedGroups includes it
  // OR if allowedGroups is null (membership-only access, no explicit allow list).
  const list = ctx.allowedGroups;
  if (list === null) return true; // no explicit allow list → membership suffices
  return Array.isArray(list) && list.includes(Number(groupId));
}

// ============================================================
//  GROUP CRUD — registered LAST to avoid shadowing named routes
//  like /visible-rotations and /demands (Express matches in order).
// ============================================================

// GET /:groupId
router.get('/:groupId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    const group = await requireRotationGroupReadAccess(db, ctx, req.params.groupId);
    res.json({ group });
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /:groupId (master admin only)
router.patch('/:groupId', adminMiddleware, async (req, res) => {
  try {
    const { name, description, is_active } = req.body || {};
    const fields = [];
    const values = [];
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Name darf nicht leer sein' });
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
    if (fields.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });
    values.push(req.params.groupId);
    await db.execute(`UPDATE rotation_group SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Name bereits vergeben' });
    }
    handleError(res, err);
  }
});

// DELETE /:groupId (master admin only)
router.delete('/:groupId', adminMiddleware, async (req, res) => {
  try {
    await db.execute('DELETE FROM rotation_group WHERE id = ?', [req.params.groupId]);
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
