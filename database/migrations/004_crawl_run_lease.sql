-- Recover crawl runs abandoned by a crashed worker.
ALTER TABLE crawl_run
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS crawl_run_lease_recovery_idx
  ON crawl_run (status, lease_expires_at)
  WHERE status = 'running';