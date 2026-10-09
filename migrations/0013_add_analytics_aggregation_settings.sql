-- Migration: Add analytics aggregation settings
-- Adds default settings for analytics aggregation enable/disable and thresholds

-- Insert default analytics aggregation enabled setting (disabled by default)
INSERT INTO settings (key, value, domain_id, updated_at, updated_by)
VALUES (
  'analytics_aggregation_enabled',
  '{"enabled": false}',
  NULL,
  strftime('%s', 'now') * 1000,
  NULL
)
ON CONFLICT(key) WHERE domain_id IS NULL DO NOTHING;

-- Insert default analytics thresholds setting
INSERT INTO settings (key, value, domain_id, updated_at, updated_by)
VALUES (
  'analytics_thresholds',
  '{"engine_threshold_days": 89, "aggregation_threshold_days": 90}',
  NULL,
  strftime('%s', 'now') * 1000,
  NULL
)
ON CONFLICT(key) WHERE domain_id IS NULL DO NOTHING;

