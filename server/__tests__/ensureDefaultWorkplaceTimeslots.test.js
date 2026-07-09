import { describe, expect, it, vi } from 'vitest';
import { ensureDefaultWorkplaceTimeslots } from '../utils/ensureDefaultWorkplaceTimeslots.js';

/**
 * Erstellt einen mock Tenant-Datenbank-Pool,
 * der isolate für jeden Testfall konfiguriert wird.
 */
function createMockDb() {
  const executed = [];
  let columnInfo = { Workplace: ['timeslots_enabled'] };
  let workplaces = [];
  let existingSlots = {};
  let systemSettingValue = null;
  let workplaceTimeslotsEnabled = {};

  const db = {
    executed,
    _setColumnInfo(cols) { columnInfo = cols; },
    _setWorkplaces(wps) { workplaces = wps; },
    _setExistingSlots(slots) { existingSlots = slots; },
    _setSystemSetting(value) { systemSettingValue = value; },
    _setWorkplaceTimeslotsEnabled(map) { workplaceTimeslotsEnabled = map; },

    async execute(sql, params = []) {
      executed.push({ sql, params });

      // SHOW COLUMNS FROM Workplace LIKE 'timeslots_enabled'
      if (sql.includes('SHOW COLUMNS FROM Workplace LIKE')) {
        const hasColumn = columnInfo.Workplace?.includes('timeslots_enabled') ?? true;
        return [hasColumn ? [{ Field: 'timeslots_enabled' }] : []];
      }

      // SELECT value FROM SystemSetting WHERE key = 'workplace_categories'
      if (sql.includes('SystemSetting') && sql.includes('workplace_categories')) {
        if (systemSettingValue) {
          return [[{ value: systemSettingValue }]];
        }
        return [[]];
      }

      // SELECT id, name, category FROM Workplace WHERE category IN (...) AND is_active = TRUE
      if (sql.includes('FROM Workplace WHERE category IN') && sql.includes('is_active')) {
        const categoryParams = params.slice(); // params sind die Kategorienamen
        const filtered = workplaces.filter((wp) => categoryParams.includes(wp.category));
        return [filtered];
      }

      // SELECT COUNT(*) AS cnt FROM WorkplaceTimeslot WHERE workplace_id = ?
      if (sql.includes('SELECT COUNT(*) AS cnt FROM WorkplaceTimeslot')) {
        const wpId = params[0];
        return [[{ cnt: existingSlots[wpId] || 0 }]];
      }

      // INSERT INTO WorkplaceTimeslot
      if (sql.includes('INSERT INTO WorkplaceTimeslot')) {
        return [{ affectedRows: 1 }];
      }

      // SELECT timeslots_enabled FROM Workplace WHERE id = ?
      if (sql.includes('SELECT timeslots_enabled FROM Workplace')) {
        const wpId = params[0];
        return [[{ timeslots_enabled: workplaceTimeslotsEnabled[wpId] || false }]];
      }

      // UPDATE Workplace SET timeslots_enabled = TRUE WHERE id = ?
      if (sql.includes('UPDATE Workplace SET timeslots_enabled')) {
        return [{ affectedRows: 1 }];
      }

      throw new Error(`Unexpected SQL: ${sql.substring(0, 80)}`);
    },
  };

  return db;
}

