import dotenv from 'dotenv';

dotenv.config();

// ---------------------------------------------------------------------------
// Centralised configuration – every process.env access in one place.
// Import this module instead of reading process.env directly.
// ---------------------------------------------------------------------------

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`FATAL: Required environment variable ${name} is not set`);
  }
  return value.trim();
}

function optional(name, fallback = '') {
  const value = process.env[name];
  return value ? value.trim() : fallback;
}

const jwtSecret = required('JWT_SECRET');

// ── Database ────────────────────────────────────────────────────────────────
export const db = {
  host: required('MYSQL_HOST'),
  port: parseInt(optional('MYSQL_PORT', '3306'), 10),
  user: required('MYSQL_USER'),
  password: required('MYSQL_PASSWORD'),
  database: required('MYSQL_DATABASE'),
};

// ── Security ────────────────────────────────────────────────────────────────
export const jwt = {
  secret: jwtSecret,
  refreshSecret: optional('JWT_REFRESH_SECRET', jwtSecret),
  tokenExpiry: optional('JWT_ACCESS_TOKEN_EXPIRY', '1h'),
  refreshTokenExpiry: optional('JWT_REFRESH_TOKEN_EXPIRY', '7d'),
};

// ── Server ──────────────────────────────────────────────────────────────────
export const server = {
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
  frontendUrl: optional('FRONTEND_URL'),
  allowedOrigins: optional('ALLOWED_ORIGINS'),
};

// ── Email / SMTP ────────────────────────────────────────────────────────────
export const email = {
  smtpHost: optional('SMTP_HOST'),
  smtpPort: parseInt(optional('SMTP_PORT', '587'), 10),
  smtpUser: optional('SMTP_USER'),
  smtpPass: optional('SMTP_PASS'),
  smtpSecure: optional('SMTP_SECURE', 'false') === 'true',
  smtpFrom: optional('SMTP_FROM'),
  brevoApiKey: optional('BREVO_API_KEY'),
  brevoFrom: optional('BREVO_FROM', 'noreply@curaflow.de'),
};

// ── AI / External APIs ──────────────────────────────────────────────────────
export const ai = {
  openaiApiKey: optional('OPENAI_API_KEY'),
  mistralApiKey: optional('MISTRAL_API_KEY'),
  autofillDebug: optional('AI_AUTOFILL_DEBUG', 'false') === 'true',
};

// ── Google Calendar ─────────────────────────────────────────────────────────
export const google = {
  serviceAccountEmail: optional('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
};

// ── Railway ─────────────────────────────────────────────────────────────────
export const railway = {
  publicDomain: optional('RAILWAY_PUBLIC_DOMAIN'),
  apiUrl: optional('RAILWAY_API_URL'),
};

// ── Docker / Seed ───────────────────────────────────────────────────────────
export const seed = {
  adminEmail: optional('CURAFLOW_ADMIN_EMAIL', 'admin@example.com'),
  adminPassword: optional('CURAFLOW_ADMIN_PASSWORD', 'admin'),
  adminName: optional('CURAFLOW_ADMIN_NAME', 'Admin'),
  seedDemoData: optional('CURAFLOW_SEED_DEMO_DATA', 'true') === 'true',
  dbWaitRetries: parseInt(optional('CURAFLOW_DB_WAIT_RETRIES', '30'), 10),
  dbWaitMs: parseInt(optional('CURAFLOW_DB_WAIT_MS', '2000'), 10),
};

// ── Default export for convenience ──────────────────────────────────────────
const config = { db, jwt, server, email, ai, google, railway, seed };
export default config;
