-- Migration: Change allows_consecutive_days from BOOLEAN to VARCHAR(20)
-- Created: 2026-03-02
-- Feature: Dreifach-Modus für aufeinanderfolgende Dienst-Tage
--
-- Beschreibung:
-- Bisher: Boolean (true/false) – erlaubt oder verboten
-- Neu: Drei Modi:
--   'forbidden'  – Aufeinanderfolgende Tage verboten (alter Wert: false/0)
--   'allowed'    – Aufeinanderfolgende Tage erlaubt (alter Wert: true/1/NULL, Default)
--   'preferred'  – Aufeinanderfolgende Tage bevorzugt (neu, z.B. für Hintergrunddienste:
--                   ganzes Wochenende am Stück statt geteilter Wochenenden)

-- Step 1: Add new column
ALTER TABLE Workplace
ADD COLUMN IF NOT EXISTS consecutive_days_mode VARCHAR(20) DEFAULT 'allowed';

-- Step 2: Migrate existing boolean values
UPDATE Workplace SET consecutive_days_mode = 'forbidden' WHERE allows_consecutive_days = 0 OR allows_consecutive_days = FALSE;
UPDATE Workplace SET consecutive_days_mode = 'allowed' WHERE allows_consecutive_days = 1 OR allows_consecutive_days = TRUE OR allows_consecutive_days IS NULL;

-- Step 3: Drop old column (after verifying migration)
-- ALTER TABLE Workplace DROP COLUMN allows_consecutive_days;
-- Note: We keep the old column for now for backward compatibility.
-- The application reads consecutive_days_mode preferentially.
