-- Migration: Create StaffingPlanNote table for yearly employee notes in staffing plan
-- Created: 2026-06-25
-- Feature: Freifeld für Notizen pro Mitarbeiter im Stellenplan (z.B. "Plant in Elternzeit zu gehen")

CREATE TABLE IF NOT EXISTS StaffingPlanNote (
    id VARCHAR(36) PRIMARY KEY,
    doctor_id VARCHAR(36) DEFAULT NULL,
    year INT NOT NULL,
    note TEXT,
    created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by VARCHAR(255) DEFAULT 'seed',
    
    INDEX idx_staffing_note_doctor_year (doctor_id, year)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
