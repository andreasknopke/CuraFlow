import crypto from 'crypto';

const ensuredAuditTables = new WeakSet();

const ensureSystemLogTable = async (dbPool) => {
  if (ensuredAuditTables.has(dbPool)) {
    return;
  }

  await dbPool.execute(`
    CREATE TABLE IF NOT EXISTS SystemLog (
      id VARCHAR(36) PRIMARY KEY,
      level VARCHAR(50),
      source VARCHAR(255),
      message TEXT,
      details TEXT,
      created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_by VARCHAR(255)
    )
  `);

  ensuredAuditTables.add(dbPool);
};

export const writeAuditLog = async (
  dbPool,
  { level = 'audit', source, message, details, userEmail },
) => {
  try {
    await ensureSystemLogTable(dbPool);
    const id = crypto.randomUUID();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await dbPool.execute(
      'INSERT INTO SystemLog (id, level, source, message, details, created_date, updated_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        level,
        source,
        message,
        typeof details === 'string' ? details : JSON.stringify(details),
        now,
        now,
        userEmail || 'system',
      ],
    );
  } catch (error) {
    console.error('[AUDIT] Failed to write audit log to SystemLog table:', error.message);
  }
};
