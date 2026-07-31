/**
 * CuraFlow — ensureDefaultWorkplaceTimeslots
 *
 * Backfill-Helfer: Stellt sicher, dass alle Arbeitsplätze der Kategorien
 * "Rotationen" und benutzerdefinierte Kategorien mindestens einen
 * WorkplaceTimeslot-Eintrag (07:00–15:30) besitzen. Für Arbeitsplätze ohne
 * Timeslot wird einer angelegt und timeslots_enabled = TRUE gesetzt.
 *
 * Dienste und Demonstrationen & Konsile werden bewusst ausgelassen.
 * Idempotent – jeder Workplace wird nur einmal bearbeitet.
 *
 * @module utils/ensureDefaultWorkplaceTimeslots
 */
import crypto from 'crypto';

/**
 * Parst die workplace_categories aus SystemSetting JSON.
 * Handhabt sowohl Legacy-Format (String-Array) als auch aktuelles (Object-Array).
 *
 * @param {string|null|undefined} rawValue
 * @returns {string[]} Kategorie-Namen
 */
function parseWorkplaceCategories(rawValue) {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((category) => {
        if (typeof category === 'string') return category.trim();
        if (category && typeof category.name === 'string') return category.name.trim();
        return null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Stellt Default-Timeslots für Rotation/Custom-Arbeitsplätze sicher.
 *
 * @param {import('mysql2/promise').Pool} dbPool - Tenant-Datenbank-Pool
 * @param {string[]} customCategoryNames - Namen benutzerdefinierter Kategorien (wird aus SystemSetting gelesen, wenn leer)
 * @returns {Promise<{processed: number, created: number, skipped: number, enabledFlagSet: number}>}
 */
export async function ensureDefaultWorkplaceTimeslots(dbPool, customCategoryNames = []) {
  const stats = { processed: 0, created: 0, skipped: 0, enabledFlagSet: 0 };

  // Falls keine customCategoryNames übergeben wurden, versuche aus SystemSetting zu lesen
  if (customCategoryNames.length === 0) {
    try {
      const [rows] = await dbPool.execute(
        `SELECT value FROM SystemSetting WHERE \`key\` = 'workplace_categories' LIMIT 1`
      );
      if (rows.length > 0) {
        customCategoryNames = parseWorkplaceCategories(rows[0].value);
      }
    } catch {
      // SystemSetting-Tabelle existiert ggf. nicht → leer lassen
    }
  }

  // Ziel-Kategorien: Rotationen + Custom
  const targetCategories = ['Rotationen', ...customCategoryNames];

  // Explizit ausgeschlossene Kategorien
  const excludedCategories = new Set(['Dienste', 'Demonstrationen & Konsile']);

  // Nur die Kategorien verarbeiten, die nicht ausgeschlossen sind
  const effectiveCategories = targetCategories.filter(
    (cat) => !excludedCategories.has(cat)
  );

  if (effectiveCategories.length === 0) {
    return stats;
  }

  try {
    // Workplace-Tabelle auf timeslots_enabled-Spalte prüfen (alte Tenants ohne)
    const [wpColumns] = await dbPool.execute(
      `SHOW COLUMNS FROM Workplace LIKE 'timeslots_enabled'`
    );
    const hasTimeslotsEnabled = wpColumns.length > 0;

    // Workplaces der Ziel-Kategorien laden
    const catPlaceholders = effectiveCategories.map(() => '?').join(',');
    const [workplaces] = await dbPool.execute(
      `SELECT id, name, category FROM Workplace WHERE category IN (${catPlaceholders}) AND is_active = TRUE`,
      effectiveCategories
    );

    for (const wp of workplaces) {
      stats.processed++;

      // Prüfen, ob bereits ein Timeslot existiert
      const [existingSlots] = await dbPool.execute(
        `SELECT COUNT(*) AS cnt FROM WorkplaceTimeslot WHERE workplace_id = ?`,
        [wp.id]
      );

      if (existingSlots[0]?.cnt > 0) {
        stats.skipped++;
        continue;
      }

      // Default-Timeslot anlegen
      const slotId = crypto.randomUUID();
      await dbPool.execute(
        `INSERT INTO WorkplaceTimeslot (id, workplace_id, label, start_time, end_time, \`order\`, overlap_tolerance_minutes, created_date, created_by)
         VALUES (?, ?, 'Standard', '07:00:00', '15:30:00', 0, 30, NOW(), 'migration')`,
        [slotId, wp.id]
      );
      stats.created++;

      // timeslots_enabled = TRUE setzen (falls Spalte existiert)
      if (hasTimeslotsEnabled) {
        // Prüfen, ob bereits TRUE (sicherheitshalber)
        const [currentWp] = await dbPool.execute(
          `SELECT timeslots_enabled FROM Workplace WHERE id = ? LIMIT 1`,
          [wp.id]
        );
        if (!currentWp[0]?.timeslots_enabled) {
          await dbPool.execute(
            `UPDATE Workplace SET timeslots_enabled = TRUE WHERE id = ?`,
            [wp.id]
          );
          stats.enabledFlagSet++;
        }
      }
    }
  } catch (error) {
    console.error('[ensureDefaultWorkplaceTimeslots] Fehler:', error.message);
    throw error;
  }

  return stats;
}
