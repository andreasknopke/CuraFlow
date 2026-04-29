import { Router } from 'express';
import { getDbForRequest } from '../utils/tenantDb.js';
import { broadcast } from '../utils/realtime.js';

const router = Router();

// Table definitions with allowed fields and mappings
const entities = {
  Doctor: {
    table: 'doctors',
    allowedFields: ['name', 'role', 'color', 'order', 'is_active', 'notes', 'qualifications', 'restrictions', 'initials'],
    boolFields: ['is_active'],
    jsonFields: ['qualifications', 'restrictions']
  },
  Workplace: {
    table: 'workplaces',
    allowedFields: ['name', 'category', 'order', 'is_active', 'min_staff', 'max_staff', 'affects_availability', 'color', 'notes', 'timeslots_enabled', 'default_overlap_tolerance_minutes'],
    boolFields: ['is_active', 'affects_availability', 'timeslots_enabled'],
    jsonFields: []
  },
  ShiftEntry: {
    table: 'shift_entries',
    allowedFields: ['doctor_id', 'date', 'workplace', 'section', 'start_time', 'end_time', 'timeslot_id', 'note', 'order', 'is_free_text', 'free_text_value'],
    boolFields: ['is_free_text'],
    jsonFields: []
  },
  WishRequest: {
    table: 'wish_requests',
    allowedFields: ['doctor_id', 'date', 'wish_type', 'workplace', 'status', 'note', 'admin_note'],
    boolFields: [],
    jsonFields: []
  },
  StaffingPlanEntry: {
    table: 'staffing_plan_entries',
    allowedFields: ['doctor_id', 'year', 'month', 'vk_amount', 'reason', 'notes'],
    boolFields: [],
    jsonFields: []
  },
  SystemSetting: {
    table: 'system_settings',
    allowedFields: ['key_name', 'value'],
    boolFields: [],
    jsonFields: []
  },
  ColorSetting: {
    table: 'color_settings',
    allowedFields: ['key_name', 'value'],
    boolFields: [],
    jsonFields: []
  },
  TeamRole: {
    table: 'team_roles',
    allowedFields: ['name', 'priority', 'color', 'can_edit_schedule', 'can_approve_wishes', 'can_do_vd', 'can_do_hd', 'excluded_from_stats', 'is_fachArzt'],
    boolFields: ['can_edit_schedule', 'can_approve_wishes', 'can_do_vd', 'can_do_hd', 'excluded_from_stats', 'is_fachArzt'],
    jsonFields: []
  },
  WorkplaceTimeslot: {
    table: 'workplace_timeslots',
    allowedFields: ['workplace_id', 'name', 'start_time', 'end_time', 'order', 'color', 'is_active'],
    boolFields: ['is_active'],
    jsonFields: []
  },
  TimeslotTemplate: {
    table: 'timeslot_templates',
    allowedFields: ['name', 'slots'],
    boolFields: [],
    jsonFields: ['slots']
  }
};

// Helper: generate suggestions for a conflicting name
async function generateSuggestions(db, baseName) {
  // Get all existing names and initials
  const [rows] = await db.execute('SELECT name, initials FROM doctors');
  const existingNames = rows.map(r => r.name);
  const existingInitials = rows.map(r => r.initials).filter(Boolean);

  // Suggest a modified name
  let count = 2;
  let suggestedName;
  do {
    suggestedName = `${baseName} (${count})`;
    count++;
  } while (existingNames.includes(suggestedName));

  // Suggest initials based on baseName
  const parts = baseName.trim().split(/\s+/);
  let prefix = '';
  if (parts.length >= 2) {
    prefix = (parts[0][0] + parts[1][0]).toUpperCase();
  } else {
    prefix = parts[0].substring(0, 2).toUpperCase();
  }
  let suggestedInitials = prefix;
  let i = 2;
  while (existingInitials.includes(suggestedInitials)) {
    suggestedInitials = prefix + i;
    i++;
  }

  return { name: suggestedName, initials: suggestedInitials };
}

// Helper: check for doctor name/initials conflict
async function checkDoctorConflict(db, name, initials, excludeId = null) {
  if (!name) return null;

  let query = 'SELECT id, name, initials FROM doctors WHERE name = ?';
  let params = [name];
  if (excludeId) {
    query += ' AND id != ?';
    params.push(excludeId);
  }

  const [rows] = await db.execute(query, params);
  if (rows.length > 0) {
    return { conflict: true, conflictingDoctor: rows[0] };
  }

  // Check initials uniqueness if provided
  if (initials) {
    let iQuery = 'SELECT id FROM doctors WHERE initials = ?';
    let iParams = [initials];
    if (excludeId) {
      iQuery += ' AND id != ?';
      iParams.push(excludeId);
    }
    const [iRows] = await db.execute(iQuery, iParams);
    if (iRows.length > 0) {
      return { conflict: true, message: 'Das Kürzel wird bereits verwendet.' };
    }
  }

  return null;
}

