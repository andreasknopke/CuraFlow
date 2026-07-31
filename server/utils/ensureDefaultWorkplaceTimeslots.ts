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
import type { Pool, RowDataPacket } from 'mysql2/promise';

interface ColumnInfo extends RowDataPacket {
  Field: string;
}

interface SettingRow extends RowDataPacket {
  value: string;
}

interface WorkplaceRow extends RowDataPacket {
  id: string;
  name: string;
  category: string;
}

interface CountRow extends RowDataPacket {
  cnt: number | string;
}

interface TimeslotEnabledRow extends RowDataPacket {
  timeslots_enabled: number | boolean | null;
}

/**
 * Parst die workplace_categories aus SystemSetting JSON.
 * Handhabt sowohl Legacy-Format (String-Array) als auch aktuelles (Object-Array).
 *
 * @param rawValue - raw JSON value from SystemSetting
 * @returns Kategorie-Namen
 */
function parseWorkplaceCategories(rawValue: string | null | undefined): string[] {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((category: unknown) => {
        if (typeof category === 'string') return category.trim();
        if (category && typeof category === 'object' && typeof (category as Record<string, unknown>).name === 'string') {
          return String((category as Record<string, unknown>).name).trim();
        }
        return null;
      })
      .filter((category: string | null): category is string => Boolean(category));
  } catch {
    return [];
  }
}

interface TimeslotStats {
  processed: number;
  created: number;
  skipped: number;
  enabledFlagSet: number;
}

/**
 * Stellt Default-Timeslots für Rotation/Custom-Arbeitsplätze sicher.
 *
 * @param dbPool - Tenant-Datenbank-Pool
 * @param customCategoryNames - Namen benutzerdefinierter Kategorien (wird aus SystemSetting gelesen, wenn leer)
 * @returns Statistik über verarbeitete Workplaces
 */
export async function ensureDefaultWorkplaceTimeslots(dbPool: Pool, customCategoryNames: string[] = []): Promise<TimeslotStats> {
  const stats: TimeslotStats = { processed: 0, created: 0, skipped: 0, enabledFlagSet: 0 };

  // Falls keine customCategoryNames übergeben wurden, versuche aus SystemSetting zu lesen
  if (customCategoryNames.length === 0) {
    try {
      const [rows] = await dbPool.execute<SettingRow[]>(
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
    const [wpColumns] = await dbPool.execute<ColumnInfo[]>(
      `SHOW COLUMNS FROM Workplace LIKE 'timeslots_enabled'`
    );
    const hasTimeslotsEnabled = wpColumns.length > 0;

    // Workplaces der Ziel-Kategorien laden
    const catPlaceholders = effectiveCategories.map(() => '?').join(',');
    const [workplaces] = await dbPool.execute<WorkplaceRow[]>(
      `SELECT id, name, category FROM Workplace WHERE category IN (${catPlaceholders}) AND is_active = TRUE`,
      effectiveCategories
    );

    for (const wp of workplaces) {
      stats.processed++;

      // Prüfen, ob bereits ein Timeslot existiert
      const [existingSlots] = await dbPool.execute<CountRow[]>(
        `SELECT COUNT(*) AS cnt FROM WorkplaceTimeslot WHERE workplace_id = ?`,
        [wp.id]
      );

      if (Number(existingSlots[0]?.cnt || 0) > 0) {
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
        const [currentWp] = await dbPool.execute<TimeslotEnabledRow[]>(
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
    console.error('[ensureDefaultWorkplaceTimeslots] Fehler:', (error as Error).message);
    throw error;
  }

  return stats;
}
