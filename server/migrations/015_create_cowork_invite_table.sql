ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_seen_at DATETIME DEFAULT NULL;

CREATE TABLE IF NOT EXISTS CoWorkInvite (
  id VARCHAR(36) PRIMARY KEY,
  room_name VARCHAR(128) NOT NULL,
  tenant_slug VARCHAR(64) NOT NULL,
  inviter_user_id VARCHAR(36) NOT NULL,
  invitee_user_id VARCHAR(36) NOT NULL,
  status ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
  responded_date TIMESTAMP NULL,
  expires_date TIMESTAMP NULL,
  created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_invitee_status (invitee_user_id, status),
  INDEX idx_inviter_status (inviter_user_id, status),
  INDEX idx_room_name (room_name),
  INDEX idx_expires_date (expires_date)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE CoWorkInvite CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;