import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../index.js';
import { sendEmail } from '../utils/email.js';

const router = express.Router();

// JWT Helper Functions
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = '24h';

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Middleware to verify authentication
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Nicht autorisiert' });
  }
  
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
  }
  
  req.user = payload;
  next();
}

// Middleware to verify admin role
export function adminMiddleware(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
  }
  next();
}

// Sanitize user object (remove sensitive data)
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
  const boolFields = ['schedule_show_sidebar', 'highlight_my_name', 'wish_show_occupied', 'wish_show_absences', 'is_active', 'must_change_password', 'email_verified'];
  for (const field of boolFields) {
    if (safe[field] !== undefined) {
      safe[field] = !!safe[field];
    }
  }
  
  return safe;
}

// ============ LOGIN ============
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email und Passwort erforderlich' });
    }
    
    const [rows] = await db.execute(
      'SELECT * FROM app_users WHERE email = ? AND is_active = 1',
      [email.toLowerCase().trim()]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }
    
    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }
    
    // Update last login
    await db.execute(
      'UPDATE app_users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );
    
    // Check if user needs to change password
    const mustChangePassword = user.must_change_password === 1 || user.must_change_password === true;
    
    // Create JWT
    const token = createToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      doctor_id: user.doctor_id
    });
    
    res.json({
      token,
      user: sanitizeUser(user),
      must_change_password: mustChangePassword
    });
  } catch (error) {
    next(error);
  }
});

