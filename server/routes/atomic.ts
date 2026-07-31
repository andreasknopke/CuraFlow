import express from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { authMiddleware } from './auth.js';
import { requirePermission, checkAdminPermission } from '../utils/permissions.js';
import { writeAuditLog, enrichAuditDetails } from './dbProxy.js';
import { broadcastPlanUpdate, buildRealtimeScope, isPlanSyncEntity } from '../utils/realtime.js';
import { db } from '../index.js';
import {
  deleteCentralAbsenceById,
  getShiftEntryWithCentralAbsence,
  isCentralAbsencePosition,
  listShiftEntriesWithCentralAbsences,
  writeShiftEntryToCentralAbsence,
} from '../utils/centralAbsences.js';
import { resolveTenantIdFromToken } from '../utils/tenantGroups.js';
import { assertValidIdentifier } from '../utils/schema.js';
import { createKysely } from '../utils/db.js';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
// atomic's marshal variant: keeps '' (no ''→null), 9 bool fields, no JSON parse.
// Aliased to the local names the closures already use, so behavior is identical.
import { toSqlValueStrict as toSqlValue, fromSqlRowBasic as fromSqlRow } from '../utils/sqlMarshal.js';

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

// All atomic operations require authentication
router.use(authMiddleware);

const shiftIsoDate = (dateString: string, days: number): string => {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// Helper: check if a position belongs to a "Dienste"-category workplace.
// Fail-closed (F6): on DB error we cannot determine the category, so treat the
// write as protected (return true) — the caller then requires can_edit_schedule.
async function isServicePosition(dbPool: Pool, positionName: string): Promise<boolean> {
  if (!positionName) return false;
  try {
    const [rows] = await dbPool.execute(
      'SELECT category FROM Workplace WHERE name = ? LIMIT 1',
      [positionName],
    ) as [RowDataPacket[], unknown];
    return rows.length > 0 && rows[0].category === 'Dienste';
  } catch (err) {
    console.error('[isServicePosition] lookup failed, treating as protected:', (err as Error).message);
    return true;
  }
}

// ===== ATOMIC OPERATIONS ENDPOINT =====
router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const curaReq = req as unknown as CuraRequest;
    const { operation, entity, id, data, check } = req.body as Record<string, unknown>;
    const dbPool = curaReq.db; // Set by tenantDbMiddleware
    const userEmail = curaReq.user?.email || 'system';
    const realtimeScope = buildRealtimeScope(curaReq.dbToken);
    const actor = {
      id: curaReq.user?.sub || undefined,
      email: userEmail,
    };
    const tenantId = curaReq.dbToken ? await resolveTenantIdFromToken(db, curaReq.dbToken) : null;

    // Helper: Get single record
    const getRecord = async (tableName: string, recordId: string): Promise<Record<string, unknown> | null> => {
      // SELECT through Kysely (PR 1.4) — table identifier escaped centrally.
      const kysely = createKysely(dbPool);
      const rows = await (kysely as unknown as Kysely<Record<string, Record<string, unknown>>>).selectFrom(tableName).selectAll().where('id', '=', recordId).limit(1).execute();
      return rows[0] ? fromSqlRow(rows[0]) : null;
    };

    const getShiftAwareRecord = async (tableName: string, recordId: string): Promise<Record<string, unknown> | null> => {
      if (tableName === 'ShiftEntry' && curaReq.db) {
        return await getShiftEntryWithCentralAbsence({ tenantDb: dbPool, masterDb: db, id: recordId });
      }
      return await getRecord(tableName, recordId);
    };

    // Helper: Filter records
    const filterRecords = async (tableName: string, filter: Record<string, unknown>): Promise<Record<string, unknown>[]> => {
      if (tableName === 'ShiftEntry' && curaReq.db) {
        return await listShiftEntriesWithCentralAbsences({
          tenantDb: dbPool,
          masterDb: db,
          filters: filter,
        });
      }

      // SELECT through Kysely (PR 1.4) — table + EVERY filter key escaped
      // centrally via sql.ref(key). This closes the previously-unvalidated
      // filter-key interpolation (atomic's filterRecords was equality-only and
      // interpolated `\`${key}\`` with no escaping). Values bound as params.
      const kysely = createKysely(dbPool);
      let query = (kysely as unknown as Kysely<Record<string, Record<string, unknown>>>).selectFrom(tableName).selectAll();
      for (const [key, val] of Object.entries(filter)) {
        query = query.where(sql.ref(key), '=', toSqlValue(val));
      }
      const rows = await query.execute();
      return rows.map(fromSqlRow).filter((r): r is Record<string, unknown> => r !== null);
    };

    // Helper: Create record
    const createRecord = async (tableName: string, createData: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (tableName === 'ShiftEntry' && curaReq.db && isCentralAbsencePosition(createData?.position)) {
        const created = await writeShiftEntryToCentralAbsence({
          tenantDb: dbPool,
          masterDb: db,
          tenantId: tenantId as string,
          shiftEntry: createData,
          doctorId: createData.doctor_id as string,
          preserveId: true,
        });
        if (created) {
          return created;
        }
      }

      if (!createData.id) createData.id = crypto.randomUUID();
      createData.created_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
      createData.updated_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
      createData.created_by = userEmail;

      // INSERT through Kysely (PR 1.4) — table + column identifiers escaped
      // centrally. Behavior matches the previous hand-built
      // `INSERT INTO \`t\` (\`k\`,...) VALUES (?,...)`.
      const kysely = createKysely(dbPool);
      const row: Record<string, unknown> = {};
      for (const k of Object.keys(createData)) {
        const v = toSqlValue(createData[k]);
        row[k] = v === undefined ? null : v;
      }
      await (kysely as unknown as Kysely<Record<string, Record<string, unknown>>>).insertInto(tableName).values(row).executeTakeFirst();
      return createData;
    };

    // Helper: Update record
    const updateRecord = async (tableName: string, recordId: string, updateData: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      if (tableName === 'ShiftEntry' && curaReq.db) {
        const current = await getShiftAwareRecord(tableName, recordId);
        const nextPosition = (updateData.position || current?.position) as string | undefined;
        if (current && isCentralAbsencePosition(nextPosition)) {
          const updated = await writeShiftEntryToCentralAbsence({
            tenantDb: dbPool,
            masterDb: db,
            tenantId: tenantId as string,
            shiftEntry: { ...current, ...updateData, id: recordId },
            doctorId: (updateData.doctor_id || current.doctor_id) as string,
            preserveId: true,
          });
          if (updated) {
            return updated;
          }
        }
        if (current && isCentralAbsencePosition(current.position as string) && !isCentralAbsencePosition(nextPosition)) {
          await deleteCentralAbsenceById(db, recordId);
          const replacement: Record<string, unknown> = { ...current, ...updateData, id: recordId };
          // INSERT through Kysely (PR 1.4) — identifiers escaped centrally.
          const kyselyIns = createKysely(dbPool);
          const insRow: Record<string, unknown> = {};
          for (const key of Object.keys(replacement)) {
            const v = toSqlValue(replacement[key]);
            insRow[key] = v === undefined ? null : v;
          }
          await (kyselyIns as unknown as Kysely<Record<string, Record<string, unknown>>>).insertInto(tableName).values(insRow).executeTakeFirst();
          return await getShiftAwareRecord(tableName, recordId);
        }
      }

      updateData.updated_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
      // UPDATE through Kysely (PR 1.4) — table + column identifiers escaped
      // centrally. Behavior matches the previous hand-built
      // `UPDATE \`t\` SET \`k\`=?,... WHERE id = ?`.
      const kysely = createKysely(dbPool);
      const setObj: Record<string, unknown> = {};
      for (const k of Object.keys(updateData).filter((k: string) => k !== 'id')) {
        const v = toSqlValue(updateData[k]);
        setObj[k] = v === undefined ? null : v;
      }
      await (kysely as unknown as Kysely<Record<string, Record<string, unknown>>>).updateTable(tableName).set(setObj).where('id', '=', recordId).executeTakeFirst();
      return await getShiftAwareRecord(tableName, recordId);
    };

    // Helper: Delete record
    const deleteRecord = async (tableName: string, recordId: string) => {
      if (tableName === 'ShiftEntry' && curaReq.db) {
        const current = await getRecord(tableName, recordId);
        if (!current) {
          const centralCurrent = await getShiftEntryWithCentralAbsence({ tenantDb: dbPool, masterDb: db, id: recordId });
          if (centralCurrent && isCentralAbsencePosition(centralCurrent.position as string)) {
            await deleteCentralAbsenceById(db, recordId);
            return { success: true };
          }
        }
      }

      // Fetch record before deletion for audit log, then DELETE — both through
      // Kysely (PR 1.4) so the table identifier is escaped centrally. Behavior
      // matches the previous hand-built `SELECT * FROM \`t\` WHERE id = ?` /
      // `DELETE FROM \`t\` WHERE id = ?`.
      const kysely = createKysely(dbPool);
      const existingRows = await (kysely as unknown as Kysely<Record<string, Record<string, unknown>>>).selectFrom(tableName).selectAll().where('id', '=', recordId).limit(1).execute();
      const deletedRecord = existingRows[0] ? fromSqlRow(existingRows[0]) : null;

      await (kysely as unknown as Kysely<Record<string, Record<string, unknown>>>).deleteFrom(tableName).where('id', '=', recordId).executeTakeFirst();
      
      // Write audit to SystemLog table
      const timestamp = new Date().toISOString();
      const auditDetails = await enrichAuditDetails(dbPool, {
        table: tableName, record_id: recordId, deleted_data: deletedRecord, timestamp,
      });
      const auditMessage = auditDetails.summary
        ? `${tableName} gelöscht: ${auditDetails.summary} von ${userEmail}`
        : `${tableName} gelöscht von ${userEmail} (ID: ${recordId})`;
      await writeAuditLog(dbPool, {
        level: 'audit',
        source: 'Löschung',
        message: auditMessage,
        details: auditDetails,
        userEmail
      });
      
      return { success: true };
    };

    // ===== OPERATION: checkAndUpdate =====
    // Optimistic locking - check updated_date before updating
    if (operation === 'checkAndUpdate') {
      if (!entity || !id) {
        res.status(400).json({ error: 'entity und id sind erforderlich' });
        return;
      }
      // entity is interpolated into backtick-quoted identifiers; validate it.
      // Throws a 400 on an invalid name (forwarded via next(error)).
      assertValidIdentifier(entity as string, 'entity');

      const current = await getShiftAwareRecord(entity as string, id as string);
      if (!current) {
        res.status(404).json({ 
          error: 'NOT_FOUND', 
          message: 'Eintrag nicht gefunden.' 
        });
        return;
      }

      // ShiftEntry write guard — only for Dienste positions
      if (entity === 'ShiftEntry') {
        const pool = curaReq.db || db;
        const position = (data as Record<string, unknown>)?.position || current.position;
        const isDienste = position ? await isServicePosition(pool, position as string) : false;
        if (isDienste) {
          // Authoritative check: role/is_active from the DB row, not the JWT
          // (S7 / F4). checkAdminPermission is fail-closed.
          let canEdit = false;
          try {
            canEdit = (await checkAdminPermission(db, curaReq.user?.sub as string, 'can_edit_schedule')).allowed;
          } catch { /* deny */ }
          if (!canEdit) {
            res.status(403).json({ error: 'Ihnen fehlt die Berechtigung f\u00fcr diese Aktion', missingPermission: 'can_edit_schedule' });
            return;
          }
        }
      }

      // Check for concurrent modification
      if (check && (check as Record<string, unknown>).updated_date) {
        const dbDate = new Date(current.updated_date as string).getTime();
        const clientDate = new Date((check as Record<string, unknown>).updated_date as string).getTime();
        
        if (dbDate !== clientDate) {
          res.status(409).json({
            error: 'CONCURRENCY_ERROR',
            message: 'Daten wurden von einem anderen Benutzer geändert.',
            currentData: current
          });
          return;
        }
      }

      const result = await updateRecord(entity as string, id as string, data as Record<string, unknown>);
      if (isPlanSyncEntity(entity as string)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: entity as string,
          action: 'update',
          recordId: id as string,
          actor,
        });
      }
      res.json(result);
      return;
    }

    // ===== OPERATION: checkAndCreate =====
    // Check for duplicates before creating
    if (operation === 'checkAndCreate') {
      // ShiftEntry write guard — only for Dienste positions
      if (entity === 'ShiftEntry') {
        const pool = curaReq.db || db;
        const position = (data as Record<string, unknown>)?.position;
        const isDienste = position ? await isServicePosition(pool, position as string) : false;
        if (isDienste) {
          // Authoritative check: role/is_active from the DB row, not the JWT
          // (S7 / F4). checkAdminPermission is fail-closed.
          let canEdit = false;
          try {
            canEdit = (await checkAdminPermission(db, curaReq.user?.sub as string, 'can_edit_schedule')).allowed;
          } catch { /* deny */ }
          if (!canEdit) {
            res.status(403).json({ error: 'Ihnen fehlt die Berechtigung f\u00fcr diese Aktion', missingPermission: 'can_edit_schedule' });
            return;
          }
        }
      }
      if (!entity || !data) {
        res.status(400).json({ error: 'entity und data sind erforderlich' });
        return;
      }
      // entity is interpolated into backtick-quoted identifiers; validate it.
      // Throws a 400 on an invalid name (forwarded via next(error)).
      assertValidIdentifier(entity as string, 'entity');

      // Check for existing record with same unique keys
      if (check && (check as Record<string, unknown>).uniqueKeys) {
        const filter: Record<string, unknown> = {};
        ((check as Record<string, unknown>).uniqueKeys as string[]).forEach((k: string) => {
          const dataObj = data as Record<string, unknown>;
          if (dataObj[k] !== undefined) filter[k] = dataObj[k];
        });

        if (Object.keys(filter).length > 0) {
          const existing = await filterRecords(entity as string, filter);
          if (existing.length > 0) {
            res.status(409).json({
              error: 'DUPLICATE_ERROR',
              message: 'Eintrag existiert bereits.',
              existingEntry: existing[0]
            });
            return;
          }
        }
      }

      const result = await createRecord(entity as string, data as Record<string, unknown>);
      if (isPlanSyncEntity(entity as string)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: entity as string,
          action: 'create',
          recordId: result.id as string,
          actor,
        });
      }
      res.json(result);
      return;
    }

    // ===== OPERATION: upsertStaffing =====
    // Special upsert logic for StaffingPlanEntry
    if (operation === 'upsertStaffing') {
      const upsertData = data as Record<string, unknown> || {};
      const { doctor_id, year, month, value, old_value_check, status_start_day, status_end_day } = upsertData;

      if (!doctor_id || !year || !month) {
        res.status(400).json({ error: 'doctor_id, year und month sind erforderlich' });
        return;
      }

      const existingList = await filterRecords('StaffingPlanEntry', { doctor_id: doctor_id as string, year: year as string, month: month as string });
      const existing = existingList[0];

      const payload: Record<string, unknown> = { value };
      if (status_start_day !== undefined) payload.status_start_day = status_start_day;
      if (status_end_day !== undefined) payload.status_end_day = status_end_day;

      if (existing) {
        // Check for concurrent modification
        if (old_value_check !== undefined && existing.value != old_value_check) {
          res.status(409).json({
            error: 'CONCURRENCY_ERROR',
            message: 'Wert wurde von einem anderen Benutzer geändert.',
            currentValue: existing.value
          });
          return;
        }

        // Delete if empty value
        if (value === '' || value === null || value === undefined) {
          await deleteRecord('StaffingPlanEntry', existing.id as string);
          broadcastPlanUpdate({
            scope: realtimeScope,
            entity: 'StaffingPlanEntry',
            action: 'delete',
            recordId: existing.id as string,
            actor,
          });
          res.json({ deleted: true, id: existing.id });
          return;
        }

        // Update existing
        const result = await updateRecord('StaffingPlanEntry', existing.id as string, payload);
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: 'StaffingPlanEntry',
          action: 'update',
          recordId: existing.id as string,
          actor,
        });
        res.json(result);
        return;
      } else {
        // Skip if empty value
        if (value === '' || value === null || value === undefined) {
          res.json({ skipped: true });
          return;
        }

        // Create new
        const result = await createRecord('StaffingPlanEntry', { doctor_id, year, month, ...payload });
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: 'StaffingPlanEntry',
          action: 'create',
          recordId: result.id as string,
          actor,
        });
        res.json(result);
        return;
      }
    }

    if (operation === 'replaceTrainingRotationRange') {
      const payload = (data as Record<string, unknown>) || {};
      const doctorId = payload.doctor_id;
      const modality = payload.modality || null;
      const inputStart = payload.start_date;
      const inputEnd = payload.end_date;

      if (!doctorId || !inputStart || !inputEnd) {
        res.status(400).json({ error: 'doctor_id, start_date und end_date sind erforderlich' });
        return;
      }

      const startDate = (inputStart as string) <= (inputEnd as string) ? inputStart as string : inputEnd as string;
      const endDate = (inputStart as string) <= (inputEnd as string) ? inputEnd as string : inputStart as string;
      const leftNeighborDate = shiftIsoDate(startDate, -1);
      const rightNeighborDate = shiftIsoDate(endDate, 1);
      const connection = await dbPool.getConnection();
      let changedCount = 0;

      const insertRotation = async (rotationData: Record<string, unknown>): Promise<string> => {
        const rotationId = crypto.randomUUID();
        const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await connection.execute(
          `INSERT INTO \`TrainingRotation\` (\`id\`, \`created_date\`, \`updated_date\`, \`created_by\`, \`doctor_id\`, \`modality\`, \`start_date\`, \`end_date\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rotationId,
            createdAt,
            createdAt,
            userEmail,
            rotationData.doctor_id,
            rotationData.modality,
            rotationData.start_date,
            rotationData.end_date,
          ]
        );
        changedCount += 1;
        return rotationId;
      };

      try {
        await connection.beginTransaction();

        const [overlappingRows] = await connection.execute(
          `SELECT * FROM \`TrainingRotation\` WHERE \`doctor_id\` = ? AND \`start_date\` <= ? AND \`end_date\` >= ? ORDER BY \`start_date\` ASC, \`id\` ASC FOR UPDATE`,
          [doctorId, endDate, startDate]
        ) as [RowDataPacket[], unknown];

        for (const row of overlappingRows) {
          if (row.start_date >= startDate && row.end_date <= endDate) {
            await connection.execute('DELETE FROM `TrainingRotation` WHERE `id` = ?', [row.id]);
            changedCount += 1;
            continue;
          }

          if (row.start_date < startDate && row.end_date > endDate) {
            await connection.execute(
              'UPDATE `TrainingRotation` SET `end_date` = ?, `updated_date` = ? WHERE `id` = ?',
              [shiftIsoDate(startDate, -1), new Date().toISOString().slice(0, 19).replace('T', ' '), row.id]
            );
            changedCount += 1;
            await insertRotation({
              doctor_id: row.doctor_id,
              modality: row.modality,
              start_date: rightNeighborDate,
              end_date: row.end_date,
            });
            continue;
          }

          if (row.start_date < startDate) {
            await connection.execute(
              'UPDATE `TrainingRotation` SET `end_date` = ?, `updated_date` = ? WHERE `id` = ?',
              [shiftIsoDate(startDate, -1), new Date().toISOString().slice(0, 19).replace('T', ' '), row.id]
            );
            changedCount += 1;
            continue;
          }

          if (row.end_date > endDate) {
            await connection.execute(
              'UPDATE `TrainingRotation` SET `start_date` = ?, `updated_date` = ? WHERE `id` = ?',
              [rightNeighborDate, new Date().toISOString().slice(0, 19).replace('T', ' '), row.id]
            );
            changedCount += 1;
          }
        }

        if (modality) {
          const [mergeRows] = await connection.execute(
            `SELECT * FROM \`TrainingRotation\` WHERE \`doctor_id\` = ? AND \`modality\` = ? AND \`start_date\` <= ? AND \`end_date\` >= ? ORDER BY \`start_date\` ASC, \`id\` ASC FOR UPDATE`,
            [doctorId, modality, rightNeighborDate, leftNeighborDate]
          ) as [RowDataPacket[], unknown];

          let mergedStart = startDate;
          let mergedEnd = endDate;

          for (const row of mergeRows) {
            if (row.start_date < mergedStart) {
              mergedStart = row.start_date;
            }
            if (row.end_date > mergedEnd) {
              mergedEnd = row.end_date;
            }
            await connection.execute('DELETE FROM `TrainingRotation` WHERE `id` = ?', [row.id]);
            changedCount += 1;
          }

          await insertRotation({
            doctor_id: doctorId,
            modality,
            start_date: mergedStart,
            end_date: mergedEnd,
          });
        }

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      if (changedCount > 0) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: 'TrainingRotation',
          action: 'bulkUpdate',
          recordCount: changedCount,
          actor,
        });
      }

      res.json({
        success: true,
        changedCount,
        doctor_id: doctorId,
        modality,
        start_date: startDate,
        end_date: endDate,
      });
      return;
    }

    res.status(400).json({ error: 'Invalid operation', validOperations: ['checkAndUpdate', 'checkAndCreate', 'upsertStaffing', 'replaceTrainingRotationRange'] });
    return;

  } catch (error) {
    console.error('Atomic operation error:', error);
    next(error);
  }
});

export default router;
