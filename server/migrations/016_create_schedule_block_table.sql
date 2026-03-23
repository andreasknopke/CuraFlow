-- ScheduleBlock: Zellen im Wochenplan sperren (z.B. Wartung, Defekt)
CREATE TABLE IF NOT EXISTS ScheduleBlock (
  id VARCHAR(36) PRIMARY KEY,
  date DATE NOT NULL,
  position VARCHAR(255) NOT NULL,
  timeslot_id VARCHAR(36) DEFAULT NULL,
  reason VARCHAR(500) DEFAULT NULL,
  created_by VARCHAR(255) DEFAULT NULL,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_block (date, position, timeslot_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