// ============ REGISTER (Admin only) ============
// New users inherit the creating admin's tenant restrictions
router.post('/register', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { email, password, full_name, role = 'user', doctor_id, sendPasswordEmail: shouldSendEmail } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email und Passwort erforderlich' });
    }
    
    // Check if user exists (only active users count as conflict)
    const [existing] = await db.execute(
      'SELECT id, is_active FROM app_users WHERE email = ?',
      [email.toLowerCase().trim()]
    );
    
    const activeUser = existing.find(u => u.is_active === 1);
    if (activeUser) {
      return res.status(409).json({ error: 'Benutzer existiert bereits' });
    }
    
    // Get the creating admin's allowed_tenants to inherit
    const [adminRows] = await db.execute('SELECT allowed_tenants FROM app_users WHERE id = ?', [req.user.sub]);
    const adminTenants = adminRows[0]?.allowed_tenants;
    
    // Hash password
    const password_hash = await bcrypt.hash(password, 12);
    
    // Check if there's a soft-deleted user with this email - reactivate instead of insert
    const deletedUser = existing.find(u => u.is_active === 0);
    
    let createdUserId;
    
    if (deletedUser) {
      // Reactivate and update the soft-deleted user
      await db.execute(
        `UPDATE app_users SET password_hash = ?, full_name = ?, role = ?, doctor_id = ?, 
         is_active = 1, allowed_tenants = ?, must_change_password = 0, updated_date = NOW() 
         WHERE id = ?`,
        [password_hash, full_name || '', role, doctor_id || null, adminTenants || null, deletedUser.id]
      );
      
      createdUserId = deletedUser.id;
      const [newUser] = await db.execute('SELECT * FROM app_users WHERE id = ?', [deletedUser.id]);
      
      console.log(`[Auth] Soft-deleted user reactivated by ${req.user.email}: ${email}, inherited tenants: ${adminTenants}`);
      
      // Auto-send password email if requested
      if (shouldSendEmail) {
        try {
          await sendPasswordEmailForUser(createdUserId, req.user.email);
          console.log(`[Auth] Auto-sent password email to reactivated user: ${email}`);
        } catch (emailErr) {
          console.error(`[Auth] Failed to auto-send password email to ${email}:`, emailErr.message);
        }
      }
      
      return res.status(201).json({ user: sanitizeUser(newUser[0]), passwordEmailSent: !!shouldSendEmail });
    }
    
    // Create brand new user
    const id = crypto.randomUUID();
    createdUserId = id;
    
    await db.execute(
      `INSERT INTO app_users (id, email, password_hash, full_name, role, doctor_id, is_active, allowed_tenants) 
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, email.toLowerCase().trim(), password_hash, full_name || '', role, doctor_id || null, adminTenants || null]
    );
    
    const [newUser] = await db.execute('SELECT * FROM app_users WHERE id = ?', [id]);
    
    console.log(`[Auth] User created by ${req.user.email}: ${email}, inherited tenants: ${adminTenants}`);
    
    // Auto-send password email if requested
    if (shouldSendEmail) {
      try {
        await sendPasswordEmailForUser(createdUserId, req.user.email);
        console.log(`[Auth] Auto-sent password email to new user: ${email}`);
      } catch (emailErr) {
        console.error(`[Auth] Failed to auto-send password email to ${email}:`, emailErr.message);
      }
    }
    
    res.status(201).json({ user: sanitizeUser(newUser[0]), passwordEmailSent: !!shouldSendEmail });
  } catch (error) {
    next(error);
  }
});

// ============ ME (Get current user) ============
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM app_users WHERE id = ? AND is_active = 1',
      [req.user.sub]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    
    res.json(sanitizeUser(rows[0]));
  } catch (error) {
    next(error);
  }
});

// ============ UPDATE ME ============
router.patch('/me', authMiddleware, async (req, res, next) => {
  try {
    const { data } = req.body;
    
    if (!data || Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Keine Daten zum Aktualisieren' });
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
        // Handle null explicitly, then objects/arrays
        if (value === null) {
          values.push(null);
        } else if (Array.isArray(value) || typeof value === 'object') {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Keine gültigen Felder zum Aktualisieren' });
    }
    
    values.push(req.user.sub);
    
    await db.execute(
      `UPDATE app_users SET ${updates.join(', ')}, updated_date = NOW() WHERE id = ?`,
      values
    );
    
    const [rows] = await db.execute('SELECT * FROM app_users WHERE id = ?', [req.user.sub]);
    
    res.json(sanitizeUser(rows[0]));
  } catch (error) {
    next(error);
  }
});

// ============ CHANGE PASSWORD ============
router.post('/change-password', authMiddleware, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich' });
    }
    
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 8 Zeichen haben' });
    }
    
    const [rows] = await db.execute('SELECT * FROM app_users WHERE id = ?', [req.user.sub]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    
    const validPassword = await bcrypt.compare(currentPassword, rows[0].password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
    }
    
    const newHash = await bcrypt.hash(newPassword, 12);
    await db.execute(
      'UPDATE app_users SET password_hash = ?, must_change_password = 0, updated_date = NOW() WHERE id = ?',
      [newHash, req.user.sub]
    );
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============ CHANGE EMAIL ============
router.post('/change-email', authMiddleware, async (req, res, next) => {
  try {
    const { newEmail, password } = req.body;
    
    if (!newEmail || !password) {
      return res.status(400).json({ error: 'Neue E-Mail und Passwort erforderlich' });
    }
    
    if (!newEmail.includes('@')) {
      return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
    }
    
    // Get current user
    const [rows] = await db.execute('SELECT * FROM app_users WHERE id = ?', [req.user.sub]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(password, rows[0].password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Passwort ist falsch' });
    }
    
    // Check if new email already exists
    const [existing] = await db.execute(
      'SELECT id FROM app_users WHERE email = ? AND id != ?',
      [newEmail.toLowerCase().trim(), req.user.sub]
    );
    
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Diese E-Mail-Adresse wird bereits verwendet' });
    }
    
    // Update email
    await db.execute(
      'UPDATE app_users SET email = ?, updated_date = NOW() WHERE id = ?',
      [newEmail.toLowerCase().trim(), req.user.sub]
    );
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============ LIST USERS (Admin only) ============
// Admins only see users that share at least one tenant with them
router.get('/users', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    // Get the requesting admin's allowed_tenants
    const [adminRows] = await db.execute('SELECT allowed_tenants FROM app_users WHERE id = ?', [req.user.sub]);
    const adminTenants = adminRows[0]?.allowed_tenants;
    
    // Parse admin tenants (could be JSON string, array, or null)
    let adminTenantList = null;
    if (adminTenants) {
      adminTenantList = typeof adminTenants === 'string' ? JSON.parse(adminTenants) : adminTenants;
    }
    
    // Only return active users (is_active = 1)
    const [rows] = await db.execute('SELECT * FROM app_users WHERE is_active = 1 ORDER BY created_date DESC');
    
    // If admin has no tenant restrictions (null or empty), show all users
    // Otherwise, filter to users who share at least one tenant OR have no restrictions
    let filteredUsers = rows;
    if (adminTenantList && adminTenantList.length > 0) {
      filteredUsers = rows.filter(user => {
        // Parse user's allowed_tenants
        let userTenants = user.allowed_tenants;
        if (userTenants && typeof userTenants === 'string') {
          try { userTenants = JSON.parse(userTenants); } catch(e) { userTenants = null; }
        }
        
        // Users with no restrictions are visible to all admins
        if (!userTenants || userTenants.length === 0) return true;
        
        // Check if there's at least one shared tenant
        return userTenants.some(t => adminTenantList.includes(t));
      });
    }
    
    res.json(filteredUsers.map(sanitizeUser));
  } catch (error) {
    next(error);
  }
});

// ============ UPDATE USER (Admin only) ============
router.patch('/users/:userId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { data } = req.body;
    
    console.log('[Auth] PATCH /users/:userId - Updating user:', userId);
    console.log('[Auth] Data received:', JSON.stringify(data));
    
    if (!data || Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Keine Daten zum Aktualisieren' });
    }
    
    // Validate tenant assignment - admin can only assign tenants they have access to
    if (data.allowed_tenants !== undefined) {
      // Get the requesting admin's allowed_tenants
      const [adminRows] = await db.execute('SELECT allowed_tenants FROM app_users WHERE id = ?', [req.user.sub]);
      const adminTenants = adminRows[0]?.allowed_tenants;
      
      // Parse admin tenants
      let adminTenantList = null;
      if (adminTenants) {
        adminTenantList = typeof adminTenants === 'string' ? JSON.parse(adminTenants) : adminTenants;
      }
      
      // If admin has restricted access, validate the assigned tenants
      if (adminTenantList && adminTenantList.length > 0 && data.allowed_tenants !== null) {
        const requestedTenants = Array.isArray(data.allowed_tenants) 
          ? data.allowed_tenants 
          : (typeof data.allowed_tenants === 'string' ? JSON.parse(data.allowed_tenants) : []);
        
        // Check if all requested tenants are in the admin's allowed list
        const invalidTenants = requestedTenants.filter(t => !adminTenantList.includes(t));
        if (invalidTenants.length > 0) {
          return res.status(403).json({ 
            error: 'Sie können nur Mandanten zuweisen, für die Sie selbst berechtigt sind' 
          });
        }
      }
      
      // Admin with restricted access cannot give full access (null) to others
      if (adminTenantList && adminTenantList.length > 0 && data.allowed_tenants === null) {
        return res.status(403).json({ 
          error: 'Sie können keinen Vollzugriff auf alle Mandanten vergeben' 
        });
      }
    }
    
    // Admin can update more fields
    const allowedFields = [
      'full_name', 'role', 'doctor_id', 'is_active', 'allowed_tenants',
      'theme', 'section_config', 'collapsed_sections',
      'schedule_hidden_rows', 'schedule_show_sidebar', 'highlight_my_name',
      'grid_font_size', 'wish_show_occupied', 'wish_show_absences', 'wish_hidden_doctors'
    ];
    
    const updates = [];
    const values = [];
    
    for (const [key, value] of Object.entries(data)) {
      if (allowedFields.includes(key)) {
        updates.push(`\`${key}\` = ?`);
        // Handle null explicitly, then objects/arrays
        if (value === null) {
          values.push(null);
        } else if (Array.isArray(value) || typeof value === 'object') {
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
      console.log('[Auth] No valid fields to update');
      return res.status(400).json({ error: 'Keine gültigen Felder' });
    }
    
    values.push(userId);
    
    const sql = `UPDATE app_users SET ${updates.join(', ')}, updated_date = NOW() WHERE id = ?`;
    console.log('[Auth] Executing SQL:', sql);
    console.log('[Auth] With values:', values);
    
    const [result] = await db.execute(sql, values);
    console.log('[Auth] Update result:', result);
    
    const [rows] = await db.execute('SELECT * FROM app_users WHERE id = ?', [userId]);
    console.log('[Auth] Updated user:', rows[0]?.allowed_tenants);
    
    res.json(sanitizeUser(rows[0]));
  } catch (error) {
    next(error);
  }
});

