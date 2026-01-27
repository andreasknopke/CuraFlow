/**
 * Setup Script: Create app_users table in MySQL
 * Run once to initialize the auth system
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import mysql from 'npm:mysql2@^3.9.0/promise';
import bcrypt from 'npm:bcryptjs@^2.4.3';

Deno.serve(async (req) => {
    // Only allow admins to run this
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
        return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    let body = {};
    try {
        body = await req.json();
    } catch (e) {}

    const { action, initialAdminEmail, initialAdminPassword } = body;

    let connection;
    try {
        connection = await mysql.createConnection({
            host: Deno.env.get('MYSQL_HOST')?.trim(),
            user: Deno.env.get('MYSQL_USER')?.trim(),
            password: Deno.env.get('MYSQL_PASSWORD')?.trim(),
            database: Deno.env.get('MYSQL_DATABASE')?.trim(),
            port: parseInt(Deno.env.get('MYSQL_PORT')?.trim() || '3306')
        });

        if (action === 'createTable') {
            // Create the app_users table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS app_users (
                    id VARCHAR(36) PRIMARY KEY,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    full_name VARCHAR(255),
                    role ENUM('admin', 'user') DEFAULT 'user',
                    doctor_id VARCHAR(36),
                    
                    -- Multi-Tenant Access Control
                    allowed_tenants JSON DEFAULT NULL,
                    
                    -- User Preferences
                    theme TEXT,
                    section_config TEXT,
                    collapsed_sections JSON,
                    schedule_hidden_rows JSON,
                    schedule_show_sidebar BOOLEAN DEFAULT TRUE,
                    highlight_my_name BOOLEAN DEFAULT TRUE,
                    grid_font_size INT DEFAULT 14,
                    
                    -- Wish Overview Preferences
                    wish_show_occupied BOOLEAN DEFAULT TRUE,
                    wish_show_absences BOOLEAN DEFAULT TRUE,
                    wish_hidden_doctors JSON,
                    
                    -- Metadata
                    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    last_login TIMESTAMP NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    
                    INDEX idx_email (email),
                    INDEX idx_doctor_id (doctor_id),
                    INDEX idx_is_active (is_active)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            return Response.json({ success: true, message: 'Table app_users created' });
        }

        if (action === 'createInitialAdmin') {
            if (!initialAdminEmail || !initialAdminPassword) {
                return Response.json({ error: 'Email and password required' }, { status: 400 });
            }

            // Check if admin already exists
            const [existing] = await connection.execute(
                'SELECT id FROM app_users WHERE email = ?',
                [initialAdminEmail.toLowerCase().trim()]
            );

            if (existing.length > 0) {
                return Response.json({ error: 'User already exists' }, { status: 409 });
            }

            const id = crypto.randomUUID();
            const password_hash = await bcrypt.hash(initialAdminPassword, 12);

            await connection.execute(
                `INSERT INTO app_users (id, email, password_hash, full_name, role, is_active)
                 VALUES (?, ?, ?, ?, 'admin', 1)`,
                [id, initialAdminEmail.toLowerCase().trim(), password_hash, 'Administrator']
            );

            return Response.json({ success: true, message: 'Initial admin created', userId: id });
        }

        if (action === 'migrateFromBase44') {
            // Migrate existing Base44 users to app_users
            const base44Users = await base44.asServiceRole.entities.User.list();
            
            let migrated = 0;
            let skipped = 0;
            const errors = [];

            for (const b44User of base44Users) {
                try {
                    // Check if already migrated
                    const [existing] = await connection.execute(
                        'SELECT id FROM app_users WHERE email = ?',
                        [b44User.email.toLowerCase().trim()]
                    );

                    if (existing.length > 0) {
                        skipped++;
                        continue;
                    }

                    // Generate temporary password (user must change it)
                    const tempPassword = crypto.randomUUID().substring(0, 12);
                    const password_hash = await bcrypt.hash(tempPassword, 12);

                    await connection.execute(
                        `INSERT INTO app_users (id, email, password_hash, full_name, role, doctor_id, is_active,
                         theme, section_config, collapsed_sections, schedule_hidden_rows, schedule_show_sidebar,
                         highlight_my_name, grid_font_size, wish_show_occupied, wish_show_absences, wish_hidden_doctors)
                         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            b44User.id,
                            b44User.email.toLowerCase().trim(),
                            password_hash,
                            b44User.full_name || '',
                            b44User.role || 'user',
                            b44User.doctor_id || null,
                            b44User.theme || null,
                            b44User.section_config || null,
                            b44User.collapsed_sections ? JSON.stringify(b44User.collapsed_sections) : null,
                            b44User.schedule_hidden_rows ? JSON.stringify(b44User.schedule_hidden_rows) : null,
                            b44User.schedule_show_sidebar !== false,
                            b44User.highlight_my_name !== false,
                            b44User.grid_font_size || 14,
                            b44User.wish_show_occupied !== false,
                            b44User.wish_show_absences !== false,
                            b44User.wish_hidden_doctors ? JSON.stringify(b44User.wish_hidden_doctors) : null
                        ]
                    );

                    migrated++;
                    
                    // Log temp password (in real scenario, send email)
                    console.log(`Migrated user ${b44User.email} with temp password: ${tempPassword}`);
                    
                } catch (e) {
                    errors.push({ email: b44User.email, error: e.message });
                }
            }

            return Response.json({
                success: true,
                migrated,
                skipped,
                errors,
                message: `Migrated ${migrated} users, skipped ${skipped} existing`
            });
        }

        if (action === 'checkTable') {
            try {
                const [rows] = await connection.execute('SELECT COUNT(*) as count FROM app_users');
                return Response.json({ 
                    exists: true, 
                    userCount: rows[0].count 
                });
            } catch (e) {
                if (e.message.includes("doesn't exist")) {
                    return Response.json({ exists: false });
                }
                throw e;
            }
        }

        return Response.json({ error: 'Unknown action. Use: createTable, createInitialAdmin, migrateFromBase44, checkTable' }, { status: 400 });

    } catch (e) {
        console.error('Setup Error:', e);
        return Response.json({ error: e.message }, { status: 500 });
    } finally {
        if (connection) await connection.end();
    }
});