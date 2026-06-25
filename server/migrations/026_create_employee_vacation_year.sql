-- Migration 026: Jahresspezifischer Urlaubsanspruch (Schicht-/Sonderurlaub)
--
-- Bisher ist der Urlaubsanspruch eine einzelne INT-Spalte
-- (Employee.vacation_days_annual), die unverändert für jedes Jahr gilt.
-- Tarifverträge kennen daneben aber Schicht- und Sonderurlaube, die pro
-- Jahr von der Personalabteilung festgelegt werden und in das Folgejahr
-- übertragen werden können (Resturlaubsübertrag NUR für diese Tage,
-- nicht für den regulären Jahresurlaub).
--
-- Daher brauchen wir eine separat pflegbare, jahresspezifische Tabelle.
-- Sie lebt in der MASTER-Datenbank, weil der Anspruch eine zentrale
-- Eigenschaft des Employees ist (genau wie vacation_days_annual). Tenant-
-- frontend liest/schreibt über die master-API.
--
-- Spalten:
--   shift_vacation_days   Manuell gepflegter Zusatzurlaub (Schicht/Sonder)
--                          fuer dieses Jahr. Default 0, weil in den meisten
--                          Jahren kein Zusatzurlaub anfaellt.
--   carried_over          TRUE, wenn der Wert des Vorjahres durch
--                          "Resturlaubsuebertrag" in dieses Jahr uebernommen
--                          wurde. Dient nur der Nachvollziehbarkeit im UI
--                          (kein Geschaeftsfilter).
--   carried_over_from_year NULL bei direkt eingetragenen Werten, ansonsten
--                          das Jahr, dessen Rest uebertragen wurde.
--
-- Idempotent (IF NOT EXISTS) — mehrfaches Ausführen ist sicher.

CREATE TABLE IF NOT EXISTS EmployeeVacationYear (
    employee_id VARCHAR(36) NOT NULL,
    year INT NOT NULL,
    shift_vacation_days INT NOT NULL DEFAULT 0,
    carried_over BOOLEAN NOT NULL DEFAULT FALSE,
    carried_over_from_year INT DEFAULT NULL,
    note TEXT,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) DEFAULT NULL,
    PRIMARY KEY (employee_id, year),
    INDEX idx_employee_vacation_year (employee_id),
    CONSTRAINT fk_employee_vacation_year_employee
        FOREIGN KEY (employee_id) REFERENCES Employee(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
