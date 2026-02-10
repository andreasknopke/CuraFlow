-- Add email_verified column to app_users
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verified TINYINT(1) DEFAULT 0;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verified_date DATETIME DEFAULT NULL;

-- Table for email verification tokens
CREATE TABLE IF NOT EXISTS EmailVerification (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  type ENUM('email_verify', 'password_sent') NOT NULL DEFAULT 'email_verify',
  status ENUM('pending', 'verified', 'expired') NOT NULL DEFAULT 'pending',
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  verified_date DATETIME DEFAULT NULL,
  expires_date DATETIME DEFAULT NULL,
  INDEX idx_token (token),
  INDEX idx_user_id (user_id)
);
