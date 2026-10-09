-- Add authentication fields to users table
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
  last_login_at INTEGER
);

-- Copy existing data (if any)
INSERT INTO users_new (id, email, cloudflare_access_id, role, preferences, created_at, updated_at, last_login_at)
SELECT id, email, cloudflare_access_id, role, preferences, created_at, updated_at, last_login_at
FROM users;

-- Drop old table and rename
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_access_id ON users(cloudflare_access_id);

