-- Migration: Create TeamRole table for configurable team roles/positions
-- Date: 2026-01-25

CREATE TABLE IF NOT EXISTS `TeamRole` (
    `id` VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    `name` VARCHAR(100) NOT NULL UNIQUE,
    `priority` INT NOT NULL DEFAULT 99,
    `is_specialist` BOOLEAN NOT NULL DEFAULT FALSE,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert default roles
INSERT INTO `TeamRole` (`name`, `priority`, `is_specialist`) VALUES
    ('Chefarzt', 0, TRUE),
    ('Oberarzt', 1, TRUE),
    ('Facharzt', 2, TRUE),
    ('Assistenzarzt', 3, FALSE),
    ('Nicht-Radiologe', 4, FALSE)
ON DUPLICATE KEY UPDATE `priority` = VALUES(`priority`), `is_specialist` = VALUES(`is_specialist`);
