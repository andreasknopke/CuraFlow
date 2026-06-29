-- Add timeslot_id column to shared_shift_entry for cross-tenant
-- Springerpool rotations with Früh-/Mittel-/Spätschicht.
-- Idempotent: only adds column if it doesn't exist.
-- The column is nullable — existing day-based shifts remain unaffected.

SET @dbname = DATABASE();
SET @colExists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = 'shared_shift_entry'
    AND COLUMN_NAME = 'timeslot_id');

SET @sql = IF(@colExists = 0,
  'ALTER TABLE shared_shift_entry
     ADD COLUMN timeslot_id VARCHAR(36) DEFAULT NULL AFTER billing_tenant_id,
     ADD INDEX idx_sse_workplace_date_timeslot (shared_workplace_id, date, timeslot_id)',
  'SELECT "Column timeslot_id already exists" AS status');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
