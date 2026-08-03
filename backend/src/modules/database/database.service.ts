import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolConfig, QueryResult } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
    private readonly pool: Pool;
    constructor() {
        const config: PoolConfig = {
            connectionString: process.env.DATABASE_URL,
            host: process.env.PGHOST ?? 'localhost',
            port: Number(process.env.PGPORT ?? 5432),
            database: process.env.PGDATABASE ?? 'food_app',
            user: process.env.PGUSER ?? 'food_app',
            password: process.env.PGPASSWORD ?? 'change-me-locally',
            max: Number(process.env.PGPOOL_MAX ?? 10),
            connectionTimeoutMillis: Number(process.env.PGCONNECT_TIMEOUT_MS ?? 1000),
            idleTimeoutMillis: Number(process.env.PGIDLE_TIMEOUT_MS ?? 30000),
            statement_timeout: Number(process.env.PGSTATEMENT_TIMEOUT_MS ?? 5000),
        };
        this.pool = new Pool(config);
    }
    query<T extends object>(text: string, values: unknown[] = []): Promise<QueryResult<T>> { return this.pool.query<T>(text, values); }
    async isReady(): Promise<boolean> { try { const result = await this.pool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'restaurant') AS has_restaurant, EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS has_postgis, EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_vector`); const row = result.rows[0]; return Boolean(row?.has_restaurant && row?.has_postgis && row?.has_vector); } catch { return false; } }
    async onModuleDestroy(): Promise<void> { await this.pool.end(); }
}
