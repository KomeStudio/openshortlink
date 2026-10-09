-- Migration: Flexible Status Check Configuration
-- This migration updates the status check frequency format from enum to flexible structure
-- The actual migration is handled in application code (src/db/settings.ts)
-- This SQL file documents the change and can be used for reference

-- Note: The settings table stores JSON values, so the migration happens in code
-- Old format: { "frequency": "2_weeks" | "1_month", "enabled": boolean, "check_top_100_daily": boolean }
-- New format: { "frequency": { "value": number, "unit": "days" | "weeks" }, "enabled": boolean, "check_top_100_daily": boolean, "batch_size": number }

-- Migration mapping:
-- "2_weeks" -> { "value": 2, "unit": "weeks" }
-- "1_month" -> { "value": 30, "unit": "days" }
-- Default batch_size: 100

-- The application code will automatically migrate old settings when they are read
-- No SQL changes are required as the settings are stored as JSON strings

-- If you need to manually update existing settings, you can run:
-- UPDATE settings 
-- SET value = json_set(
--   json_set(
--     CASE 
--       WHEN json_extract(value, '$.frequency') = '2_weeks' THEN json_set(value, '$.frequency', json_object('value', 2, 'unit', 'weeks'))
--       WHEN json_extract(value, '$.frequency') = '1_month' THEN json_set(value, '$.frequency', json_object('value', 30, 'unit', 'days'))
--       ELSE value
--     END,
--     '$.batch_size', 100
--   ),
--   '$.frequency.value', 
--   CASE 
--     WHEN json_extract(value, '$.frequency') = '2_weeks' THEN 2
--     WHEN json_extract(value, '$.frequency') = '1_month' THEN 30
--     ELSE 14
--   END
-- )
-- WHERE key = 'status_check_frequency' AND domain_id IS NULL;

-- However, the application code handles this migration automatically, so manual SQL is not required

