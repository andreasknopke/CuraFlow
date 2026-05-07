-- Migration 017: Qualification.requires_certificate
-- Markiert Qualifikationen, für die ein Zertifikat (PDF/JPEG/PNG) hinterlegt werden muss.
-- Idempotent: ALTER TABLE wird vom Tenant-Auto-Migrator (server/utils/tenantMigrations.js)
-- mit Code-Behandlung für ER_DUP_FIELDNAME ausgeführt, sodass mehrfache Anwendung
-- ohne Fehler möglich ist.

ALTER TABLE Qualification
    ADD COLUMN requires_certificate BOOLEAN NOT NULL DEFAULT FALSE;
