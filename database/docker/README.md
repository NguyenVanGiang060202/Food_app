# Local Database Image

The Dockerfile extends the official PostgreSQL 16 + PostGIS image with pgvector.

On first creation of the local PostgreSQL volume, `init/001-enable-extensions.sql` enables the extensions required by the project:

- `postgis` for geographic locations and distance queries.
- `vector` for semantic-search embeddings.
- `pg_trgm` for fuzzy text matching.
- `pgcrypto` for UUID generation.

PostgreSQL initialization scripts run only when the `postgres_data` volume is empty. Adding a
new schema change later must use a version-controlled migration, not another initialization
script. Run the repository migration runner for an existing volume:

```powershell
npm run db:migrate
```
