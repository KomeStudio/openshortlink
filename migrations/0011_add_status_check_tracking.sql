-- Add status check tracking for links
-- This migration adds:
-- 1. Status tracking columns to links table
-- 2. link_status_checks table for history
-- 3. Indexes for efficient queries

-- Step 1: Add status check columns to links table
-- SQLite doesn't support ALTER TABLE ADD COLUMN IF NOT EXISTS, so we check if columns exist first
-- We'll use a safe approach that works with SQLite

-- Add last_status_check_at column
-- Note: SQLite will ignore this if column already exists (in some cases)
-- For safety, we'll check the schema first in application code
ALTER TABLE links ADD COLUMN last_status_check_at INTEGER;

-- Add last_status_code column
ALTER TABLE links ADD COLUMN last_status_code INTEGER;

-- Add next_status_check_at column (for scheduling)
ALTER TABLE links ADD COLUMN next_status_check_at INTEGER;

-- Step 2: Create link_status_checks table for history
CREATE TABLE IF NOT EXISTS link_status_checks (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  status_code INTEGER,
  checked_at INTEGER NOT NULL,
  response_time_ms INTEGER,
  error_message TEXT,
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);

-- Step 3: Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_link_status_checks_link_id ON link_status_checks(link_id);
CREATE INDEX IF NOT EXISTS idx_link_status_checks_checked_at ON link_status_checks(checked_at);
CREATE INDEX IF NOT EXISTS idx_link_status_checks_status_code ON link_status_checks(status_code);
CREATE INDEX IF NOT EXISTS idx_links_last_status_check_at ON links(last_status_check_at);
CREATE INDEX IF NOT EXISTS idx_links_last_status_code ON links(last_status_code);
CREATE INDEX IF NOT EXISTS idx_links_next_status_check_at ON links(next_status_check_at) WHERE next_status_check_at IS NOT NULL;

