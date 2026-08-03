import { IsIn, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateCrawlRunDto {
  @IsString() @Length(1, 50) providerCode!: string;
  @IsString() @IsIn(['discovery', 'detail_refresh', 'reconciliation', 'backfill']) jobType!: string;
  @IsObject() target!: Record<string, unknown>;
}
export class ProcessingRecordParamDto { @IsUUID() id!: string; }