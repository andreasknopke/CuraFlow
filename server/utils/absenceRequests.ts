/**
 * Pure (no-Express) helper for absence requests (Read-Only-User → Approval).
 *
 * Read-Only-User mit verlinktem central_employee_id-Mitarbeiter koennen fuer
 * Urlaub/Frei/Dienstreise Zukunftstermine als Antrag einreichen. Der Admin
 * genehmigt oder lehnt ab. Erst bei Approbe wird in die CentralAbsenceEntry
 * geschrieben.
 *
 * Lebenszyklus:
 *   pending  → approved  (INSERT INTO CentralAbsenceEntry + Status-Update)
 *   pending  → rejected  (nur Status-Update + admin_comment)
 *   rejected → (kein Uebergang; neuer Antrag fuer gleiches Datum moeglich,
 *               weil rejected den Unique-Key nicht blockiert – der
 *               UNIQUE-Key (employee_id, date) in CentralAbsenceEntry
 *               entscheidet ueber die Sichtbarkeit)
 *
 * @module utils/absenceRequests
 */

import crypto from 'crypto';
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

// ─── Row shapes ──────────────────────────────────────────────────────────────

interface AbsenceRequestRow extends RowDataPacket {
  id: string;
  employee_id: string;
  source_tenant_id: string | null;
  source_tenant_doctor_id: string | null;
  date: Date | string;
  position: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  admin_comment: string | null;
  user_viewed: number;
  approved_by: string | null;
  approved_date: Date | string | null;
  created_by: string | null;
  created_date: Date | string;
  updated_date: Date | string;
}

interface AbsenceRequestIdStatusRow extends RowDataPacket {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
}

// ─── Table guard (einmal pro Process) ────────────────────────────────────────

let absenceRequestTableEnsured = false;

