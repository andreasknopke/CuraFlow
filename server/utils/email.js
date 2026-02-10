import nodemailer from 'nodemailer';

/**
 * Email sending utility with multiple provider support.
 * 
 * Priority order:
 *   1. BREVO_API_KEY → sends via Brevo HTTP API (works on Railway/serverless)
 *   2. SMTP_HOST + SMTP_USER + SMTP_PASS → sends via SMTP (works locally / on VPS)
 * 
 * Brevo setup (recommended for Railway):
 *   - Sign up at https://www.brevo.com (free: 300 emails/day)
 *   - Add & verify your sender domain/email
 *   - Set BREVO_API_KEY env var on Railway
 *   - Optionally set SMTP_FROM for the sender address
 * 
 * SMTP setup (for local dev or VPS):
 *   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   - Optional: SMTP_FROM, SMTP_SECURE
 */

// ==================== Brevo HTTP API ====================

async function sendViaBrevo({ to, subject, text, html, attachments }) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromRaw = process.env.SMTP_FROM || process.env.BREVO_FROM || 'CuraFlow <noreply@curaflow.de>';

  // Parse "Name <email>" format
  let senderName = 'CuraFlow';
  let senderEmail = 'noreply@curaflow.de';
  const match = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    senderName = match[1].trim();
    senderEmail = match[2].trim();
  } else if (fromRaw.includes('@')) {
    senderEmail = fromRaw.trim();
    senderName = senderEmail.split('@')[0];
  }

  // Build recipients array
  const recipients = (Array.isArray(to) ? to : [to]).map(email => ({ email: email.trim() }));

  const payload = {
    sender: { name: senderName, email: senderEmail },
    to: recipients,
    subject,
    ...(html && { htmlContent: html }),
    ...(text && { textContent: text }),
  };

  // Brevo supports attachments as base64
  if (attachments && attachments.length > 0) {
    payload.attachment = attachments.map(a => ({
      name: a.filename,
      content: a.content
        ? (typeof a.content === 'string' ? a.content : a.content.toString('base64'))
        : undefined,
    })).filter(a => a.content);
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    const errMsg = result.message || result.code || JSON.stringify(result);
    console.error(`[Email/Brevo] Fehler ${response.status}:`, errMsg);
    throw new Error(`Brevo API Fehler: ${errMsg}`);
  }

  console.log(`[Email/Brevo] Gesendet an ${to}: ${result.messageId}`);
  return { messageId: result.messageId, provider: 'brevo' };
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
 * Send an email. Automatically uses Brevo (HTTP) if BREVO_API_KEY is set,
 * otherwise falls back to SMTP.
 * 
 * @param {object} opts - { to, subject, text, html, attachments }
 * @returns {Promise<object>} send result with messageId and provider
 */
export async function sendEmail({ to, subject, text, html, attachments }) {
  // Prefer Brevo on serverless/Railway (SMTP ports often blocked)
  if (process.env.BREVO_API_KEY) {
    return sendViaBrevo({ to, subject, text, html, attachments });
  }

  // Fall back to SMTP
  return sendViaSMTP({ to, subject, text, html, attachments });
}

/**
 * Get info about the configured email provider.
 * Useful for diagnostics / admin UI.
 */
export function getEmailProviderInfo() {
  if (process.env.BREVO_API_KEY) {
    return {
      provider: 'brevo',
      configured: true,
      from: process.env.SMTP_FROM || process.env.BREVO_FROM || 'noreply@curaflow.de',
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
  return { provider: 'none', configured: false, note: 'Weder BREVO_API_KEY noch SMTP konfiguriert' };
}
