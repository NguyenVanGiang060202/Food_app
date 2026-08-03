import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export type PreferenceMemory = { id: string; text: string };

export class AiPreferencesDto {
    @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) favoriteFoodSlugs?: string[];
    @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) favoriteCuisineSlugs?: string[];
    @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tastePreferences?: string[];
    @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) dietaryPreferences?: string[];
    @IsOptional() @IsIn(['2', '5', '10', 'any']) searchRadius?: '2' | '5' | '10' | 'any';
    @IsOptional() @IsIn(['under-100', '100-200', '200-500', 'any']) budget?: 'under-100' | '100-200' | '200-500' | 'any';
    @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) diningStyles?: string[];
    @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) restaurantFeatures?: string[];
    @IsOptional() @IsIn(['popular', 'hidden-gems', 'new', 'local']) recommendationStyle?: 'popular' | 'hidden-gems' | 'new' | 'local';
    @IsOptional() @IsIn(['distance', 'quality', 'rating', 'price', 'atmosphere']) recommendationPriority?: 'distance' | 'quality' | 'rating' | 'price' | 'atmosphere';
    @IsOptional() @IsIn(['few', 'balanced', 'many']) suggestionCount?: 'few' | 'balanced' | 'many';
    @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PreferenceMemoryDto) memories?: PreferenceMemoryDto[];
}

export class PreferenceMemoryDto {
    @IsString() id!: string;
    @IsString() text!: string;
}

export class UpdatePreferencesDto {
    @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) favoriteCategorySlugs?: string[];
    @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) dietaryPreferences?: string[];
    @IsOptional() @IsArray() @ArrayMaxSize(4) @IsInt({ each: true }) @Min(1, { each: true }) @Max(4, { each: true }) preferredPriceLevels?: number[];
    @IsOptional() @IsObject() @ValidateNested() @Type(() => AiPreferencesDto) aiPreferences?: AiPreferencesDto;
}