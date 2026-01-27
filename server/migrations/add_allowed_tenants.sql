-- Add allowed_tenants column to app_users table
-- This allows restricting users to specific database tenants
-- NULL or empty array means user has access to all tenants (for backwards compatibility)

ALTER TABLE app_users 
ADD COLUMN IF NOT EXISTS allowed_tenants JSON DEFAULT NULL;

-- Add index for better query performance when filtering by tenant
-- Note: JSON columns can't be directly indexed, but this comment documents the intended usage
