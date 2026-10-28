param(
  [string]$Database = 'food_app',
  [string]$User = 'food_app'
)

# PostgreSQL can emit a non-fatal collation-version warning on stderr even
# when psql exits successfully. Judge native commands by LASTEXITCODE below.
$ErrorActionPreference = 'Continue'

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
if ($LASTEXITCODE -ne 0) { throw 'Could not ensure schema_migration table.' }

$initial = [string](docker compose exec -T postgres psql -At -U $User -d $Database -c "SELECT to_regclass('public.restaurant') IS NOT NULL;")
if ($LASTEXITCODE -ne 0) {
  throw 'Could not inspect the database schema.'
}
if ($initial.Trim() -ne 't') {
  Invoke-SqlFile 'database/migrations/001_initial_schema.sql'
  Invoke-SqlFile 'database/seeds/001_reference_data.sql'
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $User -d $Database -c "INSERT INTO schema_migration (version) VALUES ('001_initial_schema') ON CONFLICT (version) DO NOTHING;"
  if ($LASTEXITCODE -ne 0) { throw 'Could not record initial schema migration.' }
} else {
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $User -d $Database -c "INSERT INTO schema_migration (version) VALUES ('001_initial_schema') ON CONFLICT (version) DO NOTHING;"
  if ($LASTEXITCODE -ne 0) { throw 'Could not record initial schema migration.' }
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
  'database/migrations/028_menu_image_dish_evidence.sql',
  'database/migrations/029_food_intelligence_foundation.sql',
  'database/migrations/030_review_opinion_extraction.sql',
  'database/migrations/031_food_profile_semantic_embedding.sql',
  'database/migrations/032_recommendation_interactions.sql',
  'database/migrations/033_quarantine_food_photo_evidence.sql',
  'database/migrations/034_restaurant_image_cache.sql'
  ,'database/migrations/035_fix_image_cache_dedupe_index.sql'
  ,'database/migrations/036_quarantine_low_quality_menu_dishes.sql'
  ,'database/migrations/037_seed_safe_canonical_dish_aliases.sql'
  ,'database/migrations/038_curate_priority_canonical_names.sql'
  ,'database/migrations/039_quarantine_ocr_template_contamination.sql'
  ,'database/migrations/040_quarantine_two_item_ocr_templates.sql'
  ,'database/migrations/041_quarantine_repeated_ocr_templates.sql'
  ,'database/migrations/042_precision_grilled_attributes.sql'
  ,'database/migrations/043_quarantine_late_ocr_template_contamination.sql'
  ,'database/migrations/044_sync_quarantined_dish_status.sql'
  ,'database/migrations/045_bilingual_dish_aliases.sql'
  ,'database/migrations/046_quarantine_progressive_ocr_hallucinations.sql'
  ,'database/migrations/047_quarantine_non_menu_extraction_evidence.sql'
  ,'database/migrations/048_normalize_and_merge_dish_duplicates.sql'
  ,'database/migrations/049_recommendation_menu_lookup_indexes.sql'
  ,'database/migrations/050_curated_selection_quarantine.sql'
  ,'database/migrations/051_quarantine_website_menu_label_noise.sql'
  ,'database/migrations/052_quarantine_shared_website_mismatch.sql'
  ,'database/migrations/053_recommendation_spatial_lookup_index.sql'
  ,'database/migrations/054_correct_viet_huong_2_district.sql'
  ,'database/migrations/055_quarantine_unreviewed_structured_website_items.sql'
  ,'database/migrations/056_correct_dau_homemade_hong_ha_district.sql'
  ,'database/migrations/057_refresh_dau_homemade_legacy_website.sql'
  ,'database/migrations/058_refresh_chim_chay_official_website.sql'
  ,'database/migrations/059_correct_goc_hue_branch_districts.sql'
  ,'database/migrations/060_link_pho_nhon_verified_branch.sql'
  ,'database/migrations/061_quarantine_pho_bo_thanh_da_hijacked_website.sql'
  ,'database/migrations/062_annotate_paper_plate_seafood_pizza.sql'
  ,'database/migrations/063_correct_sen_nam_bo_official_location.sql'
  ,'database/migrations/064_correct_thien_huong_sushi_district.sql'
  ,'database/migrations/065_annotate_thien_huong_beef_udon.sql'
  ,'database/migrations/066_correct_tokyo_deli_phan_xich_long_district.sql'
  ,'database/migrations/067_correct_de_nhat_ga_nuong_nguyen_van_nghi_district.sql'
  ,'database/migrations/068_correct_dominos_le_thi_ha_district.sql'
  ,'database/migrations/069_correct_cham_cong_hoa_district.sql'
  ,'database/migrations/070_correct_huong_pho_district.sql'
  ,'database/migrations/071_correct_vittorio_contact.sql'
  ,'database/migrations/072_alias_vittorio_pumpkin_soup.sql'
  ,'database/migrations/073_alias_vittorio_seafood_salad.sql'
  ,'database/migrations/074_alias_vittorio_seafood_risotto.sql'
  ,'database/migrations/075_alias_vittorio_seafood_spaghetti.sql'
  ,'database/migrations/076_correct_be_vang_district_contact.sql'
)) {
  $version = [System.IO.Path]::GetFileNameWithoutExtension($migration)
  $applied = [string](docker compose exec -T postgres psql -At -U $User -d $Database -c "SELECT EXISTS (SELECT 1 FROM schema_migration WHERE version = '$version');")
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect migration state for $version."
  }
  if ($applied.Trim() -ne 't') {
    Invoke-SqlFile $migration
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U $User -d $Database -c "INSERT INTO schema_migration (version) VALUES ('$version');"
    if ($LASTEXITCODE -ne 0) { throw "Could not record migration $version." }
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
