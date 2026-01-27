import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { createPool } from 'mysql2/promise';
import { parseDbToken } from './utils/crypto.js';

// Load environment variables if not already loaded (fallback for direct execution)
if (!process.env.JWT_SECRET) {
  dotenv.config();
}

// CRITICAL SECURITY: Validate JWT_SECRET exists and is strong
if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is required');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('❌ FATAL: JWT_SECRET must be at least 32 characters long');
  console.error('Current length:', process.env.JWT_SECRET.length);
  process.exit(1);
}

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
import integrationsRouter from './routes/integrations.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - for deployment behind reverse proxies
app.set('trust proxy', 1);

// Default MySQL Connection Pool
export const db = createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true, // Important for DATE/DATETIME consistency
  timezone: '+00:00'
});

// Cache for tenant database pools (Multi-Tenant Support)
const tenantPools = new Map();

// Remove a tenant pool from cache (e.g., on connection error)
export const removeTenantPool = (dbToken) => {
  if (tenantPools.has(dbToken)) {
    const pool = tenantPools.get(dbToken);
    try {
      pool.end(); // Close connections
    } catch (e) {
      // Ignore errors during cleanup
    }
    tenantPools.delete(dbToken);
    console.log(`Removed tenant pool from cache`);
  }
};

// Get or create a connection pool for a tenant
export const getTenantDb = (dbToken) => {
  if (!dbToken) return db; // Return default pool if no token
  
  // Check cache first
  if (tenantPools.has(dbToken)) {
    return tenantPools.get(dbToken);
  }
  
  try {
    // Decrypt and parse token (supports both legacy base64 and encrypted formats)
    const config = parseDbToken(dbToken);
    
    // Validate required fields
    if (!config || !config.host || !config.user || !config.database) {
      console.error('Invalid DB token: missing required fields');
      return db;
    }
    
    // Create new pool for this tenant
    const tenantPool = createPool({
      host: config.host,
      port: parseInt(config.port || '3306'),
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl || undefined,
      waitForConnections: true,
      connectionLimit: 5, // Smaller limit for tenant pools
      queueLimit: 0,
      dateStrings: true,
      timezone: '+00:00'
    });
    
    // Cache it
    tenantPools.set(dbToken, tenantPool);
    console.log(`Created new tenant pool for: ${config.host}/${config.database}`);
    
    return tenantPool;
  } catch (error) {
    console.error('Failed to parse DB token:', error.message);
    return db; // Fall back to default
  }
};

// Middleware to attach tenant DB to request
export const tenantDbMiddleware = (req, res, next) => {
  const dbToken = req.headers['x-db-token'];
  req.db = getTenantDb(dbToken);
  req.dbToken = dbToken; // Store for error handling
  req.isCustomDb = !!dbToken && req.db !== db;
  next();
};

// CORS Configuration - MUST be before other middleware!
const allowedOrigins = [
  'http://localhost:5173',  // Vite dev server
  'http://localhost:3000',  // Alternative frontend port
  'http://localhost:4173',  // Vite preview
  process.env.FRONTEND_URL
].filter(Boolean);

console.log('CORS allowed origins:', allowedOrigins);
console.log('NODE_ENV:', process.env.NODE_ENV);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-DB-Token']
}));

// Multi-Tenant DB Middleware - attach tenant DB to each request
app.use(tenantDbMiddleware);// Security & Compression - AFTER CORS
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "unsafe-none" }
}));
app.use(compression());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting - General API
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // limit each IP to 300 requests per minute
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // limit each IP to 30 login attempts per windowMs
  message: { error: 'Too many login attempts from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
});

app.use('/api/', generalLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: '1.0.4' // Better error logging
  });
});

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
app.use('/api/integrations', integrationsRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error'
    : err.message;
  
  res.status(status).json({ 
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  console.warn('404 Not Found:', req.method, req.url, 'Body:', JSON.stringify(req.body || {}).substring(0, 200));
  res.status(404).json({ error: 'Route not found', path: req.url, method: req.method });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 CuraFlow Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database: ${process.env.MYSQL_HOST}`);
  
  // Auto-create missing tables on startup
  try {
    await ensureTablesExist();
  } catch (err) {
    console.error('⚠️  Table initialization error:', err.message);
  }
});

// Auto-create essential tables if missing
async function ensureTablesExist() {
  const tables = [
    {
      name: 'TeamRole',
      sql: `CREATE TABLE IF NOT EXISTS TeamRole (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        priority INT NOT NULL DEFAULT 99,
        is_specialist BOOLEAN NOT NULL DEFAULT FALSE,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`
    }
  ];

  for (const table of tables) {
    try {
      await db.execute(table.sql);
      
      // Seed default data for TeamRole
      if (table.name === 'TeamRole') {
        const [existing] = await db.execute('SELECT COUNT(*) as cnt FROM TeamRole');
        if (existing[0].cnt === 0) {
          const defaultRoles = [
            { id: crypto.randomUUID(), name: 'Chefarzt', priority: 0, is_specialist: true },
            { id: crypto.randomUUID(), name: 'Oberarzt', priority: 1, is_specialist: true },
            { id: crypto.randomUUID(), name: 'Facharzt', priority: 2, is_specialist: true },
            { id: crypto.randomUUID(), name: 'Assistenzarzt', priority: 3, is_specialist: false },
            { id: crypto.randomUUID(), name: 'Nicht-Radiologe', priority: 4, is_specialist: false },
          ];
          for (const role of defaultRoles) {
            await db.execute(
              'INSERT IGNORE INTO TeamRole (id, name, priority, is_specialist) VALUES (?, ?, ?, ?)',
              [role.id, role.name, role.priority, role.is_specialist]
            );
          }
          console.log('✅ TeamRole table seeded with defaults');
        }
      }
      console.log(`✅ Table ${table.name} ready`);
    } catch (err) {
      console.error(`❌ Failed to ensure ${table.name}:`, err.message);
    }
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server gracefully...');
  await db.end();
  process.exit(0);
});
