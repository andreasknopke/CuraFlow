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
import type { Request, Response, NextFunction } from 'express';
// @ts-expect-error — multer has no @types declaration installed
import multer from 'multer';
import crypto from 'crypto';
import { db } from '../index.js';
import { authMiddleware } from './auth.js';
import { parseDbToken } from '../utils/crypto.js';
import { resolveTenantIdFromToken } from '../utils/tenantGroups.js';
import { analyzeCertificate, isAnalyzerConfigured } from '../utils/certificateAnalyzer.js';
import { getEmailProviderInfo, sendEmail } from '../utils/email.js';
import type { Certificate, Qualification } from '../utils/qualificationEvidence.js';
import {
  computeQualificationEvidenceSummary,
  normalizeEvidenceRole,
  normalizeRequirementMode,
} from '../utils/qualificationEvidence.js';

const router = express.Router();
router.use(authMiddleware);

interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}
type CuraRequest = Request & {
  user?: Record<string, unknown>;
  dbToken?: string;
  db?: { execute: (sql: string, params?: unknown[]) => Promise<[unknown[], unknown]> };
  file?: MulterFile;
};

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
]);
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ANALYSIS_TOKEN_TTL_MS = 15 * 60 * 1000;
// Reminder-link tokens are single-purpose, short-lived, and carry NO DB
// credential — replacing the previous scheme that embedded the raw tenant
// `db_token` in the email link (SECURITY_REVIEW_SYSTEM.md Finding S3).
const REMINDER_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req: any, file: { mimetype?: string }, cb: (error: Error | null, acceptFile?: boolean) => void): void => {
    if (ALLOWED_MIME.has((file.mimetype || '').toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Dateityp nicht erlaubt. Erlaubt: PDF, JPEG, PNG.'));
    }
  },
});

