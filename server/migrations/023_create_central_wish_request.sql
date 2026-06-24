-- Migration 023: Zentrale Dienstwuensche fuer Verbundsdienste (cross-tenant wishes)
-- Diese Tabelle lebt in der MASTER-Datenbank und speichert Dienstwuensche
-- ("service" / "no_service") fuer Mitarbeiter, die an Verbundsdiensten
-- (shared_workplace / shared_shift_entry) beteiligt sind.
--
-- Die Pflege bleibt im Tenant-Frontend (Wunschbox), nur der Speicherort ist
-- zentral — analog zu CentralAbsenceEntry (Migration 021).
--
-- Das Feld `position` speichert die shared_workplace_id, fuer die der Wunsch
-- gilt (nicht den Workplace-Namen, da Namen sich aendern koennen). Der
-- Frontend-Code ermittelt den workplacespezifischen Wunsch ueber diese ID.
-- Fuer `no_service`-Wuensche, die alle Verbundsdienste eines Mitarbeiters
-- an einem Tag betreffen, bleibt `shared_workplace_id` NULL.

CREATE TABLE IF NOT EXISTS CentralWishRequest (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    shared_workplace_id VARCHAR(36) DEFAULT NULL,
    group_id INT DEFAULT NULL,
    date DATE NOT NULL,
    target_month VARCHAR(7) DEFAULT NULL,
    start_date DATE DEFAULT NULL,
    end_date DATE DEFAULT NULL,
    range_start DATE DEFAULT NULL,
    range_end DATE DEFAULT NULL,
    `position` VARCHAR(255) DEFAULT NULL,
    type VARCHAR(50) DEFAULT 'service',
    status VARCHAR(32) DEFAULT 'pending',
    priority VARCHAR(32) DEFAULT 'medium',
    reason TEXT DEFAULT NULL,
    admin_comment TEXT DEFAULT NULL,
    comment TEXT DEFAULT NULL,
    user_viewed TINYINT(1) DEFAULT 0,
    approved_by VARCHAR(255) DEFAULT NULL,
    approved_date DATETIME DEFAULT NULL,
    created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by VARCHAR(255) DEFAULT NULL,
    source_tenant_id VARCHAR(36) DEFAULT NULL,
    source_tenant_doctor_id VARCHAR(255) DEFAULT NULL,
    UNIQUE KEY uk_central_wish_employee_wp_date (employee_id, shared_workplace_id, date),
    INDEX idx_central_wish_employee (employee_id),
    INDEX idx_central_wish_workplace (shared_workplace_id),
    INDEX idx_central_wish_date (date),
    INDEX idx_central_wish_status (status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
