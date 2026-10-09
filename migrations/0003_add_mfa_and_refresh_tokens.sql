-- Add MFA and refresh token support to users table
-- SQLite doesn't support ALTER TABLE ADD COLUMN IF NOT EXISTS, so we use a table recreation approach

-- Create temporary table with new schema
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  password_hash TEXT,
  cloudflare_access_id TEXT,
  role TEXT DEFAULT 'owner' CHECK(role IN ('owner', 'admin', 'editor', 'viewer')),
  preferences TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER,
  -- MFA fields
  mfa_enabled INTEGER DEFAULT 0 CHECK(mfa_enabled IN (0, 1)),
  mfa_secret TEXT,
  mfa_backup_codes TEXT, -- JSON array of backup codes
  -- Refresh token (stored in KV, but we track if user has active refresh tokens)
  refresh_token_enabled INTEGER DEFAULT 1 CHECK(refresh_token_enabled IN (0, 1))
);

-- Copy existing data (if any)
INSERT INTO users_new (
  id, email, username, password_hash, cloudflare_access_id, role, preferences,
  created_at, updated_at, last_login_at, mfa_enabled, refresh_token_enabled
)
SELECT 
  id, email, username, password_hash, cloudflare_access_id, role, preferences,
  created_at, updated_at, last_login_at, 0, 1
FROM users;

-- Drop old table and rename
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_access_id ON users(cloudflare_access_id);
CREATE INDEX IF NOT EXISTS idx_users_mfa_enabled ON users(mfa_enabled);