function getTenantKey(req: CuraRequest): string {
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

function ensureCanAccessDoctor(req: CuraRequest, doctorId: string): void {
  if (req.user?.role === 'admin') return;
  if (req.user?.doctor_id && req.user.doctor_id === doctorId) return;
  const err = new Error('Kein Zugriff auf diese Zertifikate');
  (err as unknown as Record<string, unknown>).status = 403;
  throw err;
}

function normalizeDateInput(value: unknown): string | null {
  if (!value) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Accept YYYY-MM-DD only (HTML date input format).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getAnalysisSigningSecret(): string {
  return process.env.JWT_SECRET || process.env.AUTH_SECRET || 'curaflow-certificate-analysis-dev';
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function createAnalysisApprovalToken(payload: Record<string, unknown>): string {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', getAnalysisSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyAnalysisApprovalToken(token: string): Record<string, unknown> | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const [encodedPayload, signature] = token.split('.');
  const expected = crypto
    .createHmac('sha256', getAnalysisSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
  if (signature !== expected) {
    return null;
  }
  try {
    return JSON.parse(decodeBase64Url(encodedPayload));
  } catch {
    return null;
  }
}

// ─── Reminder-link token (Finding S3) ──────────────────────────────────────
// A signed, short-lived token that resolves to { tenant_id, doctor_id,
// qualification_ids[] } after the recipient authenticates. It carries NO
// tenant DB credential, so a leaked reminder link (mail logs, browser
// history, Referer headers) does not grant database access the way the raw
// `db_token` it replaces did. The signature uses the same app secret as the
// analysis token; both are single-purpose and verified server-side.

export function createReminderToken(payload: {
  tenantId: string;
  doctorId: string;
  qualificationIds: Array<string | number>;
}): string {
  const now = Date.now();
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + REMINDER_TOKEN_TTL_MS,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(fullPayload));
  const signature = crypto
    .createHmac('sha256', getAnalysisSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyReminderToken(token: string): {
  tenantId: string;
  doctorId: string;
  qualificationIds: Array<string | number>;
  exp: number;
} | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const [encodedPayload, signature] = token.split('.');
  const expected = crypto
    .createHmac('sha256', getAnalysisSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
  if (signature !== expected) {
    return null;
  }
  try {
    const parsed = JSON.parse(decodeBase64Url(encodedPayload)) as Record<string, unknown>;
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    if (typeof parsed.tenantId !== 'string' || typeof parsed.doctorId !== 'string') {
      return null;
    }
    if (!Array.isArray(parsed.qualificationIds)) {
      return null;
    }
    return {
      tenantId: parsed.tenantId,
      doctorId: parsed.doctorId,
      qualificationIds: parsed.qualificationIds as Array<string | number>,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

interface AnalysisResult {
  status: 'skipped' | 'error' | 'failed' | 'warning' | 'passed';
  is_certificate: boolean | null;
  scope_match: boolean | null;
  scope_detected: string | null;
  confidence: number | null;
  reasoning: string | null;
  error: string | null;
  granted_date: string | null;
  expiry_date: string | null;
  raw?: string | null;
}

function buildApprovedAnalysisPayload({ result, buffer, mimeType, qualificationName, qualificationDescription }: {
  result: AnalysisResult;
  buffer: Buffer;
  mimeType: string;
  qualificationName: string;
  qualificationDescription: string;
}): Record<string, unknown> {
  const now = Date.now();
  return {
    file_hash: sha256Buffer(buffer),
    mime_type: mimeType,
    qualification_name: qualificationName,
    qualification_description: qualificationDescription || '',
    status: result.status,
    is_certificate: result.is_certificate,
    scope_match: result.scope_match,
    scope_detected: result.scope_detected,
    confidence: result.confidence,
    reasoning: result.reasoning || result.error || null,
    granted_date: result.granted_date,
    expiry_date: result.expiry_date,
    iat: now,
    exp: now + ANALYSIS_TOKEN_TTL_MS,
  };
}

function extractPersistedAnalysisFields(payload: Record<string, unknown> | null): Record<string, unknown> {
  return {
    analysis_status: payload?.status || 'error',
    analysis_is_certificate: payload?.is_certificate === null ? null : (payload?.is_certificate ? 1 : 0),
    analysis_scope_match: payload?.scope_match === null ? null : (payload?.scope_match ? 1 : 0),
    analysis_scope_detected: payload?.scope_detected || null,
    analysis_confidence: typeof payload?.confidence === 'number' ? payload.confidence : null,
    analysis_reasoning: payload?.reasoning || null,
    analysis_detected_granted: normalizeDateInput(payload?.granted_date),
    analysis_detected_expiry: normalizeDateInput(payload?.expiry_date),
  };
}

function normalizeEvidenceRoleInput(value: unknown, qualification: Record<string, unknown> | null): string {
  return normalizeEvidenceRole(value, normalizeRequirementMode(qualification?.certificate_requirement_mode as string | undefined));
}

async function getQualificationConfig(req: CuraRequest, qualificationId: string): Promise<Record<string, unknown> | null> {
  if (!req.db || !qualificationId) return null;
  const [rows] = await req.db.execute(
    `SELECT id, name, description, requires_certificate,
            certificate_requirement_mode, certificate_validity_months,
            certificate_refresh_validity_months, certificate_base_label,
            certificate_refresh_label
       FROM Qualification
      WHERE id = ?
      LIMIT 1`,
    [qualificationId]
  ) as [Record<string, unknown>[], unknown];
  return rows[0] || null;
}

async function listQualificationCertificates({ tenantKey, doctorId, qualificationId }: {
  tenantKey: string;
  doctorId: string;
  qualificationId: string;
}): Promise<Record<string, unknown>[]> {
  const [rows] = await db.execute(
    `SELECT id, evidence_role, granted_date, expiry_date, uploaded_at
       FROM QualificationCertificate
      WHERE tenant_key = ? AND doctor_id = ? AND qualification_id = ?
      ORDER BY uploaded_at ASC`,
    [tenantKey, doctorId, qualificationId]
  ) as [Record<string, unknown>[], unknown];
  return rows;
}

async function recomputeDoctorQualificationStatus({
  tenantDb,
  tenantKey,
  doctorId,
  qualificationId,
  doctorQualificationId = null,
  qualificationConfig = null,
}: {
  tenantDb: { execute: (sql: string, params?: unknown[]) => Promise<[unknown[], unknown]> };
  tenantKey: string;
  doctorId: string;
  qualificationId: string;
  doctorQualificationId?: string | null;
  qualificationConfig?: Record<string, unknown> | null;
}): Promise<any> {
  if (!tenantDb || !doctorId || !qualificationId) return null;

  const qualification = qualificationConfig || await getQualificationConfig({ db: tenantDb } as unknown as CuraRequest, qualificationId);
  if (!qualification || qualification.requires_certificate !== 1 && qualification.requires_certificate !== true) {
    return null;
  }

  let targetDoctorQualificationId = doctorQualificationId || null;
  if (!targetDoctorQualificationId) {
    const [dqRows] = await tenantDb.execute(
      `SELECT id FROM DoctorQualification WHERE doctor_id = ? AND qualification_id = ? LIMIT 1`,
      [doctorId, qualificationId]
    ) as [Record<string, unknown>[], unknown];
    targetDoctorQualificationId = (dqRows[0]?.id as string) || null;
  }
  if (!targetDoctorQualificationId) return null;

  const certificates = await listQualificationCertificates({ tenantKey, doctorId, qualificationId });
  const summary = computeQualificationEvidenceSummary({
    qualification: qualification as unknown as Qualification,
    certificates: certificates as unknown as Certificate[],
  });

  await tenantDb.execute(
    `UPDATE DoctorQualification
        SET granted_date = ?,
            expiry_date = ?,
            certificate_status = ?,
            certificate_valid_from = ?,
            certificate_valid_until = ?,
            certificate_status_reason = ?,
            updated_date = CURRENT_TIMESTAMP(3)
      WHERE id = ?`,
    [
      summary.valid_from,
      summary.valid_until,
      summary.status,
      summary.valid_from,
      summary.valid_until,
      summary.reason?.slice(0, 500) || null,
      targetDoctorQualificationId,
    ]
  );

  return summary;
}

function isApprovedPayloadValidForUpload({ payload, buffer, mimeType, qualificationName, qualificationDescription }: {
  payload: Record<string, unknown>;
  buffer: Buffer;
  mimeType: string;
  qualificationName: string;
  qualificationDescription: string;
}): boolean {
  if (!payload || typeof payload !== 'object') return false;
  if (!payload.exp || (payload.exp as number) < Date.now()) return false;
  if (payload.file_hash !== sha256Buffer(buffer)) return false;
  if (payload.mime_type !== mimeType) return false;
  if (payload.qualification_name !== qualificationName) return false;
  if ((payload.qualification_description || '') !== (qualificationDescription || '')) return false;
  if (payload.status !== 'passed') return false;
  if (payload.is_certificate !== true) return false;
  if (payload.scope_match !== true) return false;
  return true;
}

function buildAppBaseUrl(req: Request): string {
  const configuredBase = (process.env.APP_URL || process.env.PUBLIC_APP_URL || '').trim();
  if (configuredBase) {
    return configuredBase.replace(/\/$/, '');
  }

  return `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
}

/**
 * Build the reminder deep-link. Embeds a short-lived HMAC-signed token
 * (Finding S3) bound to { tenantId, doctorId, qualificationIds } instead of
 * the raw tenant `db_token`. The recipient authenticates normally; the
 * `tenantDbMiddleware` (Finding S2) still re-checks `allowed_tenants` server-
 * side, so a leaked link grants no database capability. `/reminders/resolve`
 * verifies the token after auth and the frontend uses it to pre-select the
 * tenant and qualification.
 */
async function buildCertificateReminderLink(
  req: CuraRequest,
  doctorId: string,
  qualificationIds: Array<string | number>,
): Promise<string> {
  const url = new URL('/certificate-upload', buildAppBaseUrl(req));
  const tenantId = await resolveTenantIdFromToken(db, req.dbToken);
  // Fallback: if the tenant cannot be resolved (no token / master pool),
  // still issue a token so the link resolves to the recipient's own tenant
  // context after login — we just omit the deep-link tenant hint.
  const reminderToken = createReminderToken({
    tenantId: tenantId || '',
    doctorId,
    qualificationIds,
  });
  url.searchParams.set('rt', reminderToken);
  if (qualificationIds.length === 1) {
    url.searchParams.set('qualification_id', String(qualificationIds[0]));
  }
  return url.toString();
}

function formatReminderStatusLabel({ hasCertificates, summary, validUntil }: {
  hasCertificates: boolean;
  summary: Record<string, unknown> | null;
  validUntil: string | null;
}): string {
  if (!hasCertificates) return 'kein Zertifikat hinterlegt';
  if (summary?.status === 'expired') {
    return validUntil ? `Nachweis abgelaufen seit ${validUntil}` : 'Nachweis abgelaufen';
  }
  if (summary?.status === 'incomplete') return 'Nachweise unvollstaendig';
  return 'Nachweis ungueltig';
}

function toIsoDateOnly(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value as string);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function diffIsoDaysFromToday(value: unknown): number | null {
  const iso = toIsoDateOnly(value);
  if (!iso) return null;
  const today = new Date().toISOString().slice(0, 10);
  const targetMs = Date.parse(`${iso}T00:00:00.000Z`);
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  return Math.round((targetMs - todayMs) / 86400000);
}

async function getReminderRecipientsForDoctor(doctorId: string): Promise<Record<string, unknown>[]> {
  const [rows] = await db.execute(
    `SELECT id, email, full_name, doctor_id
       FROM app_users
      WHERE is_active = 1
        AND doctor_id = ?
        AND email IS NOT NULL
        AND email != ''
      ORDER BY created_date ASC`,
    [doctorId]
  ) as [Record<string, unknown>[], unknown];
  return rows;
}

async function computeReminderQualificationEntry({ req, tenantKey, doctorId, qualificationId }: {
  req: CuraRequest;
  tenantKey: string;
  doctorId: string;
  qualificationId: string;
}): Promise<Record<string, unknown> | null> {
  const qualification = await getQualificationConfig(req, qualificationId);
  if (!qualification || (qualification.requires_certificate !== 1 && qualification.requires_certificate !== true)) {
    return null;
  }

  const [dqRows] = await req.db!.execute(
    `SELECT id, certificate_status, certificate_valid_until, expiry_date
       FROM DoctorQualification
      WHERE doctor_id = ? AND qualification_id = ?
      LIMIT 1`,
    [doctorId, qualificationId]
  ) as [Record<string, unknown>[], unknown];
  const doctorQualification = dqRows[0] || null;
  if (!doctorQualification) {
    return null;
  }

  const certificates = await listQualificationCertificates({
    tenantKey,
    doctorId,
    qualificationId,
  });
  const summary = computeQualificationEvidenceSummary({
    qualification,
    certificates: certificates as unknown as Certificate[],
  });
  const hasCertificates = certificates.length > 0;
  const isPending = !hasCertificates || summary.status !== 'valid';

  if (!isPending) {
    return null;
  }

  const validUntil = (summary.valid_until || doctorQualification.certificate_valid_until || doctorQualification.expiry_date || null) as string | null;

  return {
    id: qualification.id,
    name: qualification.name,
    status: summary.status,
    reason: formatReminderStatusLabel({ hasCertificates, summary: summary as unknown as Record<string, unknown>, validUntil }),
  };
}

/**
 * Führt die LLM-Analyse asynchron im Hintergrund aus und schreibt das
 * Ergebnis in die Tabelle. Fehler werden geloggt, brechen den Upload-Flow
 * aber nicht ab (der Upload selbst war ja bereits erfolgreich).
 */
async function runAnalysisAndPersist({
  certificateId,
  tenantKey,
  buffer,
  mimeType,
  qualificationName,
  qualificationDescription,
  fillDatesIfMissing,
}: {
  certificateId: string;
  tenantKey: string;
  buffer: Buffer;
  mimeType: string;
  qualificationName: string;
  qualificationDescription: string;
  fillDatesIfMissing: boolean;
}): Promise<void> {
  console.info('[certificates] Starte Analyse', { certificateId, qualificationName, mimeType, size: buffer?.length });
  try {
    const result = await analyzeCertificate({
      buffer,
      mimeType,
      qualificationName,
      qualificationDescription,
    });

    console.info('[certificates] Analyse abgeschlossen', {
      certificateId,
      status: result.status,
      is_certificate: result.is_certificate,
      scope_match: result.scope_match,
      reasoning: result.reasoning?.slice(0, 200),
      error: result.error,
    });

    const fields = [
      'analysis_status = ?',
      'analysis_is_certificate = ?',
      'analysis_scope_match = ?',
      'analysis_scope_detected = ?',
      'analysis_confidence = ?',
      'analysis_reasoning = ?',
      'analysis_detected_granted = ?',
      'analysis_detected_expiry = ?',
      'analyzed_at = NOW()',
    ];
    const params: unknown[] = [
      result.status,
      result.is_certificate === null ? null : (result.is_certificate ? 1 : 0),
      result.scope_match === null ? null : (result.scope_match ? 1 : 0),
      result.scope_detected,
      result.confidence,
      result.reasoning || result.error,
      result.granted_date,
      result.expiry_date,
    ];

    if (fillDatesIfMissing) {
      if (result.granted_date) {
        fields.push('granted_date = COALESCE(granted_date, ?)');
        params.push(result.granted_date);
      }
      if (result.expiry_date) {
        fields.push('expiry_date = COALESCE(expiry_date, ?)');
        params.push(result.expiry_date);
      }
    }

    params.push(certificateId, tenantKey);

    await db.execute(
      `UPDATE QualificationCertificate
          SET ${fields.join(', ')}
        WHERE id = ? AND tenant_key = ?`,
      params
    );
  } catch (err) {
    console.error('[certificates] LLM-Analyse fehlgeschlagen', err);
    try {
      await db.execute(
        `UPDATE QualificationCertificate
            SET analysis_status = 'error',
                analysis_reasoning = ?,
                analyzed_at = NOW()
          WHERE id = ? AND tenant_key = ?`,
        [(err as Error).message?.slice(0, 1000) || 'Unbekannter Fehler', certificateId, tenantKey]
      );
    } catch (innerErr) {
      console.error('[certificates] Konnte Fehler-Status nicht persistieren', innerErr);
    }
  }
}

// ============ POST /api/certificates/check ============
// multipart/form-data: file + qualification_name + qualification_description?
// Führt OCR/LLM synchron aus und liefert erkannte Daten zurück. Nur wenn der
// Scope passt, wird ein signiertes approval_token für den späteren Upload
// ausgegeben.
router.post('/check', upload.single('file'), async (req: CuraRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Keine Datei angegeben' });
      return;
    }
    if (!isAnalyzerConfigured()) {
      res.status(503).json({ error: 'LLM nicht konfiguriert' });
      return;
    }

    const { qualification_name, qualification_description } = req.body || {};
    if (!qualification_name) {
      res.status(400).json({ error: 'qualification_name erforderlich' });
      return;
    }

    const result = await analyzeCertificate({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      qualificationName: qualification_name,
      qualificationDescription: qualification_description,
    });

    const approved = result.status === 'passed' && result.is_certificate === true && result.scope_match === true;
    const approvalPayload = approved
      ? buildApprovedAnalysisPayload({
          result,
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
          qualificationName: qualification_name,
          qualificationDescription: qualification_description,
        })
      : null;

    res.json({
      ok: true,
      upload_allowed: approved,
      approval_token: approvalPayload ? createAnalysisApprovalToken(approvalPayload) : null,
      analysis: {
        status: result.status,
        is_certificate: result.is_certificate,
        scope_match: result.scope_match,
        scope_detected: result.scope_detected,
        confidence: result.confidence,
        reasoning: result.reasoning || result.error || null,
        detected_granted_date: result.granted_date,
        detected_expiry_date: result.expiry_date,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============ POST /api/certificates/upload ============
// multipart/form-data: file + doctor_id, qualification_id, granted_date?, expiry_date?, notes?, doctor_qualification_id?
router.post('/upload', upload.single('file'), async (req: CuraRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const curaReq = req as CuraRequest;
    if (!req.file) {
      res.status(400).json({ error: 'Keine Datei angegeben' });
      return;
    }
    const tenantKey = getTenantKey(curaReq);
    const {
      doctor_id,
      qualification_id,
      doctor_qualification_id,
      granted_date,
      expiry_date,
      notes,
      evidence_role,
      approval_token,
      qualification_name,
      qualification_description,
    } = req.body || {};

    if (!doctor_id || !qualification_id) {
      res
        .status(400)
        .json({ error: 'doctor_id und qualification_id sind erforderlich' });
      return;
    }

    ensureCanAccessDoctor(curaReq, doctor_id);

  const qualificationConfig = await getQualificationConfig(curaReq, qualification_id);
  const requirementMode = normalizeRequirementMode(qualificationConfig?.certificate_requirement_mode as string | undefined);
  const normalizedEvidenceRole = normalizeEvidenceRoleInput(evidence_role, qualificationConfig);

    let approvedAnalysis: Record<string, unknown> | null = null;
    if (isAnalyzerConfigured()) {
      if (!qualification_name) {
        res.status(400).json({ error: 'qualification_name ist für die automatische Prüfung erforderlich' });
        return;
      }
      approvedAnalysis = verifyAnalysisApprovalToken(approval_token);
      if (!isApprovedPayloadValidForUpload({
        payload: approvedAnalysis!,
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        qualificationName: qualification_name,
        qualificationDescription: qualification_description,
      })) {
        res.status(422).json({
          error: 'Upload verweigert: Dokument muss unmittelbar vor dem Upload erfolgreich geprüft werden und im Scope passen.',
        });
        return;
      }
    }

    const approvedFields = extractPersistedAnalysisFields(approvedAnalysis);
    const finalGrantedDate = normalizeDateInput(granted_date) || approvedFields.analysis_detected_granted || null;
    const finalExpiryDate = normalizeDateInput(expiry_date) || approvedFields.analysis_detected_expiry || null;

    if (requirementMode === 'base_refresh' && normalizedEvidenceRole === 'refresh') {
      const existingCertificates = await listQualificationCertificates({
        tenantKey,
        doctorId: doctor_id,
        qualificationId: qualification_id,
      });
      const hasBaseCertificate = existingCertificates.some((certificate) => ['base', 'recertification', 'single'].includes(normalizeEvidenceRoleInput(certificate.evidence_role, qualificationConfig)));
      if (!hasBaseCertificate) {
        res.status(422).json({
          error: `${qualificationConfig?.certificate_base_label || 'Grundnachweis'} muss vor einer Verlängerung hochgeladen werden.`,
        });
        return;
      }
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO QualificationCertificate
         (id, tenant_key, doctor_id, qualification_id, doctor_qualification_id,
          evidence_role,
          file_name, mime_type, file_size, file_data,
          granted_date, expiry_date, notes, uploaded_by,
          analysis_status, analysis_is_certificate, analysis_scope_match,
          analysis_scope_detected, analysis_confidence, analysis_reasoning,
          analysis_detected_granted, analysis_detected_expiry, analyzed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        tenantKey,
        doctor_id,
        qualification_id,
        doctor_qualification_id || null,
        normalizedEvidenceRole,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.file.buffer,
        finalGrantedDate,
        finalExpiryDate,
        notes ? String(notes).slice(0, 500) : null,
        curaReq.user?.sub || null,
        approvedAnalysis ? approvedFields.analysis_status : 'skipped',
        approvedAnalysis ? approvedFields.analysis_is_certificate : null,
        approvedAnalysis ? approvedFields.analysis_scope_match : null,
        approvedAnalysis ? approvedFields.analysis_scope_detected : null,
        approvedAnalysis ? approvedFields.analysis_confidence : null,
        approvedAnalysis ? approvedFields.analysis_reasoning : null,
        approvedAnalysis ? approvedFields.analysis_detected_granted : null,
        approvedAnalysis ? approvedFields.analysis_detected_expiry : null,
      ]
    );

    const summary = await recomputeDoctorQualificationStatus({
      tenantDb: curaReq.db!,
      tenantKey,
      doctorId: doctor_id,
      qualificationId: qualification_id,
      doctorQualificationId: doctor_qualification_id || null,
      qualificationConfig,
    });

    res.json({
      id,
      doctor_id,
      qualification_id,
      doctor_qualification_id: doctor_qualification_id || null,
      evidence_role: normalizedEvidenceRole,
      file_name: req.file.originalname,
      mime_type: req.file.mimetype,
      file_size: req.file.size,
      granted_date: finalGrantedDate,
      expiry_date: finalExpiryDate,
      notes: notes || null,
      uploaded_by: curaReq.user?.sub || null,
      uploaded_at: new Date().toISOString(),
      analysis_status: approvedAnalysis ? approvedFields.analysis_status : 'skipped',
      analysis_is_certificate: approvedAnalysis ? approvedAnalysis.is_certificate : null,
      analysis_scope_match: approvedAnalysis ? approvedAnalysis.scope_match : null,
      analysis_scope_detected: approvedAnalysis ? approvedAnalysis.scope_detected : null,
      analysis_confidence: approvedAnalysis ? approvedAnalysis.confidence : null,
      analysis_reasoning: approvedAnalysis ? approvedAnalysis.reasoning : null,
      analysis_detected_granted: approvedAnalysis ? approvedAnalysis.granted_date : null,
      analysis_detected_expiry: approvedAnalysis ? approvedAnalysis.expiry_date : null,
      qualification_summary: summary,
    });
  } catch (err) {
    next(err);
  }
});

// ============ GET /api/certificates ============
// Query: doctor_id?, qualification_id?
// Liefert Metadaten ohne Dateiinhalt.
router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const curaReq = req as CuraRequest;
    const tenantKey = getTenantKey(curaReq);
    const { doctor_id, qualification_id } = req.query;

    let effectiveDoctorId = (doctor_id as string) || null;
    if (curaReq.user?.role !== 'admin') {
      if (!curaReq.user?.doctor_id) {
        res.json([]);
        return;
      }
      effectiveDoctorId = curaReq.user.doctor_id as string;
    }

    const conditions = ['tenant_key = ?'];
    const params: unknown[] = [tenantKey];
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
              evidence_role,
              file_name, mime_type, file_size,
              granted_date, expiry_date, notes,
              uploaded_by, uploaded_at, updated_at,
              analysis_status, analysis_is_certificate, analysis_scope_match,
              analysis_scope_detected, analysis_confidence, analysis_reasoning,
              analysis_detected_granted, analysis_detected_expiry, analyzed_at
         FROM QualificationCertificate
        WHERE ${conditions.join(' AND ')}
        ORDER BY uploaded_at DESC`,
      params
    ) as [Record<string, unknown>[], unknown];

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ============ GET /api/certificates/expiring ============
// Query: days? (default 60, max 365)
router.get('/expiring', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const curaReq = req as CuraRequest;
    const tenantKey = getTenantKey(curaReq);
    const requested = parseInt(req.query.days as string, 10);
    const days = Math.min(Math.max(Number.isFinite(requested) ? requested : 60, 1), 365);

    const conditions = ['tenant_key = ?'];
    const params: unknown[] = [tenantKey];

    if (curaReq.user?.role !== 'admin') {
      if (!curaReq.user?.doctor_id) {
        res.json([]);
        return;
      }
      conditions.push('doctor_id = ?');
      params.push(curaReq.user.doctor_id);
    }

    const [certificates] = await db.execute(
      `SELECT id, doctor_id, qualification_id, doctor_qualification_id,
              evidence_role, file_name, granted_date, expiry_date, uploaded_at
         FROM QualificationCertificate
        WHERE ${conditions.join(' AND ')}
        ORDER BY doctor_id ASC, qualification_id ASC, uploaded_at ASC`,
      params
    ) as [Record<string, unknown>[], unknown];

    if (!certificates.length) {
      res.json([]);
      return;
    }

    const qualificationIds = Array.from(new Set(certificates.map((certificate) => certificate.qualification_id).filter(Boolean)));
    if (!qualificationIds.length) {
      res.json([]);
      return;
    }

    const placeholders = qualificationIds.map(() => '?').join(', ');
    const [qualificationRows] = await curaReq.db!.execute(
      `SELECT id, name, description, requires_certificate,
              certificate_requirement_mode, certificate_validity_months,
              certificate_refresh_validity_months, certificate_base_label,
              certificate_refresh_label
         FROM Qualification
        WHERE id IN (${placeholders})`,
      qualificationIds
    ) as [Record<string, unknown>[], unknown];
    const qualificationById = new Map(qualificationRows.map((qualification) => [qualification.id, qualification]));
    const certificateById = new Map(certificates.map((certificate) => [certificate.id, certificate]));

    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const certificate of certificates) {
      const key = `${certificate.doctor_id}::${certificate.qualification_id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(certificate);
    }

    const rows: Record<string, unknown>[] = [];
    for (const groupCertificates of grouped.values()) {
      const firstCertificate = groupCertificates[0];
      const qualification = qualificationById.get(firstCertificate.qualification_id);
      if (!qualification || (qualification.requires_certificate !== 1 && qualification.requires_certificate !== true)) {
        continue;
      }

  const summary = computeQualificationEvidenceSummary({
    qualification,
    certificates: certificates as unknown as Certificate[],
  });
      const validUntil = toIsoDateOnly(summary.valid_until);
      const daysUntilExpiry = diffIsoDaysFromToday(validUntil);
      if (!Number.isFinite(daysUntilExpiry) || (daysUntilExpiry as number) > days) {
        continue;
      }

      const activeIds = Array.isArray(summary.active_certificate_ids) ? summary.active_certificate_ids : [];
      const representativeCertificate = certificateById.get(activeIds[activeIds.length - 1]) || groupCertificates[groupCertificates.length - 1];
      rows.push({
        id: representativeCertificate.id,
        doctor_id: firstCertificate.doctor_id,
        qualification_id: firstCertificate.qualification_id,
        doctor_qualification_id: representativeCertificate.doctor_qualification_id || null,
        evidence_role: representativeCertificate.evidence_role,
        file_name: representativeCertificate.file_name,
        granted_date: representativeCertificate.granted_date,
        expiry_date: validUntil,
        uploaded_at: representativeCertificate.uploaded_at,
        days_until_expiry: daysUntilExpiry as number,
        certificate_status: summary.status,
        certificate_status_reason: summary.reason,
      });
    }

    rows.sort((left, right) => {
      if (left.days_until_expiry !== right.days_until_expiry) {
        return (left.days_until_expiry as number) - (right.days_until_expiry as number);
      }
      return String(left.qualification_id).localeCompare(String(right.qualification_id));
    });

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ============ POST /api/certificates/reminders/resolve ============
// Resolves a reminder-link token (Finding S3) for the *authenticated* user
// clicking the link. Body: { token }. The token is HMAC-signed and short-
// lived; it binds a reminder to { tenantId, doctorId, qualificationIds[] }.
// After verifying the signature/expiry we confirm the calling user is the
// linked owner of the doctor profile — so a captured link still cannot
// surface another user's certificate state. The tenant is returned as an id
// only; the frontend resolves it to a tenant token via `/my-tenants`, and
// `tenantDbMiddleware` re-checks `allowed_tenants` on the subsequent tenant
// requests (Finding S2).
router.post('/reminders/resolve', express.json(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const curaReq = req as CuraRequest;
    const { token } = (req.body || {}) as { token?: string };
    const payload = verifyReminderToken(String(token || ''));
    if (!payload) {
      res.status(400).json({ error: 'Ungültiger oder abgelaufener Link' });
      return;
    }

    // The caller must be authenticated and linked to the doctor the reminder
    // was issued for. Admins (who initiated the reminder) are also allowed,
    // so an admin opening a sent link does not error.
    if (curaReq.user?.role !== 'admin') {
      const linkedUsers = await getReminderRecipientsForDoctor(payload.doctorId);
      const callerId = curaReq.user?.sub;
      const isOwner = callerId
        ? linkedUsers.some((u) => String(u.id) === String(callerId))
        : false;
      if (!isOwner) {
        res.status(403).json({ error: 'Kein Zugriff auf diesen Link' });
        return;
      }
    }

    res.json({
      tenant_id: payload.tenantId || null,
      doctor_id: payload.doctorId,
      qualification_ids: payload.qualificationIds,
    });
  } catch (err) {
    next(err);
  }
});

// ============ POST /api/certificates/reminders/send ============
// Body: { recipients: [{ doctor_id, qualification_ids: [] }] }
router.post('/reminders/send', express.json(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const curaReq = req as CuraRequest;
    if (curaReq.user?.role !== 'admin') {
      res.status(403).json({ error: 'Nur Administratoren duerfen Erinnerungen senden' });
      return;
    }

    if (!getEmailProviderInfo().configured) {
      res.status(503).json({
        error: 'E-Mail nicht konfiguriert. Bitte BREVO_API_KEY oder SMTP_HOST + SMTP_USER + SMTP_PASS setzen.',
      });
      return;
    }

    const recipients = Array.isArray(req.body?.recipients) ? (req.body.recipients as unknown[]) : [];
    if (recipients.length === 0) {
      res.status(400).json({ error: 'Mindestens ein Empfaenger ist erforderlich' });
      return;
    }

    const tenantKey = getTenantKey(curaReq);
    const results: Record<string, unknown>[] = [];
    let sentCount = 0;

    for (const recipient of recipients) {
      const recipientObj = recipient as Record<string, unknown>;
      const doctorId = recipientObj.doctor_id as string;
      const requestedQualificationIds: string[] = Array.isArray(recipientObj.qualification_ids)
        ? Array.from(new Set(recipientObj.qualification_ids.filter(Boolean))) as string[]
        : [];

      if (!doctorId || requestedQualificationIds.length === 0) {
        results.push({ doctor_id: doctorId || null, status: 'skipped', reason: 'Fehlende Pflichtdaten' });
        continue;
      }

      const [doctorRows] = await curaReq.db!.execute(
        `SELECT id, name, central_employee_id
           FROM Doctor
          WHERE id = ?
          LIMIT 1`,
        [doctorId]
      ) as [Record<string, unknown>[], unknown];
      const doctor = doctorRows[0] || null;
      if (!doctor) {
        results.push({ doctor_id: doctorId, status: 'skipped', reason: 'Mitarbeiter nicht gefunden' });
        continue;
      }

      if (!doctor.central_employee_id) {
        results.push({ doctor_id: doctorId, doctor_name: doctor.name, status: 'skipped', reason: 'Keine Verknuepfung zur zentralen Datenbank' });
        continue;
      }

      const linkedUsers = await getReminderRecipientsForDoctor(doctorId);
      if (linkedUsers.length === 0) {
        results.push({ doctor_id: doctorId, doctor_name: doctor.name, status: 'skipped', reason: 'Kein aktiver Benutzer mit regularem Login verknuepft' });
        continue;
      }

      const pendingQualifications: Record<string, unknown>[] = [];
      for (const qualificationId of requestedQualificationIds) {
        const entry = await computeReminderQualificationEntry({
          req: curaReq,
          tenantKey,
          doctorId: doctorId,
          qualificationId,
        });
        if (entry) {
          pendingQualifications.push(entry);
        }
      }

      if (pendingQualifications.length === 0) {
        results.push({ doctor_id: doctorId, doctor_name: doctor.name, status: 'skipped', reason: 'Keine offenen oder ungueltigen Nachweise mehr' });
        continue;
      }

      const reminderLink = await buildCertificateReminderLink(
        curaReq,
        doctorId,
        pendingQualifications.map((item) => item.id as string | number),
      );
      const qualificationLines = pendingQualifications
        .map((item) => `<li><strong>${item.name}</strong>: ${item.reason}</li>`)
        .join('');
      const plainQualificationLines = pendingQualifications
        .map((item) => `- ${item.name}: ${item.reason}`)
        .join('\n');

      for (const linkedUser of linkedUsers) {
        await sendEmail({
          to: linkedUser.email as string,
          subject: 'CuraFlow: Zertifikatsnachweise hochladen',
          text: [
            `Hallo ${linkedUser.full_name || doctor.name},`,
            '',
            'fuer folgende Qualifikationen fehlt ein gueltiger Nachweis oder er ist ungueltig:',
            plainQualificationLines,
            '',
            `Bitte melden Sie sich ueber diesen Link an und laden Sie die Nachweise hoch: ${reminderLink}`,
            '',
            'Der Link fuehrt in Ihren persoenlichen Upload-Bereich in CuraFlow.',
          ].join('\n'),
          html: `
            <p>Hallo ${linkedUser.full_name || doctor.name},</p>
            <p>fuer folgende Qualifikationen fehlt ein gueltiger Nachweis oder er ist ungueltig:</p>
            <ul>${qualificationLines}</ul>
            <p>
              <a href="${reminderLink}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;">
                Nachweise in CuraFlow hochladen
              </a>
            </p>
            <p>Der Link fuehrt in Ihren persoenlichen Upload-Bereich in CuraFlow.</p>
          `,
        });
        sentCount += 1;
      }

      results.push({
        doctor_id: doctorId,
        doctor_name: doctor.name,
        status: 'sent',
        sent_to: linkedUsers.map((user) => user.email),
        qualification_ids: pendingQualifications.map((item) => item.id),
      });
    }

    res.json({
      success: true,
      sent_count: sentCount,
      results,
    });
  } catch (err) {
    next(err);
  }
});

// ============ PATCH /api/certificates/:id ============
// Aktualisiert nur Datum/Notiz, nicht den Dateiinhalt.
router.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const curaReq = req as CuraRequest;
    const tenantKey = getTenantKey(curaReq);
    const { id } = req.params;
    const [rows] = await db.execute(
      `SELECT doctor_id, qualification_id, doctor_qualification_id FROM QualificationCertificate WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    ) as [Record<string, unknown>[], unknown];
    if (rows.length === 0) {
      res.status(404).json({ error: 'Zertifikat nicht gefunden' });
      return;
    }
    ensureCanAccessDoctor(curaReq, rows[0].doctor_id as string);

    const qualificationConfig = await getQualificationConfig(curaReq, rows[0].qualification_id as string);
    const { granted_date, expiry_date, notes, evidence_role } = req.body || {};
    await db.execute(
      `UPDATE QualificationCertificate
          SET granted_date = ?, expiry_date = ?, notes = ?, evidence_role = ?
        WHERE id = ? AND tenant_key = ?`,
      [
        normalizeDateInput(granted_date),
        normalizeDateInput(expiry_date),
        notes ? String(notes).slice(0, 500) : null,
        normalizeEvidenceRoleInput(evidence_role, qualificationConfig),
        id,
        tenantKey,
      ]
    );
    const summary = await recomputeDoctorQualificationStatus({
      tenantDb: curaReq.db!,
      tenantKey,
      doctorId: rows[0].doctor_id as string,
      qualificationId: rows[0].qualification_id as string,
      doctorQualificationId: (rows[0].doctor_qualification_id as string) || null,
      qualificationConfig,
    });
    res.json({ ok: true, qualification_summary: summary });
  } catch (err) {
    next(err);
  }
});

// ============ GET /api/certificates/:id/download ============
router.get('/:id/download', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const curaReq = req as CuraRequest;
    const tenantKey = getTenantKey(curaReq);
    const { id } = req.params;
    const [rows] = await db.execute(
      `SELECT doctor_id, file_name, mime_type, file_data
         FROM QualificationCertificate
        WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    ) as [Record<string, unknown>[], unknown];
    if (rows.length === 0) {
      res.status(404).json({ error: 'Zertifikat nicht gefunden' });
      return;
    }
    ensureCanAccessDoctor(curaReq, rows[0].doctor_id as string);

    const safeName = String(rows[0].file_name || 'zertifikat')
      .replace(/[\r\n"]/g, '_');
    res.setHeader('Content-Type', (rows[0].mime_type as string) || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(safeName)}"`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(rows[0].file_data as Buffer);
  } catch (err) {
    next(err);
  }
});

// ============ POST /api/certificates/:id/analyze ============
// Erneute LLM-Analyse für ein bereits hochgeladenes Zertifikat anstoßen.
router.post('/:id/analyze', express.json(), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const curaReq = req as CuraRequest;
    const tenantKey = getTenantKey(curaReq);
    const { id } = req.params as Record<string, string>;
    const { qualification_name, qualification_description } = req.body || {};

    const [rows] = await db.execute(
      `SELECT doctor_id, mime_type, file_data
         FROM QualificationCertificate
        WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    ) as [Record<string, unknown>[], unknown];
    if (rows.length === 0) {
      res.status(404).json({ error: 'Zertifikat nicht gefunden' });
      return;
    }
    ensureCanAccessDoctor(curaReq, rows[0].doctor_id as string);

    if (!isAnalyzerConfigured()) {
      res.status(503).json({ error: 'Vision-LLM nicht konfiguriert' });
      return;
    }
    if (!qualification_name) {
      res.status(400).json({ error: 'qualification_name erforderlich' });
      return;
    }

    await db.execute(
      `UPDATE QualificationCertificate SET analysis_status = 'pending' WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );

    runAnalysisAndPersist({
      certificateId: id,
      tenantKey,
      buffer: rows[0].file_data as Buffer,
      mimeType: rows[0].mime_type as string,
      qualificationName: qualification_name,
      qualificationDescription: qualification_description,
      fillDatesIfMissing: false,
    });

    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

// ============ DELETE /api/certificates/:id ============
router.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const curaReq = req as CuraRequest;
    const tenantKey = getTenantKey(curaReq);
    const { id } = req.params;
    const [rows] = await db.execute(
      `SELECT doctor_id, qualification_id, doctor_qualification_id FROM QualificationCertificate WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    ) as [Record<string, unknown>[], unknown];
    if (rows.length === 0) {
      res.status(404).json({ error: 'Zertifikat nicht gefunden' });
      return;
    }
    ensureCanAccessDoctor(curaReq, rows[0].doctor_id as string);

    const qualificationConfig = await getQualificationConfig(curaReq, rows[0].qualification_id as string);

    await db.execute(
      `DELETE FROM QualificationCertificate WHERE id = ? AND tenant_key = ?`,
      [id, tenantKey]
    );
    const summary = await recomputeDoctorQualificationStatus({
      tenantDb: curaReq.db!,
      tenantKey,
      doctorId: rows[0].doctor_id as string,
      qualificationId: rows[0].qualification_id as string,
      doctorQualificationId: (rows[0].doctor_qualification_id as string) || null,
      qualificationConfig,
    });
    res.json({ ok: true, qualification_summary: summary });
  } catch (err) {
    next(err);
  }
});

// Multer-spezifische Fehlerbehandlung
router.use((err: unknown, _req: Request, res: Response, next: NextFunction): void => {
  if (!err) return next();
  const multerErr = err as { code?: string; message?: string };
  if (multerErr.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: 'Datei zu groß (max. 5 MB).' });
    return;
  }
  if (multerErr.message && /Dateityp nicht erlaubt/i.test(multerErr.message)) {
    res.status(400).json({ error: multerErr.message });
    return;
  }
  next(err);
});

export default router;
