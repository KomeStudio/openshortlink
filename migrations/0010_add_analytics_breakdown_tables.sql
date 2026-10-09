-- Add analytics breakdown tables for devices, UTM, and custom parameters

-- Analytics Devices table (device_type, browser, os breakdown)
CREATE TABLE IF NOT EXISTS analytics_devices (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  device_type TEXT, -- desktop, mobile, tablet
  browser TEXT,
  os TEXT,
  date TEXT NOT NULL, -- YYYY-MM-DD
  clicks INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (link_id) REFERENCES links(id),
  UNIQUE(link_id, device_type, browser, os, date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_devices_link ON analytics_devices(link_id);
CREATE INDEX IF NOT EXISTS idx_analytics_devices_date ON analytics_devices(date);
CREATE INDEX IF NOT EXISTS idx_analytics_devices_device ON analytics_devices(device_type);
CREATE INDEX IF NOT EXISTS idx_analytics_devices_browser ON analytics_devices(browser);
CREATE INDEX IF NOT EXISTS idx_analytics_devices_os ON analytics_devices(os);

-- Analytics UTM table (utm_source, utm_medium, utm_campaign breakdown)
CREATE TABLE IF NOT EXISTS analytics_utm (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  date TEXT NOT NULL, -- YYYY-MM-DD
  clicks INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (link_id) REFERENCES links(id),
  UNIQUE(link_id, utm_source, utm_medium, utm_campaign, date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_utm_link ON analytics_utm(link_id);
CREATE INDEX IF NOT EXISTS idx_analytics_utm_date ON analytics_utm(date);
CREATE INDEX IF NOT EXISTS idx_analytics_utm_source ON analytics_utm(utm_source);
CREATE INDEX IF NOT EXISTS idx_analytics_utm_medium ON analytics_utm(utm_medium);
CREATE INDEX IF NOT EXISTS idx_analytics_utm_campaign ON analytics_utm(utm_campaign);

-- Analytics Custom Parameters table (custom_param1, custom_param2, custom_param3 breakdown)
CREATE TABLE IF NOT EXISTS analytics_custom_params (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  param_name TEXT NOT NULL, -- 'custom_param1', 'custom_param2', 'custom_param3'
  param_value TEXT,
  date TEXT NOT NULL, -- YYYY-MM-DD
  clicks INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (link_id) REFERENCES links(id),
  UNIQUE(link_id, param_name, param_value, date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_custom_params_link ON analytics_custom_params(link_id);
CREATE INDEX IF NOT EXISTS idx_analytics_custom_params_date ON analytics_custom_params(date);
CREATE INDEX IF NOT EXISTS idx_analytics_custom_params_name ON analytics_custom_params(param_name);
CREATE INDEX IF NOT EXISTS idx_analytics_custom_params_value ON analytics_custom_params(param_value);

