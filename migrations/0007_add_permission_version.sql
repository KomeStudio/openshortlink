-- Add permission_version column to users table for cache invalidation
-- This allows automatic cache invalidation when user permissions change

-- Add permission_version column with default value of 1
ALTER TABLE users ADD COLUMN permission_version INTEGER DEFAULT 1;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_permission_version ON users(permission_version);

-- Initialize existing users with version 1
UPDATE users SET permission_version = 1 WHERE permission_version IS NULL;

