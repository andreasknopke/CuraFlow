-- Migration 028: Urlaubsantraege fuer Read-Only-User (Approval-Workflow)
-- Read-Only-User mit verknuepftem Mitarbeiter (EmployeeTenantAssignment) koennen
-- fuer die Typen Urlaub/Frei/Dienstreise (nur Zukunftstermine) Antraege stellen.
-- Der Admin genehmigt oder lehnt ab (im MyDashboard). Erst bei Approve wird der
-- Eintrag in CentralAbsenceEntry geschrieben.
--
-- Diese Tabelle lebt in der MASTER-Datenbank, weil der employee_id zentral ist
-- (analog zu CentralAbsenceEntry und CentralWishRequest).
--
-- Idempotent (IF NOT EXISTS) — mehrfaches Ausführen ist sicher.

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
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
