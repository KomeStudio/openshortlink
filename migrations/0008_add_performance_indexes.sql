-- Add performance indexes for database query optimizations
-- This migration adds indexes to improve query performance for frequently accessed columns

-- 1. Composite index for getLinkBySlug (most critical - hot path)
-- This index optimizes the redirect lookup which happens on every link click
CREATE INDEX IF NOT EXISTS idx_links_domain_slug_status 
ON links(domain_id, slug, status);

-- 2. Index for link listing with filters and sorting
-- Optimizes queries that filter by status and sort by created_at
CREATE INDEX IF NOT EXISTS idx_links_status_created 
ON links(status, created_at DESC);

-- 3. Index for tag/category filtering
-- Optimizes queries that filter tags and categories by domain and name
CREATE INDEX IF NOT EXISTS idx_tags_domain_name 
ON tags(domain_id, name);

CREATE INDEX IF NOT EXISTS idx_categories_domain_name 
ON categories(domain_id, name);

-- 4. Index for API key lookups
-- Optimizes API key authentication queries
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash 
ON api_keys(key_hash);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix 
ON api_keys(key_prefix);

-- 5. Index for username lookups (if username column exists)
-- Note: Check if username column exists before creating index
-- This will be created only if the column exists (from migration 0002)
CREATE INDEX IF NOT EXISTS idx_users_username 
ON users(username) WHERE username IS NOT NULL;

-- Note: email index already exists (idx_users_email from initial schema)
-- Note: domain_name index already exists (idx_domains_name from initial schema)
-- Note: Composite index for links already exists (idx_links_domain_slug from initial schema)
-- But we're adding a better composite index that includes status for the hot path

