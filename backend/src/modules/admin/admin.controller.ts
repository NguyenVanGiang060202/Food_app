import { ConflictException, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards, Body, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AdminAuthorizationGuard } from './admin-authorization.guard';
import { AdminListQueryDto } from './admin.dto';
import { CreateCrawlRunDto, ProcessingRecordParamDto } from './admin-write.dto';

@Controller('admin')
@UseGuards(AdminAuthorizationGuard)
export class AdminController {
    constructor(private readonly database: DatabaseService) { }
    @Get('data-sources')
    async dataSources() { const result = await this.database.query(`SELECT ds.id, ds.code, ds.name, ds.base_url AS \"baseUrl\", ds.is_active AS \"isActive\", COUNT(DISTINCT rs.id)::int AS \"restaurantSourceCount\", MAX(cr.finished_at) AS \"lastFinishedAt\" FROM data_source ds LEFT JOIN restaurant_source rs ON rs.data_source_id = ds.id LEFT JOIN crawl_run cr ON cr.data_source_id = ds.id AND cr.status = 'completed' GROUP BY ds.id ORDER BY ds.name`); return { data: result.rows }; }
    @Get('crawl-runs')
    async crawlRuns(@Query() query: AdminListQueryDto) { const values: unknown[] = [query.limit]; const conditions = query.status ? 'WHERE cr.status = $2' : ''; if (query.status) values.push(query.status); const result = await this.database.query(`SELECT cr.id, ds.code AS \"providerCode\", cr.job_type AS \"jobType\", cr.target, cr.status, cr.started_at AS \"startedAt\", cr.finished_at AS \"finishedAt\", cr.records_found AS \"recordsFound\", cr.records_processed AS \"recordsProcessed\", cr.error_message AS \"errorMessage\" FROM crawl_run cr JOIN data_source ds ON ds.id = cr.data_source_id ${conditions} ORDER BY cr.started_at DESC NULLS LAST, cr.id DESC LIMIT $1`, values); return { data: result.rows, meta: { limit: query.limit } }; }
    @Get('processing-records')
    async processingRecords(@Query() query: AdminListQueryDto) { const values: unknown[] = [query.limit]; const conditions = query.processingStatus ? 'WHERE pr.status = $2' : ''; if (query.processingStatus) values.push(query.processingStatus); const result = await this.database.query(`SELECT pr.id, pr.crawl_run_id AS \"crawlRunId\", pr.external_id AS \"externalId\", pr.stage, pr.status, pr.attempt_count AS \"attemptCount\", pr.error_details AS \"errorDetails\", pr.processed_at AS \"processedAt\" FROM processing_record pr ${conditions} ORDER BY pr.processed_at DESC NULLS LAST, pr.id DESC LIMIT $1`, values); return { data: result.rows, meta: { limit: query.limit } }; }
    @Get('restaurants/unresolved')
    async unresolved(@Query() query: AdminListQueryDto) { const result = await this.database.query(`SELECT pr.id AS \"processingRecordId\", pr.external_id AS \"externalId\", pr.crawl_run_id AS \"crawlRunId\", pr.stage, pr.status, pr.error_details AS \"errorDetails\" FROM processing_record pr WHERE pr.stage = 'matching' AND pr.status IN ('failed', 'pending', 'processing') ORDER BY pr.id DESC LIMIT $1`, [query.limit]); return { data: result.rows, meta: { limit: query.limit } }; }
    @Post('crawl-runs')
    @HttpCode(HttpStatus.ACCEPTED)
    async createCrawlRun(@Body() body: CreateCrawlRunDto) { this.validateTarget(body.target); const result = await this.database.query<{ id: string }>(`INSERT INTO crawl_run (data_source_id, job_type, target, status) SELECT id, $2, $3::jsonb, 'queued' FROM data_source WHERE code = $1 AND is_active = true RETURNING id`, [body.providerCode, body.jobType, JSON.stringify(body.target)]); if (!result.rows[0]) throw new ConflictException('Provider is not active or does not exist.'); return { data: { id: result.rows[0].id, providerCode: body.providerCode, jobType: body.jobType, status: 'queued', target: body.target } }; }
    @Post('processing-records/:id/retry')
    @HttpCode(HttpStatus.ACCEPTED)
    async retryProcessing(@Param() params: ProcessingRecordParamDto) {
        const result = await this.database.query<{ id: string; attempt_count: number; retry_run_id: string }>(`
            WITH source_record AS (
                SELECT pr.id, pr.attempt_count, cr.target, cr.job_type, ds.code AS provider_code
                FROM processing_record pr
                JOIN crawl_run cr ON cr.id = pr.crawl_run_id
                JOIN data_source ds ON ds.id = cr.data_source_id
                WHERE pr.id = $1 AND pr.status IN ('failed', 'skipped') AND pr.attempt_count < 5
                  AND cr.job_type = 'discovery'
                FOR UPDATE OF pr
            ), created_run AS (
                INSERT INTO crawl_run (data_source_id, job_type, target, status)
                SELECT ds.id, sr.job_type, sr.target, 'queued'
                FROM source_record sr
                JOIN data_source ds ON ds.code = sr.provider_code AND ds.is_active = true
                RETURNING id
            ), marked_record AS (
                UPDATE processing_record pr
                SET status = 'skipped',
                    attempt_count = pr.attempt_count + 1,
                    error_details = jsonb_build_object('message', 'Retry enqueued as a new crawl run.', 'retryRunId', cr.id),
                    processed_at = now()
                FROM source_record sr, created_run cr
                WHERE pr.id = sr.id
                RETURNING pr.id, pr.attempt_count, cr.id AS retry_run_id
            )
            SELECT id, attempt_count, retry_run_id FROM marked_record
        `, [params.id]);
        if (!result.rows[0]) throw new ConflictException('Processing record is not eligible for retry or its provider is inactive.');
        return { data: { id: result.rows[0].id, status: 'queued', retryRunId: result.rows[0].retry_run_id, attemptCount: result.rows[0].attempt_count } };
    }
    private validateTarget(target: Record<string, unknown>) { const allowed = new Set(['city', 'district', 'category', 'query', 'location', 'limit']); for (const key of Object.keys(target)) if (!allowed.has(key)) throw new BadRequestException(`Unsupported crawl target field: ${key}.`); for (const key of ['city', 'district', 'category', 'query', 'location']) if (target[key] !== undefined && (typeof target[key] !== 'string' || target[key].length > 200)) throw new BadRequestException(`${key} must be a string of at most 200 characters.`); if (target.limit !== undefined && (typeof target.limit !== 'number' || !Number.isInteger(target.limit) || target.limit < 1 || target.limit > 50)) throw new BadRequestException('limit must be an integer between 1 and 50.'); }
}