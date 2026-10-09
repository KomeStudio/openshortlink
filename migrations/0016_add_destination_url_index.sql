-- Add index on destination_url for faster lookups
-- Optimizes "Status Monitor" and "Links by Destination" pages
CREATE INDEX IF NOT EXISTS idx_links_destination_url ON links(destination_url);
