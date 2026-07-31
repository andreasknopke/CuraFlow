import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../index.js';
import { broadcastUserEvent, buildRealtimeScope, registerRealtimeClient } from '../utils/realtime.js';
import { getEmailProviderInfo, sendEmail } from '../utils/email.js';
import { loadUserGroupContext, listUserGroups } from '../utils/tenantGroups.js';
import { requirePermission, isSuperAdmin, loadPermissions, clampPermissionsToGranter, ALL_PERMISSIONS_TRUE } from '../utils/permissions.js';

const router = express.Router();

type AuthRequest = Request & { user?: Record<string, unknown> };

// JWT Helper Functions
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = '24h';
const JITSI_JWT_APP_ID = process.env.JITSI_JWT_APP_ID;
const JITSI_JWT_APP_SECRET = process.env.JITSI_JWT_APP_SECRET;
const JITSI_JWT_AUDIENCE = process.env.JITSI_JWT_AUDIENCE || 'jitsi';
const JITSI_JWT_SUB = process.env.JITSI_JWT_SUB;
const parsedJitsiJwtExpirySeconds = parseInt(process.env.JITSI_JWT_EXPIRY_SECONDS || '1800', 10);
const JITSI_JWT_EXPIRY_SECONDS = Math.max(Number.isFinite(parsedJitsiJwtExpirySeconds) ? parsedJitsiJwtExpirySeconds : 1800, 1800);
const COWORK_INVITE_EXPIRY_MINUTES = parseInt(process.env.COWORK_INVITE_EXPIRY_MINUTES || '10', 10);
const COWORK_ONLINE_WINDOW_SECONDS = parseInt(process.env.COWORK_ONLINE_WINDOW_SECONDS || '120', 10);

function createToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, JWT_SECRET as string, { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token: string): Record<string, unknown> | null {
  try {
    return jwt.verify(token, JWT_SECRET as string) as Record<string, unknown>;
  } catch (e) {
    return null;
  }
}

function resolveAuthPayload(req: Request): Record<string, unknown> | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return verifyToken(authHeader.substring(7));
  }

  if (typeof req.query?.access_token === 'string' && req.query.access_token) {
    return verifyToken(req.query.access_token);
  }

  return null;
}

function streamAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const payload = resolveAuthPayload(req);
  if (!payload) {
    res.status(401).json({ error: 'Nicht autorisiert' });
    return;
  }

  req.user = payload;
  next();
}

function parseTenantSlug(allowedTenants: unknown): string {
  if (!allowedTenants) return 'default';

  try {
    const parsed = typeof allowedTenants === 'string' ? JSON.parse(allowedTenants) : allowedTenants;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed[0].toString().toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
    }
  } catch (error) {
    // Fallback below for non-JSON values.
  }

  return allowedTenants.toString().toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
}

function parseTenantList(allowedTenants: unknown): string[] | null {
  if (!allowedTenants) return null;

  try {
    const parsed = typeof allowedTenants === 'string' ? JSON.parse(allowedTenants) : allowedTenants;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (error) {
    return null;
  }

  return null;
}

function usersShareTenantAccess(firstAllowedTenants: unknown, secondAllowedTenants: unknown): boolean {
  const first = parseTenantList(firstAllowedTenants);
  const second = parseTenantList(secondAllowedTenants);

  if (!first || first.length === 0) return true;
  if (!second || second.length === 0) return true;

  return first.some((tenantId) => second.includes(tenantId));
}

function buildCoworkRoomName(tenantSlug: string): string {
  return `curaflow-support-${tenantSlug}-${crypto.randomUUID().slice(0, 8)}`;
}

function isUserOnline(lastSeenAt: unknown): boolean {
  if (!lastSeenAt) return false;
  const lastSeen = new Date(lastSeenAt as string).getTime();
  if (Number.isNaN(lastSeen)) return false;
  return Date.now() - lastSeen <= COWORK_ONLINE_WINDOW_SECONDS * 1000;
}

async function expireStaleCoworkInvites(): Promise<void> {
  await db.execute(
    `UPDATE CoWorkInvite
     SET status = 'expired', responded_date = COALESCE(responded_date, UTC_TIMESTAMP())
     WHERE status = 'pending' AND expires_date IS NOT NULL AND expires_date < UTC_TIMESTAMP()`
  );
}

function uuidCompareSql(columnName: string): string {
  return `${columnName} COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR(36) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci`;
}

function createJitsiToken({ roomName, user }: { roomName: string; user: Record<string, unknown> }): string {
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign({
    aud: JITSI_JWT_AUDIENCE,
    iss: JITSI_JWT_APP_ID,
    sub: JITSI_JWT_SUB,
    room: roomName,
    nbf: now - 10,
    exp: now + JITSI_JWT_EXPIRY_SECONDS,
    context: {
      user: {
        id: user.id,
        name: user.full_name || user.email || 'CuraFlow Admin',
        email: user.email,
        moderator: user.role === 'admin',
      },
    },
  }, JITSI_JWT_APP_SECRET as string, { algorithm: 'HS256' });
}

async function getCoworkAudienceUserIds({ allowedTenants, includeUserIds = [] }: {
  allowedTenants: unknown;
  includeUserIds?: string[];
}): Promise<string[]> {
  const [rows] = await db.execute(
    `SELECT id, allowed_tenants
     FROM app_users
     WHERE is_active = 1 AND role = 'admin'`
  ) as [Record<string, unknown>[], unknown];

  const audience = rows
    .filter((candidate) => usersShareTenantAccess(allowedTenants, candidate.allowed_tenants))
    .map((candidate) => candidate.id as string);

  for (const userId of includeUserIds) {
    if (userId && !audience.includes(userId)) {
      audience.push(userId);
    }
  }

  return audience;
}

async function broadcastCoworkUpdate({ type, actor = null, allowedTenants = null, includeUserIds = [], invite = null }: {
  type: string;
  actor?: Record<string, unknown> | null;
  allowedTenants?: string | null;
  includeUserIds?: string[];
  invite?: Record<string, unknown> | null;
}): Promise<void> {
  const userIds = await getCoworkAudienceUserIds({ allowedTenants, includeUserIds });

  broadcastUserEvent({
    eventName: 'cowork-update',
    userIds,
    payload: {
      type,
      changedAt: new Date().toISOString(),
      actor: actor ? {
        id: actor.id || null,
        email: actor.email || null,
      } : null,
      invite: invite ? {
        id: invite.id || null,
        roomName: invite.roomName || null,
        status: invite.status || null,
      } : null,
    },
  });
}

// Middleware to verify authentication
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Nicht autorisiert' });
    return;
  }
  
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  
  if (!payload) {
    res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
    return;
  }
  
  req.user = payload;
  next();
}

