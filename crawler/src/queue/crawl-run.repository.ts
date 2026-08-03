import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

export interface CrawlRunJob {
    id: string;
    providerCode: string;
    jobType: string;
    target: Record<string, unknown>;
}

export class CrawlRunRepository {
    private readonly pool: Pool;
    private readonly workerId = process.env.CRAWL_WORKER_ID ?? `crawler-${randomUUID()}`;
    private readonly leaseSeconds = Math.max(60, Number(process.env.CRAWL_LEASE_SECONDS ?? 900));

    constructor(connectionString = process.env.DATABASE_URL) {
        this.pool = new Pool({
            connectionString,
            host: process.env.PGHOST ?? 'localhost',
            port: Number(process.env.PGPORT ?? 5432),
            database: process.env.PGDATABASE ?? 'food_app',
            user: process.env.PGUSER ?? 'food_app',
            password: process.env.PGPASSWORD ?? 'change-me-locally',
        });
    }

    async close(): Promise<void> {
        await this.pool.end();
    }

    async claimNext(): Promise<CrawlRunJob | undefined> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query<CrawlRunJob>(`
        SELECT cr.id, ds.code AS "providerCode", cr.job_type AS "jobType", cr.target
        FROM crawl_run cr
        JOIN data_source ds ON ds.id = cr.data_source_id
        WHERE ds.is_active = true
          AND (cr.status = 'queued' OR (cr.status = 'running' AND (cr.lease_expires_at IS NULL OR cr.lease_expires_at < now())))
        ORDER BY CASE WHEN cr.status = 'queued' THEN 0 ELSE 1 END, cr.started_at NULLS FIRST, cr.id
        FOR UPDATE OF cr SKIP LOCKED
        LIMIT 1
      `);
            const job = result.rows[0];
            if (!job) {
                await client.query('COMMIT');
                return undefined;
            }
            await client.query(`UPDATE crawl_run SET status = 'running', started_at = COALESCE(started_at, now()), worker_id = $2, lease_expires_at = now() + ($3 * interval '1 second'), error_message = NULL WHERE id = $1`, [job.id, this.workerId, this.leaseSeconds]);
            await client.query('COMMIT');
            return job;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async markFailed(id: string, error: unknown): Promise<void> {
        const message = error instanceof Error ? error.message : 'Unknown crawl failure.';
        await this.pool.query(`UPDATE crawl_run SET status = 'failed', finished_at = now(), worker_id = NULL, lease_expires_at = NULL, error_message = $2 WHERE id = $1 AND status = 'running' AND (worker_id = $3 OR lease_expires_at < now())`, [id, message, this.workerId]);
    }

    async renewLease(id: string): Promise<void> {
        await this.pool.query(`UPDATE crawl_run SET lease_expires_at = now() + ($2 * interval '1 second') WHERE id = $1 AND status = 'running' AND worker_id = $3`, [id, this.leaseSeconds, this.workerId]);
    }
}