const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

const quoteIdentifier = (identifier) => {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  return `\`${identifier}\``;
};

export async function listColumns(dbPool, tableName) {
  const safeTableName = quoteIdentifier(tableName);
  const [rows] = await dbPool.execute(`SHOW COLUMNS FROM ${safeTableName}`);
  return rows.map((row) => row.Field);
}

export async function ensureColumns(dbPool, tableName, columns) {
  const safeTableName = quoteIdentifier(tableName);
  const existingColumns = new Set(await listColumns(dbPool, tableName));
  let addedColumns = 0;

  for (const { name, definition } of columns) {
    if (existingColumns.has(name)) {
      continue;
    }

    const safeColumnName = quoteIdentifier(name);

    try {
      await dbPool.execute(
        `ALTER TABLE ${safeTableName} ADD COLUMN ${safeColumnName} ${definition}`,
      );
      existingColumns.add(name);
      addedColumns += 1;
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        existingColumns.add(name);
        continue;
      }

      throw err;
    }
  }

  return addedColumns;
}

export async function ensureColumn(dbPool, tableName, columnName, definition) {
  return ensureColumns(dbPool, tableName, [{ name: columnName, definition }]);
}