// Middleware to verify admin role
export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    return;
  }
  next();
}

// Sanitize user object (remove sensitive data)
function sanitizeUser(user: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!user) return null;
  
  const { password_hash, ...safe } = user;
  
  // Parse JSON fields
  const jsonFields = ['allowed_tenants', 'allowed_groups', 'group_admin_groups', 'collapsed_sections', 'schedule_hidden_rows', 'wish_hidden_doctors', 'permissions'];
  for (const field of jsonFields) {
    if (safe[field] && typeof safe[field] === 'string') {
      try {
        safe[field] = JSON.parse(safe[field] as string);
      } catch (e) {}
    }
  }
  
  // Convert boolean fields
  const boolFields = ['schedule_show_sidebar', 'schedule_show_time_account', 'schedule_initials_only', 'schedule_sort_doctors_alphabetically', 'highlight_my_name', 'wish_show_occupied', 'wish_show_absences', 'is_active', 'must_change_password', 'email_verified'];
  for (const field of boolFields) {
    if (safe[field] !== undefined) {
      safe[field] = !!safe[field];
    }
  }
  
  // Super-admin flag (read-only, calculated from env)
  (safe as Record<string, unknown>).is_super_admin = isSuperAdmin(safe.email as string);
  
  return safe;
}

function generateTemporaryPassword(): string {
  return `CF-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}!`;
}

// Load the requesting admin's ("granter's") authoritative permissions from the
// master DB by their user id — NOT from `req.user` (the JWT carries no
// `permissions`, so `loadPermissions(req.user)` would hit the lockout-safe
// branch and return ALL_PERMISSIONS_TRUE, enabling privilege escalation).
// Returns null for a non-existent / inactive / non-admin granter.
async function loadGranterPermissions(granterUser: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const [rows] = await db.execute(
    'SELECT email, role, is_active, permissions FROM app_users WHERE id = ?',
    [granterUser?.sub],
  ) as [Record<string, unknown>[], unknown];
  const row = rows[0];
  if (!row || !row.is_active || row.role !== 'admin') return null;
  return loadPermissions({ ...row, role: row.role, permissions: row.permissions });
}

async function sendTemporaryPasswordEmail({ email, fullName, tempPassword }: {
  email: string;
  fullName: string;
  tempPassword: string;
}): Promise<void> {
  const providerInfo = getEmailProviderInfo();
  if (!providerInfo.configured) {
    const error = new Error('E-Mail nicht konfiguriert. Bitte BREVO_API_KEY oder SMTP_HOST + SMTP_USER + SMTP_PASS setzen.');
    (error as unknown as Record<string, unknown>).statusCode = 503;
    throw error;
  }

  const displayName = fullName?.trim() || email;
  const appUrl = (process.env.APP_URL || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const loginHint = appUrl
    ? `<p>Login: <a href="${appUrl}">${appUrl}</a></p>`
    : '<p>Bitte melden Sie sich in CuraFlow mit dem neuen Passwort an.</p>';

  await sendEmail({
    to: email,
    subject: 'CuraFlow: Neues temporäres Passwort',
    text: [
      `Hallo ${displayName},`,
      '',
      'für Ihr CuraFlow-Konto wurde ein neues temporäres Passwort erstellt.',
      `Temporäres Passwort: ${tempPassword}`,
      '',
      'Bitte melden Sie sich damit an und ändern Sie Ihr Passwort direkt anschließend.',
      appUrl ? `Login: ${appUrl}` : '',
    ].filter(Boolean).join('\n'),
    html: `
      <p>Hallo ${displayName},</p>
      <p>für Ihr CuraFlow-Konto wurde ein neues temporäres Passwort erstellt.</p>
      <p><strong>Temporäres Passwort:</strong> ${tempPassword}</p>
      <p>Bitte melden Sie sich damit an und ändern Sie Ihr Passwort direkt anschließend.</p>
      ${loginHint}
    `,
  });
}

// ============ LOGIN ============
router.post('/login', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      res.status(400).json({ error: 'Email und Passwort erforderlich' });
      return;
    }
    
    const [rows] = await db.execute(
      'SELECT * FROM app_users WHERE email = ? AND is_active = 1',
      [email.toLowerCase().trim()]
    ) as [Record<string, unknown>[], unknown];
    
    if (rows.length === 0) {
      res.status(401).json({ error: 'Ungültige Anmeldedaten' });
      return;
    }
    
    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash as string);
    
    if (!validPassword) {
      res.status(401).json({ error: 'Ungültige Anmeldedaten' });
      return;
    }
    
    // Update last login and presence for CoWork online detection.
    await db.execute(
      'UPDATE app_users SET last_login = NOW(), last_seen_at = NOW() WHERE id = ?',
      [user.id]
    );
    
    // Create JWT
    const token = createToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      doctor_id: user.doctor_id
    });
    
    res.json({
      token,
      user: sanitizeUser(user)
    });
  } catch (error) {
    next(error);
  }
});

