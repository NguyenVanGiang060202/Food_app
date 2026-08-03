-- Fixture data is a test harness only, never a production crawl source.
-- Keep the source row and historical records for provenance, but prevent new
-- crawl runs and worker claims from using it.
UPDATE data_source
SET is_active = false
WHERE code = 'fixture';