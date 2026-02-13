-- Migration 011: Qualification/Berechtigung System
-- Creates dynamic qualifications that can be assigned to doctors
-- and required by workplaces/shifts

-- Table for qualification definitions
CREATE TABLE IF NOT EXISTS Qualification (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    short_label VARCHAR(10) DEFAULT NULL,
    description VARCHAR(255) DEFAULT NULL,
    color_bg VARCHAR(20) DEFAULT '#e0e7ff',
    color_text VARCHAR(20) DEFAULT '#3730a3',
    category VARCHAR(50) DEFAULT 'Allgemein',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    `order` INT NOT NULL DEFAULT 99,
    created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by VARCHAR(255) DEFAULT 'system'
);

-- Junction table: Doctor <-> Qualification (many-to-many)
CREATE TABLE IF NOT EXISTS DoctorQualification (
    id VARCHAR(255) PRIMARY KEY,
    doctor_id VARCHAR(255) NOT NULL,
    qualification_id VARCHAR(255) NOT NULL,
    granted_date DATE DEFAULT NULL,
    expiry_date DATE DEFAULT NULL,
    notes VARCHAR(255) DEFAULT NULL,
    created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by VARCHAR(255) DEFAULT 'system',
    UNIQUE KEY uq_doctor_qual (doctor_id, qualification_id),
    INDEX idx_doctor (doctor_id),
    INDEX idx_qualification (qualification_id)
);

-- Junction table: Workplace <-> Qualification (required qualifications per workplace/shift)
CREATE TABLE IF NOT EXISTS WorkplaceQualification (
    id VARCHAR(255) PRIMARY KEY,
    workplace_id VARCHAR(255) NOT NULL,
    qualification_id VARCHAR(255) NOT NULL,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    created_by VARCHAR(255) DEFAULT 'system',
    UNIQUE KEY uq_workplace_qual (workplace_id, qualification_id),
    INDEX idx_workplace (workplace_id),
    INDEX idx_qualification (qualification_id)
);
