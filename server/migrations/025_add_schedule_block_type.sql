-- Add type column to ScheduleBlock to support 'block' and 'info' types
-- 'block' = cell is locked (existing behavior)
-- 'info'  = cell has an informational note (new), does not lock the cell

ALTER TABLE ScheduleBlock
  ADD COLUMN type VARCHAR(10) DEFAULT 'block' AFTER reason;

-- Update unique key to include type, so a cell can have both a block and an info entry
ALTER TABLE ScheduleBlock DROP INDEX unique_block;
ALTER TABLE ScheduleBlock ADD UNIQUE KEY unique_block (date, position, timeslot_id, type);
