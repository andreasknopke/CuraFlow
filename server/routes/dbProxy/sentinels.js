import { getValidColumns } from './cache.js';

const WORKPLACE_CACHE = {};
const WORKPLACE_CACHE_TTL = 60_000;

export const checkShiftConflict = async (dbPool, shiftData, cacheKey = 'default') => {
  const { date, position, timeslot_id: timeslotId } = shiftData;
  if (!date || !position) return null;

  const workplaceCacheKey = `${cacheKey}:wp:${position}`;
  let workplaceEntry = WORKPLACE_CACHE[workplaceCacheKey];
  if (!workplaceEntry || Date.now() - workplaceEntry.ts > WORKPLACE_CACHE_TTL) {
    try {
      const workplaceColumns = await getValidColumns(dbPool, 'Workplace', cacheKey);
      const hasAllowsMultiple =
        Array.isArray(workplaceColumns) && workplaceColumns.includes('allows_multiple');
      const selectColumns = hasAllowsMultiple ? 'allows_multiple, category' : 'category';
      const [rows] = await dbPool.execute(
        `SELECT ${selectColumns} FROM Workplace WHERE name = ? LIMIT 1`,
        [position],
      );
      const workplace = rows[0] || null;
      WORKPLACE_CACHE[workplaceCacheKey] = { data: workplace, ts: Date.now() };
      workplaceEntry = WORKPLACE_CACHE[workplaceCacheKey];
    } catch (error) {
      console.warn('[Sentinel] Workplace lookup failed:', error.message);
      return null;
    }
  }

  const workplace = workplaceEntry.data;
  if (!workplace) return null;

  let allowsMultiple;
  if (workplace.allows_multiple !== undefined && workplace.allows_multiple !== null) {
    allowsMultiple = !!workplace.allows_multiple;
  } else if (workplace.category === 'Rotationen') {
    allowsMultiple = true;
  } else if (
    workplace.category === 'Dienste' ||
    workplace.category === 'Demonstrationen & Konsile'
  ) {
    allowsMultiple = false;
  } else {
    allowsMultiple = true;
  }

  if (allowsMultiple) return null;

  let sql;
  let params;
  if (timeslotId) {
    sql =
      'SELECT id, doctor_id FROM ShiftEntry WHERE date = ? AND position = ? AND timeslot_id = ? LIMIT 1';
    params = [date, position, timeslotId];
  } else {
    sql = 'SELECT id, doctor_id FROM ShiftEntry WHERE date = ? AND position = ? LIMIT 1';
    params = [date, position];
  }

  try {
    const [existing] = await dbPool.execute(sql, params);
    return existing.length > 0 ? existing[0] : null;
  } catch (error) {
    console.warn('[Sentinel] Conflict check failed:', error.message);
    return null;
  }
};
