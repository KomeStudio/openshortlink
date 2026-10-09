-- Add geo and device-specific redirect tables

-- Geo-specific redirects table
CREATE TABLE IF NOT EXISTS link_geo_redirects (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  country_code TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
  UNIQUE(link_id, country_code)
);

CREATE INDEX IF NOT EXISTS idx_link_geo_link ON link_geo_redirects(link_id);
CREATE INDEX IF NOT EXISTS idx_link_geo_country ON link_geo_redirects(country_code);

-- Device-specific redirects table
CREATE TABLE IF NOT EXISTS link_device_redirects (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK(device_type IN ('desktop', 'mobile', 'tablet')),
  destination_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
  UNIQUE(link_id, device_type)
);

CREATE INDEX IF NOT EXISTS idx_link_device_link ON link_device_redirects(link_id);
CREATE INDEX IF NOT EXISTS idx_link_device_type ON link_device_redirects(device_type);

