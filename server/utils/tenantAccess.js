const DB_TOKENS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS db_tokens (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    token TEXT NOT NULL,
    host VARCHAR(255),
    db_name VARCHAR(100),
    description TEXT,
    is_active BOOLEAN DEFAULT FALSE,
    created_by VARCHAR(255),
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

const ensuredDbTokenTables = new WeakSet();

const normalizeTenantIds = (tenantIds) =>
  tenantIds
    .filter((tenantId) => tenantId !== null && tenantId !== undefined && tenantId !== '')
    .map((tenantId) => String(tenantId));

export const parseTenantAccess = (rawAllowedTenants) => {
  if (rawAllowedTenants === null || rawAllowedTenants === undefined || rawAllowedTenants === '') {
    return { tenantIds: [], hasFullAccess: true, isValid: true };
  }

  if (Array.isArray(rawAllowedTenants)) {
    const tenantIds = normalizeTenantIds(rawAllowedTenants);
    return {
      tenantIds,
      hasFullAccess: tenantIds.length === 0,
      isValid: true,
    };
  }

  if (typeof rawAllowedTenants === 'string') {
    try {
      const parsed = JSON.parse(rawAllowedTenants);
      return parseTenantAccess(parsed);
    } catch (_error) {
      return { tenantIds: [], hasFullAccess: false, isValid: false };
    }
  }

  return { tenantIds: [], hasFullAccess: false, isValid: false };
};

export const canAccessTenant = (access, tenantId) => {
  if (!access?.isValid) {
    return false;
  }

  if (access.hasFullAccess) {
    return true;
  }

  return access.tenantIds.includes(String(tenantId));
};

export const filterTokensByTenantAccess = (tokens, access) => {
  if (!access?.isValid) {
    return [];
  }

  if (access.hasFullAccess) {
    return tokens;
  }

  return tokens.filter((token) => canAccessTenant(access, token.id));
};

export const ensureDbTokensTable = async (masterDb) => {
  if (ensuredDbTokenTables.has(masterDb)) {
    return;
  }

  await masterDb.execute(DB_TOKENS_TABLE_SQL);
  ensuredDbTokenTables.add(masterDb);
};

export const getUserTenantAccess = async (masterDb, userId) => {
  const [rows] = await masterDb.execute(
    'SELECT allowed_tenants FROM app_users WHERE id = ? AND is_active = 1',
    [userId],
  );

  if (rows.length === 0) {
    return {
      found: false,
      access: { tenantIds: [], hasFullAccess: false, isValid: false },
    };
  }

  return {
    found: true,
    access: parseTenantAccess(rows[0].allowed_tenants),
  };
};

export const resolveTenantTokenRecord = async (masterDb, encryptedToken) => {
  await ensureDbTokensTable(masterDb);

  const [rows] = await masterDb.execute(
    'SELECT id, name, host, db_name, is_active FROM db_tokens WHERE token = ? LIMIT 1',
    [encryptedToken],
  );

  return rows[0] || null;
};

export const authorizeTenantToken = async (masterDb, userId, encryptedToken) => {
  const tokenRecord = await resolveTenantTokenRecord(masterDb, encryptedToken);

  if (!tokenRecord) {
    return {
      allowed: false,
      status: 403,
      error: 'Ungültiger Mandanten-Token',
      tokenRecord: null,
      access: null,
    };
  }

  const { found, access } = await getUserTenantAccess(masterDb, userId);

  if (!found) {
    return {
      allowed: false,
      status: 401,
      error: 'Nicht autorisiert',
      tokenRecord,
      access,
    };
  }

  if (!access.isValid) {
    return {
      allowed: false,
      status: 403,
      error: 'Mandantenzugriff fehlerhaft konfiguriert',
      tokenRecord,
      access,
    };
  }

  if (!canAccessTenant(access, tokenRecord.id)) {
    return {
      allowed: false,
      status: 403,
      error: 'Kein Zugriff auf diesen Mandanten',
      tokenRecord,
      access,
    };
  }

  return {
    allowed: true,
    status: 200,
    error: null,
    tokenRecord,
    access,
  };
};
