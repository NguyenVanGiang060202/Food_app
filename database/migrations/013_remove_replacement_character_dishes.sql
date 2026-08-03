-- The previous repair migration intentionally required a normalized-name
-- match. Legacy transcoding can corrupt enough bytes to prevent that match,
-- so remove only replacement-character rows from restaurants that also have
-- at least one clean dish row.
DELETE FROM dish corrupted
WHERE corrupted.name LIKE '%' || chr(65533) || '%'
  AND EXISTS (
    SELECT 1
    FROM dish clean
    WHERE clean.restaurant_id = corrupted.restaurant_id
      AND clean.id <> corrupted.id
      AND clean.name NOT LIKE '%' || chr(65533) || '%'
  );