// Generic list
router.get('/:entity', async (req, res, next) => {
  try {
    const { entity } = req.params;
    const config = entities[entity];
    if (!config) return res.status(404).json({ error: `Entity '${entity}' nicht gefunden.` });

    const { table } = config;
    const [rows] = await req.db.execute(`SELECT * FROM ${table} ORDER BY id`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Generic get by id
router.get('/:entity/:id', async (req, res, next) => {
  try {
    const { entity, id } = req.params;
    const config = entities[entity];
    if (!config) return res.status(404).json({ error: `Entity '${entity}' nicht gefunden.` });

    const { table } = config;
    const [rows] = await req.db.execute(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Generic create
router.post('/:entity', async (req, res, next) => {
  try {
    const { entity } = req.params;
    const config = entities[entity];
    if (!config) return res.status(404).json({ error: `Entity '${entity}' nicht gefunden.` });

    const { table, allowedFields, boolFields, jsonFields } = config;
    const data = {};

    // Filter and transform fields
    for (const [key, value] of Object.entries(req.body)) {
      if (allowedFields.includes(key)) {
        if (boolFields.includes(key)) {
          data[key] = value ? 1 : 0;
        } else if (jsonFields.includes(key)) {
          data[key] = JSON.stringify(value);
        } else {
          data[key] = value;
        }
      }
    }

    // Special handling for Doctor: check duplicates
    if (entity === 'Doctor') {
      const conflict = await checkDoctorConflict(req.db, data.name, data.initials);
      if (conflict) {
        const suggestions = await generateSuggestions(req.db, data.name);
        return res.status(409).json({
          error: conflict.message || 'Mitarbeiter mit diesem Namen existiert bereits.',
          suggestions: suggestions
        });
      }
    }

    const columns = Object.keys(data).join(', ');
    const placeholders = Object.keys(data).map(() => '?').join(', ');
    const values = Object.values(data);

    const [result] = await req.db.execute(
      `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`,
      values
    );

    const [rows] = await req.db.execute(`SELECT * FROM ${table} WHERE id = ?`, [result.insertId]);
    res.status(201).json(rows[0]);

    // Broadcast change
    broadcast(req, { entity, action: 'create', recordId: result.insertId });
  } catch (err) {
    next(err);
  }
});

// Generic update
router.patch('/:entity/:id', async (req, res, next) => {
  try {
    const { entity, id } = req.params;
    const config = entities[entity];
    if (!config) return res.status(404).json({ error: `Entity '${entity}' nicht gefunden.` });

    const { table, allowedFields, boolFields, jsonFields } = config;
    const data = {};

    for (const [key, value] of Object.entries(req.body)) {
      if (allowedFields.includes(key)) {
        if (boolFields.includes(key)) {
          data[key] = value ? 1 : 0;
        } else if (jsonFields.includes(key)) {
          data[key] = JSON.stringify(value);
        } else {
          data[key] = value;
        }
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Keine gültigen Felder zum Aktualisieren.' });
    }

    // Special handling for Doctor: check duplicates if name or initials is changed
    if (entity === 'Doctor' && (data.name || data.initials)) {
      const current = await req.db.execute(`SELECT name, initials FROM ${table} WHERE id = ?`, [id]);
      const currentName = current[0]?.[0]?.name;
      const currentInitials = current[0]?.[0]?.initials;

      const nameToCheck = data.name || currentName;
      const initialsToCheck = data.initials !== undefined ? data.initials : currentInitials;

      const conflict = await checkDoctorConflict(req.db, nameToCheck, initialsToCheck, id);
      if (conflict) {
        const suggestions = await generateSuggestions(req.db, nameToCheck);
        return res.status(409).json({
          error: conflict.message || 'Mitarbeiter mit diesem Namen existiert bereits.',
          suggestions: suggestions
        });
      }
    }

    const setClauses = Object.keys(data).map(key => `${key} = ?`).join(', ');
    const values = Object.values(data);
    values.push(id);

    await req.db.execute(`UPDATE ${table} SET ${setClauses} WHERE id = ?`, values);

    const [rows] = await req.db.execute(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    res.json(rows[0]);

    broadcast(req, { entity, action: 'update', recordId: id });
  } catch (err) {
    next(err);
  }
});

// Generic delete
router.delete('/:entity/:id', async (req, res, next) => {
  try {
    const { entity, id } = req.params;
    const config = entities[entity];
    if (!config) return res.status(404).json({ error: `Entity '${entity}' nicht gefunden.` });

    const { table } = config;
    await req.db.execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
    res.status(204).end();

    broadcast(req, { entity, action: 'delete', recordId: id });
  } catch (err) {
    next(err);
  }
});

// Filter
router.post('/:entity/filter', async (req, res, next) => {
  try {
    const { entity } = req.params;
    const config = entities[entity];
    if (!config) return res.status(404).json({ error: `Entity '${entity}' nicht gefunden.` });

    const { table } = config;
    const { filter, orderBy, limit } = req.body;
    let query = `SELECT * FROM ${table}`;
    const conditions = [];
    const values = [];

    if (filter) {
      for (const [key, cond] of Object.entries(filter)) {
        if (typeof cond === 'object') {
          for (const [op, val] of Object.entries(cond)) {
            switch (op) {
              case '$gte': conditions.push(`${key} >= ?`); break;
              case '$lte': conditions.push(`${key} <= ?`); break;
              case '$gt': conditions.push(`${key} > ?`); break;
              case '$lt': conditions.push(`${key} < ?`); break;
              case '$eq': conditions.push(`${key} = ?`); break;
              case '$ne': conditions.push(`${key} != ?`); break;
              case '$in': conditions.push(`${key} IN (?)`); break;
            }
            values.push(val);
          }
        } else {
          conditions.push(`${key} = ?`);
          values.push(cond);
        }
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    if (orderBy) query += ` ORDER BY ${orderBy}`;
    if (limit) query += ` LIMIT ${limit}`;

    const [rows] = await req.db.execute(query, values);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
