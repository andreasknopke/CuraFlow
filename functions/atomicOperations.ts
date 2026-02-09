import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import mysql from 'npm:mysql2@^3.9.0/promise';

// Helper to get DB mode from SystemSetting
const getDbMode = async (base44) => {
    try {
        const settings = await base44.asServiceRole.entities.SystemSetting.list();
        const setting = settings.find(s => s.key === 'db_mode');
        return setting ? setting.value : 'internal';
    } catch {
        return 'internal';
    }
};

// Helper to get MySQL connection
const getMysqlConnection = async () => {
    return await mysql.createConnection({
        host: Deno.env.get('MYSQL_HOST')?.trim(),
        user: Deno.env.get('MYSQL_USER')?.trim(),
        password: Deno.env.get('MYSQL_PASSWORD')?.trim(),
        database: Deno.env.get('MYSQL_DATABASE')?.trim(),
        port: parseInt(Deno.env.get('MYSQL_PORT')?.trim() || '3306'),
        dateStrings: true
    });
};

// Helper to convert JS value to SQL value
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

// Helper to parse MySQL row
const fromSqlRow = (row) => {
    if (!row) return null;
    const res = { ...row };
    const boolFields = ['receive_email_notifications', 'exclude_from_staffing_plan', 'user_viewed', 'auto_off', 'show_in_service_plan', 'allows_rotation_concurrently', 'allows_consecutive_days', 'acknowledged', 'is_active'];
    for (const key in res) {
        if (boolFields.includes(key)) res[key] = !!res[key];
    }
    return res;
};

Deno.serve(async (req) => {
    let connection = null;
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        const { operation, entity, id, data, check } = body;
        
        // Determine DB mode
        const dbMode = await getDbMode(base44);
        const useMySQL = dbMode === 'mysql';
        
        // MySQL helper functions
        const mysqlGet = async (entityName, recordId) => {
            if (!connection) connection = await getMysqlConnection();
            const [rows] = await connection.execute(`SELECT * FROM \`${entityName}\` WHERE id = ?`, [recordId]);
            return rows[0] ? fromSqlRow(rows[0]) : null;
        };
        
        const mysqlFilter = async (entityName, filter) => {
            if (!connection) connection = await getMysqlConnection();
            const clauses = [];
            const params = [];
            for (const [key, val] of Object.entries(filter)) {
                clauses.push(`\`${key}\` = ?`);
                params.push(toSqlValue(val));
            }
            const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
            const [rows] = await connection.execute(`SELECT * FROM \`${entityName}\`${whereClause}`, params);
            return rows.map(fromSqlRow);
        };
        
        const mysqlCreate = async (entityName, createData) => {
            if (!connection) connection = await getMysqlConnection();
            if (!createData.id) createData.id = crypto.randomUUID();
            createData.created_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
            createData.updated_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
            createData.created_by = user.email;
            
            const keys = Object.keys(createData);
            const values = keys.map(k => toSqlValue(createData[k]));
            const placeholders = keys.map(() => '?').join(',');
            await connection.execute(`INSERT INTO \`${entityName}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`, values);
            return createData;
        };
        
        const mysqlUpdate = async (entityName, recordId, updateData) => {
            if (!connection) connection = await getMysqlConnection();
            updateData.updated_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
            const keys = Object.keys(updateData).filter(k => k !== 'id');
            const sets = keys.map(k => `\`${k}\` = ?`).join(',');
            const values = keys.map(k => toSqlValue(updateData[k]));
            values.push(recordId);
            await connection.execute(`UPDATE \`${entityName}\` SET ${sets} WHERE id = ?`, values);
            return await mysqlGet(entityName, recordId);
        };
        
        const mysqlDelete = async (entityName, recordId) => {
            if (!connection) connection = await getMysqlConnection();
            await connection.execute(`DELETE FROM \`${entityName}\` WHERE id = ?`, [recordId]);
            return { success: true };
        };

        // Generic Optimistic Update
        if (operation === 'checkAndUpdate') {
            const current = useMySQL 
                ? await mysqlGet(entity, id)
                : await base44.entities[entity].get(id);
                
            if (!current) return Response.json({ error: "NOT_FOUND", message: "Eintrag nicht gefunden." }, { status: 404 });

            if (check && check.updated_date) {
                const dbDate = new Date(current.updated_date).getTime();
                const clientDate = new Date(check.updated_date).getTime();
                if (dbDate !== clientDate) {
                    return Response.json({ 
                        error: "CONCURRENCY_ERROR", 
                        message: "Daten wurden von einem anderen Benutzer geändert.",
                        currentData: current
                    }, { status: 409 });
                }
            }

            const result = useMySQL
                ? await mysqlUpdate(entity, id, data)
                : await base44.entities[entity].update(id, data);
            return Response.json(result);
        }

        // Safe Create (check duplicates)
        if (operation === 'checkAndCreate') {
            if (check && check.uniqueKeys) {
                const filter = {};
                check.uniqueKeys.forEach(k => filter[k] = data[k]);
                
                const existing = useMySQL
                    ? await mysqlFilter(entity, filter)
                    : await base44.entities[entity].filter(filter);
                    
                if (existing.length > 0) {
                    return Response.json({ 
                        error: "DUPLICATE_ERROR", 
                        message: "Eintrag existiert bereits.",
                        existingEntry: existing[0]
                    }, { status: 409 });
                }
            }
            
            const result = useMySQL
                ? await mysqlCreate(entity, data)
                : await base44.entities[entity].create(data);
            return Response.json(result);
        }

        // Specific Logic for Staffing Plan (Upsert with Lock)
        if (operation === 'upsertStaffing') {
            const { doctor_id, year, month, value, old_value_check } = data;
            
            const existingList = useMySQL
                ? await mysqlFilter('StaffingPlanEntry', { doctor_id, year, month })
                : await base44.entities.StaffingPlanEntry.filter({ doctor_id, year, month });
            const existing = existingList[0];

            if (existing) {
                if (old_value_check !== undefined && existing.value != old_value_check) {
                     return Response.json({ 
                         error: "CONCURRENCY_ERROR", 
                         message: "Wert wurde von einem anderen Benutzer geändert.",
                         currentValue: existing.value
                     }, { status: 409 });
                }

                if (value === "" || value === null) {
                    useMySQL
                        ? await mysqlDelete('StaffingPlanEntry', existing.id)
                        : await base44.entities.StaffingPlanEntry.delete(existing.id);
                    return Response.json({ deleted: true, id: existing.id });
                } else {
                    const res = useMySQL
                        ? await mysqlUpdate('StaffingPlanEntry', existing.id, { value })
                        : await base44.entities.StaffingPlanEntry.update(existing.id, { value });
                    return Response.json(res);
                }
            } else {
                if (value === "" || value === null) return Response.json({ skipped: true });
                
                const res = useMySQL
                    ? await mysqlCreate('StaffingPlanEntry', { doctor_id, year, month, value })
                    : await base44.entities.StaffingPlanEntry.create({ doctor_id, year, month, value });
                return Response.json(res);
            }
        }

        return Response.json({ error: "Invalid operation" }, { status: 400 });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    } finally {
        if (connection) await connection.end();
    }
});