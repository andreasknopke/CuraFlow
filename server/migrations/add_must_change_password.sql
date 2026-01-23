-- Add must_change_password column to app_users table
-- This column indicates if a user must change their password on next login

ALTER TABLE app_users 
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

-- Update all users who still have the default password to require password change
-- Note: This is a placeholder - admin should manually set this flag for users with default passwords
UPDATE app_users 
SET must_change_password = TRUE 
WHERE password_hash = '$2a$12$...' -- Replace with actual hash of 'CuraFlow2026!' if needed
AND must_change_password IS NULL;

-- Optional: Set flag for specific users by email
-- UPDATE app_users SET must_change_password = TRUE WHERE email IN ('user1@example.com', 'user2@example.com');