describe('ensureDefaultWorkplaceTimeslots', () => {
  it('legt Default-Timeslot für Rotation ohne bestehenden Timeslot an', async () => {
    const db = createMockDb();
    db._setWorkplaces([
      { id: 'wp-1', name: 'CT', category: 'Rotationen' },
    ]);
    db._setExistingSlots({ 'wp-1': 0 });
    db._setWorkplaceTimeslotsEnabled({ 'wp-1': false });

    const stats = await ensureDefaultWorkplaceTimeslots(db);

    expect(stats.processed).toBe(1);
    expect(stats.created).toBe(1);
    expect(stats.enabledFlagSet).toBe(1);
    expect(stats.skipped).toBe(0);

    // Prüfen, ob ein INSERT für WorkplaceTimeslot erfolgte
    const inserts = db.executed.filter(e => e.sql.includes('INSERT INTO WorkplaceTimeslot'));
    expect(inserts.length).toBe(1);
    expect(inserts[0].params[1]).toBe('wp-1');  // workplace_id
    expect(inserts[0].sql).toContain('overlap_tolerance_minutes');  // Pause enthalten
  });

  it('überspringt Workplace mit bereits existierendem Timeslot', async () => {
    const db = createMockDb();
    db._setWorkplaces([
      { id: 'wp-1', name: 'CT', category: 'Rotationen' },
    ]);
    db._setExistingSlots({ 'wp-1': 1 });  // Bereits vorhanden

    const stats = await ensureDefaultWorkplaceTimeslots(db);

    expect(stats.processed).toBe(1);
    expect(stats.created).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(stats.enabledFlagSet).toBe(0);
  });

  it('überspringt Dienste-Kategorie', async () => {
    const db = createMockDb();
    db._setWorkplaces([
      { id: 'wp-1', name: 'Nachtdienst', category: 'Dienste' },
    ]);

    // Dienste sind nicht in targetCategories, also wird die SQL-Abfrage
    // workplaces nur mit 'Rotationen' als Parameter abfragen
    const stats = await ensureDefaultWorkplaceTimeslots(db);

    // Da 'Dienste' nicht in effectiveCategories, wird keine Workplace-Abfrage gemacht
    expect(stats.processed).toBe(0);
    expect(stats.created).toBe(0);
    expect(stats.skipped).toBe(0);
  });

  it('überspringt Demonstrationen & Konsile', async () => {
    const db = createMockDb();
    db._setWorkplaces([
      { id: 'wp-1', name: 'Demo Chirurgie', category: 'Demonstrationen & Konsile' },
    ]);

    const stats = await ensureDefaultWorkplaceTimeslots(db);

    expect(stats.processed).toBe(0);
    expect(stats.created).toBe(0);
  });

  it('überspringt inaktive Workplaces (is_active = FALSE)', async () => {
    const db = createMockDb();
    // Die SQL-Abfrage filtert nach is_active = TRUE, also wird ein inaktiver
    // Workplace gar nicht erst geladen
    db._setWorkplaces([]);  // Keine aktiven

    const stats = await ensureDefaultWorkplaceTimeslots(db);

    expect(stats.processed).toBe(0);
    expect(stats.created).toBe(0);
  });

  it('behandelt Custom-Kategorien aus SystemSetting', async () => {
    const db = createMockDb();
    db._setSystemSetting(JSON.stringify([
      { name: 'Funktionsbereiche' },
      { name: 'Diagnostik' },
    ]));
    db._setWorkplaces([
      { id: 'wp-1', name: 'EKG', category: 'Funktionsbereiche' },
      { id: 'wp-2', name: 'CT', category: 'Rotationen' },
    ]);
    db._setExistingSlots({ 'wp-1': 0, 'wp-2': 1 });

    const stats = await ensureDefaultWorkplaceTimeslots(db);

    expect(stats.processed).toBe(2);

    // Nur wp-1 wird neu angelegt (wp-2 hat bereits Timeslot)
    const inserts = db.executed.filter(e => e.sql.includes('INSERT INTO WorkplaceTimeslot'));
    expect(inserts.length).toBe(1);
    expect(inserts[0].params[1]).toBe('wp-1'); // workplace_id
  });

  it('ist idempotent bei zweimaligem Aufruf', async () => {
    const db = createMockDb();
    db._setWorkplaces([
      { id: 'wp-1', name: 'CT', category: 'Rotationen' },
      { id: 'wp-2', name: 'MRT', category: 'Rotationen' },
    ]);

    // Erster Lauf: beide ohne Timeslot
    db._setExistingSlots({ 'wp-1': 0, 'wp-2': 0 });
    db._setWorkplaceTimeslotsEnabled({ 'wp-1': false, 'wp-2': false });

    const stats1 = await ensureDefaultWorkplaceTimeslots(db);
    expect(stats1.created).toBe(2);

    // Zweiter Lauf: beide haben jetzt Timeslot (die Mock-DB merkt sich das nicht,
    // also setzen wir die Slots manuell)
    db._setExistingSlots({ 'wp-1': 1, 'wp-2': 1 });

    const stats2 = await ensureDefaultWorkplaceTimeslots(db);
    expect(stats2.created).toBe(0);
    expect(stats2.skipped).toBe(2);
  });
});
