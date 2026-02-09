import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../index.js';

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
  const boolFields = ['schedule_show_sidebar', 'highlight_my_name', 'wish_show_occupied', 'wish_show_absences', 'is_active', 'must_change_password'];
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
    const { email, password, full_name, role = 'user', doctor_id } = req.body;
    
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
    
    if (deletedUser) {
      // Reactivate and update the soft-deleted user
      await db.execute(
        `UPDATE app_users SET password_hash = ?, full_name = ?, role = ?, doctor_id = ?, 
         is_active = 1, allowed_tenants = ?, must_change_password = 0, updated_date = NOW() 
         WHERE id = ?`,
        [password_hash, full_name || '', role, doctor_id || null, adminTenants || null, deletedUser.id]
      );
      
      const [newUser] = await db.execute('SELECT * FROM app_users WHERE id = ?', [deletedUser.id]);
      
      console.log(`[Auth] Soft-deleted user reactivated by ${req.user.email}: ${email}, inherited tenants: ${adminTenants}`);
      
      return res.status(201).json({ user: sanitizeUser(newUser[0]) });
    }
    
    // Create brand new user
    const id = crypto.randomUUID();
    
    await db.execute(
      `INSERT INTO app_users (id, email, password_hash, full_name, role, doctor_id, is_active, allowed_tenants) 
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, email.toLowerCase().trim(), password_hash, full_name || '', role, doctor_id || null, adminTenants || null]
    );
    
    const [newUser] = await db.execute('SELECT * FROM app_users WHERE id = ?', [id]);
    
    console.log(`[Auth] User created by ${req.user.email}: ${email}, inherited tenants: ${adminTenants}`);
    
    res.status(201).json({ user: sanitizeUser(newUser[0]) });
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
    console.log(`[AUDIT][DELETE][USER] ${timestamp} | Admin: ${req.user.email} | Deactivated User: ${deletedUser?.email || userId} | Name: ${deletedUser?.full_name || 'unknown'} | Role: ${deletedUser?.role || 'unknown'} | DoctorID: ${deletedUser?.doctor_id || 'none'}`);
    
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

export default router;
