import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Request, Response, NextFunction } from 'express';
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

type ExtendedRequest = Request & {
  user?: { sub?: string; role?: string; doctor_id?: string; [key: string]: unknown };
};

// ─── Helper: Employee-ID aus Tenant-Doctor aufloesen ─────────────────────────

async function resolveEmployeeIdForDoctor(tenantId: unknown, doctorId: unknown): Promise<string | null> {
  if (!tenantId || !doctorId) return null;
  const [rows] = await db.execute(
    `SELECT employee_id
       FROM EmployeeTenantAssignment
      WHERE tenant_id = ?
        AND tenant_doctor_id = ?
      LIMIT 1`,
    [tenantId, String(doctorId)]
  ) as [RowDataPacket[], unknown];
  return rows.length > 0 ? String(rows[0].employee_id) : null;
}

// ─── GET / — Antraege listen (tenant-scoped) ─────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dbToken = req.headers['x-db-token'] as string | undefined;
    const tenantId = await resolveTenantIdFromToken(db, dbToken);
    if (!tenantId) {
      res.status(400).json({
        error: 'Mandanten-Token fehlt. Bitte mit aktivem Mandanten verbinden.',
      });
      return;
    }

    const extReq = req as ExtendedRequest;
    const isAdmin = extReq.user?.role === 'admin';
    const { status, year } = req.query as Record<string, unknown>;

    // Read-Only-User sehen nur ihre eigenen Antraege
    const doctorId = isAdmin
      ? (req.query.doctorId as string | undefined) || null
      : (extReq.user?.doctor_id as string | undefined) || null;

    const requests = await listAbsenceRequests({
      masterDb: db,
      tenantId,
      doctorId,
      status: status ? String(status) : null,
      year: year ? parseInt(String(year), 10) : null,
    });

    res.json({ requests });
    return;
  } catch (error) {
    console.error('[absence-requests] GET failed', {
      message: (error as Error).message,
      code: (error as { code?: string }).code,
    });
    return next(error);
  }
});

// ─── POST / — Antrag erstellen (Read-Only oder Admin) ────────────────────────

router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dbToken = req.headers['x-db-token'] as string | undefined;
    const tenantId = await resolveTenantIdFromToken(db, dbToken);
    if (!tenantId) {
      res.status(400).json({
        error: 'Mandanten-Token fehlt. Bitte mit aktivem Mandanten verbinden.',
      });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const { doctorId, date, position, reason } = body;
    const extReq = req as ExtendedRequest;
    const isAdmin = extReq.user?.role === 'admin';

    // Read-Only-User duerfen nur fuer sich selbst antragen
    if (!isAdmin) {
      if (!doctorId || String(doctorId) !== String(extReq.user?.doctor_id)) {
        res.status(403).json({
          error: 'Sie koennen nur fuer sich selbst Antraege stellen.',
        });
        return;
      }
    }

    if (!doctorId) {
      res.status(400).json({ error: 'doctorId ist erforderlich.' });
      return;
    }
    if (!date) {
      res.status(400).json({ error: 'Datum (yyyy-mm-dd) ist erforderlich.' });
      return;
    }
    if (!position) {
      res.status(400).json({ error: 'Position ist erforderlich.' });
      return;
    }

    // Employee-Verknuepfung aufloesen
    const employeeId = await resolveEmployeeIdForDoctor(tenantId, doctorId);
    if (!employeeId) {
      res.status(422).json({
        error: 'Mitarbeiter ist nicht zentral verknuepft. Nur verlinkte Mitarbeiter koennen Antraege stellen.',
      });
      return;
    }

    const request = await createAbsenceRequest({
      masterDb: db,
      tenantId,
      tenantDoctorId: String(doctorId),
      employeeId,
      date: date as string,
      position: position as string,
      reason: reason ? String(reason) : null,
      createdBy: String(extReq.user?.sub || ''),
    });

    res.status(201).json({ request });
    return;
  } catch (error) {
    // Fehler mit statusCode werden als kontrollierte Fehler behandelt
    if ((error as { statusCode?: number }).statusCode) {
      res.status((error as { statusCode: number }).statusCode).json({ error: (error as Error).message });
      return;
    }
    console.error('[absence-requests] POST failed', {
      message: (error as Error).message,
      code: (error as { code?: string }).code,
    });
    return next(error);
  }
});

// ─── PATCH /:id — Antrag genehmigen/ablehnen (Admin only) ────────────────────

router.patch('/:id', requirePermission('can_approve_absence'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const { status, admin_comment } = body;
    const requestId = req.params.id as string;
    const extReq = req as ExtendedRequest;

    const updated = await updateAbsenceRequestStatus({
      masterDb: db,
      requestId,
      status: status as string,
      adminUserId: String(extReq.user?.sub || ''),
      adminComment: admin_comment ? String(admin_comment) : null,
    });

    res.json({ request: updated });
    return;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      res.status((error as { statusCode: number }).statusCode).json({ error: (error as Error).message });
      return;
    }
    console.error('[absence-requests] PATCH failed', {
      requestId: req.params.id,
      message: (error as Error).message,
    });
    return next(error);
  }
});

// ─── DELETE /:id — Antrag loeschen (Admin oder Antragsteller bei pending/rejected) ─

router.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const requestId = req.params.id as string;
    const extReq = req as ExtendedRequest;
    const isAdmin = extReq.user?.role === 'admin';

    // Admin darf immer loeschen
    if (isAdmin) {
      const deleted = await deleteAbsenceRequest({ masterDb: db, requestId });
      if (!deleted) {
        res.status(404).json({ error: 'Antrag nicht gefunden.' });
        return;
      }
      res.json({ success: true });
      return;
    }

    // Read-Only-User: Pruefen, ob der Antrag ihnen gehoert und pending/rejected ist
    const [rows] = await db.execute(
      'SELECT id, status, source_tenant_doctor_id FROM AbsenceRequest WHERE id = ? LIMIT 1',
      [requestId]
    ) as [RowDataPacket[], unknown];
    if (rows.length === 0) {
      res.status(404).json({ error: 'Antrag nicht gefunden.' });
      return;
    }

    const request = rows[0];
    if (String(request.source_tenant_doctor_id) !== String(extReq.user?.doctor_id)) {
      res.status(403).json({ error: 'Sie koennen nur eigene Antraege loeschen.' });
      return;
    }
    if (request.status === 'approved') {
      res.status(422).json({
        error: 'Bereits genehmigte Antraege koennen nicht geloescht werden.',
      });
      return;
    }

    const deleted = await deleteAbsenceRequest({ masterDb: db, requestId });
    if (!deleted) {
      res.status(404).json({ error: 'Antrag nicht gefunden.' });
      return;
    }
    res.json({ success: true });
    return;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      res.status((error as { statusCode: number }).statusCode).json({ error: (error as Error).message });
      return;
    }
    console.error('[absence-requests] DELETE failed', {
      requestId: req.params.id,
      message: (error as Error).message,
    });
    return next(error);
  }
});

export default router;
export { REQUEST_ABSENCE_POSITIONS };
