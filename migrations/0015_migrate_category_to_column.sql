-- Migration: Move category_id from JSON metadata to dedicated column
-- This migration promotes category_id to a first-class indexed column
-- for efficient filtering instead of using json_extract() which is O(N)

-- Step 1: Add category_id column
ALTER TABLE links ADD COLUMN category_id TEXT;

-- Step 2: Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_links_category_id ON links(category_id);

-- Step 3: Migrate existing data from metadata JSON
-- Extract category_id from metadata column where it exists
UPDATE links 
SET category_id = json_extract(metadata, '$.category_id')
WHERE metadata IS NOT NULL 
  AND json_extract(metadata, '$.category_id') IS NOT NULL;

-- Note: We intentionally do NOT remove category_id from metadata yet
-- Application code will handle this during new writes and updates
-- This allows for a gradual migration and rollback if needed
