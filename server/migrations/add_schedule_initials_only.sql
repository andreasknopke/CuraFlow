-- Add schedule_initials_only column to app_users table
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS schedule_initials_only TINYINT(1) DEFAULT 0
  AFTER schedule_show_sidebar;