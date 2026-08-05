/**
 * Rotation-Assignment-Guard.
 *
 * Verhindert, dass ein Mitarbeiter, der am Zieldatum im Abwesenheitskalender
 * als "Nicht verfügbar" eingetragen ist, still in eine Pool-Rotation eingeteilt
 * wird (Drag-Drop, Dialog ODER API-Aufruf). "Nicht verfügbar" blockiert wie
 * "Frei" — per Override überschreibbar, aber nicht unbemerkt.
 *
 * Die Abwesenheit kann an zwei Orten liegen:
 *  1. lokal im Tenant des Mitarbeiters (ShiftEntry mit doctor_id = lokale ID)
 *  2. zentral in der Master-DB (CentralAbsenceEntry mit employee_id = zentrale
 *     UUID) — für verknüpfte Mitarbeiter (Linked Doctors).
 *
 * Der Guard ist fail-open: fehlende Tabellen (frische Installation) oder
 * einzelne Lesefehler blockieren die Einteilung nicht, solange keine
 * Abwesenheit gefunden wird. Nur ein tatsächlicher "Nicht verfügbar"-Eintrag
 * führt zu einem Treffer.
 */
import type { Pool, RowDataPacket } from 'mysql2/promise';

/**
 * Normalisiert eine Positionsbezeichnung für den Vergleich:
 * trimmt, kleingeschrieben, Umlaute entfernt ("Nicht verfügbar" → "nicht verfugbar").
 */
export function normalizePosition(position: unknown): string {
  return String(position ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Alle normalisierten Schreibweisen von "Nicht verfügbar" — die NFD-Normalisierung
 * entfernt nur echte Umlaute (ü→u), nicht die ASCII-Umschreibung "ue".
 */
const UNAVAILABLE_NORMALIZED_VARIANTS = new Set<string>([
  normalizePosition('Nicht verfügbar'),  // 'nicht verfugbar'
  normalizePosition('nicht verfuegbar'), // 'nicht verfuegbar'
]);

/**
 * True, wenn die Position eine "Nicht verfügbar"-Abwesenheit ist —
 * unabhängig von Schreibweise/Umlauten ('Nicht verfügbar', 'nicht verfuegbar', …).
 */
export function isUnavailablePosition(position: unknown): boolean {
  return UNAVAILABLE_NORMALIZED_VARIANTS.has(normalizePosition(position));
}

export interface BlockingAbsence {
  /** Die gefundene Positionsbezeichnung (Original-Schreibweise aus der DB). */
  position: string;
  /** Woher der Eintrag stammt. */
  source: 'tenant' | 'central';
}

export interface FindUnavailableAbsenceParams {
  /** Master-DB-Pool (CentralAbsenceEntry). */
  masterDb: Pool;
  /** Tenant-DB-Pool des anfragenden Users (Doctor/ShiftEntry). */
  tenantDb?: Pool | null;
  /** employee_id des Assignments — lokale Doctor.id ODER zentrale UUID. */
  employeeId: string;
  /** Zieldatum als YYYY-MM-DD. */
  date: string;
}

/**
 * Prüft, ob der Mitarbeiter am Zieldatum als "Nicht verfügbar" eingetragen ist.
 * Gibt den ersten Treffer zurück ({ position, source }) oder null.
 */
export async function findUnavailableAbsenceForAssignment({
  masterDb,
  tenantDb,
  employeeId,
  date,
}: FindUnavailableAbsenceParams): Promise<BlockingAbsence | null> {
  const centralIds = new Set<string>([String(employeeId)]);

  // 1) Lokale Tenant-Abwesenheit (ShiftEntry) — employeeId ist eine lokale Doctor.id
  if (tenantDb) {
    try {
      const [docRows] = await tenantDb.execute<RowDataPacket[]>(
        'SELECT id, central_employee_id FROM Doctor WHERE id = ? LIMIT 1',
        [String(employeeId)]
      );
      if (docRows.length > 0) {
        const centralId = docRows[0].central_employee_id;
        if (centralId) centralIds.add(String(centralId));

        const [shiftRows] = await tenantDb.execute<RowDataPacket[]>(
          'SELECT position FROM ShiftEntry WHERE doctor_id = ? AND date = ?',
          [String(employeeId), date]
        );
        for (const row of shiftRows) {
          if (isUnavailablePosition(row.position)) {
            return { position: String(row.position), source: 'tenant' };
          }
        }
      }
    } catch {
      // Tenant-Tabellen ggf. nicht vorhanden → zentrale Prüfung genügt
    }
  }

  // 2) Zentrale Abwesenheit (CentralAbsenceEntry) — employeeId selbst kann
  //    bereits die zentrale UUID sein (Springer/Joker), sonst die des Doctors.
  try {
    const placeholders = [...centralIds].map(() => '?').join(',');
    const [absRows] = await masterDb.execute<RowDataPacket[]>(
      `SELECT position FROM CentralAbsenceEntry WHERE employee_id IN (${placeholders}) AND date = ?`,
      [...centralIds, date]
    );
    for (const row of absRows) {
      if (isUnavailablePosition(row.position)) {
        return { position: String(row.position), source: 'central' };
      }
    }
  } catch {
    // CentralAbsenceEntry ggf. noch nicht vorhanden (frische Installation)
  }

  return null;
}
