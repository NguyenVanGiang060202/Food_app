import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseService } from '../database/database.service';

@Controller('media/restaurant-images')
export class MediaController {
  constructor(private readonly database: DatabaseService) {}

  @Get(':imageId')
  async getRestaurantImage(@Param('imageId', new ParseUUIDPipe()) imageId: string, @Res() response: ServerResponse) {
    const result = await this.database.query<{ key: string | null; content_type: string | null }>(
      "SELECT cached_object_key AS key, cached_content_type AS content_type FROM restaurant_image ri JOIN restaurant r ON r.id = ri.restaurant_id WHERE ri.id = $1 AND ri.status = 'active' AND r.status = 'active'",
      [imageId],
    );
    const row = result.rows[0];
    if (!row?.key) throw new NotFoundException('Image is not cached.');
    const root = process.env.IMAGE_STORAGE_DIR ?? join(process.cwd(), 'storage', 'restaurant-images');
    const file = join(root, row.key);
    try { await access(file); } catch { throw new NotFoundException('Image file is missing.'); }
    response.setHeader('Content-Type', row.content_type ?? 'image/jpeg');
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return createReadStream(file).pipe(response);
  }
}
