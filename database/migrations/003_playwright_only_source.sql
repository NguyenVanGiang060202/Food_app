-- Playwright is the only production crawler source.
-- Keep the legacy API source row for provenance, but prevent new crawl runs from using it.
INSERT INTO data_source (code, name, base_url, is_active)
VALUES ('google_maps_playwright', 'Google Maps (Playwright)', 'https://www.google.com/maps', true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    base_url = EXCLUDED.base_url,
    is_active = true;

UPDATE data_source
SET is_active = false
WHERE code = 'google_maps';