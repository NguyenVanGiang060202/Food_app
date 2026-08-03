-- Register the browser-based Google Maps adapter for existing installations.
-- This migration contains reference data only; it never creates catalog records.
INSERT INTO data_source (code, name, base_url)
VALUES ('google_maps_playwright', 'Google Maps (Playwright)', 'https://www.google.com/maps')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    base_url = EXCLUDED.base_url;