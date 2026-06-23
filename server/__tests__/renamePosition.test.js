import { describe, expect, it } from 'vitest';

/**
 * Hilfsfunktion: Erzeugt einen Mock-DB-Pool, der die ausgeführten SQL-Calls aufzeichnet
 * und pro Tabelle konfigurierbare Fehler werfen kann.
 */
function createMockPool(tablesWithErrors = new Set()) {
  const calls = [];

  const pool = {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });

      // Table existiert nicht → ER_NO_SUCH_TABLE simulieren
      for (const table of tablesWithErrors) {
        if (sql.includes(table)) {
          const err = new Error(`Table '${table}' doesn't exist`);
          err.code = 'ER_NO_SUCH_TABLE';
          throw err;
        }
      }

      // Default: 1 Zeile aktualisiert
      return [{ affectedRows: 1 }, []];
    },
  };

  return pool;
}

/**
 * Simuliert die Logik der rename-position-Route.
 * Die gleichen SQL-Updates und Error-Handling wie in server/routes/admin.js.
 */
async function executeRenamePosition(dbPool, { oldName, newName }) {
  const stats = { updatedShifts: 0, updatedNotes: 0, updatedRotations: 0 };

  // Update ShiftEntry
  try {
    const [r1] = await dbPool.execute(
      'UPDATE ShiftEntry SET position = ? WHERE position = ?',
      [newName, oldName],
    );
    stats.updatedShifts = r1.affectedRows || 0;
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
  }

  // Update ScheduleNote
  try {
    const [r2] = await dbPool.execute(
      'UPDATE ScheduleNote SET position = ? WHERE position = ?',
      [newName, oldName],
    );
    stats.updatedNotes = r2.affectedRows || 0;
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
  }

  // Update TrainingRotation (modality field)
  try {
    const [r3] = await dbPool.execute(
      'UPDATE TrainingRotation SET modality = ? WHERE modality = ?',
      [newName, oldName],
    );
    stats.updatedRotations = r3.affectedRows || 0;
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
  }

  return stats;
}

describe('renamePosition (SQL-Logik)', () => {
  it('führt Updates auf allen drei Tabellen durch, wenn diese existieren', async () => {
    const pool = createMockPool();
    const result = await executeRenamePosition(pool, {
      oldName: 'Dienst Alt',
      newName: 'Dienst Neu',
    });

    expect(result.updatedShifts).toBe(1);
    expect(result.updatedNotes).toBe(1);
    expect(result.updatedRotations).toBe(1);

    expect(pool.calls).toHaveLength(3);
    expect(pool.calls[0].sql).toContain('UPDATE ShiftEntry');
    expect(pool.calls[0].params).toEqual(['Dienst Neu', 'Dienst Alt']);
    expect(pool.calls[1].sql).toContain('UPDATE ScheduleNote');
    expect(pool.calls[2].sql).toContain('UPDATE TrainingRotation');
  });

  it('überspringt fehlende Tabellen via ER_NO_SUCH_TABLE', async () => {
    const missingTables = new Set(['ShiftEntry', 'ScheduleNote', 'TrainingRotation']);
    const pool = createMockPool(missingTables);

    // Sollte keinen Fehler werfen, sondern tabellenlos durchlaufen
    const result = await executeRenamePosition(pool, {
      oldName: 'Dienst Alt',
      newName: 'Dienst Neu',
    });

    expect(result.updatedShifts).toBe(0);
    expect(result.updatedNotes).toBe(0);
    expect(result.updatedRotations).toBe(0);
  });

  it('überspringt nur fehlende Tabellen, andere bleiben funktionsfähig', async () => {
    // Nur ShiftEntry fehlt, ScheduleNote und TrainingRotation existieren
    const missingTables = new Set(['ShiftEntry']);
    const pool = createMockPool(missingTables);

    const result = await executeRenamePosition(pool, {
      oldName: 'Dienst Alt',
      newName: 'Dienst Neu',
    });

    expect(result.updatedShifts).toBe(0);  // Tabelle fehlt → übersprungen
    expect(result.updatedNotes).toBe(1);   // OK
    expect(result.updatedRotations).toBe(1); // OK
  });

  it('gibt 0 affectedRows zurück, wenn keine Einträge matchen', async () => {
    const pool = {
      calls: [],
      async execute(sql, params) {
        this.calls.push({ sql, params });

        // 0 Zeilen betroffen
        if (sql.includes('ShiftEntry')) return [{ affectedRows: 0 }, []];
        if (sql.includes('ScheduleNote')) return [{ affectedRows: 0 }, []];
        if (sql.includes('TrainingRotation')) return [{ affectedRows: 0 }, []];

        return [{ affectedRows: 0 }, []];
      },
    };

    const result = await executeRenamePosition(pool, {
      oldName: 'Nicht-existierend',
      newName: 'Egal',
    });

    expect(result.updatedShifts).toBe(0);
    expect(result.updatedNotes).toBe(0);
    expect(result.updatedRotations).toBe(0);
    expect(pool.calls).toHaveLength(3);
  });

  it('wirft echte MySQL-Fehler (kein ER_NO_SUCH_TABLE)', async () => {
    const pool = {
      calls: [],
      async execute(sql) {
        this.calls.push({ sql });
        const err = new Error('Lock wait timeout exceeded');
        err.code = 'ER_LOCK_WAIT_TIMEOUT';
        throw err;
      },
    };

    await expect(executeRenamePosition(pool, {
      oldName: 'Alt',
      newName: 'Neu',
    })).rejects.toThrow('Lock wait timeout exceeded');
  });

  it('aktualisiert alle drei Tabellen mit den korrekten Positionswerten', async () => {
    const pool = createMockPool();
    await executeRenamePosition(pool, {
      oldName: 'Hintergrunddienst',
      newName: 'BG-Dienst',
    });

    // Alle drei Queries müssen dieselben Parameer verwenden
    for (const call of pool.calls) {
      if (call.sql.includes('TrainingRotation')) {
        // TrainingRotation verwendet modality statt position
        expect(call.params).toEqual(['BG-Dienst', 'Hintergrunddienst']);
      } else {
        expect(call.params).toEqual(['BG-Dienst', 'Hintergrunddienst']);
      }
    }
  });
});
