-- Remove legacy fixture dish rows that were imported with replacement
-- characters when a UTF-8 payload was transcoded through PowerShell.
-- Keep the valid row when the same restaurant already has a clean name.
DELETE FROM dish corrupted
USING dish valid
WHERE corrupted.id <> valid.id
  AND corrupted.restaurant_id = valid.restaurant_id
  AND corrupted.name LIKE '%' || chr(65533) || '%'
  AND valid.name NOT LIKE '%' || chr(65533) || '%'
  AND lower(regexp_replace(corrupted.name, '[^[:alnum:]]+', '', 'g'))
      = lower(regexp_replace(valid.name, '[^[:alnum:]]+', '', 'g'));