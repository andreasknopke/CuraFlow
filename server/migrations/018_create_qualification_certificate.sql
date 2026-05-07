-- Migration 018: QualificationCertificate (Master-DB, multi-tenant)
-- Speichert Zertifikatsdateien (PDF/JPEG/PNG) zentral. Mandantentrennung über
-- tenant_key = sha256(host:database) des jeweiligen Tenant-DB-Tokens.
-- Idempotent (CREATE TABLE IF NOT EXISTS); wird zusätzlich beim Server-Start
-- über server/utils/masterMigrations.js automatisch ausgeführt.

CREATE TABLE IF NOT EXISTS QualificationCertificate (
    id VARCHAR(36) PRIMARY KEY,
    tenant_key VARCHAR(64) NOT NULL,
    doctor_id VARCHAR(255) NOT NULL,
    qualification_id VARCHAR(255) NOT NULL,
    doctor_qualification_id VARCHAR(255) DEFAULT NULL,
    evidence_role VARCHAR(32) DEFAULT 'single',
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INT NOT NULL,
    file_data MEDIUMBLOB NOT NULL,
    granted_date DATE DEFAULT NULL,
    expiry_date DATE DEFAULT NULL,
    notes VARCHAR(500) DEFAULT NULL,
    uploaded_by VARCHAR(36) DEFAULT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_qc_tenant (tenant_key),
    INDEX idx_qc_doctor (tenant_key, doctor_id),
    INDEX idx_qc_qual (tenant_key, qualification_id),
    INDEX idx_qc_expiry (tenant_key, expiry_date)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