// ============ DELETE USER (Admin only - soft delete) ============
router.delete('/users/:userId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    // Fetch user data before soft-delete for audit log
    const [userRows] = await db.execute('SELECT id, email, full_name, role, doctor_id FROM app_users WHERE id = ?', [userId]);
    const deletedUser = userRows[0] || null;
    
    await db.execute(
      'UPDATE app_users SET is_active = 0, updated_date = NOW() WHERE id = ?',
      [userId]
    );
    
    const timestamp = new Date().toISOString();
    
    // Write to SystemLog table for UI visibility (use master db since this is an auth operation)
    try {
      const auditId = (await import('crypto')).randomUUID();
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await db.execute(
        `INSERT INTO SystemLog (id, level, source, message, details, created_date, updated_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [auditId, 'audit', 'Benutzerverwaltung', `Benutzer deaktiviert: ${deletedUser?.email || userId} (${deletedUser?.full_name || 'unknown'})`, JSON.stringify({ admin: req.user.email, user_id: userId, user_email: deletedUser?.email, user_name: deletedUser?.full_name, role: deletedUser?.role, doctor_id: deletedUser?.doctor_id, timestamp }), now, now, req.user.email]
      );
    } catch (logErr) {
      console.error('[AUDIT] Failed to write user deletion audit log:', logErr.message);
    }
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============ GET MY ALLOWED TENANTS ============
// Returns the tenants that the current user is allowed to access
router.get('/my-tenants', authMiddleware, async (req, res, next) => {
  try {
    // Get user's allowed_tenants
    const [userRows] = await db.execute(
      'SELECT allowed_tenants FROM app_users WHERE id = ? AND is_active = 1',
      [req.user.sub]
    );
    
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    
    const allowedTenants = userRows[0].allowed_tenants;
    let allowedTenantList = null;
    
    // Parse allowed_tenants (could be JSON string, array, or null)
    if (allowedTenants) {
      allowedTenantList = typeof allowedTenants === 'string' 
        ? JSON.parse(allowedTenants) 
        : allowedTenants;
    }
    
    // Get all db_tokens
    const [tokenRows] = await db.execute(`
      SELECT id, name, host, db_name, description, is_active
      FROM db_tokens
      ORDER BY name ASC
    `);
    
    // Filter tokens based on user's allowed_tenants
    let filteredTokens = tokenRows;
    
    // If allowedTenantList is null or empty, user has access to all tenants
    if (allowedTenantList && allowedTenantList.length > 0) {
      filteredTokens = tokenRows.filter(token => allowedTenantList.includes(token.id));
    }
    
    // Convert is_active from MySQL tinyint to proper boolean
    const tokens = filteredTokens.map(row => ({
      ...row,
      is_active: Boolean(row.is_active)
    }));
    
    res.json({
      hasFullAccess: !allowedTenantList || allowedTenantList.length === 0,
      tenants: tokens
    });
  } catch (error) {
    next(error);
  }
});

// ============ ACTIVATE TENANT (for non-admin users) ============
// Allows users to activate a tenant they have access to
router.post('/activate-tenant/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Get user's allowed_tenants
    const [userRows] = await db.execute(
      'SELECT allowed_tenants, role FROM app_users WHERE id = ? AND is_active = 1',
      [req.user.sub]
    );
    
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    
    const allowedTenants = userRows[0].allowed_tenants;
    const userRole = userRows[0].role;
    let allowedTenantList = null;
    
    // Parse allowed_tenants (could be JSON string, array, or null)
    if (allowedTenants) {
      allowedTenantList = typeof allowedTenants === 'string' 
        ? JSON.parse(allowedTenants) 
        : allowedTenants;
    }
    
    // Check if user has access to this tenant
    // Admin users OR users with no restrictions (null/empty allowed_tenants) have full access
    const hasFullAccess = userRole === 'admin' || !allowedTenantList || allowedTenantList.length === 0;
    
    if (!hasFullAccess && !allowedTenantList.includes(id)) {
      return res.status(403).json({ error: 'Kein Zugriff auf diesen Mandanten' });
    }
    
    // Get the token
    const [tokenRows] = await db.execute(
      'SELECT * FROM db_tokens WHERE id = ?',
      [id]
    );
    
    if (tokenRows.length === 0) {
      return res.status(404).json({ error: 'Mandant nicht gefunden' });
    }
    
    console.log(`[Auth] User ${req.user.email} activated tenant "${tokenRows[0].name}"`);
    
    res.json({
      success: true,
      token: tokenRows[0].token,
      name: tokenRows[0].name,
      host: tokenRows[0].host,
      db_name: tokenRows[0].db_name
    });
  } catch (error) {
    next(error);
  }
});

// ============ VERIFY TOKEN ============
router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.json({ valid: false });
  }
  
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  
  res.json({ valid: !!payload, payload });
});

// ============ SEND PASSWORD EMAIL (Admin only) ============
// Generates a temporary password, stores it, and sends it via email
router.post('/send-password-email', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId ist erforderlich' });
    }

    // Get user
    const [userRows] = await db.execute(
      'SELECT id, email, full_name, is_active FROM app_users WHERE id = ?',
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const user = userRows[0];

    if (!user.email) {
      return res.status(400).json({ error: 'Benutzer hat keine E-Mail-Adresse' });
    }

    // Generate a random temporary password
    const tempPassword = generateTempPassword();

    // Hash and store password, set must_change_password
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await db.execute(
      'UPDATE app_users SET password_hash = ?, must_change_password = 1, updated_date = NOW() WHERE id = ?',
      [passwordHash, userId]
    );

    // Build the login URL (FRONTEND_URL must point to the frontend, not the backend API)
    const appBaseUrl = process.env.FRONTEND_URL || process.env.APP_URL || process.env.VITE_APP_URL || 'https://curaflow-production.up.railway.app';

    // Also create email verification token
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyId = crypto.randomUUID();
    const expiresDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Ensure EmailVerification table exists (graceful)
    try {
      await db.execute(
        `INSERT INTO EmailVerification (id, user_id, token, type, status, created_date, expires_date) 
         VALUES (?, ?, ?, 'email_verify', 'pending', NOW(), ?)`,
        [verifyId, userId, verifyToken, expiresDate]
      );
    } catch (tableErr) {
      console.warn('[Auth] EmailVerification table may not exist yet:', tableErr.message);
    }

    const apiBaseUrl = process.env.API_URL 
      || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
      || 'http://localhost:3000';
    const verifyUrl = `${apiBaseUrl.replace(/\/+$/, '')}/api/auth/verify-email?token=${verifyToken}`;

    // Send email with temp password
    const subject = '[CuraFlow] Ihr Zugang wurde eingerichtet';
    const text = [
      `Hallo ${user.full_name || user.email},`,
      '',
      `Ihr CuraFlow-Zugang wurde eingerichtet. Hier sind Ihre Zugangsdaten:`,
      '',
      `📧 E-Mail: ${user.email}`,
      `🔑 Passwort: ${tempPassword}`,
      '',
      `Bitte ändern Sie Ihr Passwort nach der ersten Anmeldung.`,
      '',
      `Login-Seite: ${appBaseUrl}`,
      '',
      `Bitte bestätigen Sie Ihre E-Mail-Adresse über folgenden Link:`,
      verifyUrl,
      '',
      `Viele Grüße,`,
      `Ihr CuraFlow-System`
    ].join('\n');

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
        <h2 style="color:#4f46e5">Willkommen bei CuraFlow!</h2>
        <p>Hallo <strong>${user.full_name || user.email}</strong>,</p>
        <p>Ihr CuraFlow-Zugang wurde eingerichtet. Hier sind Ihre Zugangsdaten:</p>
        <div style="background:#f1f5f9;border-radius:8px;padding:20px;margin:20px 0;border-left:4px solid #4f46e5">
          <p style="margin:0 0 8px 0"><strong>📧 E-Mail:</strong> ${user.email}</p>
          <p style="margin:0"><strong>🔑 Passwort:</strong> <code style="background:#e2e8f0;padding:2px 8px;border-radius:4px;font-size:16px;letter-spacing:1px">${tempPassword}</code></p>
        </div>
        <p style="color:#dc2626;font-weight:600">⚠️ Bitte ändern Sie Ihr Passwort nach der ersten Anmeldung!</p>
        <div style="text-align:center;margin:24px 0">
          <a href="${appBaseUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">
            Jetzt anmelden
          </a>
        </div>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
        <p style="color:#64748b">Bitte bestätigen Sie außerdem Ihre E-Mail-Adresse:</p>
        <div style="text-align:center;margin:24px 0">
          <a href="${verifyUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
            ✓ E-Mail bestätigen
          </a>
        </div>
        <p style="font-size:13px;color:#94a3b8;margin-top:32px">Diese E-Mail wurde automatisch von CuraFlow versendet.</p>
      </div>
    `;

    await sendEmail({
      to: user.email.trim(),
      subject,
      text,
      html,
    });

    // Log the action
    try {
      const logId = crypto.randomUUID();
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await db.execute(
        `INSERT INTO SystemLog (id, level, source, message, details, created_date, updated_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [logId, 'info', 'Benutzerverwaltung', `Passwort-Email gesendet an: ${user.email}`, JSON.stringify({ admin: req.user.email, user_id: userId }), now, now, req.user.email]
      );
    } catch (logErr) {
      console.error('[AUDIT] Failed to write password email audit log:', logErr.message);
    }

    console.log(`[Auth] Password email sent to ${user.email} by admin ${req.user.email}`);

    res.json({ success: true, message: `Passwort-Email an ${user.email} gesendet` });
  } catch (error) {
    console.error('[Auth] send-password-email error:', error.message, error.code, error.responseCode);
    // Return detailed error for admin debugging
    const detail = error.code === 'ECONNREFUSED' ? 'SMTP-Server nicht erreichbar' 
      : error.code === 'EAUTH' ? 'SMTP-Authentifizierung fehlgeschlagen (SMTP_USER/SMTP_PASS prüfen)'
      : error.code === 'ESOCKET' ? 'SMTP-Verbindungsfehler (Port/SSL prüfen)'
      : error.responseCode ? `SMTP-Fehler ${error.responseCode}: ${error.response}`
      : error.message;
    res.status(500).json({ error: `E-Mail-Versand fehlgeschlagen: ${detail}` });
  }
});

// ============ EMAIL TEST (Admin only) ============
router.post('/test-smtp', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { sendEmail, getEmailProviderInfo } = await import('../utils/email.js');
    const providerInfo = getEmailProviderInfo();
    
    if (!providerInfo.configured) {
      return res.status(500).json({ 
        error: 'E-Mail nicht konfiguriert', 
        detail: 'Entweder BREVO_API_KEY (empfohlen für Railway) oder SMTP_HOST + SMTP_USER + SMTP_PASS setzen.',
        provider: providerInfo,
        env: { 
          BREVO_API_KEY: process.env.BREVO_API_KEY ? '✓' : '✗',
          SMTP_HOST: process.env.SMTP_HOST ? '✓' : '✗',
          SMTP_PORT: process.env.SMTP_PORT || '(default)',
          SMTP_USER: process.env.SMTP_USER ? '✓' : '✗',
          SMTP_PASS: process.env.SMTP_PASS ? '✓' : '✗',
          SMTP_FROM: process.env.SMTP_FROM || '(not set)',
        }
      });
    }
    
    // Send a test email via the configured provider
    const result = await sendEmail({
      to: req.user.email,
      subject: '[CuraFlow] E-Mail Test erfolgreich',
      text: `E-Mail-Konfiguration funktioniert!\n\nProvider: ${providerInfo.provider}\nFrom: ${providerInfo.from}\n\nZeitstempel: ${new Date().toISOString()}`,
      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px">
        <h2 style="color:#16a34a">✅ E-Mail Test erfolgreich!</h2>
        <p>Provider: <strong>${providerInfo.provider}</strong></p>
        <p>From: ${providerInfo.from}</p>
        <p style="color:#64748b;font-size:13px">Zeitstempel: ${new Date().toISOString()}</p>
      </div>`,
    });
    
    res.json({ success: true, message: `Test-Email an ${req.user.email} gesendet`, provider: providerInfo, result });
  } catch (error) {
    console.error('[Auth] Email test failed:', error.message, error.code);
    res.status(500).json({ error: `E-Mail-Test fehlgeschlagen: ${error.message}`, code: error.code, provider: (await import('../utils/email.js')).getEmailProviderInfo() });
  }
});

