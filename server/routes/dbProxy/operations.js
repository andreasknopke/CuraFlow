import crypto from 'crypto';
import { db, removeTenantPool } from '../../db/pool.js';
import { broadcastPlanUpdate, buildRealtimeScope, isPlanSyncEntity } from '../../utils/realtime.js';
import { PUBLIC_READ_TABLES, getValidColumns } from './cache.js';
import { toSqlValue, fromSqlRow } from './serializers.js';
import { checkShiftConflict } from './sentinels.js';
import { verifyAccessToken } from '../../utils/authTokens.js';
import {
  ensureScheduleBlockTable,
  ensureTeamRoleTable,
  ensureQualificationTables,
  ensureWorkplaceStaffColumns,
} from './tables.js';
import { writeAuditLog } from './audit.js';

export const handleDbProxyRequest = async (req, res, next) => {
  try {
    const { action, operation, entity, table, data, id, query, sort, limit, skip } = req.body;
    const effectiveAction = action || operation;
    const tableName = entity || table;

    const dbPool = req.db || db;
    const cacheKey = req.headers['x-db-token'] || 'default';
    const realtimeScope = buildRealtimeScope(req.dbToken);
    const actor = {
      id: req.user?.sub || null,
      email: req.user?.email || 'system',
    };

    if (tableName === 'TeamRole') {
      await ensureTeamRoleTable(dbPool, cacheKey);
    }

    if (['Qualification', 'DoctorQualification', 'WorkplaceQualification'].includes(tableName)) {
      await ensureQualificationTables(dbPool, cacheKey);
    }

    if (tableName === 'Workplace') {
      await ensureWorkplaceStaffColumns(dbPool, cacheKey);
    }

    if (tableName === 'ScheduleBlock') {
      await ensureScheduleBlockTable(dbPool, cacheKey);
    }

    if (!tableName) {
      return res.status(400).json({ error: 'Entity/table required' });
    }

    if (!effectiveAction) {
      return res.status(400).json({ error: 'Action/operation required' });
    }

    const isPublicRead =
      PUBLIC_READ_TABLES.includes(tableName) &&
      (effectiveAction === 'list' || effectiveAction === 'filter' || effectiveAction === 'get');

    if (!isPublicRead) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Nicht autorisiert' });
      }

      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);
      if (!decoded) {
        return res.status(401).json({ error: 'Token ungültig' });
      }

      req.user = decoded;
    }

    if (effectiveAction === 'list' || effectiveAction === 'filter') {
      let sql = `SELECT * FROM \`${tableName}\``;
      const params = [];
      const filters = query || req.body.filters || {};

      if (filters && Object.keys(filters).length > 0) {
        const clauses = [];
        for (const [key, value] of Object.entries(filters)) {
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (value.$gte !== undefined) {
              clauses.push(`\`${key}\` >= ?`);
              params.push(toSqlValue(value.$gte));
            }
            if (value.$lte !== undefined) {
              clauses.push(`\`${key}\` <= ?`);
              params.push(toSqlValue(value.$lte));
            }
          } else {
            clauses.push(`\`${key}\` = ?`);
            params.push(toSqlValue(value));
          }
        }
        if (clauses.length > 0) {
          sql += ` WHERE ${clauses.join(' AND ')}`;
        }
      }

      if (sort) {
        if (typeof sort === 'string') {
          const desc = sort.startsWith('-');
          const field = desc ? sort.substring(1) : sort;
          sql += ` ORDER BY \`${field}\` ${desc ? 'DESC' : 'ASC'}`;

          if (field !== 'id') {
            sql += ', `id` ASC';
          }
        }
      } else {
        sql += ' ORDER BY `id` ASC';
      }

      if (limit && !isNaN(parseInt(limit, 10))) {
        sql += ` LIMIT ${parseInt(limit, 10)}`;
        if (skip && !isNaN(parseInt(skip, 10))) {
          sql += ` OFFSET ${parseInt(skip, 10)}`;
        }
      }

      try {
        const safeParams = params.map((param) => (param === undefined ? null : param));
        const [rows] = await dbPool.execute(sql, safeParams);
        return res.json(rows.map(fromSqlRow));
      } catch (error) {
        console.error('List Execute Error:', error.message, 'SQL:', sql);
        if (error.message.includes("doesn't exist") || error.code === 'ER_NO_SUCH_TABLE') {
          console.warn(`Table ${tableName} doesn't exist, returning empty array`);
          return res.json([]);
        }
        throw error;
      }
    }

    if (effectiveAction === 'get') {
      if (!id) return res.json(null);

      const [rows] = await dbPool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);
      return res.json(rows[0] ? fromSqlRow(rows[0]) : null);
    }

    if (effectiveAction === 'create') {
      if (!data.id) data.id = crypto.randomUUID();
      data.created_date = new Date();
      data.updated_date = new Date();
      data.created_by = req.user?.email || 'system';

      if (tableName === 'ShiftEntry' && data.date && data.position) {
        await ensureScheduleBlockTable(dbPool, cacheKey);
        try {
          let blockSql;
          let blockParams;
          if (data.timeslot_id) {
            blockSql =
              'SELECT id, reason FROM ScheduleBlock WHERE date = ? AND position = ? AND (timeslot_id = ? OR timeslot_id IS NULL) LIMIT 1';
            blockParams = [data.date, data.position, data.timeslot_id];
          } else {
            blockSql =
              'SELECT id, reason FROM ScheduleBlock WHERE date = ? AND position = ? AND timeslot_id IS NULL LIMIT 1';
            blockParams = [data.date, data.position];
          }
          const [blockRows] = await dbPool.execute(blockSql, blockParams);
          if (blockRows.length > 0) {
            console.warn(
              `[Sentinel] Blocked ShiftEntry on locked cell: ${data.position} on ${data.date} (reason: ${blockRows[0].reason})`,
            );
            return res.status(409).json({
              error: 'Zelle gesperrt' + (blockRows[0].reason ? `: ${blockRows[0].reason}` : ''),
              blocked: true,
              block_id: blockRows[0].id,
              reason: blockRows[0].reason,
            });
          }
        } catch (error) {
          // ScheduleBlock may not exist yet.
        }

        const conflict = await checkShiftConflict(dbPool, data, cacheKey);
        if (conflict) {
          console.warn(
            `[Sentinel] Blocked duplicate ShiftEntry: ${data.position} on ${data.date} (existing: ${conflict.id})`,
          );
          return res.status(409).json({
            error: 'Position bereits besetzt',
            conflict: true,
            existing_id: conflict.id,
            existing_doctor_id: conflict.doctor_id,
          });
        }
      }

      if (tableName === 'ShiftEntry' && data.doctor_id && data.position && !data.start_time) {
        try {
          const [docRows] = await dbPool.execute(
            'SELECT work_time_model_id FROM Doctor WHERE id = ? LIMIT 1',
            [data.doctor_id],
          );
          const modelId = docRows[0]?.work_time_model_id;

          if (modelId) {
            const [workplaceRows] = await dbPool.execute(
              'SELECT id FROM Workplace WHERE name = ? LIMIT 1',
              [data.position],
            );
            const workplaceId = workplaceRows[0]?.id;

            if (workplaceId) {
              const [ruleRows] = await dbPool.execute(
                'SELECT start_time, end_time, break_minutes FROM ShiftTimeRule WHERE workplace_id = ? AND work_time_model_id = ? LIMIT 1',
                [workplaceId, modelId],
              );

              if (ruleRows[0]) {
                data.start_time = ruleRows[0].start_time;
                data.end_time = ruleRows[0].end_time;
                if (ruleRows[0].break_minutes) {
                  data.break_minutes = ruleRows[0].break_minutes;
                }
              }
            }
          }
        } catch (error) {
          console.warn(`[AutoTime] Failed to calculate shift times: ${error.message}`);
        }
      }

      const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
      let keys = Object.keys(data);

      if (validColumns && validColumns.length > 0) {
        keys = keys.filter((key) => validColumns.includes(key));
      }

      if (keys.length === 0) {
        console.error(
          `CREATE failed: No valid columns for ${tableName}. Data keys:`,
          Object.keys(data),
          'Valid columns:',
          validColumns,
        );
        return res.status(500).json({ error: `No valid columns found for table ${tableName}` });
      }

      const values = keys.map((key) => toSqlValue(data[key]));
      const placeholders = keys.map(() => '?').join(',');
      const sql = `INSERT INTO \`${tableName}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`;

      try {
        const safeValues = values.map((value) => (value === undefined ? null : value));
        await dbPool.execute(sql, safeValues);
        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({
            scope: realtimeScope,
            entity: tableName,
            action: 'create',
            recordId: data.id,
            actor,
          });
        }
        return res.json(data);
      } catch (error) {
        console.error(`CREATE error for ${tableName}:`, error.message, 'SQL:', sql);
        throw error;
      }
    }

    if (effectiveAction === 'update') {
      if (!id) return res.status(400).json({ error: 'ID required for update' });

      data.updated_date = new Date();

      const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
      let keys = Object.keys(data).filter((key) => key !== 'id');

      if (validColumns) {
        keys = keys.filter((key) => validColumns.includes(key));
      }

      if (keys.length === 0) return res.json({ success: true });

      const sets = keys.map((key) => `\`${key}\` = ?`).join(',');
      const values = keys.map((key) => toSqlValue(data[key]));
      values.push(id);

      const sql = `UPDATE \`${tableName}\` SET ${sets} WHERE id = ?`;
      const safeValues = values.map((value) => (value === undefined ? null : value));
      await dbPool.execute(sql, safeValues);

      const [rows] = await dbPool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);
      if (isPlanSyncEntity(tableName)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: tableName,
          action: 'update',
          recordId: id,
          actor,
        });
      }
      return res.json(rows[0] ? fromSqlRow(rows[0]) : null);
    }

    if (effectiveAction === 'delete') {
      if (!id) return res.status(400).json({ error: 'ID required for delete' });

      const [existingRows] = await dbPool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [
        id,
      ]);
      const deletedRecord = existingRows[0] ? fromSqlRow(existingRows[0]) : null;

      await dbPool.execute(`DELETE FROM \`${tableName}\` WHERE id = ?`, [id]);

      const userEmail = req.user?.email || 'unknown';
      const timestamp = new Date().toISOString();
      await writeAuditLog(dbPool, {
        level: 'audit',
        source: 'Löschung',
        message: `${tableName} gelöscht von ${userEmail} (ID: ${id})`,
        details: { table: tableName, record_id: id, deleted_data: deletedRecord, timestamp },
        userEmail,
      });

      if (isPlanSyncEntity(tableName)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: tableName,
          action: 'delete',
          recordId: id,
          actor,
        });
      }

      return res.json({ success: true });
    }

    if (effectiveAction === 'bulkCreate') {
      if (!Array.isArray(data) || data.length === 0) return res.json([]);

      const processed = data.map((item) => {
        if (!item.id) item.id = crypto.randomUUID();
        item.created_date = new Date();
        item.updated_date = new Date();
        item.created_by = req.user?.email || 'system';
        return item;
      });

      if (tableName === 'ShiftEntry') {
        const filtered = [];
        for (const item of processed) {
          if (item.date && item.position) {
            const conflict = await checkShiftConflict(dbPool, item, cacheKey);
            if (conflict) {
              console.warn(
                `[Sentinel] Blocked duplicate in bulkCreate: ${item.position} on ${item.date}`,
              );
              continue;
            }
          }
          filtered.push(item);
        }
        if (filtered.length === 0) return res.json([]);
        processed.length = 0;
        processed.push(...filtered);

        for (const item of processed) {
          if (item.doctor_id && item.position && !item.start_time) {
            try {
              const [docRows] = await dbPool.execute(
                'SELECT work_time_model_id FROM Doctor WHERE id = ? LIMIT 1',
                [item.doctor_id],
              );
              const modelId = docRows[0]?.work_time_model_id;
              if (modelId) {
                const [workplaceRows] = await dbPool.execute(
                  'SELECT id FROM Workplace WHERE name = ? LIMIT 1',
                  [item.position],
                );
                const workplaceId = workplaceRows[0]?.id;
                if (workplaceId) {
                  const [ruleRows] = await dbPool.execute(
                    'SELECT start_time, end_time, break_minutes FROM ShiftTimeRule WHERE workplace_id = ? AND work_time_model_id = ? LIMIT 1',
                    [workplaceId, modelId],
                  );
                  if (ruleRows[0]) {
                    item.start_time = ruleRows[0].start_time;
                    item.end_time = ruleRows[0].end_time;
                    if (ruleRows[0].break_minutes) {
                      item.break_minutes = ruleRows[0].break_minutes;
                    }
                  }
                }
              }
            } catch (error) {
              console.warn(`[AutoTime] Bulk: Failed for ${item.position}: ${error.message}`);
            }
          }
        }
      }

      const allKeys = new Set();
      processed.forEach((item) => Object.keys(item).forEach((key) => allKeys.add(key)));

      let keys = Array.from(allKeys);

      const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
      if (validColumns) {
        keys = keys.filter((key) => validColumns.includes(key));
      }

      if (keys.length === 0) {
        return res.status(400).json({ error: 'No valid columns found for insert' });
      }

      for (const item of processed) {
        const values = keys.map((key) => toSqlValue(item[key]));
        const placeholders = keys.map(() => '?').join(',');
        const sql = `INSERT INTO \`${tableName}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`;
        const safeValues = values.map((value) => (value === undefined ? null : value));
        await dbPool.execute(sql, safeValues);
      }

      if (isPlanSyncEntity(tableName)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: tableName,
          action: 'bulkCreate',
          recordCount: processed.length,
          actor,
        });
      }

      return res.json(processed);
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('DB Proxy Error:', error.message, 'Stack:', error.stack);
    console.error('Request body:', JSON.stringify(req.body || {}).substring(0, 500));

    if (error.code === 'ER_ACCESS_DENIED_ERROR' && req.dbToken) {
      console.log('Removing invalid tenant pool from cache due to access denied error');
      removeTenantPool(req.dbToken);
    }

    next(error);
  }
};