// ============ REGISTER (Admin only) ============
router.post('/register', authMiddleware, requirePermission('can_manage_users'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, full_name, role = 'user', doctor_id } = req.body;
    const authReq = req as AuthRequest;
    
    if (!email || !password) {
      res.status(400).json({ error: 'Email und Passwort erforderlich' });
      return;
    }
    
    // Permission inheritance (F1): if the new user is an admin, load the
    // granter's AUTHORITATIVE permissions from the DB (not the JWT — the JWT
    // has no `permissions`, so the old `loadPermissions(req.user)` returned
    // ALL_PERMISSIONS_TRUE and let a restricted granter create a full admin).
    // A new admin can never hold a permission the granter lacks.
    let permissions: string | null = null;
    if (role === 'admin') {
      const granterPerms = await loadGranterPermissions(authReq.user!);
      permissions = JSON.stringify(granterPerms ?? ALL_PERMISSIONS_TRUE);
    }
    
    // Check if user exists
    const [existing] = await db.execute(
      'SELECT id, is_active FROM app_users WHERE email = ?',
      [email.toLowerCase().trim()]
    ) as [Record<string, unknown>[], unknown];
    
    if (existing.length > 0) {
      const existingUser = existing[0];
      if (existingUser.is_active) {
        res.status(409).json({ error: 'Benutzer existiert bereits' });
        return;
      }
      // Soft-deleted user → reaktivieren mit neuen Daten
      const password_hash = await bcrypt.hash(password, 12);
      await db.execute(
        `UPDATE app_users
            SET password_hash = ?, full_name = ?, role = ?,
                doctor_id = ?, is_active = 1, updated_date = NOW(),
                email_verified = 0,
                permissions = COALESCE(?, permissions)
          WHERE id = ?`,
        [password_hash, full_name || '', role, doctor_id || null, permissions, existingUser.id]
      );
      const [updated] = await db.execute('SELECT * FROM app_users WHERE id = ?', [existingUser.id]) as [Record<string, unknown>[], unknown];
      res.status(201).json({ user: sanitizeUser(updated[0]) });
      return;
    }
    
    // Hash password
    const password_hash = await bcrypt.hash(password, 12);
    const id = crypto.randomUUID();
    
    await db.execute(
      `INSERT INTO app_users (id, email, password_hash, full_name, role, doctor_id, is_active, permissions) 
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, email.toLowerCase().trim(), password_hash, full_name || '', role, doctor_id || null, permissions]
    );
    
    const [newUser] = await db.execute('SELECT * FROM app_users WHERE id = ?', [id]) as [Record<string, unknown>[], unknown];
    
    res.status(201).json({ user: sanitizeUser(newUser[0]) });
  } catch (error) {
    next(error);
  }
});

// ============ ME (Get current user) ============
router.get('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const [rows] = await db.execute(
      'SELECT * FROM app_users WHERE id = ? AND is_active = 1',
      [authReq.user?.sub]
    ) as [Record<string, unknown>[], unknown];
    
    if (rows.length === 0) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }
    
    res.json(sanitizeUser(rows[0]));
  } catch (error) {
    next(error);
  }
});

// ============ UPDATE ME ============
router.patch('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { data } = req.body;
    const authReq = req as AuthRequest;
    
    if (!data || Object.keys(data).length === 0) {
      res.status(400).json({ error: 'Keine Daten zum Aktualisieren' });
      return;
    }
    
    // Whitelist allowed fields for self-update
    const allowedFields = [
      'full_name', 'theme', 'section_config', 'collapsed_sections',
      'schedule_hidden_rows', 'schedule_show_sidebar', 'schedule_show_time_account', 'highlight_my_name',
      'grid_font_size', 'wish_show_occupied', 'wish_show_absences', 'wish_hidden_doctors', 'wish_default_position'
    ];
    
    const updates: string[] = [];
    const values: unknown[] = [];
    
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
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
      res.status(400).json({ error: 'Keine gültigen Felder zum Aktualisieren' });
      return;
    }
    
    values.push(authReq.user?.sub);
    
    await db.execute(
      `UPDATE app_users SET ${updates.join(', ')}, updated_date = NOW() WHERE id = ?`,
      values
    );
    
    const [rows] = await db.execute('SELECT * FROM app_users WHERE id = ?', [authReq.user?.sub]) as [Record<string, unknown>[], unknown];
    
    res.json(sanitizeUser(rows[0]));
  } catch (error) {
    next(error);
  }
});

// ============ CHANGE PASSWORD ============
router.post('/change-password', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;
    const authReq = req as AuthRequest;
    
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich' });
      return;
    }
    
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'Neues Passwort muss mindestens 8 Zeichen haben' });
      return;
    }
    
    const [rows] = await db.execute('SELECT * FROM app_users WHERE id = ?', [authReq.user?.sub]) as [Record<string, unknown>[], unknown];
    
    if (rows.length === 0) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }
    
    const validPassword = await bcrypt.compare(currentPassword, rows[0].password_hash as string);
    
    if (!validPassword) {
      res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
      return;
    }
    
    const newHash = await bcrypt.hash(newPassword, 12);
    await db.execute(
      'UPDATE app_users SET password_hash = ?, must_change_password = 0, updated_date = NOW() WHERE id = ?',
      [newHash, authReq.user?.sub]
    );
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============ FORCE CHANGE PASSWORD ============
router.post('/force-change-password', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { newPassword } = req.body;
    const authReq = req as AuthRequest;

    if (!newPassword) {
      res.status(400).json({ error: 'Neues Passwort erforderlich' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'Neues Passwort muss mindestens 8 Zeichen haben' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await db.execute(
      'UPDATE app_users SET password_hash = ?, must_change_password = 0, updated_date = NOW() WHERE id = ?',
      [newHash, authReq.user?.sub]
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============ LIST USERS (Admin only) ============
router.get('/users', authMiddleware, requirePermission('can_manage_users'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [rows] = await db.execute('SELECT * FROM app_users WHERE is_active = 1 ORDER BY created_date DESC') as [Record<string, unknown>[], unknown];
    res.json(rows.map(sanitizeUser));
  } catch (error) {
    next(error);
  }
});

// ============ UPDATE USER (Admin only) ============
router.patch('/users/:userId', authMiddleware, requirePermission('can_manage_users'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId } = req.params;
    const { data } = req.body;
    const authReq = req as AuthRequest;
    
    if (!data || Object.keys(data).length === 0) {
      res.status(400).json({ error: 'Keine Daten zum Aktualisieren' });
      return;
    }
    
    // Admin can update more fields
    const allowedFields = [
      'full_name', 'email', 'role', 'doctor_id', 'is_active', 'allowed_tenants', 'allowed_groups', 'group_admin_groups',
      'theme', 'section_config', 'collapsed_sections',
      'schedule_hidden_rows', 'schedule_show_sidebar', 'highlight_my_name',
      'grid_font_size', 'wish_show_occupied', 'wish_show_absences', 'wish_hidden_doctors', 'wish_default_position',
      'permissions',
    ];
    
    const updates: string[] = [];
    const values: unknown[] = [];
    
    // Normalize email early for uniqueness check
    if (data.email) {
      data.email = String(data.email).toLowerCase().trim();
      const [existingWithEmail] = await db.execute(
        'SELECT id FROM app_users WHERE email = ? AND id != ? LIMIT 1',
        [data.email, userId]
      ) as [Record<string, unknown>[], unknown];
      if (existingWithEmail.length > 0) {
        res.status(409).json({ error: 'E-Mail-Adresse wird bereits von einem anderen Benutzer verwendet' });
        return;
      }
    }
    
    // Permission inheritance + clamp (F2/F3): for an admin target, load the
    // granter's AUTHORITATIVE permissions from the DB (the JWT has none, so the
    // old `loadPermissions(req.user)` returned ALL_PERMISSIONS_TRUE and enabled
    // escalation). If no explicit permissions were sent, inherit the granter's.
    // If explicit permissions were sent (the dialog path), force-revoke any key
    // the granter lacks — the granter can never grant a capability they do not
    // hold. The clamp is the authoritative control; the dialog disabling (F3)
    // is UX.
    if (data.role === 'admin') {
      const granterPerms = await loadGranterPermissions(authReq.user!);
      if (data.permissions === undefined) {
        data.permissions = granterPerms ?? ALL_PERMISSIONS_TRUE;
      } else {
        const incoming = typeof data.permissions === 'string'
          ? JSON.parse(data.permissions)
          : data.permissions;
        data.permissions = clampPermissionsToGranter(incoming, (granterPerms ?? ALL_PERMISSIONS_TRUE) as Parameters<typeof clampPermissionsToGranter>[1]);
      }
    }
    
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (allowedFields.includes(key)) {
        updates.push(`\`${key}\` = ?`);
        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }
    
    if (data.password) {
      updates.push('password_hash = ?');
      values.push(await bcrypt.hash(data.password, 12));
    }
    
    if (updates.length === 0) {
      res.status(400).json({ error: 'Keine gültigen Felder' });
      return;
    }
    
    values.push(userId);
    
    await db.execute(
      `UPDATE app_users SET ${updates.join(', ')}, updated_date = NOW() WHERE id = ?`,
      values
    );
    
    const [rows] = await db.execute('SELECT * FROM app_users WHERE id = ?', [userId]) as [Record<string, unknown>[], unknown];
    
    res.json(sanitizeUser(rows[0]));
  } catch (error) {
    next(error);
  }
});