export async function ensureAbsenceRequestTables(masterDb: Pool): Promise<void> {
  if (absenceRequestTableEnsured) return;
  await masterDb.execute(`
    CREATE TABLE IF NOT EXISTS AbsenceRequest (
      id VARCHAR(36) PRIMARY KEY,
      employee_id VARCHAR(36) NOT NULL,
      source_tenant_id VARCHAR(36) DEFAULT NULL,
      source_tenant_doctor_id VARCHAR(255) DEFAULT NULL,
      date DATE NOT NULL,
      position VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      reason TEXT DEFAULT NULL,
      admin_comment TEXT DEFAULT NULL,
      user_viewed TINYINT(1) DEFAULT 0,
      approved_by VARCHAR(255) DEFAULT NULL,
      approved_date DATETIME DEFAULT NULL,
      created_by VARCHAR(255) DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uk_absence_request_employee_date (employee_id, date),
      INDEX idx_absence_request_employee (employee_id),
      INDEX idx_absence_request_status (status),
      INDEX idx_absence_request_date (date),
      INDEX idx_absence_request_source_tenant (source_tenant_id),
      CONSTRAINT fk_absence_request_employee
        FOREIGN KEY (employee_id) REFERENCES Employee(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  absenceRequestTableEnsured = true;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Abwesenheitstypen, die Read-Only-User beantragen duerfen.
 * Krank/Fortbildung etc. bleiben Admin vorbehalten.
 */
export const REQUEST_ABSENCE_POSITIONS: string[] = ['Urlaub', 'Frei', 'Dienstreise'];
export const REQUEST_ABSENCE_POSITIONS_SET = new Set(REQUEST_ABSENCE_POSITIONS);

/**
 * Erlaubte Stati eines Antrags.
 */
export const REQUEST_STATUSES: string[] = ['pending', 'approved', 'rejected'];

/**
 * Whitelist der Spalten, die ueber die API beschreibbar sind.
 * Nie req.body blind spreaden — Sicherheitsmassnahme analog
 * CENTRAL_WISH_WRITABLE_COLUMNS in centralWishes.js.
 */
export const ABSENCE_REQUEST_WRITABLE_COLUMNS = new Set([
  'employee_id',
  'source_tenant_id',
  'source_tenant_doctor_id',
  'date',
  'position',
  'status',
  'reason',
  'admin_comment',
  'user_viewed',
  'approved_by',
  'approved_date',
  'created_by',
]);

// ─── Helper: Abwesenheitstyp validieren ──────────────────────────────────────

export function isRequestableAbsencePosition(position: unknown): boolean {
  if (!position || typeof position !== 'string') return false;
  return REQUEST_ABSENCE_POSITIONS_SET.has(position);
}

// ─── Helper: Future-Datum validieren ─────────────────────────────────────────

export function isFutureDate(dateStr: unknown): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  // ISO-Datum yyyy-mm-dd parsen
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return false;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  // Pruefen, ob das Datum valide ist
  if (d.getFullYear() !== parts[0] || d.getMonth() !== parts[1] - 1 || d.getDate() !== parts[2]) {
    return false;
  }
  // Future: > heute (Mitternacht heute)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d > today;
}

function getErrorCode(err: unknown): string | undefined {
  if (err instanceof Error && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return undefined;
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

interface CreateAbsenceRequestDeps {
  masterDb: Pool;
  tenantId: string | null | undefined;
  tenantDoctorId: string | null | undefined;
  employeeId: string;
  date: string;
  position: string;
  reason?: string | null;
  createdBy: string | null | undefined;
}

/**
 * Erstellt einen neuen AbsenceRequest.
 *
 * @param {Object} deps
 * @param {import('mysql2/promise').Pool} deps.masterDb
 * @param {string} deps.tenantId       - Source-Tenant (aus x-db-token)
 * @param {string} deps.tenantDoctorId - Tenant-lokale Doctor.id
 * @param {string} deps.employeeId     - Zentrale Employee.id (aus EmployeeTenantAssignment)
 * @param {string} deps.date           - ISO-Datum (yyyy-mm-dd), muss in der Zukunft liegen
 * @param {string} deps.position       - Einer aus REQUEST_ABSENCE_POSITIONS
 * @param {string} [deps.reason]       - Optionaler Grund
 * @param {string} deps.createdBy      - User-ID (req.user.sub)
 * @returns {Promise<Object>} Der angelegte Antrag als DB-Zeile
 * @throws {Error} mit .statusCode = 422 bei Validierungsfehlern, 409 bei Duplikat
 */
export async function createAbsenceRequest({
  masterDb,
  tenantId,
  tenantDoctorId,
  employeeId,
  date,
  position,
  reason,
  createdBy,
}: CreateAbsenceRequestDeps): Promise<AbsenceRequestRow> {
  // Validierung
  if (!employeeId || typeof employeeId !== 'string') {
    const err = new Error('Mitarbeiter-ID (employee_id) ist erforderlich.');
    (err as Error & { statusCode?: number }).statusCode = 422;
    throw err;
  }
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const err = new Error('Datum (yyyy-mm-dd) ist erforderlich.');
    (err as Error & { statusCode?: number }).statusCode = 422;
    throw err;
  }
  if (!isFutureDate(date)) {
    const err = new Error('Das Datum muss in der Zukunft liegen.');
    (err as Error & { statusCode?: number }).statusCode = 422;
    throw err;
  }
  if (!isRequestableAbsencePosition(position)) {
    const err = new Error(
      `Unzulaessige Position: "${position}". Erlaubt: ${REQUEST_ABSENCE_POSITIONS.join(', ')}.`
    );
    (err as Error & { statusCode?: number }).statusCode = 422;
    throw err;
  }

  await ensureAbsenceRequestTables(masterDb);

  const id = crypto.randomUUID();
  const row: Record<string, string | number | null> = {
    id,
    employee_id: employeeId,
    source_tenant_id: tenantId || null,
    source_tenant_doctor_id: tenantDoctorId || null,
    date,
    position,
    status: 'pending',
    reason: reason || null,
    user_viewed: 0,
    created_by: createdBy || null,
  };

  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  const colList = columns.join(', ');

  try {
    await masterDb.execute<ResultSetHeader>(
      `INSERT INTO AbsenceRequest (${colList}) VALUES (${placeholders})`,
      columns.map((k) => row[k])
    );
  } catch (err) {
    if (getErrorCode(err) === 'ER_DUP_ENTRY') {
      // Prüfen, ob ein bestehender nicht-pending Eintrag überschrieben werden kann.
      // Wenn der existierende Antrag rejected oder approved ist, darf ein neuer
      // Antrag (andere Position) diesen ersetzen — der alte Antrag gilt als erledigt.
      const [existing] = await masterDb.execute<AbsenceRequestIdStatusRow[]>(
        'SELECT id, status FROM AbsenceRequest WHERE employee_id = ? AND date = ? LIMIT 1',
        [employeeId, date]
      );
      if (existing.length > 0 && existing[0].status === 'pending') {
        const conflict = new Error(
          'Fuer diesen Mitarbeiter existiert an diesem Datum bereits ein ausstehender Antrag.'
        );
        (conflict as Error & { statusCode?: number }).statusCode = 409;
        throw conflict;
      }

      // existing ist nicht pending (rejected oder approved) → überschreiben
      const existingId = existing[0].id;
      await masterDb.execute<ResultSetHeader>(
        `UPDATE AbsenceRequest
            SET position = ?, reason = ?, status = 'pending',
                created_by = ?, user_viewed = 0,
                admin_comment = NULL, approved_by = NULL, approved_date = NULL,
                updated_date = NOW()
          WHERE id = ?`,
        [position, reason || null, createdBy || null, existingId]
      );

      const [rows] = await masterDb.execute<AbsenceRequestRow[]>(
        'SELECT * FROM AbsenceRequest WHERE id = ? LIMIT 1',
        [existingId]
      );
      return rows[0];
    }
    throw err;
  }

  const [rows] = await masterDb.execute<AbsenceRequestRow[]>(
    'SELECT * FROM AbsenceRequest WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0];
}

// ─── LIST (tenant-scoped) ────────────────────────────────────────────────────

interface ListAbsenceRequestsDeps {
  masterDb: Pool;
  tenantId: string | null | undefined;
  doctorId?: string | number | null;
  status?: string | null;
  year?: number | string | null;
}

/**
 * Listet AbsenceRequests fuer einen Tenant.
 *
 * @param {Object} deps
 * @param {import('mysql2/promise').Pool} deps.masterDb
 * @param {string} deps.tenantId        - Tenant-ID (aus x-db-token)
 * @param {string} [deps.doctorId]      - Wenn gesetzt, nur Antraege dieses Tenant-Doctors
 * @param {string} [deps.status]        - Filter auf Status (optional)
 * @param {number|string} [deps.year]   - Filter auf Jahr (optional)
 * @returns {Promise<Object[]>} Liste der Antraege
 */
export async function listAbsenceRequests({
  masterDb,
  tenantId,
  doctorId,
  status,
  year,
}: ListAbsenceRequestsDeps): Promise<AbsenceRequestRow[]> {
  if (!tenantId) return [];

  await ensureAbsenceRequestTables(masterDb);

  const conditions: string[] = ['source_tenant_id = ?'];
  const params: (string | number)[] = [tenantId];

  if (doctorId) {
    conditions.push('source_tenant_doctor_id = ?');
    params.push(String(doctorId));
  }

  if (status && REQUEST_STATUSES.includes(status)) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (year) {
    const y = parseInt(String(year), 10);
    if (Number.isFinite(y) && y > 1970 && y < 3000) {
      conditions.push('YEAR(date) = ?');
      params.push(y);
    }
  }

  const sql = `SELECT * FROM AbsenceRequest WHERE ${conditions.join(' AND ')} ORDER BY created_date DESC`;

  const [rows] = await masterDb.execute<AbsenceRequestRow[]>(sql, params);
  return rows;
}

// ─── UPDATE STATUS (transaktional: Approve → CentralAbsenceEntry) ───────────

interface UpdateAbsenceRequestStatusDeps {
  masterDb: Pool;
  requestId: string;
  status: string;
  adminUserId: string | null | undefined;
  adminComment?: string | null;
}

/**
 * Aktualisiert den Status eines AbsenceRequest.
 * Bei `approved` wird transaktional ein CentralAbsenceEntry angelegt.
 *
 * @param {Object} deps
 * @param {import('mysql2/promise').Pool} deps.masterDb
 * @param {string} deps.requestId   - AbsenceRequest.id
 * @param {string} deps.status      - 'approved' | 'rejected'
 * @param {string} deps.adminUserId - ID des genehmigenden Admins
 * @param {string} [deps.adminComment] - Optionaler Kommentar
 * @returns {Promise<Object>} Der aktualisierte Antrag
 * @throws {Error} mit .statusCode = 404/409/422 bei Fehlern
 */
export async function updateAbsenceRequestStatus({
  masterDb,
  requestId,
  status,
  adminUserId,
  adminComment,
}: UpdateAbsenceRequestStatusDeps): Promise<AbsenceRequestRow> {
  if (!requestId) {
    const err = new Error('requestId ist erforderlich.');
    (err as Error & { statusCode?: number }).statusCode = 422;
    throw err;
  }
  if (!status || !['approved', 'rejected'].includes(status)) {
    const err = new Error("Status muss 'approved' oder 'rejected' sein.");
    (err as Error & { statusCode?: number }).statusCode = 422;
    throw err;
  }

  await ensureAbsenceRequestTables(masterDb);

  // Aktuellen Antrag laden
  const [existing] = await masterDb.execute<AbsenceRequestRow[]>(
    'SELECT * FROM AbsenceRequest WHERE id = ? LIMIT 1',
    [requestId]
  );
  if (existing.length === 0) {
    const err = new Error('Antrag nicht gefunden.');
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }

  const request = existing[0];

  if (request.status !== 'pending') {
    const err = new Error(
      `Antrag hat bereits Status "${request.status}". Nur pending-Antraege koennen bearbeitet werden.`
    );
    (err as Error & { statusCode?: number }).statusCode = 409;
    throw err;
  }

  // Transaktion: Status-Update + ggf. CentralAbsenceEntry anlegen
  const connection: PoolConnection = await masterDb.getConnection();
  try {
    await connection.beginTransaction();

    // Status-Update
    await connection.execute<ResultSetHeader>(
      `UPDATE AbsenceRequest
          SET status = ?, approved_by = ?, approved_date = NOW(),
              admin_comment = COALESCE(?, admin_comment),
              updated_date = NOW()
        WHERE id = ?`,
      [status, adminUserId || null, adminComment || null, requestId]
    );

    if (status === 'approved') {
      // CentralAbsenceEntry anlegen (oder aktualisieren, falls bereits vorhanden).
      // ON DUPLICATE KEY UPDATE: falls fuer employee_id + date bereits ein Eintrag
      // existiert (z.B. Admin hat direkt eingetragen), wird die Position ueberschrieben.
      // Das ist gewollt — der genehmigte Antrag ist die autoritative Quelle.
      const entryId = crypto.randomUUID();
      await connection.execute<ResultSetHeader>(
        `INSERT INTO CentralAbsenceEntry (id, employee_id, date, position, note, source_tenant_id, source_tenant_doctor_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           position = VALUES(position),
           note = COALESCE(VALUES(note), note),
           source_tenant_id = VALUES(source_tenant_id),
           source_tenant_doctor_id = VALUES(source_tenant_doctor_id),
           updated_date = NOW()`,
        [
          entryId,
          request.employee_id,
          request.date,
          request.position,
          request.reason ? `Genehmigter Antrag: ${request.reason}` : 'Genehmigter Antrag',
          request.source_tenant_id,
          request.source_tenant_doctor_id,
          adminUserId || null,
        ]
      );
    }

    await connection.commit();

    // Aktualisierten Antrag zurueckgeben
    const [updated] = await masterDb.execute<AbsenceRequestRow[]>(
      'SELECT * FROM AbsenceRequest WHERE id = ? LIMIT 1',
      [requestId]
    );
    return updated[0];
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

interface DeleteAbsenceRequestDeps {
  masterDb: Pool;
  requestId: string;
}

/**
 * Loescht einen AbsenceRequest (nur im pending/rejected-Status).
 *
 * @param {Object} deps
 * @param {import('mysql2/promise').Pool} deps.masterDb
 * @param {string} deps.requestId
 * @returns {Promise<boolean>} true wenn geloescht, false wenn nicht vorhanden
 * @throws {Error} mit .statusCode = 422 wenn Status approved
 */
export async function deleteAbsenceRequest({
  masterDb,
  requestId,
}: DeleteAbsenceRequestDeps): Promise<boolean> {
  if (!requestId) {
    const err = new Error('requestId ist erforderlich.');
    (err as Error & { statusCode?: number }).statusCode = 422;
    throw err;
  }

  await ensureAbsenceRequestTables(masterDb);

  const [existing] = await masterDb.execute<AbsenceRequestIdStatusRow[]>(
    'SELECT id, status FROM AbsenceRequest WHERE id = ? LIMIT 1',
    [requestId]
  );
  if (existing.length === 0) return false;

  if (existing[0].status === 'approved') {
    const err = new Error(
      'Bereits genehmigte Antraege koennen nicht geloescht werden. Bitte entfernen Sie den Urlaubseintrag direkt.'
    );
    (err as Error & { statusCode?: number }).statusCode = 422;
    throw err;
  }

  await masterDb.execute<ResultSetHeader>('DELETE FROM AbsenceRequest WHERE id = ?', [requestId]);
  return true;
}
