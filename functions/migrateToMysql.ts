import { createClientFromRequest } from 'npm:@base44/sdk@^0.8.3';
import mysql from 'npm:mysql2@^3.9.0/promise';

// Entity Schemas for Table Creation
const SCHEMAS = {
    Doctor: `
        CREATE TABLE IF NOT EXISTS Doctor (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            name VARCHAR(255),
            initials VARCHAR(50),
            role VARCHAR(100),
            color VARCHAR(50),
            \`order\` INT,
            email VARCHAR(255),
            receive_email_notifications BOOLEAN,
            google_email VARCHAR(255),
            fte FLOAT,
            contract_end_date DATE,
            exclude_from_staffing_plan BOOLEAN
        )
    `,
    ShiftEntry: `
        CREATE TABLE IF NOT EXISTS ShiftEntry (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            date DATE,
            position VARCHAR(255),
            doctor_id VARCHAR(255),
            note TEXT,
            \`order\` INT,
            google_event_id VARCHAR(255),
            INDEX idx_date (date),
            INDEX idx_doctor (doctor_id)
        )
    `,
    WishRequest: `
        CREATE TABLE IF NOT EXISTS WishRequest (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            doctor_id VARCHAR(255),
            date DATE,
            type VARCHAR(50),
            position VARCHAR(255),
            priority VARCHAR(50),
            reason TEXT,
            status VARCHAR(50),
            admin_comment TEXT,
            user_viewed BOOLEAN
        )
    `,
    Workplace: `
        CREATE TABLE IF NOT EXISTS Workplace (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            name VARCHAR(255),
            category VARCHAR(100),
            \`order\` INT,
            active_days JSON,
            time VARCHAR(100),
            auto_off BOOLEAN,
            show_in_service_plan BOOLEAN,
            allows_rotation_concurrently BOOLEAN,
            allows_consecutive_days BOOLEAN
        )
    `,
    SystemSetting: `
        CREATE TABLE IF NOT EXISTS SystemSetting (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            \`key\` VARCHAR(255),
            value LONGTEXT
        )
    `,
    ShiftNotification: `
        CREATE TABLE IF NOT EXISTS ShiftNotification (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            doctor_id VARCHAR(255),
            date DATE,
            message TEXT,
            type VARCHAR(50),
            acknowledged BOOLEAN
        )
    `,
    DemoSetting: `
        CREATE TABLE IF NOT EXISTS DemoSetting (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            name VARCHAR(255),
            active_days JSON,
            time VARCHAR(100)
        )
    `,
    TrainingRotation: `
        CREATE TABLE IF NOT EXISTS TrainingRotation (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            doctor_id VARCHAR(255),
            modality VARCHAR(255),
            start_date DATE,
            end_date DATE
        )
    `,
    ScheduleRule: `
        CREATE TABLE IF NOT EXISTS ScheduleRule (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            content TEXT,
            is_active BOOLEAN
        )
    `,
    ColorSetting: `
        CREATE TABLE IF NOT EXISTS ColorSetting (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            name VARCHAR(255),
            category VARCHAR(100),
            bg_color VARCHAR(50),
            text_color VARCHAR(50)
        )
    `,
    ScheduleNote: `
        CREATE TABLE IF NOT EXISTS ScheduleNote (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            date DATE,
            position VARCHAR(255),
            content TEXT
        )
    `,
    CustomHoliday: `
        CREATE TABLE IF NOT EXISTS CustomHoliday (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            name VARCHAR(255),
            start_date DATE,
            end_date DATE,
            type VARCHAR(50),
            action VARCHAR(50)
        )
    `,
    StaffingPlanEntry: `
        CREATE TABLE IF NOT EXISTS StaffingPlanEntry (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            doctor_id VARCHAR(255),
            year INT,
            month INT,
            value VARCHAR(50)
        )
    `,
    BackupLog: `
        CREATE TABLE IF NOT EXISTS BackupLog (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            filename VARCHAR(255),
            file_uri TEXT,
            size INT,
            type VARCHAR(50),
            status VARCHAR(50),
            metadata TEXT
        )
    `,
    SystemLog: `
        CREATE TABLE IF NOT EXISTS SystemLog (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            level VARCHAR(50),
            source VARCHAR(255),
            message TEXT,
            details TEXT
        )
    `,
    VoiceAlias: `
        CREATE TABLE IF NOT EXISTS VoiceAlias (
            id VARCHAR(255) PRIMARY KEY,
            created_date DATETIME(3),
            updated_date DATETIME(3),
            created_by VARCHAR(255),
            doctor_id VARCHAR(255),
            detected_text VARCHAR(255)
        )
    `
};

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    // Migration Auth Check
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let connection;
    const results = {
        created_tables: [],
        migrated_entities: {}
    };

    let body = {};
    try { body = await req.json(); } catch(e) {}
    const { _credentials } = body;

    try {
        let config = {
            host: Deno.env.get('MYSQL_HOST')?.trim(),
            user: Deno.env.get('MYSQL_USER')?.trim(),
            password: Deno.env.get('MYSQL_PASSWORD')?.trim(),
            database: Deno.env.get('MYSQL_DATABASE')?.trim(),
            port: parseInt(Deno.env.get('MYSQL_PORT')?.trim() || '3306')
        };

        if (_credentials) {
            try {
                const decoded = JSON.parse(atob(_credentials));
                // Trim string values from token
                for (const key in decoded) {
                    if (typeof decoded[key] === 'string') decoded[key] = decoded[key].trim();
                }
                config = { ...config, ...decoded };
            } catch (e) {
                console.error("Failed to parse credentials token", e);
            }
        }
        
        // Only use SSL if explicitly provided in config (from token)
        
        connection = await mysql.createConnection(config);
        // 1. Create Tables
        for (const [entityName, schema] of Object.entries(SCHEMAS)) {
            await connection.execute(schema);
            results.created_tables.push(entityName);
        }

        // 1.5 Clear Tables (Clean Slate Migration)
        try {
            await connection.query('SET FOREIGN_KEY_CHECKS = 0');
            for (const entityName of Object.keys(SCHEMAS)) {
                await connection.query(`TRUNCATE TABLE \`${entityName}\``);
            }
            await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        } catch (e) {
            console.error("Truncate failed (trying DELETE instead)", e);
            for (const entityName of Object.keys(SCHEMAS)) {
                 await connection.query(`DELETE FROM \`${entityName}\``);
            }
        }

        // 2. Migrate Data
        for (const [entityName, schema] of Object.entries(SCHEMAS)) {
            
            // Extract valid columns from Schema
            const columnPattern = /^\s+(`?\w+`?)\s+(VARCHAR|INT|DATETIME|DATE|TEXT|BOOLEAN|FLOAT|JSON|LONGTEXT)/gim;
            const validColumns = [];
            let match;
            while ((match = columnPattern.exec(schema)) !== null) {
                // remove backticks if present
                validColumns.push(match[1].replace(/`/g, ''));
            }

            // Fetch Data
            let allRecords = [];
            let skip = 0;
            const limit = 1000;
            let hasMore = true;

            while (hasMore) {
                const batch = await base44.entities[entityName].list(null, limit, skip);
                if (batch.length < limit) hasMore = false;
                allRecords = [...allRecords, ...batch];
                skip += limit;
                if (allRecords.length > 20000) break; // Safety
            }
            
            if (allRecords.length === 0) continue;

            // Prepare Batch Insert
            let insertedCount = 0;
            const chunkSize = 100;
            
            for (let i = 0; i < allRecords.length; i += chunkSize) {
                const chunk = allRecords.slice(i, i + chunkSize);
                
                // Map chunk records to array of values strictly matching validColumns
                const values = chunk.map(record => {
                    return validColumns.map(col => {
                        let val = record[col];

                        // Handle standard fields that might be missing in some old records
                        if (val === undefined) return null;
                        if (typeof val === 'number' && isNaN(val)) return null;

                        // Type conversions
                        if (val instanceof Date) {
                             return val; // mysql2 handles Date objects
                        }

                        // Stringify objects/arrays for JSON/TEXT fields
                        if (typeof val === 'object' && val !== null) {
                            return JSON.stringify(val);
                        }

                        return val;
                    });
                });

                // Construct SQL
                const placeholders = validColumns.map(() => '?').join(',');
                const columnsStr = validColumns.map(c => `\`${c}\``).join(',');
                
                const sql = `INSERT IGNORE INTO ${entityName} (${columnsStr}) VALUES ?`;
                
                await connection.query(sql, [values]);
                insertedCount += chunk.length;
            }
            results.migrated_entities[entityName] = insertedCount;
        }

    } catch (error) {
        console.error("Migration failed", error);
        return Response.json({ 
            error: error.message, 
            stack: error.stack, 
            results 
        }, { status: 500 });
    } finally {
        if (connection) await connection.end();
    }

    return Response.json({ success: true, results });
});