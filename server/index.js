import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config from './config.js';
import { db, tenantDbMiddleware, isDatabaseError, isTransientDbError } from './db/pool.js';
import { applyCors } from './middleware/cors.js';
import { applySecurityMiddleware, authLimiter } from './middleware/security.js';
import { registerShutdown, runStartupTasks } from './startup.js';

// Import routes
import authRouter from './routes/auth.js';
import dbProxyRouter from './routes/dbProxy.js';
import scheduleRouter from './routes/schedule.js';
import holidaysRouter from './routes/holidays.js';
import staffRouter from './routes/staff.js';
import calendarRouter from './routes/calendar.js';
import voiceRouter from './routes/voice.js';
import adminRouter from './routes/admin.js';
import atomicRouter from './routes/atomic.js';
import aiAutofillRouter from './routes/aiAutofill.js';
import masterRouter from './routes/master.js';

export {
  db,
  getTenantDb,
  isDatabaseError,
  isTransientDbError,
  removeTenantPool,
} from './db/pool.js';

const app = express();
const PORT = config.server.port;

// ===== Static frontend serving (Coolify / single-container deployment) =====
// Must be BEFORE helmet/CORS/auth middleware so static files are served fast and clean.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  console.log(`📁 Serving static frontend from ${distPath}`);
  app.use(
    express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
}

// Trust proxy - Railway runs behind a reverse proxy
app.set('trust proxy', 1);

applyCors(app);
app.use(tenantDbMiddleware);
applySecurityMiddleware(app);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.server.nodeEnv,
    version: '1.0.4', // Better error logging
  });
});

// ===== PUBLIC (no-auth) endpoint: Wish reminder acknowledgment =====
app.get('/api/wish-ack', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string' || token.length > 100) {
    return res
      .status(400)
      .send(wishAckHtml('Ungültiger Link', 'Der Link ist ungültig oder abgelaufen.', false));
  }
  try {
    const [rows] = await db.execute(
      'SELECT id, doctor_id, target_month, status FROM WishReminderAck WHERE token = ?',
      [token],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .send(
          wishAckHtml(
            'Link nicht gefunden',
            'Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet.',
            false,
          ),
        );
    }
    const ack = rows[0];
    if (ack.status === 'acknowledged') {
      return res.send(
        wishAckHtml(
          'Bereits bestätigt',
          'Sie haben bereits bestätigt, dass Sie keine Dienstwünsche haben. Vielen Dank!',
          true,
        ),
      );
    }
    await db.execute(
      "UPDATE WishReminderAck SET status = 'acknowledged', acknowledged_date = NOW() WHERE id = ?",
      [ack.id],
    );
    return res.send(
      wishAckHtml(
        'Vielen Dank!',
        'Ihre Bestätigung wurde gespeichert. Sie haben angegeben, dass Sie keine Dienstwünsche für diesen Zeitraum haben.',
        true,
      ),
    );
  } catch (err) {
    console.error('[wish-ack] Error:', err.message);
    return res
      .status(500)
      .send(
        wishAckHtml(
          'Fehler',
          'Es ist ein technischer Fehler aufgetreten. Bitte versuchen Sie es später erneut.',
          false,
        ),
      );
  }
});

function wishAckHtml(title, message, success) {
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

// API Routes
app.use('/api/auth/login', authLimiter); // Apply stricter limit to login
app.use('/api/auth', authRouter);
app.use('/api/db', dbProxyRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/holidays', holidaysRouter);
app.use('/api/staff', staffRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/voice', voiceRouter);
app.use('/api/admin', adminRouter);
app.use('/api/atomic', atomicRouter);
app.use('/api/schedule', aiAutofillRouter);
app.use('/api/master', masterRouter);

// ===== SPA fallback (Coolify / single-container deployment) =====
if (fs.existsSync(distPath)) {
  app.get(/^(?!\/api\/).*/, (req, res) => {
    const htmlFile =
      req.path === '/master' || req.path.startsWith('/master/') ? 'master.html' : 'index.html';
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(distPath, htmlFile));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  const databaseError = isDatabaseError(err);
  const retryable = databaseError && (err.retryable ?? isTransientDbError(err));

  if (databaseError) {
    console.error('[DB][HTTP] Request failed', {
      method: req.method,
      path: req.originalUrl,
      code: err.code || null,
      retryable,
      pool: err.poolLabel || 'unknown',
      message: err.message,
    });
  } else {
    console.error('Error:', err);
  }

  const status = err.status || (databaseError && retryable ? 503 : 500);
  const message = databaseError
    ? 'Datenbankproblem auf dem Server. Bitte versuchen Sie es erneut.'
    : config.server.isProduction && status === 500
      ? 'Internal server error'
      : err.message;

  res.status(status).json({
    error: message,
    ...(databaseError && {
      databaseError: true,
      retryable,
      code: err.code || null,
    }),
    ...(databaseError &&
      !config.server.isProduction && {
        details: err.message,
        pool: err.poolLabel || 'unknown',
      }),
    ...(!config.server.isProduction && { stack: err.stack }),
  });
});

// 404 handler
app.use((req, res) => {
  console.warn(
    '404 Not Found:',
    req.method,
    req.url,
    'Body:',
    JSON.stringify(req.body || {}).substring(0, 200),
  );
  res.status(404).json({ error: 'Route not found', path: req.url, method: req.method });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 CuraFlow Railway Server running on port ${PORT}`);
  console.log(`📊 Environment: ${config.server.nodeEnv}`);
  console.log(`🗄️  Database: ${config.db.host}`);

  await runStartupTasks(db);
});

// Graceful shutdown
registerShutdown(db);