// ============ VERIFY EMAIL (Public callback) ============
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  
  if (!token || typeof token !== 'string' || token.length > 100) {
    return res.status(400).send(emailVerifyHtml('Ungültiger Link', 'Der Verifizierungslink ist ungültig oder abgelaufen.', false));
  }

  try {
    const [rows] = await db.execute(
      'SELECT id, user_id, status, expires_date FROM EmailVerification WHERE token = ? AND type = ?',
      [token, 'email_verify']
    );

    if (rows.length === 0) {
      return res.status(404).send(emailVerifyHtml('Link nicht gefunden', 'Dieser Verifizierungslink ist ungültig oder wurde bereits verwendet.', false));
    }

    const record = rows[0];

    if (record.status === 'verified') {
      return res.send(emailVerifyHtml('Bereits verifiziert', 'Ihre E-Mail-Adresse wurde bereits erfolgreich verifiziert. Vielen Dank!', true));
    }

    if (record.expires_date && new Date(record.expires_date) < new Date()) {
      await db.execute("UPDATE EmailVerification SET status = 'expired' WHERE id = ?", [record.id]);
      return res.status(410).send(emailVerifyHtml('Link abgelaufen', 'Dieser Verifizierungslink ist abgelaufen. Bitte wenden Sie sich an Ihren Administrator.', false));
    }

    // Mark as verified
    await db.execute(
      "UPDATE EmailVerification SET status = 'verified', verified_date = NOW() WHERE id = ?",
      [record.id]
    );

    // Update user's email_verified status
    await db.execute(
      'UPDATE app_users SET email_verified = 1, email_verified_date = NOW(), updated_date = NOW() WHERE id = ?',
      [record.user_id]
    );

    console.log(`[Auth] Email verified for user_id ${record.user_id}`);

    return res.send(emailVerifyHtml('E-Mail verifiziert!', 'Ihre E-Mail-Adresse wurde erfolgreich bestätigt. Sie können sich jetzt bei CuraFlow anmelden.', true));
  } catch (err) {
    console.error('[Auth] Email verification error:', err.message);
    return res.status(500).send(emailVerifyHtml('Fehler', 'Es ist ein technischer Fehler aufgetreten. Bitte versuchen Sie es später erneut.', false));
  }
});

