export const PUBLIC_READ_TABLES = [
  'SystemSetting',
  'ColorSetting',
  'Workplace',
  'DemoSetting',
  'TeamRole',
  'Qualification',
  'DoctorQualification',
  'WorkplaceQualification',
];

export const COLUMNS_CACHE = {};

export const clearColumnsCache = (tableNames = null, cacheKey = null) => {
  if (!tableNames) {
    for (const key in COLUMNS_CACHE) {
      delete COLUMNS_CACHE[key];
    }
    console.log('[dbProxy] Cleared entire columns cache');
    return;
  }

  for (const key in COLUMNS_CACHE) {
    const matchesTable = tableNames.some((tableName) => key.endsWith(`:${tableName}`));
    const matchesCacheKey = !cacheKey || key.startsWith(`${cacheKey}:`);
    if (matchesTable && matchesCacheKey) {
      delete COLUMNS_CACHE[key];
      console.log(`[dbProxy] Cleared cache for: ${key}`);
    }
  }
};

export const getValidColumns = async (dbPool, tableName, cacheKey) => {
  const fullCacheKey = `${cacheKey}:${tableName}`;
  if (COLUMNS_CACHE[fullCacheKey]) return COLUMNS_CACHE[fullCacheKey];

  try {
    const [rows] = await dbPool.execute(`SHOW COLUMNS FROM \`${tableName}\``);
    const columns = rows.map((row) => row.Field);
    COLUMNS_CACHE[fullCacheKey] = columns;
    return columns;
  } catch (error) {
    console.error(`Failed to fetch columns for ${tableName}:`, error.message);
    if (error.message.includes("doesn't exist") || error.code === 'ER_NO_SUCH_TABLE') {
      return [];
    }
    return null;
  }
};
