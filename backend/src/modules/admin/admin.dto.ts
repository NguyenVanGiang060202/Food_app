import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

enum CrawlRunStatus {
  Queued = 'queued',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}
enum ProcessingStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Skipped = 'skipped',
}
export class AdminListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsEnum(CrawlRunStatus) status?: CrawlRunStatus;
  @IsOptional() @IsEnum(ProcessingStatus) processingStatus?: ProcessingStatus;
}
