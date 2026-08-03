import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';

export enum RestaurantSort { Relevance = 'relevance', Distance = 'distance', Rating = 'rating', Newest = 'newest' }
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class ListRestaurantsQueryDto {
    @IsOptional() @Transform(trim) @IsString() @Length(0, 200) query?: string;
    @IsOptional() @Transform(trim) @IsString() @Length(1, 100) category?: string;
    @IsOptional() @Transform(trim) @IsString() @Length(1, 100) city?: string;
    @IsOptional() @Transform(trim) @IsString() @Length(1, 100) district?: string;
    @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude?: number;
    @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude?: number;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50000) radiusMeters?: number;
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(5) minRating?: number;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4) priceLevel?: number;
    @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() openNow?: boolean;
    @IsOptional() @IsEnum(RestaurantSort) sort: RestaurantSort = RestaurantSort.Relevance;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
    @IsOptional() @Transform(trim) @IsString() @Length(1, 500) cursor?: string;
    @IsOptional() @Transform(({ value }) => Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : value) @IsString({ each: true }) tastes?: string[];
    validateLocationPair(): string | undefined { if ((this.latitude === undefined) !== (this.longitude === undefined)) return 'latitude and longitude must be supplied together.'; if (this.radiusMeters !== undefined && (this.latitude === undefined || this.longitude === undefined)) return 'radiusMeters requires latitude and longitude.'; return undefined; }
}

export class SimilarRestaurantsQueryDto {
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit = 12;
}

export class InterpretSearchDto { @Transform(trim) @IsString() @Length(1, 200) query!: string; }
export class LocationDto { @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number; @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number; }
export class RecommendationFiltersDto {
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(5) minRating?: number;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4) priceLevel?: number;
    @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() openNow?: boolean;
    @IsOptional() @IsEnum(RestaurantSort) sort?: RestaurantSort;
    @IsOptional() @Transform(({ value }) => Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : value) @IsString({ each: true }) taste?: string[];
    @IsOptional() @Transform(({ value }) => Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : value) @IsString({ each: true }) dishTypes?: string[];
    @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1, 100) area?: string;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50000) radiusMeters?: number;
}
export class RecommendationDto {
    @Transform(trim) @IsString() @Length(1, 200) query!: string;
    @IsOptional() @ValidateNested() @Type(() => LocationDto) location?: LocationDto;
    @IsOptional() @ValidateNested() @Type(() => RecommendationFiltersDto) filters?: RecommendationFiltersDto;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 10;
}
