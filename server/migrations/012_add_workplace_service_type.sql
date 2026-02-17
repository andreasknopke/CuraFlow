-- Migration: Add service_type field to Workplace table
-- Created: 2026-02-17
-- Feature: Diensttyp (Bereitschaftsdienst/Rufbereitschaft/Schichtdienst/Andere) pro Dienst definierbar
--
-- Beschreibung:
-- Pro Dienst-Arbeitsplatz soll der Diensttyp konfigurierbar sein:
--   1 = Bereitschaftsdienst (Vordergrunddienst)
--   2 = Rufbereitschaftsdienst (Hintergrunddienst)
--   3 = Schichtdienst
--   4 = Andere Kategorie
--
-- Migration des Altsystems:
--   Der erste Dienst (nach order sortiert) bekommt Typ 1 (Bereitschaftsdienst),
--   alle weiteren Dienste bekommen Typ 2 (Rufbereitschaftsdienst).
--
-- NULL = kein Diensttyp gesetzt (Nicht-Dienst-Arbeitsplätze)

-- Add service_type column (nullable, only relevant for category='Dienste')
ALTER TABLE Workplace
ADD COLUMN IF NOT EXISTS service_type INT DEFAULT NULL;

-- Migrate existing data: first service (by order) gets type 1, all others get type 2
-- This uses a subquery to find the minimum order among Dienste workplaces
UPDATE Workplace
SET service_type = CASE
    WHEN `order` = (
        SELECT min_order FROM (
            SELECT MIN(COALESCE(`order`, 0)) AS min_order
            FROM Workplace
            WHERE category = 'Dienste'
        ) AS sub
    ) THEN 1
    ELSE 2
END
WHERE category = 'Dienste' AND service_type IS NULL;