// ============ DELETE USER (Admin only) ============
// Hard delete — users are not doctors; they can be fully removed
// so the same email can be used to create a new account.
router.delete('/users/:userId', authMiddleware, requirePermission('can_manage_users'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId } = req.params;

    await db.execute('DELETE FROM app_users WHERE id = ?', [userId]);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============ RESET USER PASSWORD (Admin only) ============
router.post('/users/:userId/reset-password', authMiddleware, requirePermission('can_manage_users'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId } = req.params;

    const [rows] = await db.execute(
      'SELECT id, email, full_name, is_active FROM app_users WHERE id = ?',
      [userId]
    ) as [Record<string, unknown>[], unknown];

    if (rows.length === 0) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }

    const user = rows[0];
    if (!user.is_active) {
      res.status(400).json({ error: 'Passwort kann nur für aktive Benutzer zurückgesetzt werden' });
      return;
    }

    const tempPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await sendTemporaryPasswordEmail({
      email: user.email as string,
      fullName: user.full_name as string,
      tempPassword,
    });

    await db.execute(
      'UPDATE app_users SET password_hash = ?, must_change_password = 1, updated_date = NOW() WHERE id = ?',
      [passwordHash, userId]
    );

    res.json({ success: true, message: `Passwort-E-Mail an ${user.email} gesendet` });
  } catch (error) {
    next(error);
  }
});

