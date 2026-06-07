-- Migration 022: Mitarbeiterbeziehungen (Lebensgemeinschaft / Dienstkonflikt)
-- Erlaubt die Definition von Beziehungen zwischen zentralen Mitarbeitern,
-- z.B. Lebensgemeinschaften, bei denen ein Dienstkonflikt (kein gleichzeitiger
-- Dienst) konfiguriert werden kann. Die eigentliche Konfliktlogik im
-- ScheduleBoard folgt in einem separaten Schritt.

CREATE TABLE IF NOT EXISTS EmployeeRelationship (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    related_employee_id VARCHAR(36) NOT NULL,
    relationship_type VARCHAR(100) NOT NULL DEFAULT 'lebensgemeinschaft',
    shift_conflict BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by VARCHAR(255) DEFAULT NULL,
    UNIQUE KEY uk_relationship_pair (employee_id, related_employee_id),
    INDEX idx_relationship_employee (employee_id),
    INDEX idx_relationship_related (related_employee_id),
    CONSTRAINT fk_relationship_employee FOREIGN KEY (employee_id) REFERENCES Employee(id) ON DELETE CASCADE,
    CONSTRAINT fk_relationship_related FOREIGN KEY (related_employee_id) REFERENCES Employee(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
