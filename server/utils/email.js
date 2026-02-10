import nodemailer from 'nodemailer';

/**
 * Email sending utility with multiple provider support.
 * 
 * Priority order:
 *   1. RESEND_API_KEY → sends via Resend HTTP API (works on Railway/serverless)
 *   2. SMTP_HOST + SMTP_USER + SMTP_PASS → sends via SMTP (works locally / on VPS)
 * 
 * Resend setup (recommended for Railway):
 *   - Sign up at https://resend.com (free: 100 emails/day)
 *   - Add & verify your domain (or use onboarding@resend.dev for testing)
 *   - Set RESEND_API_KEY env var on Railway
 *   - Optionally set SMTP_FROM for the sender address
 * 
 * SMTP setup (for local dev or VPS):
 *   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   - Optional: SMTP_FROM, SMTP_SECURE
 */

// ==================== Resend HTTP API ====================

async function sendViaResend({ to, subject, text, html, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.SMTP_FROM || process.env.RESEND_FROM || 'CuraFlow <noreply@resend.dev>';

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    ...(html && { html }),
    ...(text && !html && { text }),
    ...(text && html && { text }),
  };

  // Resend supports attachments too
  if (attachments && attachments.length > 0) {
    payload.attachments = attachments.map(a => ({
      filename: a.filename,
      content: a.content ? (typeof a.content === 'string' ? a.content : a.content.toString('base64')) : undefined,
      path: a.path,
    })).filter(a => a.content || a.path);
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    const errMsg = result.message || result.error || JSON.stringify(result);
    console.error(`[Email/Resend] Fehler ${response.status}:`, errMsg);
    throw new Error(`Resend API Fehler: ${errMsg}`);
  }

  console.log(`[Email/Resend] Gesendet an ${to}: ${result.id}`);
  return { messageId: result.id, provider: 'resend' };
}

// ==================== SMTP (Nodemailer) ====================

let transporter = null;

export function resetTransporter() {
  transporter = null;
}

export function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[Email] SMTP nicht konfiguriert (SMTP_HOST, SMTP_USER, SMTP_PASS erforderlich)');
    return null;
  }

  const secure = process.env.SMTP_SECURE 
    ? process.env.SMTP_SECURE === 'true' 
    : port === 465;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // Port 587: use STARTTLS upgrade; Port 465: direct TLS
    ...(!secure && { requireTLS: true }),
    tls: {
      // Do not fail on invalid/self-signed certs (common with shared hosting like ALL-INKL)
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2'
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });

  console.log(`[Email] SMTP Transporter konfiguriert: ${host}:${port} (secure=${secure}, STARTTLS=${!secure})`);
  return transporter;
}

async function sendViaSMTP({ to, subject, text, html, attachments }) {
  const transport = getTransporter();
  if (!transport) {
    throw new Error('SMTP nicht konfiguriert. Bitte SMTP_HOST, SMTP_USER, SMTP_PASS als Umgebungsvariablen setzen.');
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  const info = await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
    attachments,
  });

  console.log(`[Email/SMTP] Gesendet an ${to}: ${info.messageId}`);
  return { ...info, provider: 'smtp' };
}

// ==================== Unified sendEmail ====================

/**
 * Send an email. Automatically uses Resend (HTTP) if RESEND_API_KEY is set,
 * otherwise falls back to SMTP.
 * 
 * @param {object} opts - { to, subject, text, html, attachments }
 * @returns {Promise<object>} send result with messageId and provider
 */
export async function sendEmail({ to, subject, text, html, attachments }) {
  // Prefer Resend on serverless/Railway (SMTP ports often blocked)
  if (process.env.RESEND_API_KEY) {
    return sendViaResend({ to, subject, text, html, attachments });
  }

  // Fall back to SMTP
  return sendViaSMTP({ to, subject, text, html, attachments });
}

/**
 * Get info about the configured email provider.
 * Useful for diagnostics / admin UI.
 */
export function getEmailProviderInfo() {
  if (process.env.RESEND_API_KEY) {
    return {
      provider: 'resend',
      configured: true,
      from: process.env.SMTP_FROM || process.env.RESEND_FROM || 'noreply@resend.dev',
      note: 'HTTP API – funktioniert auf Railway',
    };
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      provider: 'smtp',
      configured: true,
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || '587',
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      note: 'SMTP – funktioniert nicht auf Railway (Ports blockiert)',
    };
  }
  return { provider: 'none', configured: false, note: 'Weder RESEND_API_KEY noch SMTP konfiguriert' };
}
