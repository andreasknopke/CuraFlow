-- Migration: Create TimeslotTemplate table
-- Diese Tabelle speichert benutzerdefinierte Timeslot-Templates für Wiederverwendung

CREATE TABLE IF NOT EXISTS TimeslotTemplate (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(100) NOT NULL,
    slots_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
