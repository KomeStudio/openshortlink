-- Migration: Add normalized_domain_name column for optimized lookups
-- This migration adds a normalized domain name column to avoid full table scans
-- caused by using LOWER(REPLACE(...)) on the domain_name column in WHERE clauses

-- Step 1: Add normalized column
ALTER TABLE domains ADD COLUMN normalized_domain_name TEXT;

-- Step 2: Populate existing data
-- Normalize: lowercase, remove slashes and spaces
UPDATE domains 
SET normalized_domain_name = LOWER(REPLACE(REPLACE(domain_name, '/', ''), ' ', ''));

-- Step 3: Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_domains_normalized_name 
ON domains(normalized_domain_name);

-- Note: Application code will enforce that this column is always populated
-- for new records and kept in sync with domain_name updates