// ============ CHECK EMAIL VERIFICATION STATUS (Admin) ============
router.get('/email-verification-status/:userId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    const [userRows] = await db.execute(
      'SELECT email_verified, email_verified_date FROM app_users WHERE id = ?',
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Also check for pending verifications
    let lastSent = null;
    try {
      const [verifyRows] = await db.execute(
        "SELECT created_date, status FROM EmailVerification WHERE user_id = ? ORDER BY created_date DESC LIMIT 1",
        [userId]
      );
      if (verifyRows.length > 0) {
        lastSent = verifyRows[0];
      }
    } catch (e) {
      // Table may not exist
    }

    res.json({
      email_verified: !!userRows[0].email_verified,
      email_verified_date: userRows[0].email_verified_date,
      last_verification: lastSent
    });
  } catch (error) {
    next(error);
  }
});

// HTML template for email verification page
function emailVerifyHtml(title, message, success) {
  const color = success ? '#16a34a' : '#dc2626';
  const icon = success ? '✅' : '❌';
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CuraFlow – ${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;padding:20px}
.card{background:#fff;border-radius:16px;padding:48px;max-width:480px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);border-top:4px solid ${color}}
.icon{font-size:48px;margin-bottom:16px}.title{font-size:24px;font-weight:700;color:#1e293b;margin-bottom:12px}
.msg{font-size:16px;color:#64748b;line-height:1.6}.footer{margin-top:24px;font-size:13px;color:#94a3b8}</style></head>
<body><div class="card"><div class="icon">${icon}</div><h1 class="title">${title}</h1><p class="msg">${message}</p><p class="footer">CuraFlow Dienstplanverwaltung</p></div></body></html>`;
}

// Helper: Generate a readable temporary password
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const specials = '!@#$%&*';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Add one special char and one digit for complexity
  password += specials.charAt(Math.floor(Math.random() * specials.length));
  password += Math.floor(Math.random() * 10);
  return password;
}

// Export the sendPasswordEmail helper for use in register route
export async function sendPasswordEmailForUser(userId, adminEmail) {
  const [userRows] = await db.execute(
    'SELECT id, email, full_name FROM app_users WHERE id = ?',
    [userId]
  );

  if (userRows.length === 0 || !userRows[0].email) {
    throw new Error('Benutzer nicht gefunden oder keine E-Mail-Adresse');
  }

  const user = userRows[0];

  // Generate a temporary password
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  
  await db.execute(
    'UPDATE app_users SET password_hash = ?, must_change_password = 1, updated_date = NOW() WHERE id = ?',
    [passwordHash, userId]
  );

  // FRONTEND_URL must point to the frontend, not the backend API
  const appBaseUrl = process.env.FRONTEND_URL || process.env.APP_URL || process.env.VITE_APP_URL || 'https://curaflow-production.up.railway.app';

  // Email verification
  const emailVerifyToken = crypto.randomBytes(32).toString('hex');
  const verifyId = crypto.randomUUID();
  const expiresDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  try {
    await db.execute(
      `INSERT INTO EmailVerification (id, user_id, token, type, status, created_date, expires_date) 
       VALUES (?, ?, ?, 'email_verify', 'pending', NOW(), ?)`,
      [verifyId, userId, emailVerifyToken, expiresDate]
    );
  } catch (e) {
    console.warn('[Auth] Could not write EmailVerification record:', e.message);
  }

  const apiBaseUrl = process.env.API_URL 
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
    || 'http://localhost:3000';
  const verifyUrl = `${apiBaseUrl.replace(/\/+$/, '')}/api/auth/verify-email?token=${emailVerifyToken}`;

  const subject = '[CuraFlow] Ihr Zugang wurde eingerichtet';
  const text = [
    `Hallo ${user.full_name || user.email},`,
    '',
    `Ihr CuraFlow-Zugang wurde eingerichtet. Hier sind Ihre Zugangsdaten:`,
    '',
    `📧 E-Mail: ${user.email}`,
    `🔑 Passwort: ${tempPassword}`,
    '',
    `Bitte ändern Sie Ihr Passwort nach der ersten Anmeldung.`,
    '',
    `Login-Seite: ${appBaseUrl}`,
    '',
    `Bitte bestätigen Sie Ihre E-Mail-Adresse über folgenden Link:`,
    verifyUrl,
    '',
    `Viele Grüße,`,
    `Ihr CuraFlow-System`
  ].join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
      <h2 style="color:#4f46e5">Willkommen bei CuraFlow!</h2>
      <p>Hallo <strong>${user.full_name || user.email}</strong>,</p>
      <p>Ihr CuraFlow-Zugang wurde eingerichtet. Hier sind Ihre Zugangsdaten:</p>
      <div style="background:#f1f5f9;border-radius:8px;padding:20px;margin:20px 0;border-left:4px solid #4f46e5">
        <p style="margin:0 0 8px 0"><strong>📧 E-Mail:</strong> ${user.email}</p>
        <p style="margin:0"><strong>🔑 Passwort:</strong> <code style="background:#e2e8f0;padding:2px 8px;border-radius:4px;font-size:16px;letter-spacing:1px">${tempPassword}</code></p>
      </div>
      <p style="color:#dc2626;font-weight:600">⚠️ Bitte ändern Sie Ihr Passwort nach der ersten Anmeldung!</p>
      <div style="text-align:center;margin:24px 0">
        <a href="${appBaseUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">
          Jetzt anmelden
        </a>
      </div>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
      <p style="color:#64748b">Bitte bestätigen Sie außerdem Ihre E-Mail-Adresse:</p>
      <div style="text-align:center;margin:24px 0">
        <a href="${verifyUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
          ✓ E-Mail bestätigen
        </a>
      </div>
      <p style="font-size:13px;color:#94a3b8;margin-top:32px">Diese E-Mail wurde automatisch von CuraFlow versendet.</p>
    </div>
  `;

  await sendEmail({
    to: user.email.trim(),
    subject,
    text,
    html,
  });

  // Audit log
  try {
    const logId = crypto.randomUUID();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await db.execute(
      `INSERT INTO SystemLog (id, level, source, message, details, created_date, updated_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [logId, 'info', 'Benutzerverwaltung', `Passwort-Email gesendet an: ${user.email}`, JSON.stringify({ admin: adminEmail, user_id: userId }), now, now, adminEmail]
    );
  } catch (logErr) {
    console.error('[AUDIT] Failed to write password email audit log:', logErr.message);
  }

  console.log(`[Auth] Password email sent to ${user.email} by admin ${adminEmail}`);
  return { success: true, email: user.email };
}

export default router;
