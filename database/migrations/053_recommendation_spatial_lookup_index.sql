-- Recommendation nearby searches first resolve matching locations and then
-- join active restaurants by location_id. Without this partial index,
-- PostgreSQL repeatedly scans the whole restaurant table for each nearby
-- location and exact-dish requests can exceed the API budget.
CREATE INDEX IF NOT EXISTS restaurant_active_location_idx
  ON restaurant (location_id)
  WHERE status = 'active';
