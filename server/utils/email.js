import nodemailer from 'nodemailer';

/**
 * Creates a nodemailer transporter from environment variables.
 * Required env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * Optional:
 *   SMTP_FROM (defaults to SMTP_USER)
 *   SMTP_SECURE (defaults to 'true' for port 465, 'false' otherwise)
 */
let transporter = null;

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
    tls: {
      // Do not fail on invalid/self-signed certs (common with shared hosting)
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2'
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  console.log(`[Email] SMTP Transporter konfiguriert: ${host}:${port}`);
  return transporter;
}

/**
 * Send an email via SMTP.
 * @param {object} opts - { to, subject, text, html, attachments }
 * @param {string} opts.to - Recipient email
 * @param {string} opts.subject - Email subject
 * @param {string} [opts.text] - Plain text body
 * @param {string} [opts.html] - HTML body
 * @param {Array} [opts.attachments] - Nodemailer attachments array
 * @returns {Promise<object>} nodemailer send result
 */
export async function sendEmail({ to, subject, text, html, attachments }) {
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

  console.log(`[Email] Gesendet an ${to}: ${info.messageId}`);
  return info;
}
