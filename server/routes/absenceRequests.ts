/**
 * AbsenceRequest-Routen (Read-Only-User → Admin-Approval).
 *
 * Read-Only-User mit verlinktem central_employee_id-Mitarbeiter koennen
 * fuer Urlaub/Frei/Dienstreise (Zukunftstermine) Antraege stellen.
 * Der Admin sieht diese im MyDashboard und kann genehmigen/ablehnen.
 *
 * Erst bei Genehmigung wird der Eintrag in CentralAbsenceEntry geschrieben.
 *
 * Authentication:
 *   - `authMiddleware` (JWT) is required for all endpoints.
 *   - `PATCH /:id` additionally requires `adminMiddleware`.
 *   - Tenant resolution via `x-db-token` Header, exactly like vacation.js.
 */
import express from 'express';
import { authMiddleware } from './auth.js';
import { requirePermission } from '../utils/permissions.js';
import { db } from '../index.js';
import { resolveTenantIdFromToken } from '../utils/tenantGroups.js';
import {
  createAbsenceRequest,
  listAbsenceRequests,
  updateAbsenceRequestStatus,
  deleteAbsenceRequest,
  REQUEST_ABSENCE_POSITIONS,
} from '../utils/absenceRequests.js';

const router = express.Router();
router.use(authMiddleware);

// ─── Helper: Employee-ID aus Tenant-Doctor aufloesen ─────────────────────────

async function resolveEmployeeIdForDoctor(tenantId, doctorId) {
  if (!tenantId || !doctorId) return null;
  const [rows] = await db.execute(
    `SELECT employee_id
       FROM EmployeeTenantAssignment
      WHERE tenant_id = ?
        AND tenant_doctor_id = ?
      LIMIT 1`,
    [tenantId, String(doctorId)]
  );
  return rows.length > 0 ? String(rows[0].employee_id) : null;
}

// ─── GET / — Antraege listen (tenant-scoped) ─────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const dbToken = req.headers['x-db-token'];
    const tenantId = await resolveTenantIdFromToken(db, dbToken);
    if (!tenantId) {
      return res.status(400).json({
        error: 'Mandanten-Token fehlt. Bitte mit aktivem Mandanten verbinden.',
      });
    }

    const isAdmin = req.user?.role === 'admin';
    const { status, year } = req.query;

    // Read-Only-User sehen nur ihre eigenen Antraege
    const doctorId = isAdmin
      ? (req.query.doctorId || null)
      : (req.user?.doctor_id || null);

    const requests = await listAbsenceRequests({
      masterDb: db,
      tenantId,
      doctorId,
      status: status || null,
      year: year ? parseInt(year, 10) : null,
    });

    return res.json({ requests });
  } catch (error) {
    console.error('[absence-requests] GET failed', {
      message: error.message,
      code: error.code,
    });
    return next(error);
  }
});

// ─── POST / — Antrag erstellen (Read-Only oder Admin) ────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const dbToken = req.headers['x-db-token'];
    const tenantId = await resolveTenantIdFromToken(db, dbToken);
    if (!tenantId) {
      return res.status(400).json({
        error: 'Mandanten-Token fehlt. Bitte mit aktivem Mandanten verbinden.',
      });
    }

    const { doctorId, date, position, reason } = req.body || {};
    const isAdmin = req.user?.role === 'admin';

    // Read-Only-User duerfen nur fuer sich selbst antragen
    if (!isAdmin) {
      if (!doctorId || String(doctorId) !== String(req.user?.doctor_id)) {
        return res.status(403).json({
          error: 'Sie koennen nur fuer sich selbst Antraege stellen.',
        });
      }
    }

    if (!doctorId) {
      return res.status(400).json({ error: 'doctorId ist erforderlich.' });
    }
    if (!date) {
      return res.status(400).json({ error: 'Datum (yyyy-mm-dd) ist erforderlich.' });
    }
    if (!position) {
      return res.status(400).json({ error: 'Position ist erforderlich.' });
    }

    // Employee-Verknuepfung aufloesen
    const employeeId = await resolveEmployeeIdForDoctor(tenantId, doctorId);
    if (!employeeId) {
      return res.status(422).json({
        error: 'Mitarbeiter ist nicht zentral verknuepft. Nur verlinkte Mitarbeiter koennen Antraege stellen.',
      });
    }

    const request = await createAbsenceRequest({
      masterDb: db,
      tenantId,
      tenantDoctorId: String(doctorId),
      employeeId,
      date,
      position,
      reason: reason || null,
      createdBy: req.user?.sub || null,
    });

    return res.status(201).json({ request });
  } catch (error) {
    // Fehler mit statusCode werden als kontrollierte Fehler behandelt
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[absence-requests] POST failed', {
      message: error.message,
      code: error.code,
    });
    return next(error);
  }
});

// ─── PATCH /:id — Antrag genehmigen/ablehnen (Admin only) ────────────────────

router.patch('/:id', requirePermission('can_approve_absence'), async (req, res, next) => {
  try {
    const { status, admin_comment } = req.body || {};
    const requestId = req.params.id;

    const updated = await updateAbsenceRequestStatus({
      masterDb: db,
      requestId,
      status,
      adminUserId: req.user?.sub || null,
      adminComment: admin_comment || null,
    });

    return res.json({ request: updated });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[absence-requests] PATCH failed', {
      requestId: req.params.id,
      message: error.message,
    });
    return next(error);
  }
});

// ─── DELETE /:id — Antrag loeschen (Admin oder Antragsteller bei pending/rejected) ─

router.delete('/:id', async (req, res, next) => {
  try {
    const requestId = req.params.id;
    const isAdmin = req.user?.role === 'admin';

    // Admin darf immer loeschen
    if (isAdmin) {
      const deleted = await deleteAbsenceRequest({ masterDb: db, requestId });
      if (!deleted) {
        return res.status(404).json({ error: 'Antrag nicht gefunden.' });
      }
      return res.json({ success: true });
    }

    // Read-Only-User: Pruefen, ob der Antrag ihnen gehoert und pending/rejected ist
    const [rows] = await db.execute(
      'SELECT id, status, source_tenant_doctor_id FROM AbsenceRequest WHERE id = ? LIMIT 1',
      [requestId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Antrag nicht gefunden.' });
    }

    const request = rows[0];
    if (String(request.source_tenant_doctor_id) !== String(req.user?.doctor_id)) {
      return res.status(403).json({ error: 'Sie koennen nur eigene Antraege loeschen.' });
    }
    if (request.status === 'approved') {
      return res.status(422).json({
        error: 'Bereits genehmigte Antraege koennen nicht geloescht werden.',
      });
    }

    const deleted = await deleteAbsenceRequest({ masterDb: db, requestId });
    if (!deleted) {
      return res.status(404).json({ error: 'Antrag nicht gefunden.' });
    }
    return res.json({ success: true });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[absence-requests] DELETE failed', {
      requestId: req.params.id,
      message: error.message,
    });
    return next(error);
  }
});

export default router;
export { REQUEST_ABSENCE_POSITIONS };
