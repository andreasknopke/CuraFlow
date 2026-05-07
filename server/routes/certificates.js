/**
 * Qualification Certificate Routes
 *
 * Speichert/liefert Zertifikate (PDF/JPEG/PNG) für Qualifikationen, die einen
 * Nachweis erfordern (z.B. Strahlenschutz, Notfallmedizin).
 *
 * Speicherort: zentrale Master-DB in Tabelle `QualificationCertificate`.
 * Mandantentrennung: `tenant_key = sha256(host:database)` aus dem
 * X-DB-Token Header (per `tenantDbMiddleware` in req.dbToken bereitgestellt).
 *
 * Berechtigungen:
 *  - Admins (req.user.role === 'admin'): Lese-/Schreibzugriff auf alle Mitarbeiter
 *    des aktuellen Mandanten.
 *  - Sonstige User: ausschließlich Zugriff auf den eigenen `req.user.doctor_id`.
 */

import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { db } from '../index.js';
import { authMiddleware } from './auth.js';
import { parseDbToken } from '../utils/crypto.js';

const router = express.Router();
router.use(authMiddleware);

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
]);
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has((file.mimetype || '').toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Dateityp nicht erlaubt. Erlaubt: PDF, JPEG, PNG.'));
    }
  },
});

function getTenantKey(req) {
  const token = req.dbToken;
  if (!token) return 'default';
  try {
    const cfg = parseDbToken(token);
    if (!cfg?.host || !cfg?.database) return 'default';
    return crypto
      .createHash('sha256')
      .update(`${cfg.host}:${cfg.database}`)
      .digest('hex');
  } catch {
    return 'default';
  }
}

function ensureCanAccessDoctor(req, doctorId) {
  if (req.user?.role === 'admin') return;
  if (req.user?.doctor_id && req.user.doctor_id === doctorId) return;
  const err = new Error('Kein Zugriff auf diese Zertifikate');
  err.status = 403;
  throw err;
}

