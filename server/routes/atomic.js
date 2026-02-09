import express from 'express';
import crypto from 'crypto';
import { authMiddleware } from './auth.js';
import { writeAuditLog } from './dbProxy.js';

const router = express.Router();

// All atomic operations require authentication
router.use(authMiddleware);

// Helper: Convert JS value to MySQL value
const toSqlValue = (val) => {
  if (val === undefined) return null;
  if (typeof val === 'number' && isNaN(val)) return null;
  if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
    return JSON.stringify(val);
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 19).replace('T', ' ');
  }
  return val;
};

// Helper: Parse MySQL row
const fromSqlRow = (row) => {
  if (!row) return null;
  const res = { ...row };
  const boolFields = [
    'receive_email_notifications', 'exclude_from_staffing_plan', 
    'user_viewed', 'auto_off', 'show_in_service_plan', 
    'allows_rotation_concurrently', 'allows_consecutive_days', 
    'acknowledged', 'is_active'
  ];
  for (const key in res) {
    if (boolFields.includes(key)) res[key] = !!res[key];
  }
  return res;
};

// ===== ATOMIC OPERATIONS ENDPOINT =====
router.post('/', async (req, res, next) => {
  try {
    const { operation, entity, id, data, check } = req.body;
    const dbPool = req.db; // Set by tenantDbMiddleware
    const userEmail = req.user?.email || 'system';

    // Helper: Get single record
    const getRecord = async (tableName, recordId) => {
      const [rows] = await dbPool.execute(
        `SELECT * FROM \`${tableName}\` WHERE id = ?`, 
        [recordId]
      );
      return rows[0] ? fromSqlRow(rows[0]) : null;
    };

    // Helper: Filter records
    const filterRecords = async (tableName, filter) => {
      const clauses = [];
      const params = [];
      for (const [key, val] of Object.entries(filter)) {
        clauses.push(`\`${key}\` = ?`);
        params.push(toSqlValue(val));
      }
      const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      const [rows] = await dbPool.execute(
        `SELECT * FROM \`${tableName}\`${whereClause}`, 
        params
      );
      return rows.map(fromSqlRow);
    };

    // Helper: Create record
    const createRecord = async (tableName, createData) => {
      if (!createData.id) createData.id = crypto.randomUUID();
      createData.created_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
      createData.updated_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
      createData.created_by = userEmail;

      const keys = Object.keys(createData);
      const values = keys.map(k => toSqlValue(createData[k]));
      const placeholders = keys.map(() => '?').join(',');
      
      await dbPool.execute(
        `INSERT INTO \`${tableName}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`, 
        values
      );
      return createData;
    };

    // Helper: Update record
    const updateRecord = async (tableName, recordId, updateData) => {
      updateData.updated_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const keys = Object.keys(updateData).filter(k => k !== 'id');
      const sets = keys.map(k => `\`${k}\` = ?`).join(',');
      const values = keys.map(k => toSqlValue(updateData[k]));
      values.push(recordId);
      
      await dbPool.execute(
        `UPDATE \`${tableName}\` SET ${sets} WHERE id = ?`, 
        values
      );
      return await getRecord(tableName, recordId);
    };

    // Helper: Delete record
    const deleteRecord = async (tableName, recordId) => {
      // Fetch record before deletion for audit log
      const [existingRows] = await dbPool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [recordId]);
      const deletedRecord = existingRows[0] ? fromSqlRow(existingRows[0]) : null;
      
      await dbPool.execute(`DELETE FROM \`${tableName}\` WHERE id = ?`, [recordId]);
      
      // Write audit to SystemLog table
      const timestamp = new Date().toISOString();
      await writeAuditLog(dbPool, {
        level: 'audit',
        source: 'Löschung',
        message: `${tableName} gelöscht von ${userEmail} (ID: ${recordId})`,
        details: { table: tableName, record_id: recordId, deleted_data: deletedRecord, timestamp },
        userEmail
      });
      
      return { success: true };
    };

    // ===== OPERATION: checkAndUpdate =====
    // Optimistic locking - check updated_date before updating
    if (operation === 'checkAndUpdate') {
      if (!entity || !id) {
        return res.status(400).json({ error: 'entity und id sind erforderlich' });
      }

      const current = await getRecord(entity, id);
      if (!current) {
        return res.status(404).json({ 
          error: 'NOT_FOUND', 
          message: 'Eintrag nicht gefunden.' 
        });
      }

      // Check for concurrent modification
      if (check && check.updated_date) {
        const dbDate = new Date(current.updated_date).getTime();
        const clientDate = new Date(check.updated_date).getTime();
        
        if (dbDate !== clientDate) {
          return res.status(409).json({
            error: 'CONCURRENCY_ERROR',
            message: 'Daten wurden von einem anderen Benutzer geändert.',
            currentData: current
          });
        }
      }

      const result = await updateRecord(entity, id, data);
      return res.json(result);
    }

    // ===== OPERATION: checkAndCreate =====
    // Check for duplicates before creating
    if (operation === 'checkAndCreate') {
      if (!entity || !data) {
        return res.status(400).json({ error: 'entity und data sind erforderlich' });
      }

      // Check for existing record with same unique keys
      if (check && check.uniqueKeys) {
        const filter = {};
        check.uniqueKeys.forEach(k => {
          if (data[k] !== undefined) filter[k] = data[k];
        });

        if (Object.keys(filter).length > 0) {
          const existing = await filterRecords(entity, filter);
          if (existing.length > 0) {
            return res.status(409).json({
              error: 'DUPLICATE_ERROR',
              message: 'Eintrag existiert bereits.',
              existingEntry: existing[0]
            });
          }
        }
      }

      const result = await createRecord(entity, data);
      return res.json(result);
    }

    // ===== OPERATION: upsertStaffing =====
    // Special upsert logic for StaffingPlanEntry
    if (operation === 'upsertStaffing') {
      const { doctor_id, year, month, value, old_value_check } = data || {};

      if (!doctor_id || !year || !month) {
        return res.status(400).json({ error: 'doctor_id, year und month sind erforderlich' });
      }

      const existingList = await filterRecords('StaffingPlanEntry', { doctor_id, year, month });
      const existing = existingList[0];

      if (existing) {
        // Check for concurrent modification
        if (old_value_check !== undefined && existing.value != old_value_check) {
          return res.status(409).json({
            error: 'CONCURRENCY_ERROR',
            message: 'Wert wurde von einem anderen Benutzer geändert.',
            currentValue: existing.value
          });
        }

        // Delete if empty value
        if (value === '' || value === null || value === undefined) {
          await deleteRecord('StaffingPlanEntry', existing.id);
          return res.json({ deleted: true, id: existing.id });
        }

        // Update existing
        const result = await updateRecord('StaffingPlanEntry', existing.id, { value });
        return res.json(result);
      } else {
        // Skip if empty value
        if (value === '' || value === null || value === undefined) {
          return res.json({ skipped: true });
        }

        // Create new
        const result = await createRecord('StaffingPlanEntry', { doctor_id, year, month, value });
        return res.json(result);
      }
    }

    return res.status(400).json({ error: 'Invalid operation', validOperations: ['checkAndUpdate', 'checkAndCreate', 'upsertStaffing'] });

  } catch (error) {
    console.error('Atomic operation error:', error);
    next(error);
  }
});

export default router;
