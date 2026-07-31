import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Request, Response, NextFunction } from 'express';
/**
 * Tenant-side vacation endpoints.
 *
 * Surfaces the central `CentralAbsenceEntry` table to the tenant frontend
 * (e.g. DoctorYearView) without depending on the ShiftEntry merge path
 * inside `dbProxy`. This is the authoritative source for absences of
 * employees that have been linked to the central Employee database and
 * migrated to the central absence table.
 *
 * Without this endpoint the tenant-frontend would only see absence rows
 * that still exist in the local `ShiftEntry` table — once the
 * "Migrate linked absences" job runs, the local rows are removed and
 * only the central rows remain.
 *
 * Authentication:
 *   - `authMiddleware` (JWT in Authorization header) is required.
 *   - Tenant resolution uses the `x-db-token` header, exactly like
 *     `/api/groups`. Users without a tenant token get a 400.
 *
 * The endpoint never exposes data from other tenants: the link is
 * resolved strictly from `EmployeeTenantAssignment` rows for the
 * active tenant.
 */
import express from 'express';
import { authMiddleware } from './auth.js';
import { requirePermission } from '../utils/permissions.js';
import { db } from '../index.js';
import { resolveTenantIdFromToken } from '../utils/tenantGroups.js';
import {
  fetchCentralAbsencesForDoctor,
  VACATION_ABSENCE_POSITIONS,
  VACATION_ABSENCE_POSITIONS_SET,
} from '../utils/vacationCentralAbsences.js';
import {
  getShiftVacationEntitlement,
  setShiftVacationEntitlement,
  carryOverShiftVacation,
} from '../utils/shiftVacationEntitlement.js';

const router = express.Router();
router.use(authMiddleware);

type ExtendedRequest = Request & {
  user?: { sub?: string; role?: string; doctor_id?: string; [key: string]: unknown };
};

/**
 * GET /api/vacation/central-absences
 *   ?year=2026          (required)
 *   &doctorId=123       (required, tenant-local Doctor.id)
 *
 * Returns the central absence rows for the given tenant doctor in the
 * given year. The rows are normalised to the same `date/position/note`
 * shape the tenant `ShiftEntry` uses, so the frontend can merge both
 * sources transparently.
 */
router.get('/central-absences', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const year = parseInt(String(req.query.year), 10);
    const doctorId = req.query.doctorId;

    if (!Number.isFinite(year) || year < 1970 || year > 2999) {
      res.status(400).json({ error: 'Parameter "year" ist erforderlich (z.B. 2026).' });
      return;
    }
    if (doctorId == null || doctorId === '') {
      res.status(400).json({ error: 'Parameter "doctorId" ist erforderlich.' });
      return;
    }

    const dbToken = (req.headers['x-db-token'] as string | undefined);
    const tenantId = await resolveTenantIdFromToken(db, dbToken);
    if (!tenantId) {
      res.status(400).json({
        error: 'Mandanten-Token fehlt. Bitte mit aktivem Mandanten verbinden.',
      });
      return;
    }

    const { employee_id, absences, vacation_days_annual } = await fetchCentralAbsencesForDoctor({
      db,
      tenantId,
      doctorId: String(doctorId),
      year,
    });

    res.json({
      year,
      doctorId: String(doctorId),
      employee_id,
      absences,
      vacation_days_annual,
    });
    return;
  } catch (error) {
    console.error('[vacation] central-absences failed', {
      year: req.query.year,
      doctorId: req.query.doctorId,
      message: (error as Error).message,
      code: (error as { code?: string }).code,
    });
    return next(error);
  }
});

// Re-export so consumers can introspect the supported positions without
// pulling in the utils module directly.
export { VACATION_ABSENCE_POSITIONS, VACATION_ABSENCE_POSITIONS_SET };

/**
 * Resolves the central `employee_id` for a tenant doctor. Returns `null`
 * if the doctor has no central link. Used by the shift-entitlement
 * endpoints below so they don't need to repeat the assignment lookup.
 */
async function resolveEmployeeIdForDoctor(tenantId: unknown, doctorId: unknown): Promise<string | null> {
  if (!tenantId) return null;
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

/**
 * GET /api/vacation/shift-entitlement
 *   ?year=2026          (required)
 *   &doctorId=123       (required, tenant-local Doctor.id)
 *
 * Reads the year-specific shift-/Sonderurlaubs-Anspruch for a linked
 * doctor. Returns `{ employee_id: null, shift_vacation_days: 0, ... }`
 * when the doctor is not linked or has no row yet (default 0).
 */
router.get('/shift-entitlement', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const year = parseInt(String(req.query.year), 10);
    const doctorId = req.query.doctorId;
    if (!Number.isFinite(year) || year < 1970 || year > 2999) {
      res.status(400).json({ error: 'Parameter "year" ist erforderlich (z.B. 2026).' });
      return;
    }
    if (doctorId == null || doctorId === '') {
      res.status(400).json({ error: 'Parameter "doctorId" ist erforderlich.' });
      return;
    }

    const tenantId = await resolveTenantIdFromToken(db, (req.headers['x-db-token'] as string | undefined));
    if (!tenantId) {
      res.status(400).json({ error: 'Mandanten-Token fehlt.' });
      return;
    }

    const employeeId = await resolveEmployeeIdForDoctor(tenantId, doctorId);
    if (!employeeId) {
      // Unlinked doctor — no central entitlement yet.
      res.json({
        year,
        doctorId: String(doctorId),
        employee_id: null,
        shift_vacation_days: 0,
        carried_over: false,
        carried_over_from_year: null,
        note: null,
      });
      return;
    }

    const entitlement = await getShiftVacationEntitlement(db, employeeId, year);
    res.json({
      year,
      doctorId: String(doctorId),
      employee_id: employeeId,
      ...entitlement,
    });
    return;
  } catch (error) {
    console.error('[vacation] shift-entitlement GET failed', {
      year: req.query.year,
      doctorId: req.query.doctorId,
      message: (error as Error).message,
      code: (error as { code?: string }).code,
    });
    return next(error);
  }
});