// ============ GET MY ALLOWED TENANTS ============
// Returns the tenants that the current user is allowed to access
router.get('/my-tenants', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    // Get user's allowed_tenants
    const [userRows] = await db.execute(
      'SELECT allowed_tenants FROM app_users WHERE id = ? AND is_active = 1',
      [authReq.user?.sub]
    ) as [Record<string, unknown>[], unknown];
    
    if (userRows.length === 0) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }
    
    const allowedTenants = userRows[0].allowed_tenants;
    let allowedTenantList: string[] | null = null;
    
    // Parse allowed_tenants (could be JSON string, array, or null)
    if (allowedTenants) {
      allowedTenantList = typeof allowedTenants === 'string' 
        ? JSON.parse(allowedTenants) 
        : allowedTenants as string[];
    }
    
    // Get all db_tokens
    const [tokenRows] = await db.execute(`
      SELECT id, name, host, db_name, description, is_active
      FROM db_tokens
      ORDER BY name ASC
    `) as [Record<string, unknown>[], unknown];
    
    // Filter tokens based on user's allowed_tenants
    let filteredTokens = tokenRows;
    
    // If allowedTenantList is null or empty, user has access to all tenants
    if (allowedTenantList && allowedTenantList.length > 0) {
      filteredTokens = tokenRows.filter(token => (allowedTenantList as string[]).includes(token.id as string));
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

// ============ GET MY ALLOWED GROUPS ============
// Returns the cross-tenant pool groups the user is allowed to see.
router.get('/my-groups', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const ctx = await loadUserGroupContext(db, authReq.user?.sub as string | null | undefined);
    if (!ctx) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }
    const groups = await listUserGroups(db, ctx);
    res.json({
      hasFullAccess: ctx.isMasterAdmin,
      groups: groups.map((g) => ({
        ...g,
        is_active: Boolean(g.is_active),
        // canWrite signals whether the user may modify pool data for this group
        canWrite: ctx.isMasterAdmin
          || (Array.isArray(ctx.adminGroups) && ctx.adminGroups.includes(Number(g.id))),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Activate a tenant for the current user (checks tenant access)
router.post('/activate-tenant/:tokenId', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { tokenId } = req.params;
    const authReq = req as AuthRequest;

    // Check user's allowed tenants
    const [userRows] = await db.execute(
      'SELECT allowed_tenants FROM app_users WHERE id = ? AND is_active = 1',
      [authReq.user?.sub]
    ) as [Record<string, unknown>[], unknown];
    if (userRows.length === 0) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }

    const allowedTenants = userRows[0].allowed_tenants;
    let allowedTenantList: string[] | null = null;
    if (allowedTenants) {
      allowedTenantList = typeof allowedTenants === 'string'
        ? JSON.parse(allowedTenants)
        : allowedTenants as string[];
    }

    // If user has restricted access, verify this tenant is allowed
    if (allowedTenantList && allowedTenantList.length > 0) {
      if (!allowedTenantList.includes(tokenId as string)) {
        res.status(403).json({ error: 'Kein Zugriff auf diesen Mandanten' });
        return;
      }
    }

    // Find the token
    const [existing] = await db.execute('SELECT id, token, name, host, db_name FROM db_tokens WHERE id = ?', [tokenId]) as [Record<string, unknown>[], unknown];
    if (existing.length === 0) {
      res.status(404).json({ error: 'Token nicht gefunden' });
      return;
    }

    // Deactivate all, activate selected
    await db.execute('UPDATE db_tokens SET is_active = FALSE');
    await db.execute('UPDATE db_tokens SET is_active = TRUE WHERE id = ?', [tokenId]);

    console.log(`[Auth] Tenant "${existing[0].name}" activated by ${authReq.user?.email}`);

    res.json({
      success: true,
      token: existing[0].token,
      name: existing[0].name,
      host: existing[0].host,
      db_name: existing[0].db_name
    });
  } catch (error) {
    next(error);
  }
});

// ============ VERIFY TOKEN ============
router.get('/verify', (req: Request, res: Response): void => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    res.json({ valid: false });
    return;
  }
  
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  
  res.json({ valid: !!payload, payload });
});

router.post('/presence', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    await db.execute(
      'UPDATE app_users SET last_seen_at = NOW() WHERE id = ? AND is_active = 1',
      [authReq.user?.sub]
    );

    const [rows] = await db.execute(
      'SELECT id, email, role, allowed_tenants FROM app_users WHERE id = ? AND is_active = 1',
      [authReq.user?.sub]
    ) as [Record<string, unknown>[], unknown];

    if (rows[0]?.role === 'admin') {
      await broadcastCoworkUpdate({
        type: 'presence-updated',
        actor: rows[0],
        allowedTenants: rows[0].allowed_tenants as string,
        includeUserIds: [rows[0].id as string],
      });
    }

    res.json({ success: true, lastSeenAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

router.get('/jitsi-token', authMiddleware, adminMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    if (!JITSI_JWT_APP_ID || !JITSI_JWT_APP_SECRET || !JITSI_JWT_SUB) {
      res.status(503).json({
        error: 'Jitsi JWT ist nicht vollständig konfiguriert. Bitte JITSI_JWT_APP_ID, JITSI_JWT_APP_SECRET und JITSI_JWT_SUB setzen.'
      });
      return;
    }

    const [rows] = await db.execute(
      'SELECT id, email, full_name, role, allowed_tenants FROM app_users WHERE id = ? AND is_active = 1',
      [authReq.user?.sub]
    ) as [Record<string, unknown>[], unknown];

    if (rows.length === 0) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }

    const user = rows[0];
    const tenantSlug = parseTenantSlug(user.allowed_tenants);
    const roomName = `curaflow-support-${tenantSlug}`;
    const token = createJitsiToken({ roomName, user });
    const expiresAt = Math.floor(Date.now() / 1000) + JITSI_JWT_EXPIRY_SECONDS;

    res.json({
      token,
      roomName,
      tenantSlug,
      expiresAt,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/events/stream', streamAuthMiddleware, async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthRequest;
  const dbToken = typeof req.query?.db_token === 'string' ? req.query.db_token : null;
  const scope = buildRealtimeScope(dbToken);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const unregister = registerRealtimeClient({
    scope,
    res,
    userId: (authReq.user?.sub as string) || '',
  });

  req.on('close', unregister);
  req.on('end', unregister);
});

router.get('/cowork/contacts', authMiddleware, requirePermission('can_manage_cowork'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const [adminRows] = await db.execute(
      'SELECT id, email, full_name, role, allowed_tenants, last_seen_at FROM app_users WHERE id = ? AND is_active = 1',
      [authReq.user?.sub]
    ) as [Record<string, unknown>[], unknown];

    if (adminRows.length === 0) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }

    const adminUser = adminRows[0];
    const [rows] = await db.execute(
      `SELECT id, email, full_name, role, allowed_tenants, last_seen_at
       FROM app_users
       WHERE is_active = 1 AND id <> ?
       ORDER BY full_name ASC, email ASC`,
      [authReq.user?.sub]
    ) as [Record<string, unknown>[], unknown];

    const contacts = rows
      .filter((candidate) => candidate.role === 'admin')
      .filter((candidate) => usersShareTenantAccess(adminUser.allowed_tenants, candidate.allowed_tenants))
      .map((candidate) => ({
        id: candidate.id,
        email: candidate.email,
        full_name: candidate.full_name,
        role: candidate.role,
        last_seen_at: candidate.last_seen_at,
        is_online: isUserOnline(candidate.last_seen_at),
      }));

    res.json(contacts);
  } catch (error) {
    next(error);
  }
});

router.get('/cowork/invites', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    await expireStaleCoworkInvites();

    const [incomingRows] = await db.execute(
      `SELECT ci.*, inviter.full_name AS inviter_name, inviter.email AS inviter_email
       FROM CoWorkInvite ci
       INNER JOIN app_users inviter ON inviter.id COLLATE utf8mb4_unicode_ci = ci.inviter_user_id COLLATE utf8mb4_unicode_ci
       WHERE ${uuidCompareSql('ci.invitee_user_id')}
         AND ci.status IN ('pending', 'accepted')
         AND (ci.expires_date IS NULL OR ci.expires_date >= UTC_TIMESTAMP())
       ORDER BY ci.created_date DESC
       LIMIT 10`,
      [authReq.user?.sub]
    ) as [Record<string, unknown>[], unknown];

    const [outgoingRows] = await db.execute(
      `SELECT ci.*, invitee.full_name AS invitee_name, invitee.email AS invitee_email, invitee.last_seen_at AS invitee_last_seen_at
       FROM CoWorkInvite ci
       INNER JOIN app_users invitee ON invitee.id COLLATE utf8mb4_unicode_ci = ci.invitee_user_id COLLATE utf8mb4_unicode_ci
       WHERE ${uuidCompareSql('ci.inviter_user_id')}
         AND ci.status IN ('pending', 'accepted')
         AND (ci.expires_date IS NULL OR ci.expires_date >= UTC_TIMESTAMP())
       ORDER BY ci.created_date DESC
       LIMIT 10`,
      [authReq.user?.sub]
    ) as [Record<string, unknown>[], unknown];

    res.json({
      incoming: incomingRows.map((invite) => ({
        id: invite.id,
        room_name: invite.room_name,
        tenant_slug: invite.tenant_slug,
        status: invite.status,
        created_date: invite.created_date,
        responded_date: invite.responded_date,
        expires_date: invite.expires_date,
        inviter_name: invite.inviter_name,
        inviter_email: invite.inviter_email,
      })),
      outgoing: outgoingRows.map((invite) => ({
        id: invite.id,
        room_name: invite.room_name,
        tenant_slug: invite.tenant_slug,
        status: invite.status,
        created_date: invite.created_date,
        responded_date: invite.responded_date,
        expires_date: invite.expires_date,
        invitee_name: invite.invitee_name,
        invitee_email: invite.invitee_email,
        invitee_last_seen_at: invite.invitee_last_seen_at,
        invitee_is_online: isUserOnline(invite.invitee_last_seen_at),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/cowork/invites', authMiddleware, requirePermission('can_manage_cowork'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    if (!JITSI_JWT_APP_ID || !JITSI_JWT_APP_SECRET || !JITSI_JWT_SUB) {
      res.status(503).json({
        error: 'Jitsi JWT ist nicht vollständig konfiguriert. Bitte JITSI_JWT_APP_ID, JITSI_JWT_APP_SECRET und JITSI_JWT_SUB setzen.'
      });
      return;
    }

    const { inviteeUserId } = req.body || {};
    if (!inviteeUserId) {
      res.status(400).json({ error: 'inviteeUserId ist erforderlich' });
      return;
    }

    if (inviteeUserId === authReq.user?.sub) {
      res.status(400).json({ error: 'Sie koennen sich nicht selbst einladen' });
      return;
    }

    const [userRows] = await db.execute(
      `SELECT id, email, full_name, role, allowed_tenants
       FROM app_users
       WHERE id IN (?, ?) AND is_active = 1`,
      [authReq.user?.sub, inviteeUserId]
    ) as [Record<string, unknown>[], unknown];

    const inviter = userRows.find((row) => row.id === authReq.user?.sub);
    const invitee = userRows.find((row) => row.id === inviteeUserId);

    if (!inviter || !invitee) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }

    if (invitee.role !== 'admin') {
      res.status(400).json({ error: 'CoWork-Einladungen koennen aktuell nur an Admins gesendet werden' });
      return;
    }

    if (!usersShareTenantAccess(inviter.allowed_tenants, invitee.allowed_tenants)) {
      res.status(403).json({ error: 'Der Benutzer liegt ausserhalb Ihres Mandantenkontexts' });
      return;
    }

    await expireStaleCoworkInvites();

    await db.execute(
      `UPDATE CoWorkInvite
       SET status = 'cancelled', responded_date = UTC_TIMESTAMP()
       WHERE ${uuidCompareSql('inviter_user_id')}
         AND ${uuidCompareSql('invitee_user_id')}
         AND status = 'pending'
         AND (expires_date IS NULL OR expires_date >= UTC_TIMESTAMP())`,
      [authReq.user?.sub, inviteeUserId]
    );

    const tenantSlug = parseTenantSlug(inviter.allowed_tenants || invitee.allowed_tenants);
    const roomName = buildCoworkRoomName(tenantSlug);
    const inviteId = crypto.randomUUID();

    await db.execute(
      `INSERT INTO CoWorkInvite (
        id, room_name, tenant_slug, inviter_user_id, invitee_user_id, status, expires_date
      ) VALUES (?, ?, ?, ?, ?, 'pending', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))`,
      [inviteId, roomName, tenantSlug, authReq.user?.sub, inviteeUserId, COWORK_INVITE_EXPIRY_MINUTES]
    );

    const token = createJitsiToken({ roomName, user: inviter });
    const expiresAt = Math.floor(Date.now() / 1000) + JITSI_JWT_EXPIRY_SECONDS;

    await broadcastCoworkUpdate({
      type: 'invite-created',
      actor: inviter,
      allowedTenants: inviter.allowed_tenants as string,
      includeUserIds: [inviter.id as string, invitee.id as string],
      invite: {
        id: inviteId,
        roomName,
        status: 'pending',
      },
    });

    res.status(201).json({
      invite: {
        id: inviteId,
        room_name: roomName,
        tenant_slug: tenantSlug,
        status: 'pending',
        expires_date: new Date(Date.now() + COWORK_INVITE_EXPIRY_MINUTES * 60 * 1000),
        invitee_name: invitee.full_name,
        invitee_email: invitee.email,
      },
      session: {
        inviteId,
        roomName,
        tenantSlug,
        token,
        expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/cowork/invites/:inviteId/decline', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { inviteId } = req.params;
    const authReq = req as AuthRequest;

    const [rows] = await db.execute(
      `SELECT ci.id, ci.inviter_user_id, ci.invitee_user_id, ci.status, ci.expires_date, ci.room_name
       FROM CoWorkInvite ci
       WHERE ${uuidCompareSql('ci.id')}`,
      [inviteId]
    ) as [Record<string, unknown>[], unknown];

    if (rows.length === 0) {
      res.status(404).json({ error: 'Einladung nicht gefunden' });
      return;
    }

    const invite = rows[0];
    if (invite.invitee_user_id !== authReq.user?.sub) {
      res.status(403).json({ error: 'Nur der eingeladene Benutzer kann ablehnen' });
      return;
    }

    if (invite.status === 'expired') {
      res.status(410).json({ error: 'Die Einladung ist bereits abgelaufen' });
      return;
    }

    await db.execute(
      `UPDATE CoWorkInvite
       SET status = 'declined', responded_date = UTC_TIMESTAMP()
       WHERE ${uuidCompareSql('id')}
         AND status = 'pending'
         AND (expires_date IS NULL OR expires_date >= UTC_TIMESTAMP())`,
      [inviteId]
    );

    const [userRows] = await db.execute(
      `SELECT id, email, allowed_tenants
       FROM app_users
       WHERE id = ? AND is_active = 1`,
      [authReq.user?.sub]
    ) as [Record<string, unknown>[], unknown];

    if (userRows.length > 0) {
      await broadcastCoworkUpdate({
        type: 'invite-declined',
        actor: userRows[0],
        allowedTenants: userRows[0].allowed_tenants as string,
        includeUserIds: [invite.inviter_user_id as string, invite.invitee_user_id as string],
        invite: {
          id: inviteId,
          roomName: invite.room_name as string,
          status: 'declined',
        },
      });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/cowork/invites/:inviteId/cancel', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { inviteId } = req.params;
    const authReq = req as AuthRequest;

    const [rows] = await db.execute(
      `SELECT ci.id, ci.inviter_user_id, ci.invitee_user_id, ci.status, ci.room_name,
              inviter.allowed_tenants AS inviter_allowed_tenants
       FROM CoWorkInvite ci
       INNER JOIN app_users inviter ON inviter.id COLLATE utf8mb4_unicode_ci = ci.inviter_user_id COLLATE utf8mb4_unicode_ci
       WHERE ${uuidCompareSql('ci.id')}`,
      [inviteId]
    ) as [Record<string, unknown>[], unknown];

    if (rows.length === 0) {
      res.status(404).json({ error: 'Einladung nicht gefunden' });
      return;
    }

    const invite = rows[0];
    const isParticipant = invite.inviter_user_id === authReq.user?.sub || invite.invitee_user_id === authReq.user?.sub;
    if (!isParticipant) {
      res.status(403).json({ error: 'Nur Teilnehmer dieser CoWork-Einladung koennen sie beenden' });
      return;
    }

    await db.execute(
      `UPDATE CoWorkInvite
       SET status = 'cancelled', responded_date = UTC_TIMESTAMP()
       WHERE ${uuidCompareSql('id')} AND status IN ('pending', 'accepted')`,
      [inviteId]
    );

    await broadcastCoworkUpdate({
      type: 'invite-cancelled',
      actor: { id: authReq.user?.sub, email: authReq.user?.email || null },
      allowedTenants: invite.inviter_allowed_tenants as string,
      includeUserIds: [invite.inviter_user_id as string, invite.invitee_user_id as string],
      invite: {
        id: inviteId,
        roomName: invite.room_name as string,
        status: 'cancelled',
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/cowork/session/:inviteId', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    if (!JITSI_JWT_APP_ID || !JITSI_JWT_APP_SECRET || !JITSI_JWT_SUB) {
      res.status(503).json({
        error: 'Jitsi JWT ist nicht vollständig konfiguriert. Bitte JITSI_JWT_APP_ID, JITSI_JWT_APP_SECRET und JITSI_JWT_SUB setzen.'
      });
      return;
    }

    await expireStaleCoworkInvites();

    const { inviteId } = req.params;
    const [inviteRows] = await db.execute(
      `SELECT ci.*, inviter.full_name AS inviter_name, inviter.email AS inviter_email,
              invitee.full_name AS invitee_name, invitee.email AS invitee_email
       FROM CoWorkInvite ci
       INNER JOIN app_users inviter ON inviter.id COLLATE utf8mb4_unicode_ci = ci.inviter_user_id COLLATE utf8mb4_unicode_ci
       INNER JOIN app_users invitee ON invitee.id COLLATE utf8mb4_unicode_ci = ci.invitee_user_id COLLATE utf8mb4_unicode_ci
       WHERE ${uuidCompareSql('ci.id')}`,
      [inviteId]
    ) as [Record<string, unknown>[], unknown];

    if (inviteRows.length === 0) {
      res.status(404).json({ error: 'Einladung nicht gefunden' });
      return;
    }

    const invite = inviteRows[0];
    const isInviter = invite.inviter_user_id === authReq.user?.sub;
    const isInvitee = invite.invitee_user_id === authReq.user?.sub;

    if (!isInviter && !isInvitee) {
      res.status(403).json({ error: 'Kein Zugriff auf diese Einladung' });
      return;
    }

    if (['declined', 'cancelled', 'expired'].includes(invite.status as string)) {
      res.status(410).json({ error: 'Diese Einladung ist nicht mehr gueltig' });
      return;
    }

    if (invite.expires_date && new Date(invite.expires_date as string).getTime() < Date.now()) {
      await db.execute(
        `UPDATE CoWorkInvite SET status = 'expired', responded_date = UTC_TIMESTAMP() WHERE ${uuidCompareSql('id')}`,
        [inviteId]
      );
      res.status(410).json({ error: 'Diese Einladung ist abgelaufen' });
      return;
    }

    const [userRows] = await db.execute(
      'SELECT id, email, full_name, role, allowed_tenants FROM app_users WHERE id = ? AND is_active = 1',
      [authReq.user?.sub]
    ) as [Record<string, unknown>[], unknown];

    if (userRows.length === 0) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }

    let inviteStatus = invite.status;
    if (isInvitee && invite.status === 'pending') {
      inviteStatus = 'accepted';
      await db.execute(
        `UPDATE CoWorkInvite
         SET status = 'accepted', responded_date = UTC_TIMESTAMP()
         WHERE ${uuidCompareSql('id')}`,
        [inviteId]
      );
    }

    await db.execute(
      'UPDATE app_users SET last_seen_at = NOW() WHERE id = ?',
      [authReq.user?.sub]
    );

    await broadcastCoworkUpdate({
      type: inviteStatus === 'accepted' ? 'invite-accepted' : 'session-opened',
      actor: userRows[0],
      allowedTenants: userRows[0].allowed_tenants as string,
      includeUserIds: [invite.inviter_user_id as string, invite.invitee_user_id as string],
      invite: {
        id: inviteId,
        roomName: invite.room_name as string,
        status: inviteStatus as string,
      },
    });

    const token = createJitsiToken({ roomName: invite.room_name as string, user: userRows[0] });
    const expiresAt = Math.floor(Date.now() / 1000) + JITSI_JWT_EXPIRY_SECONDS;

    res.json({
      inviteId,
      roomName: invite.room_name,
      tenantSlug: invite.tenant_slug,
      token,
      expiresAt,
      inviteStatus,
      inviterName: invite.inviter_name,
      inviterEmail: invite.inviter_email,
      inviteeName: invite.invitee_name,
      inviteeEmail: invite.invitee_email,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
