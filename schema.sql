-- CuraFlow Database Schema
-- MySQL 5.7+
-- Run this to initialize your local database

CREATE DATABASE IF NOT EXISTS curaflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE curaflow;

-- Users table (JWT authentication)
CREATE TABLE IF NOT EXISTS `User` (
  `id` VARCHAR(36) PRIMARY KEY,
  `email` VARCHAR(255) UNIQUE NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(255),
  `role` VARCHAR(50) DEFAULT 'user',
  `is_active` BOOLEAN DEFAULT TRUE,
  `must_change_password` BOOLEAN DEFAULT FALSE,
  `last_login` DATETIME,
  `theme` VARCHAR(50) DEFAULT 'default',
  `section_config` JSON,
  `collapsed_sections` JSON,
  `schedule_hidden_rows` JSON,
  `schedule_show_sidebar` BOOLEAN DEFAULT TRUE,
  `highlight_my_name` BOOLEAN DEFAULT FALSE,
  `grid_font_size` VARCHAR(20) DEFAULT 'medium',
  `wish_show_occupied` BOOLEAN DEFAULT TRUE,
  `wish_show_absences` BOOLEAN DEFAULT TRUE,
  `wish_hidden_doctors` JSON,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_email (`email`),
  INDEX idx_role (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Doctors/Staff table
CREATE TABLE IF NOT EXISTS `Doctor` (
  `id` VARCHAR(36) PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `position` VARCHAR(100),
  `color` VARCHAR(50),
  `section` VARCHAR(100),
  `email` VARCHAR(255),
  `receive_email_notifications` BOOLEAN DEFAULT FALSE,
  `exclude_from_staffing_plan` BOOLEAN DEFAULT FALSE,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_name (`name`),
  INDEX idx_position (`position`),
  INDEX idx_section (`section`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Shift Entries (Schedule)
CREATE TABLE IF NOT EXISTS `ShiftEntry` (
  `id` VARCHAR(36) PRIMARY KEY,
  `doctor_id` VARCHAR(36),
  `date` DATE NOT NULL,
  `shift_type` VARCHAR(50),
  `workplace` VARCHAR(100),
  `notes` TEXT,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_doctor_id (`doctor_id`),
  INDEX idx_date (`date`),
  INDEX idx_shift_type (`shift_type`),
  INDEX idx_workplace (`workplace`),
  FOREIGN KEY (`doctor_id`) REFERENCES `Doctor`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Wish Requests (Vacation/Time off)
CREATE TABLE IF NOT EXISTS `WishRequest` (
  `id` VARCHAR(36) PRIMARY KEY,
  `doctor_id` VARCHAR(36),
  `date` DATE NOT NULL,
  `type` VARCHAR(50),
  `status` VARCHAR(50) DEFAULT 'pending',
  `notes` TEXT,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_doctor_id (`doctor_id`),
  INDEX idx_date (`date`),
  INDEX idx_status (`status`),
  FOREIGN KEY (`doctor_id`) REFERENCES `Doctor`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Workplaces
CREATE TABLE IF NOT EXISTS `Workplace` (
  `id` VARCHAR(36) PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL UNIQUE,
  `short_name` VARCHAR(50),
  `color` VARCHAR(50),
  `section` VARCHAR(100),
  `sort_order` INT DEFAULT 0,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_name (`name`),
  INDEX idx_section (`section`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Shift Notifications
CREATE TABLE IF NOT EXISTS `ShiftNotification` (
  `id` VARCHAR(36) PRIMARY KEY,
  `doctor_id` VARCHAR(36),
  `shift_entry_id` VARCHAR(36),
  `notification_type` VARCHAR(50),
  `sent_date` DATETIME,
  `user_viewed` BOOLEAN DEFAULT FALSE,
  `acknowledged` BOOLEAN DEFAULT FALSE,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_doctor_id (`doctor_id`),
  INDEX idx_sent_date (`sent_date`),
  FOREIGN KEY (`doctor_id`) REFERENCES `Doctor`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Demo Settings (On-call demo display)
CREATE TABLE IF NOT EXISTS `DemoSetting` (
  `id` VARCHAR(36) PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `active_days` JSON,
  `time` VARCHAR(20),
  `auto_off` BOOLEAN DEFAULT FALSE,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_name (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Training Rotations
CREATE TABLE IF NOT EXISTS `TrainingRotation` (
  `id` VARCHAR(36) PRIMARY KEY,
  `doctor_id` VARCHAR(36),
  `start_date` DATE,
  `end_date` DATE,
  `rotation_type` VARCHAR(100),
  `workplace` VARCHAR(100),
  `allows_rotation_concurrently` BOOLEAN DEFAULT FALSE,
  `allows_consecutive_days` BOOLEAN DEFAULT TRUE,
  `notes` TEXT,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_doctor_id (`doctor_id`),
  INDEX idx_start_date (`start_date`),
  INDEX idx_end_date (`end_date`),
  FOREIGN KEY (`doctor_id`) REFERENCES `Doctor`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Schedule Rules (AI rules)
CREATE TABLE IF NOT EXISTS `ScheduleRule` (
  `id` VARCHAR(36) PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `rule_type` VARCHAR(100),
  `description` TEXT,
  `priority` INT DEFAULT 0,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_rule_type (`rule_type`),
  INDEX idx_priority (`priority`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Color Settings
CREATE TABLE IF NOT EXISTS `ColorSetting` (
  `id` VARCHAR(36) PRIMARY KEY,
  `entity_type` VARCHAR(50),
  `entity_id` VARCHAR(36),
  `color` VARCHAR(50),
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_entity_type (`entity_type`),
  INDEX idx_entity_id (`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Schedule Notes
CREATE TABLE IF NOT EXISTS `ScheduleNote` (
  `id` VARCHAR(36) PRIMARY KEY,
  `date` DATE NOT NULL,
  `content` TEXT,
  `note_type` VARCHAR(50),
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_date (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- System Settings
CREATE TABLE IF NOT EXISTS `SystemSetting` (
  `id` VARCHAR(36) PRIMARY KEY,
  `setting_key` VARCHAR(255) UNIQUE NOT NULL,
  `setting_value` TEXT,
  `data_type` VARCHAR(50) DEFAULT 'string',
  `description` TEXT,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_setting_key (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Custom Holidays
CREATE TABLE IF NOT EXISTS `CustomHoliday` (
  `id` VARCHAR(36) PRIMARY KEY,
  `date` DATE NOT NULL,
  `name` VARCHAR(255),
  `is_recurring` BOOLEAN DEFAULT FALSE,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_date (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staffing Plan Entries
CREATE TABLE IF NOT EXISTS `StaffingPlanEntry` (
  `id` VARCHAR(36) PRIMARY KEY,
  `date` DATE NOT NULL,
  `year` INT,
  `month` INT,
  `shift_type` VARCHAR(50),
  `workplace` VARCHAR(100),
  `required_staff` INT DEFAULT 1,
  `show_in_service_plan` BOOLEAN DEFAULT TRUE,
  `notes` TEXT,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_date (`date`),
  INDEX idx_year_month (`year`, `month`),
  INDEX idx_shift_type (`shift_type`),
  INDEX idx_workplace (`workplace`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backup Logs
CREATE TABLE IF NOT EXISTS `BackupLog` (
  `id` VARCHAR(36) PRIMARY KEY,
  `backup_type` VARCHAR(50),
  `status` VARCHAR(50),
  `file_path` VARCHAR(500),
  `file_size` BIGINT,
  `error_message` TEXT,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_backup_type (`backup_type`),
  INDEX idx_created_date (`created_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- System Logs
CREATE TABLE IF NOT EXISTS `SystemLog` (
  `id` VARCHAR(36) PRIMARY KEY,
  `log_level` VARCHAR(20),
  `message` TEXT,
  `source` VARCHAR(255),
  `metadata` JSON,
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_log_level (`log_level`),
  INDEX idx_created_date (`created_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Voice Aliases
CREATE TABLE IF NOT EXISTS `VoiceAlias` (
  `id` VARCHAR(36) PRIMARY KEY,
  `alias` VARCHAR(255) NOT NULL,
  `entity_type` VARCHAR(50),
  `entity_id` VARCHAR(36),
  `entity_name` VARCHAR(255),
  `created_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` VARCHAR(255),
  INDEX idx_alias (`alias`),
  INDEX idx_entity_type (`entity_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default admin user (password: admin123)
-- Password hash for 'admin123' using bcrypt rounds=10
INSERT INTO `User` (`id`, `email`, `password_hash`, `full_name`, `role`, `must_change_password`, `created_by`)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'admin@curaflow.local', '$2a$10$CwTycUXWue0Thq9StjUM0uJ8VfEYKkXhEKt/ZLn8WKGkEqZqL0.JO', 'Administrator', 'admin', TRUE, 'system')
ON DUPLICATE KEY UPDATE `email` = `email`;

-- Insert some default system settings
INSERT INTO `SystemSetting` (`id`, `setting_key`, `setting_value`, `data_type`, `description`, `created_by`)
VALUES
  (UUID(), 'app_name', 'CuraFlow', 'string', 'Application name', 'system'),
  (UUID(), 'max_shifts_per_month', '15', 'number', 'Maximum shifts per doctor per month', 'system'),
  (UUID(), 'require_staffing_approval', 'false', 'boolean', 'Require approval for staffing changes', 'system')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;

-- Create indexes for better performance
ALTER TABLE `ShiftEntry` ADD INDEX idx_doctor_date (`doctor_id`, `date`);
ALTER TABLE `WishRequest` ADD INDEX idx_doctor_date (`doctor_id`, `date`);
ALTER TABLE `StaffingPlanEntry` ADD INDEX idx_date_workplace (`date`, `workplace`);

COMMIT;

-- Display setup completion message
SELECT 'Database schema created successfully!' as Status;
SELECT 'Default admin user: admin@curaflow.local / password: admin123 (change immediately!)' as Info;
