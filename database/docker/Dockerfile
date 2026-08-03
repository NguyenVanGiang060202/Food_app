FROM postgis/postgis:16-3.5

# pgvector is installed on top of the official PostgreSQL + PostGIS image so
# restaurant, geospatial, and semantic-search data share one local database.
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-16-pgvector \
  && rm -rf /var/lib/apt/lists/*

COPY database/migrations/001_initial_schema.sql /docker-entrypoint-initdb.d/010_initial_schema.sql
COPY database/seeds/001_reference_data.sql /docker-entrypoint-initdb.d/020_reference_data.sql
COPY database/migrations/002_google_maps_playwright_source.sql /docker-entrypoint-initdb.d/030_google_maps_playwright_source.sql
COPY database/migrations/003_playwright_only_source.sql /docker-entrypoint-initdb.d/040_playwright_only_source.sql
COPY database/migrations/004_crawl_run_lease.sql /docker-entrypoint-initdb.d/050_crawl_run_lease.sql
COPY database/migrations/005_disable_fixture_source.sql /docker-entrypoint-initdb.d/060_disable_fixture_source.sql
COPY database/migrations/006_remove_inactive_sources.sql /docker-entrypoint-initdb.d/070_remove_inactive_sources.sql
COPY database/migrations/007_backfill_google_maps_coordinates.sql /docker-entrypoint-initdb.d/071_backfill_google_maps_coordinates.sql
COPY database/migrations/008_backfill_google_maps_coordinates_fix.sql /docker-entrypoint-initdb.d/072_backfill_google_maps_coordinates_fix.sql
COPY database/migrations/009_users_and_saved_restaurants.sql /docker-entrypoint-initdb.d/080_users_and_saved_restaurants.sql
COPY database/migrations/010_auth_email_verification.sql /docker-entrypoint-initdb.d/090_auth_email_verification.sql
COPY database/migrations/011_user_preferences.sql /docker-entrypoint-initdb.d/100_user_preferences.sql
COPY database/migrations/012_repair_corrupted_fixture_dishes.sql /docker-entrypoint-initdb.d/110_repair_corrupted_fixture_dishes.sql
COPY database/migrations/013_remove_replacement_character_dishes.sql /docker-entrypoint-initdb.d/120_remove_replacement_character_dishes.sql
COPY database/migrations/014_enable_unaccent_dish_search.sql /docker-entrypoint-initdb.d/130_enable_unaccent_dish_search.sql
COPY database/migrations/015_auth_password_reset.sql /docker-entrypoint-initdb.d/140_auth_password_reset.sql
COPY database/migrations/016_reject_non_restaurant_google_result.sql /docker-entrypoint-initdb.d/150_reject_non_restaurant_google_result.sql
COPY database/migrations/017_dedupe_restaurant_images.sql /docker-entrypoint-initdb.d/160_dedupe_restaurant_images.sql
COPY database/migrations/018_ensure_image_url_unique_index.sql /docker-entrypoint-initdb.d/170_ensure_image_url_unique_index.sql
COPY database/migrations/019_nullable_review_count.sql /docker-entrypoint-initdb.d/180_nullable_review_count.sql
COPY database/migrations/020_add_user_role.sql /docker-entrypoint-initdb.d/190_add_user_role.sql
COPY database/migrations/021_repair_missing_ai_preferences.sql /docker-entrypoint-initdb.d/200_repair_missing_ai_preferences.sql
COPY database/docker/init/001-enable-extensions.sql /docker-entrypoint-initdb.d/001-enable-extensions.sql

