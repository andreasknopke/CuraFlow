// Redeployed: 2026-01-15
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import mysql from 'npm:mysql2@^3.9.0/promise';

// Cache for table columns to avoid "Unknown column" errors
const COLUMNS_CACHE = {};

// Connection Pool Cache (key: config hash, value: pool instance)
const POOL_CACHE = new Map();

// Helper to create a consistent config hash for pooling
const getConfigHash = (config) => {
    return `${config.host}:${config.port}:${config.user}:${config.database}`;
};

// Helper to get or create connection pool
const getPool = (config) => {
    const hash = getConfigHash(config);
    
    if (!POOL_CACHE.has(hash)) {
        const pool = mysql.createPool({
            ...config,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0
        });
        POOL_CACHE.set(hash, pool);
        console.log(`Created new connection pool for ${hash}`);
    }
    
    return POOL_CACHE.get(hash);
};

Deno.serve(async (req) => {
    // 1. Auth Check (v2)
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse Request
    let body;
    try {
        body = await req.json();
    } catch (e) {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { action, entity, data, id, query, sort, limit, skip, _credentials } = body;

    if (!entity) return Response.json({ error: 'Entity required' }, { status: 400 });

    let pool;
    try {
        let config = {
            host: Deno.env.get('MYSQL_HOST')?.trim(),
            user: Deno.env.get('MYSQL_USER')?.trim(),
            password: Deno.env.get('MYSQL_PASSWORD')?.trim(),
            database: Deno.env.get('MYSQL_DATABASE')?.trim(),
            port: parseInt(Deno.env.get('MYSQL_PORT')?.trim() || '3306'),
            dateStrings: true // Force DATE/DATETIME to be returned as strings
        };

        if (_credentials) {
            try {
                const decoded = JSON.parse(atob(_credentials));
                // Trim string values from token to avoid ' root' issues
                for (const key in decoded) {
                    if (typeof decoded[key] === 'string') decoded[key] = decoded[key].trim();
                }
                config = { ...config, ...decoded };
            } catch (e) {
                console.error("Failed to parse credentials token", e);
            }
        }

        pool = getPool(config);
        
        // HELPER: Convert JS value to MySQL value
        const toSqlValue = (val) => {
            if (val === undefined) return null;
            if (typeof val === 'number' && isNaN(val)) return null; // Handle NaN
            if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
                return JSON.stringify(val); // Arrays/Objects to JSON string
            }
            if (val instanceof Date) {
                return val.toISOString().slice(0, 19).replace('T', ' ');
            }
            return val;
        };

        // HELPER: Parse MySQL row to JS object
        const fromSqlRow = (row) => {
            if (!row) return null;
            const res = { ...row };
            
            const jsonFields = ['active_days']; // Add others if needed
            
            for (const key in res) {
                if (jsonFields.includes(key) && typeof res[key] === 'string') {
                    try {
                        res[key] = JSON.parse(res[key]);
                    } catch (e) {}
                }
                
                const boolFields = ['receive_email_notifications', 'exclude_from_staffing_plan', 'user_viewed', 'auto_off', 'show_in_service_plan', 'allows_rotation_concurrently', 'allows_consecutive_days', 'acknowledged', 'is_active'];
                if (boolFields.includes(key)) {
                    res[key] = !!res[key];
                }
            }
            return res;
        };

        // HELPER: Get valid columns for entity
        const getValidColumns = async (tableName) => {
            if (COLUMNS_CACHE[tableName]) return COLUMNS_CACHE[tableName];
            
            try {
                const [rows] = await pool.execute(`SHOW COLUMNS FROM \`${tableName}\``);
                const columns = rows.map(r => r.Field);
                COLUMNS_CACHE[tableName] = columns;
                return columns;
            } catch (e) {
                console.error(`Failed to fetch columns for ${tableName}:`, e.message);
                // Table doesn't exist - return empty array to signal this
                if (e.message.includes("doesn't exist") || e.code === 'ER_NO_SUCH_TABLE') {
                    return [];
                }
                return null; // Unknown error - don't filter
            }
        };

        if (action === 'list' || action === 'filter') {
            let sql = `SELECT * FROM \`${entity}\``;
            const params = [];
            
            // Merge filters from both body.query and body.filters for compatibility
            const filters = query || body.filters || {};
            
            // Handle Filter Query (simple equality and $gte/$lte for now)
            if (filters && Object.keys(filters).length > 0) {
                const clauses = [];
                for (const [key, val] of Object.entries(filters)) {
                    if (val && typeof val === 'object' && !Array.isArray(val)) {
                        // Complex operators: $gte, $lte
                        if (val.$gte !== undefined) {
                            clauses.push(`\`${key}\` >= ?`);
                            params.push(toSqlValue(val.$gte));
                        }
                        if (val.$lte !== undefined) {
                            clauses.push(`\`${key}\` <= ?`);
                            params.push(toSqlValue(val.$lte));
                        }
                    } else {
                        // Equality
                        clauses.push(`\`${key}\` = ?`);
                        params.push(toSqlValue(val));
                    }
                }
                if (clauses.length > 0) {
                    sql += ` WHERE ${clauses.join(' AND ')}`;
                }
            }

            // Sort
            if (sort) {
                if (typeof sort === 'string') {
                    const desc = sort.startsWith('-');
                    const field = desc ? sort.substring(1) : sort;
                    sql += ` ORDER BY \`${field}\` ${desc ? 'DESC' : 'ASC'}`;
                    
                    // Add secondary sort by ID for deterministic results if not sorting by ID already
                    if (field !== 'id') {
                        sql += `, \`id\` ASC`;
                    }
                }
            } else {
                // Default deterministic sort if no sort provided
                sql += ` ORDER BY \`id\` ASC`;
            }

            // Limit/Skip
            if (limit && !isNaN(parseInt(limit))) {
                sql += ` LIMIT ${parseInt(limit)}`;
                if (skip && !isNaN(parseInt(skip))) {
                    sql += ` OFFSET ${parseInt(skip)}`;
                }
            }

            try {
                const safeParams = params.map(p => p === undefined ? null : p);
                const [rows] = await pool.execute(sql, safeParams);
                return Response.json(rows.map(fromSqlRow));
            } catch (err) {
                console.error("List Execute Error:", err.message, "SQL:", sql);
                // If table doesn't exist, return empty array instead of error
                if (err.message.includes("doesn't exist") || err.code === 'ER_NO_SUCH_TABLE') {
                    console.warn(`Table ${entity} doesn't exist in MySQL, returning empty array`);
                    return Response.json([]);
                }
                return Response.json({ error: err.message }, { status: 500 });
            }
        }

        if (action === 'get') {
            if (!id) return Response.json(null);
            try {
                const [rows] = await pool.execute(`SELECT * FROM \`${entity}\` WHERE id = ?`, [id]);
                return Response.json(rows[0] ? fromSqlRow(rows[0]) : null);
            } catch (err) {
                return Response.json({ error: err.message }, { status: 500 });
            }
        }

        if (action === 'create') {
            if (!data.id) data.id = crypto.randomUUID();
            data.created_date = new Date();
            data.updated_date = new Date();
            data.created_by = user.email;

            const validColumns = await getValidColumns(entity);
            let keys = Object.keys(data);
            
            // Filter keys if validColumns are known
            if (validColumns) {
                keys = keys.filter(k => validColumns.includes(k));
            }

            const values = keys.map(k => toSqlValue(data[k]));
            const placeholders = keys.map(() => '?').join(',');
            const sql = `INSERT INTO \`${entity}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`;
            
            try {
                const safeValues = values.map(v => v === undefined ? null : v);
                await pool.execute(sql, safeValues);
            } catch (err) {
                console.error("Create Error:", err.message);
                return Response.json({ error: err.message }, { status: 500 });
            }
            return Response.json(data);
        }

        if (action === 'update') {
            if (!id) return Response.json({ error: "ID required for update" }, { status: 400 });
            
            data.updated_date = new Date();
            
            const validColumns = await getValidColumns(entity);
            let keys = Object.keys(data).filter(k => k !== 'id');
            
            if (validColumns) {
                keys = keys.filter(k => validColumns.includes(k));
            }

            if (keys.length === 0) return Response.json({ success: true });

            const sets = keys.map(k => `\`${k}\` = ?`).join(',');
            const values = keys.map(k => toSqlValue(data[k]));
            values.push(id); 

            const sql = `UPDATE \`${entity}\` SET ${sets} WHERE id = ?`;
            try {
                const safeValues = values.map(v => v === undefined ? null : v);
                await pool.execute(sql, safeValues);
                const [rows] = await pool.execute(`SELECT * FROM \`${entity}\` WHERE id = ?`, [id]);
                return Response.json(rows[0] ? fromSqlRow(rows[0]) : null);
            } catch (err) {
                console.error("Update Error:", err.message);
                return Response.json({ error: err.message }, { status: 500 });
            }
        }

        if (action === 'delete') {
            if (!id) return Response.json({ error: "ID required for delete" }, { status: 400 });
            try {
                await pool.execute(`DELETE FROM \`${entity}\` WHERE id = ?`, [id]);
            } catch (err) {
                return Response.json({ error: err.message }, { status: 500 });
            }
            return Response.json({ success: true });
        }
        
        if (action === 'bulkCreate') {
             if (!Array.isArray(data) || data.length === 0) return Response.json([]);
             
             // Pre-process all items
             const processed = data.map(item => {
                 if (!item.id) item.id = crypto.randomUUID();
                 item.created_date = new Date();
                 item.updated_date = new Date();
                 item.created_by = user.email;
                 return item;
             });

             // Determine Union of all keys from all items
             const allKeys = new Set();
             processed.forEach(item => Object.keys(item).forEach(k => allKeys.add(k)));
             
             let keys = Array.from(allKeys);
             
             // Filter against valid columns
             const validColumns = await getValidColumns(entity);
             if (validColumns) {
                 keys = keys.filter(k => validColumns.includes(k));
             }

             if (keys.length === 0) {
                 console.error("No valid keys for bulkCreate");
                 return Response.json({ error: "No valid columns found for insert" }, { status: 400 });
             }

             // Create values array ensuring every row has value for every key (or null)
             const values = processed.map(item => keys.map(k => toSqlValue(item[k])));
             
             const sql = `INSERT INTO \`${entity}\` (\`${keys.join('`,`')}\`) VALUES ?`;
             
             try {
                await pool.query(sql, [values]);
             } catch (err) {
                 console.error("BulkCreate Error:", err.message, "Entity:", entity);
                 // If error is duplicate entry, we might want to ignore or retry?
                 // But bulk insert usually fails all.
                 return Response.json({ error: err.message }, { status: 500 });
             }
             
             return Response.json(processed);
        }

        return Response.json({ error: 'Unknown action' }, { status: 400 });

    } catch (e) {
        console.error("DB Proxy Error:", e.message);
        console.error("Stack:", e.stack);
        console.error("Request:", { action, entity });
        return Response.json({ 
            error: e.message,
            stack: e.stack,
            context: { action, entity }
        }, { status: 500 });
    }
});