function normalizeDateInput(value) {
  if (!value) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Accept YYYY-MM-DD only (HTML date input format).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

// ============ POST /api/certificates/upload ============
// multipart/form-data: file + doctor_id, qualification_id, granted_date?, expiry_date?, notes?, doctor_qualification_id?
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei angegeben' });
    }
    const tenantKey = getTenantKey(req);
    const {
      doctor_id,
      qualification_id,
      doctor_qualification_id,
      granted_date,
      expiry_date,
      notes,
    } = req.body || {};

    if (!doctor_id || !qualification_id) {
      return res
        .status(400)
        .json({ error: 'doctor_id und qualification_id sind erforderlich' });
    }

    ensureCanAccessDoctor(req, doctor_id);

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO QualificationCertificate
         (id, tenant_key, doctor_id, qualification_id, doctor_qualification_id,
          file_name, mime_type, file_size, file_data,
          granted_date, expiry_date, notes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tenantKey,
        doctor_id,
        qualification_id,
        doctor_qualification_id || null,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.file.buffer,
        normalizeDateInput(granted_date),
        normalizeDateInput(expiry_date),
        notes ? String(notes).slice(0, 500) : null,
        req.user?.sub || null,
      ]
    );

    res.json({
      id,
      doctor_id,
      qualification_id,
      doctor_qualification_id: doctor_qualification_id || null,
      file_name: req.file.originalname,
      mime_type: req.file.mimetype,
      file_size: req.file.size,
      granted_date: normalizeDateInput(granted_date),
      expiry_date: normalizeDateInput(expiry_date),
      notes: notes || null,
      uploaded_by: req.user?.sub || null,
      uploaded_at: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ============ GET /api/certificates ============
// Query: doctor_id?, qualification_id?
// Liefert Metadaten ohne Dateiinhalt.
router.get('/', async (req, res, next) => {
  try {
    const tenantKey = getTenantKey(req);
    const { doctor_id, qualification_id } = req.query;

    let effectiveDoctorId = doctor_id || null;
    if (req.user?.role !== 'admin') {
      if (!req.user?.doctor_id) return res.json([]);
      effectiveDoctorId = req.user.doctor_id;
    }

    const conditions = ['tenant_key = ?'];
    const params = [tenantKey];
    if (effectiveDoctorId) {
      conditions.push('doctor_id = ?');
      params.push(effectiveDoctorId);
    }
    if (qualification_id) {
      conditions.push('qualification_id = ?');
      params.push(qualification_id);
    }

    const [rows] = await db.execute(
      `SELECT id, doctor_id, qualification_id, doctor_qualification_id,
              file_name, mime_type, file_size,
              granted_date, expiry_date, notes,
              uploaded_by, uploaded_at, updated_at
         FROM QualificationCertificate
        WHERE ${conditions.join(' AND ')}
        ORDER BY uploaded_at DESC`,
      params
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ============ GET /api/certificates/expiring ============
// Query: days? (default 60, max 365)
router.get('/expiring', async (req, res, next) => {
  try {
    const tenantKey = getTenantKey(req);
    const requested = parseInt(req.query.days, 10);
    const days = Math.min(Math.max(Number.isFinite(requested) ? requested : 60, 1), 365);

    const conditions = [
      'tenant_key = ?',
      'expiry_date IS NOT NULL',
      'expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)',
    ];
    const params = [tenantKey, days];

    if (req.user?.role !== 'admin') {
      if (!req.user?.doctor_id) return res.json([]);
      conditions.push('doctor_id = ?');
      params.push(req.user.doctor_id);
    }

    const [rows] = await db.execute(
      `SELECT id, doctor_id, qualification_id, file_name,
              granted_date, expiry_date, uploaded_at,
              DATEDIFF(expiry_date, CURDATE()) AS days_until_expiry
         FROM QualificationCertificate
        WHERE ${conditions.join(' AND ')}
        ORDER BY expiry_date ASC`,
      params
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ============ PATCH /api/certificates/:id ============
// Aktualisiert nur Datum/Notiz, nicht den Dateiinhalt.
router.patch('/:id', async (req, res, next) => {
  try {
    const tenantKey = getTenantKey(req);
    const { id } = req.params;
    const [rows] = await db.execute(
      `SELECT doctor_id FROM QualificationCertificate WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Zertifikat nicht gefunden' });
    }
    ensureCanAccessDoctor(req, rows[0].doctor_id);

    const { granted_date, expiry_date, notes } = req.body || {};
    await db.execute(
      `UPDATE QualificationCertificate
          SET granted_date = ?, expiry_date = ?, notes = ?
        WHERE id = ? AND tenant_key = ?`,
      [
        normalizeDateInput(granted_date),
        normalizeDateInput(expiry_date),
        notes ? String(notes).slice(0, 500) : null,
        id,
        tenantKey,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ============ GET /api/certificates/:id/download ============
router.get('/:id/download', async (req, res, next) => {
  try {
    const tenantKey = getTenantKey(req);
    const { id } = req.params;
    const [rows] = await db.execute(
      `SELECT doctor_id, file_name, mime_type, file_data
         FROM QualificationCertificate
        WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Zertifikat nicht gefunden' });
    }
    ensureCanAccessDoctor(req, rows[0].doctor_id);

    const safeName = String(rows[0].file_name || 'zertifikat')
      .replace(/[\r\n"]/g, '_');
    res.setHeader('Content-Type', rows[0].mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(safeName)}"`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(rows[0].file_data);
  } catch (err) {
    next(err);
  }
});

// ============ DELETE /api/certificates/:id ============
router.delete('/:id', async (req, res, next) => {
  try {
    const tenantKey = getTenantKey(req);
    const { id } = req.params;
    const [rows] = await db.execute(
      `SELECT doctor_id FROM QualificationCertificate WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Zertifikat nicht gefunden' });
    }
    ensureCanAccessDoctor(req, rows[0].doctor_id);

    await db.execute(
      `DELETE FROM QualificationCertificate WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Multer-spezifische Fehlerbehandlung
router.use((err, _req, res, next) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Datei zu groß (max. 5 MB).' });
  }
  if (err.message && /Dateityp nicht erlaubt/i.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

export default router;
