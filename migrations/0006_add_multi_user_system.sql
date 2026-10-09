-- Add multi-user system support: user_domains table and global_access column
-- This migration adds:
-- 1. user_domains junction table for many-to-many user-domain relationships
-- 2. global_access column to users table
-- 3. Updates role enum to support new roles: admin, user, analyst

-- Step 1: Create user_domains table
CREATE TABLE IF NOT EXISTS user_domains (
  user_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, domain_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_domains_user ON user_domains(user_id);
CREATE INDEX IF NOT EXISTS idx_user_domains_domain ON user_domains(domain_id);

-- Step 2: Add global_access column to users table
-- SQLite doesn't support ALTER TABLE ADD COLUMN IF NOT EXISTS, so we use table recreation
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  password_hash TEXT,
  cloudflare_access_id TEXT,
  role TEXT DEFAULT 'admin' CHECK(role IN ('admin', 'user', 'analyst', 'owner')),
  preferences TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER,
  -- MFA fields
  mfa_enabled INTEGER DEFAULT 0 CHECK(mfa_enabled IN (0, 1)),
  mfa_secret TEXT,
  mfa_backup_codes TEXT,
  -- Refresh token
  refresh_token_enabled INTEGER DEFAULT 1 CHECK(refresh_token_enabled IN (0, 1)),
  -- Multi-user system
  global_access INTEGER DEFAULT 0 CHECK(global_access IN (0, 1))
);

-- Copy existing data (if any)
INSERT INTO users_new (
  id, email, username, password_hash, cloudflare_access_id, role, preferences,
  created_at, updated_at, last_login_at, mfa_enabled, mfa_secret, mfa_backup_codes,
  refresh_token_enabled, global_access
)
SELECT 
  id, email, username, password_hash, cloudflare_access_id, 
  -- Migrate old roles to new roles
  CASE 
    WHEN role = 'owner' THEN 'admin'
    WHEN role = 'editor' THEN 'user'
    WHEN role = 'viewer' THEN 'analyst'
    ELSE role
  END as role,
  preferences,
  created_at, updated_at, last_login_at, 
  COALESCE(mfa_enabled, 0) as mfa_enabled,
  mfa_secret, mfa_backup_codes,
  COALESCE(refresh_token_enabled, 1) as refresh_token_enabled,
  -- Set global_access based on role: admin/owner always have global access
  CASE 
    WHEN role IN ('owner', 'admin') THEN 1
    ELSE 0
  END as global_access
FROM users;

-- Drop old table and rename
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_access_id ON users(cloudflare_access_id);
CREATE INDEX IF NOT EXISTS idx_users_mfa_enabled ON users(mfa_enabled);
CREATE INDEX IF NOT EXISTS idx_users_global_access ON users(global_access);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

