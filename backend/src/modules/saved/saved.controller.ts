import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { SavedRepository } from './saved.repository';

interface AuthenticatedRequest {
  user: AuthUser;
}

export class ListSavedQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 12;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 500)
  cursor?: string;
}

@Controller('saved')
@UseGuards(AuthGuard)
export class SavedController {
  constructor(private readonly saved: SavedRepository) {}
  @Get() list(@Req() req: AuthenticatedRequest, @Query() query: ListSavedQueryDto) {
    return this.saved
      .list(req.user.id, query)
      .then((result) => ({ data: result.data, meta: result.meta }));
  }
  @Get(':restaurantId') has(
    @Req() req: AuthenticatedRequest,
    @Param('restaurantId', new ParseUUIDPipe()) restaurantId: string,
  ) {
    return this.saved.has(req.user.id, restaurantId).then((saved) => ({ saved }));
  }
  @Post(':restaurantId') save(
    @Req() req: AuthenticatedRequest,
    @Param('restaurantId', new ParseUUIDPipe()) restaurantId: string,
  ) {
    return this.saved.save(req.user.id, restaurantId).then(() => ({ saved: true }));
  }
  @Delete(':restaurantId') remove(
    @Req() req: AuthenticatedRequest,
    @Param('restaurantId', new ParseUUIDPipe()) restaurantId: string,
  ) {
    return this.saved.remove(req.user.id, restaurantId).then(() => ({ saved: false }));
  }
}
