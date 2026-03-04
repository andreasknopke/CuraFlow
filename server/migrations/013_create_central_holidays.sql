-- Migration 013: Zentrale Feiertage- und Ferienverwaltung
-- Diese Tabellen werden in der MASTER-Datenbank erstellt (nicht in Tenant-DBs).
-- Feiertage und Ferien werden zentral verwaltet und an alle Mandanten weitergegeben.

-- Zentrale Einstellungen für Feiertage/Ferien
CREATE TABLE IF NOT EXISTS holiday_settings (
    `key` VARCHAR(100) PRIMARY KEY,
    `value` TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Standardwerte einfügen
INSERT IGNORE INTO holiday_settings (`key`, `value`) VALUES 
    ('federal_state', 'MV'),
    ('show_school_holidays', 'true');

-- Zentrale manuelle Korrekturen (Feiertage/Ferien hinzufügen oder entfernen)
CREATE TABLE IF NOT EXISTS custom_holidays (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE DEFAULT NULL,
    type ENUM('public', 'school') NOT NULL DEFAULT 'public',
    action ENUM('add', 'remove') NOT NULL DEFAULT 'add',
    created_by VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
