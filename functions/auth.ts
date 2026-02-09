/**
 * Custom JWT Authentication Backend
 * Endpoints: login, register, me, updateMe, logout
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import mysql from 'npm:mysql2@^3.9.0/promise';
import bcrypt from 'npm:bcryptjs@^2.4.3';

const JWT_SECRET = Deno.env.get('JWT_SECRET');
const TOKEN_EXPIRY = 24 * 60 * 60; // 24 hours in seconds

// Simple JWT implementation using Web Crypto API
async function createJWT(payload) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    
    const fullPayload = {
        ...payload,
        iat: now,
        exp: now + TOKEN_EXPIRY
    };
    
    const encoder = new TextEncoder();
    const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
    const payloadB64 = btoa(JSON.stringify(fullPayload)).replace(/=/g, '');
    
    const data = encoder.encode(`${headerB64}.${payloadB64}`);
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(JWT_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', key, data);
    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    
    return `${headerB64}.${payloadB64}.${signatureB64}`;
}

async function verifyJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        
        const [headerB64, payloadB64, signatureB64] = parts;
        
        const encoder = new TextEncoder();
        const data = encoder.encode(`${headerB64}.${payloadB64}`);
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(JWT_SECRET),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );
        
        // Decode signature
        const sigStr = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
        const sigPadded = sigStr + '='.repeat((4 - sigStr.length % 4) % 4);
        const signature = Uint8Array.from(atob(sigPadded), c => c.charCodeAt(0));
        
        const valid = await crypto.subtle.verify('HMAC', key, signature, data);
        if (!valid) return null;
        
        // Decode payload
        const payloadPadded = payloadB64 + '='.repeat((4 - payloadB64.length % 4) % 4);
        const payload = JSON.parse(atob(payloadPadded));
        
        // Check expiry
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }
        
        return payload;
    } catch (e) {
        console.error('JWT verify error:', e);
        return null;
    }
}

async function getConnection() {
    return await mysql.createConnection({
        host: Deno.env.get('MYSQL_HOST')?.trim(),
        user: Deno.env.get('MYSQL_USER')?.trim(),
        password: Deno.env.get('MYSQL_PASSWORD')?.trim(),
        database: Deno.env.get('MYSQL_DATABASE')?.trim(),
        port: parseInt(Deno.env.get('MYSQL_PORT')?.trim() || '3306'),
        dateStrings: true
    });
}

function sanitizeUser(user) {
    if (!user) return null;
    const { password_hash, ...safe } = user;
    
    // Parse JSON fields
    const jsonFields = ['collapsed_sections', 'schedule_hidden_rows', 'wish_hidden_doctors'];
    for (const field of jsonFields) {
        if (safe[field] && typeof safe[field] === 'string') {
            try {
                safe[field] = JSON.parse(safe[field]);
            } catch (e) {}
        }
    }
    
    // Convert boolean fields
    const boolFields = ['schedule_show_sidebar', 'highlight_my_name', 'wish_show_occupied', 'wish_show_absences', 'is_active'];
    for (const field of boolFields) {
        if (safe[field] !== undefined) {
            safe[field] = !!safe[field];
        }
    }
    
    return safe;
}

Deno.serve(async (req) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    };
    
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers });
    }

    let body = {};
    try {
        body = await req.json();
    } catch (e) {}
    
    const { action } = body;
    let connection;
    
    try {
        connection = await getConnection();
        
        // ============ LOGIN ============
        if (action === 'login') {
            const { email, password } = body;
            
            if (!email || !password) {
                return Response.json({ error: 'Email und Passwort erforderlich' }, { status: 400, headers });
            }
            
            const [rows] = await connection.execute(
                'SELECT * FROM app_users WHERE email = ? AND is_active = 1',
                [email.toLowerCase().trim()]
            );
            
            if (rows.length === 0) {
                return Response.json({ error: 'Ungültige Anmeldedaten' }, { status: 401, headers });
            }
            
            const user = rows[0];
            const validPassword = await bcrypt.compare(password, user.password_hash);
            
            if (!validPassword) {
                return Response.json({ error: 'Ungültige Anmeldedaten' }, { status: 401, headers });
            }
            
            // Update last login
            await connection.execute(
                'UPDATE app_users SET last_login = NOW() WHERE id = ?',
                [user.id]
            );
            
            // Create JWT
            const token = await createJWT({
                sub: user.id,
                email: user.email,
                role: user.role,
                doctor_id: user.doctor_id
            });
            
            return Response.json({
                token,
                user: sanitizeUser(user)
            }, { headers });
        }
        
        // ============ REGISTER (Admin only) ============
        if (action === 'register') {
            // Verify admin token
            const authHeader = req.headers.get('Authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                return Response.json({ error: 'Nicht autorisiert' }, { status: 401, headers });
            }
            
            const adminPayload = await verifyJWT(authHeader.substring(7));
            if (!adminPayload || adminPayload.role !== 'admin') {
                return Response.json({ error: 'Nur Administratoren können Benutzer erstellen' }, { status: 403, headers });
            }
            
            const { email, password, full_name, role = 'user', doctor_id } = body;
            
            if (!email || !password) {
                return Response.json({ error: 'Email und Passwort erforderlich' }, { status: 400, headers });
            }
            
            // Check if user exists (only active users count as conflict)
            const [existing] = await connection.execute(
                'SELECT id, is_active FROM app_users WHERE email = ?',
                [email.toLowerCase().trim()]
            );
            
            const activeUser = (existing as any[]).find((u: any) => u.is_active === 1);
            if (activeUser) {
                return Response.json({ error: 'Benutzer existiert bereits' }, { status: 409, headers });
            }
            
            // Hash password
            const password_hash = await bcrypt.hash(password, 12);
            
            // Check if there's a soft-deleted user with this email - reactivate instead of insert
            const deletedUser = (existing as any[]).find((u: any) => u.is_active === 0);
            
            if (deletedUser) {
                // Reactivate and update the soft-deleted user
                await connection.execute(
                    `UPDATE app_users SET password_hash = ?, full_name = ?, role = ?, doctor_id = ?, 
                     is_active = 1, must_change_password = 0, updated_date = NOW() 
                     WHERE id = ?`,
                    [password_hash, full_name || '', role, doctor_id || null, deletedUser.id]
                );
                
                const [newUser] = await connection.execute('SELECT * FROM app_users WHERE id = ?', [deletedUser.id]);
                
                return Response.json({ user: sanitizeUser((newUser as any[])[0]) }, { status: 201, headers });
            }
            
            // Create brand new user
            const id = crypto.randomUUID();
            
            await connection.execute(
                `INSERT INTO app_users (id, email, password_hash, full_name, role, doctor_id, is_active) 
                 VALUES (?, ?, ?, ?, ?, ?, 1)`,
                [id, email.toLowerCase().trim(), password_hash, full_name || '', role, doctor_id || null]
            );
            
            const [newUser] = await connection.execute('SELECT * FROM app_users WHERE id = ?', [id]);
            
            return Response.json({ user: sanitizeUser((newUser as any[])[0]) }, { status: 201, headers });
        }
        
        // ============ ME (Get current user) ============
        if (action === 'me') {
            const authHeader = req.headers.get('Authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                return Response.json({ error: 'Nicht autorisiert' }, { status: 401, headers });
            }
            
            const payload = await verifyJWT(authHeader.substring(7));
            if (!payload) {
                return Response.json({ error: 'Token ungültig oder abgelaufen' }, { status: 401, headers });
            }
            
            const [rows] = await connection.execute(
                'SELECT * FROM app_users WHERE id = ? AND is_active = 1',
                [payload.sub]
            );
            
            if (rows.length === 0) {
                return Response.json({ error: 'Benutzer nicht gefunden' }, { status: 404, headers });
            }
            
            return Response.json(sanitizeUser(rows[0]), { headers });
        }
        
        // ============ UPDATE ME ============
        if (action === 'updateMe') {
            const authHeader = req.headers.get('Authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                return Response.json({ error: 'Nicht autorisiert' }, { status: 401, headers });
            }
            
            const payload = await verifyJWT(authHeader.substring(7));
            if (!payload) {
                return Response.json({ error: 'Token ungültig oder abgelaufen' }, { status: 401, headers });
            }
            
            const { data } = body;
            if (!data || Object.keys(data).length === 0) {
                return Response.json({ error: 'Keine Daten zum Aktualisieren' }, { status: 400, headers });
            }
            
            // Whitelist allowed fields for self-update
            const allowedFields = [
                'full_name', 'theme', 'section_config', 'collapsed_sections',
                'schedule_hidden_rows', 'schedule_show_sidebar', 'highlight_my_name',
                'grid_font_size', 'wish_show_occupied', 'wish_show_absences', 'wish_hidden_doctors'
            ];
            
            const updates = [];
            const values = [];
            
            for (const [key, value] of Object.entries(data)) {
                if (allowedFields.includes(key)) {
                    updates.push(`\`${key}\` = ?`);
                    // Serialize arrays/objects
                    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
                        values.push(JSON.stringify(value));
                    } else {
                        values.push(value);
                    }
                }
            }
            
            if (updates.length === 0) {
                return Response.json({ error: 'Keine gültigen Felder zum Aktualisieren' }, { status: 400, headers });
            }
            
            values.push(payload.sub);
            
            await connection.execute(
                `UPDATE app_users SET ${updates.join(', ')}, updated_date = NOW() WHERE id = ?`,
                values
            );
            
            const [rows] = await connection.execute('SELECT * FROM app_users WHERE id = ?', [payload.sub]);
            
            return Response.json(sanitizeUser(rows[0]), { headers });
        }
        
        // ============ CHANGE PASSWORD ============
        if (action === 'changePassword') {
            const authHeader = req.headers.get('Authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                return Response.json({ error: 'Nicht autorisiert' }, { status: 401, headers });
            }
            
            const payload = await verifyJWT(authHeader.substring(7));
            if (!payload) {
                return Response.json({ error: 'Token ungültig oder abgelaufen' }, { status: 401, headers });
            }
            
            const { currentPassword, newPassword } = body;
            
            if (!currentPassword || !newPassword) {
                return Response.json({ error: 'Aktuelles und neues Passwort erforderlich' }, { status: 400, headers });
            }
            
            if (newPassword.length < 8) {
                return Response.json({ error: 'Neues Passwort muss mindestens 8 Zeichen haben' }, { status: 400, headers });
            }
            
            const [rows] = await connection.execute('SELECT * FROM app_users WHERE id = ?', [payload.sub]);
            if (rows.length === 0) {
                return Response.json({ error: 'Benutzer nicht gefunden' }, { status: 404, headers });
            }
            
            const validPassword = await bcrypt.compare(currentPassword, rows[0].password_hash);
            if (!validPassword) {
                return Response.json({ error: 'Aktuelles Passwort ist falsch' }, { status: 401, headers });
            }
            
            const newHash = await bcrypt.hash(newPassword, 12);
            await connection.execute(
                'UPDATE app_users SET password_hash = ?, updated_date = NOW() WHERE id = ?',
                [newHash, payload.sub]
            );
            
            return Response.json({ success: true }, { headers });
        }
        
        // ============ LIST USERS (Admin only) ============
        if (action === 'listUsers') {
            const authHeader = req.headers.get('Authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                return Response.json({ error: 'Nicht autorisiert' }, { status: 401, headers });
            }
            
            const payload = await verifyJWT(authHeader.substring(7));
            if (!payload || payload.role !== 'admin') {
                return Response.json({ error: 'Nur Administratoren können Benutzer auflisten' }, { status: 403, headers });
            }
            
            const [rows] = await connection.execute('SELECT * FROM app_users ORDER BY created_date DESC');
            
            return Response.json(rows.map(sanitizeUser), { headers });
        }
        
        // ============ UPDATE USER (Admin only) ============
        if (action === 'updateUser') {
            const authHeader = req.headers.get('Authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                return Response.json({ error: 'Nicht autorisiert' }, { status: 401, headers });
            }
            
            const payload = await verifyJWT(authHeader.substring(7));
            if (!payload || payload.role !== 'admin') {
                return Response.json({ error: 'Nur Administratoren können Benutzer bearbeiten' }, { status: 403, headers });
            }
            
            const { userId, data } = body;
            if (!userId || !data) {
                return Response.json({ error: 'userId und data erforderlich' }, { status: 400, headers });
            }
            
            // Admin can update more fields
            const allowedFields = [
                'full_name', 'role', 'doctor_id', 'is_active',
                'theme', 'section_config', 'collapsed_sections',
                'schedule_hidden_rows', 'schedule_show_sidebar', 'highlight_my_name',
                'grid_font_size', 'wish_show_occupied', 'wish_show_absences', 'wish_hidden_doctors'
            ];
            
            const updates = [];
            const values = [];
            
            for (const [key, value] of Object.entries(data)) {
                if (allowedFields.includes(key)) {
                    updates.push(`\`${key}\` = ?`);
                    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
                        values.push(JSON.stringify(value));
                    } else {
                        values.push(value);
                    }
                }
            }
            
            // Handle password reset
            if (data.password) {
                updates.push('password_hash = ?');
                values.push(await bcrypt.hash(data.password, 12));
            }
            
            if (updates.length === 0) {
                return Response.json({ error: 'Keine gültigen Felder' }, { status: 400, headers });
            }
            
            values.push(userId);
            
            await connection.execute(
                `UPDATE app_users SET ${updates.join(', ')}, updated_date = NOW() WHERE id = ?`,
                values
            );
            
            const [rows] = await connection.execute('SELECT * FROM app_users WHERE id = ?', [userId]);
            
            return Response.json(sanitizeUser(rows[0]), { headers });
        }
        
        // ============ DELETE USER (Admin only) ============
        if (action === 'deleteUser') {
            const authHeader = req.headers.get('Authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                return Response.json({ error: 'Nicht autorisiert' }, { status: 401, headers });
            }
            
            const payload = await verifyJWT(authHeader.substring(7));
            if (!payload || payload.role !== 'admin') {
                return Response.json({ error: 'Nur Administratoren können Benutzer löschen' }, { status: 403, headers });
            }
            
            const { userId } = body;
            if (!userId) {
                return Response.json({ error: 'userId erforderlich' }, { status: 400, headers });
            }
            
            // Fetch user data before soft-delete for audit log
            const [userRows] = await connection.execute(
                'SELECT id, email, full_name, role, doctor_id FROM app_users WHERE id = ?', [userId]
            );
            const deletedUser = (userRows as any[])[0] || null;
            
            // Soft delete
            await connection.execute(
                'UPDATE app_users SET is_active = 0, updated_date = NOW() WHERE id = ?',
                [userId]
            );
            
            const timestamp = new Date().toISOString();
            console.log(`[AUDIT][DELETE][USER] ${timestamp} | Admin: ${payload.email} | Deactivated User: ${deletedUser?.email || userId} | Name: ${deletedUser?.full_name || 'unknown'} | Role: ${deletedUser?.role || 'unknown'}`);
            
            return Response.json({ success: true }, { headers });
        }
        
        // ============ VERIFY TOKEN ============
        if (action === 'verify') {
            const authHeader = req.headers.get('Authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                return Response.json({ valid: false }, { headers });
            }
            
            const payload = await verifyJWT(authHeader.substring(7));
            return Response.json({ valid: !!payload, payload }, { headers });
        }
        
        return Response.json({ error: 'Unknown action' }, { status: 400, headers });
        
    } catch (e) {
        console.error('Auth Error:', e);
        return Response.json({ error: e.message }, { status: 500, headers });
    } finally {
        if (connection) await connection.end();
    }
});