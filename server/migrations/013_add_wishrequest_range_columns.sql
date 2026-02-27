-- Add optional range columns for single-request multi-day wishes
ALTER TABLE WishRequest
  ADD COLUMN IF NOT EXISTS range_start DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS range_end DATE DEFAULT NULL;
