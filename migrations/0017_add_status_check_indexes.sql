-- Add indexes for status monitoring
-- Optimizes sorting by check time and filtering by status code ("Broken Links" page)
CREATE INDEX IF NOT EXISTS idx_links_status_check_at ON links(last_status_check_at);
CREATE INDEX IF NOT EXISTS idx_links_status_code ON links(last_status_code);
