-- Add schedule_sort_doctors_alphabetically column to app_users table
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS schedule_sort_doctors_alphabetically TINYINT(1) DEFAULT 0
  AFTER schedule_initials_only;