/**
 * PUT /api/vacation/shift-entitlement
 *   body: { year, doctorId, shift_vacation_days, note? }
 *
 * Writes the manually-entered shift/Sonderurlaub value for a year.
 * Resets `carried_over` to false and `carried_over_from_year` to null,
 * because a manual edit overwrites a previous carry-over.
 */
router.put('/shift-entitlement', requirePermission('can_manage_shift_vacation'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const { year, doctorId, shift_vacation_days, note } = body;
    if (!Number.isFinite(year as number) || (year as number) < 1970 || (year as number) > 2999) {
      res.status(400).json({ error: 'Body-Feld "year" ist erforderlich.' });
      return;
    }
    if (doctorId == null || doctorId === '') {
      res.status(400).json({ error: 'Body-Feld "doctorId" ist erforderlich.' });
      return;
    }
    const days = Number(shift_vacation_days);
    if (!Number.isFinite(days) || days < 0 || !Number.isInteger(days)) {
      res.status(422).json({ error: '"shift_vacation_days" muss eine nicht-negative Ganzzahl sein.' });
      return;
    }

    const tenantId = await resolveTenantIdFromToken(db, (req.headers['x-db-token'] as string | undefined));
    if (!tenantId) {
      res.status(400).json({ error: 'Mandanten-Token fehlt.' });
      return;
    }

    const employeeId = await resolveEmployeeIdForDoctor(tenantId, doctorId);
    if (!employeeId) {
      res.status(404).json({
        error: 'Mitarbeiter ist nicht zentral verknüpft. Schichturlaub kann nur für verknüpfte Mitarbeiter gepflegt werden.',
      });
      return;
    }

    const extReq = req as ExtendedRequest;
    const entitlement = await setShiftVacationEntitlement(db, employeeId, year as number, {
      shift_vacation_days: days,
      note: note ? String(note) : null,
      carried_over: false,
      carried_over_from_year: null,
      updatedBy: String(extReq.user?.sub || ''),
    });

    res.json({
      year,
      doctorId: String(doctorId),
      employee_id: employeeId,
      ...entitlement,
    });
    return;
  } catch (error) {
    console.error('[vacation] shift-entitlement PUT failed', {
      message: (error as Error).message,
      code: (error as { code?: string }).code,
    });
    return next(error);
  }
});

/**
 * POST /api/vacation/shift-entitlement/carry-over
 *   body: { fromYear, toYear, doctorId }
 *
 * Transfers the remaining shift-vacation days of `fromYear` into the
 * `toYear` row by setting `shift_vacation_days = remaining` and flagging
 * the row as carried_over. Regular 'Urlaub' is intentionally NOT
 * transferred — only Schichturlaub is eligible per tariff rule.
 *
 * Re-running the carry-over is idempotent only insofar as it overwrites
 * the existing factor row. The endpoint refuses to overwrite a target
 * year that is itself already carried_over (to avoid chaining), and
 * refuses a non-positive remainder (no days to carry).
 */
router.post('/shift-entitlement/carry-over', requirePermission('can_manage_shift_vacation'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const { fromYear, toYear, doctorId } = body;
    if (!Number.isFinite(fromYear as number) || !Number.isFinite(toYear as number)) {
      res.status(400).json({ error: 'Body-Felder "fromYear" und "toYear" sind erforderlich.' });
      return;
    }
    if ((toYear as number) !== (fromYear as number) + 1) {
      res.status(422).json({ error: 'Übertrag ist nur in das unmittelbare Folgejahr erlaubt.' });
      return;
    }
    if (doctorId == null || doctorId === '') {
      res.status(400).json({ error: 'Body-Feld "doctorId" ist erforderlich.' });
      return;
    }

    const tenantId = await resolveTenantIdFromToken(db, (req.headers['x-db-token'] as string | undefined));
    if (!tenantId) {
      res.status(400).json({ error: 'Mandanten-Token fehlt.' });
      return;
    }

    const employeeId = await resolveEmployeeIdForDoctor(tenantId, doctorId);
    if (!employeeId) {
      res.status(404).json({ error: 'Mitarbeiter ist nicht zentral verknüpft.' });
      return;
    }

    const extReq = req as ExtendedRequest;
    const result = await carryOverShiftVacation(db, employeeId, {
      fromYear: fromYear as number,
      toYear: toYear as number,
      updatedBy: String(extReq.user?.sub || ''),
    });

    if ((result as { error?: string }).error) {
      // 422 for business-rule violations (no days to carry, already carried).
      res.status(422).json({ error: (result as { error: string }).error });
      return;
    }
    res.json({
      fromYear,
      toYear,
      doctorId: String(doctorId),
      employee_id: employeeId,
      ...result,
    });
    return;
  } catch (error) {
    console.error('[vacation] shift-entitlement carry-over failed', {
      message: (error as Error).message,
      code: (error as { code?: string }).code,
    });
    return next(error);
  }
});

export default router;
