param(
  [string]$Database = 'food_app',
  [string]$User = 'food_app'
)

$ErrorActionPreference = 'Stop'

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Desktop is not running. Start Docker Desktop, then run npm run db:migrate again.'
}

docker compose exec -T postgres pg_isready -U $User -d $Database *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'The postgres service is not ready. Run docker compose up -d postgres, then retry npm run db:migrate.'
}

function Invoke-SqlFile([string]$File) {
  Write-Host "Applying $File"
  # Let cmd.exe stream the UTF-8 file as bytes. This avoids PowerShell's text
  # pipeline transcoding Vietnamese characters before psql receives them.
  $resolvedFile = (Resolve-Path $File).Path
  cmd /c "type `"$resolvedFile`" | docker compose exec -T postgres psql --set=client_encoding=UTF8 -v ON_ERROR_STOP=1 -U $User -d $Database"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not apply SQL file $File."
  }
}

docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $User -d $Database -c @'
CREATE TABLE IF NOT EXISTS schema_migration (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
'@

$initial = [string](docker compose exec -T postgres psql -At -U $User -d $Database -c "SELECT to_regclass('public.restaurant') IS NOT NULL;")
if ($LASTEXITCODE -ne 0) {
  throw 'Could not inspect the database schema.'
}
if ($initial.Trim() -ne 't') {
  Invoke-SqlFile 'database/migrations/001_initial_schema.sql'
  Invoke-SqlFile 'database/seeds/001_reference_data.sql'
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $User -d $Database -c "INSERT INTO schema_migration (version) VALUES ('001_initial_schema') ON CONFLICT (version) DO NOTHING;"
} else {
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $User -d $Database -c "INSERT INTO schema_migration (version) VALUES ('001_initial_schema') ON CONFLICT (version) DO NOTHING;"
}

foreach ($migration in @(
  'database/migrations/002_google_maps_playwright_source.sql',
  'database/migrations/003_playwright_only_source.sql',
  'database/migrations/004_crawl_run_lease.sql',
  'database/migrations/005_disable_fixture_source.sql',
  'database/migrations/006_remove_inactive_sources.sql',
  'database/migrations/007_backfill_google_maps_coordinates.sql',
  'database/migrations/008_backfill_google_maps_coordinates_fix.sql',
  'database/migrations/009_users_and_saved_restaurants.sql',
  'database/migrations/010_auth_email_verification.sql',
  'database/migrations/011_user_preferences.sql',
  'database/migrations/012_repair_corrupted_fixture_dishes.sql',
  'database/migrations/013_remove_replacement_character_dishes.sql',
  'database/migrations/014_enable_unaccent_dish_search.sql',
  'database/migrations/015_auth_password_reset.sql',
   'database/migrations/016_reject_non_restaurant_google_result.sql',
   'database/migrations/017_dedupe_restaurant_images.sql',
   'database/migrations/018_ensure_image_url_unique_index.sql',
   'database/migrations/019_nullable_review_count.sql',
   'database/migrations/020_add_user_role.sql',
   'database/migrations/021_repair_missing_ai_preferences.sql',
   'database/migrations/022_enrichment_provenance.sql',
   'database/migrations/023_embedding_run_log.sql',
   'database/migrations/024_food_attribute_taxonomy.sql',
   'database/migrations/025_reject_non_food_google_results.sql',
   'database/migrations/026_semantic_profile.sql',
   'database/migrations/027_embedding_vector_index.sql',
   'database/migrations/028_menu_image_dish_evidence.sql'
)) {
  $version = [System.IO.Path]::GetFileNameWithoutExtension($migration)
  $applied = [string](docker compose exec -T postgres psql -At -U $User -d $Database -c "SELECT EXISTS (SELECT 1 FROM schema_migration WHERE version = '$version');")
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect migration state for $version."
  }
  if ($applied.Trim() -ne 't') {
    Invoke-SqlFile $migration
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $User -d $Database -c "INSERT INTO schema_migration (version) VALUES ('$version');"
  } else {
    Write-Host "Skipping $version (already applied)"
  }
}

# Reference data is intentionally safe to re-apply. This keeps an existing
# installation in sync when new categories are added to the seed file.
Invoke-SqlFile 'database/seeds/001_reference_data.sql'

# The embedding HNSW index is also safe to re-apply: it skips until vectors
# exist, then locks the column dimension and builds the index. Re-applying it
# on every migrate means a database that recorded 027 before any embedding run
# still gets its index automatically after `npm run embed:once`.
Invoke-SqlFile 'database/migrations/027_embedding_vector_index.sql'

Write-Host 'Database migrations are up to date.'
