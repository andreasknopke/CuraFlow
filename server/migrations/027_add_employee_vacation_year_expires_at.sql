-- Migration 027: Verfallsdatum für übertragenen Schichturlaub
--
-- Übertragener Schichturlaub (carried_over = TRUE) verfällt am 31.03.
-- des Zieljahres. Die Spalte expires_at wird beim carryOverShiftVacation
-- automatisch auf {toYear}-03-31 gesetzt. Der dynamische Carry-Adjustment-
-- Mechanismus in getShiftVacationEntitlement berücksichtigt expirierte
-- Tage automatisch: nach dem 31.03. ist der effektive Rest 0.
--
-- Bestehende Datensätze erhalten NULL (kein rückwirkender Verfall).
-- NULL bedeutet "kein Verfallsdatum" – das betrifft manuell eingetragene
-- Zusatzurlaube, die nicht übertragen wurden.
--
-- Idempotent (IF NOT EXISTS) – mehrfaches Ausführen ist sicher.

ALTER TABLE EmployeeVacationYear
  ADD COLUMN IF NOT EXISTS expires_at DATE DEFAULT NULL;

-- Da IF NOT EXISTS für ALTER TABLE in älteren MySQL-Versionen nicht
-- unterstützt wird, verwenden wir den idempotenten Mechanismus in
-- masterMigrations.js (addColumnIfMissing). Dieses SQL-File dient
-- als dokumentierte Referenz für manuelle Migrationen.
