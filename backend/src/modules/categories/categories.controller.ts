import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { DatabaseUnavailableException } from '../../common/database-unavailable.exception';
import { DatabaseService } from '../database/database.service';
interface CategoryRow {
  slug: string;
  name: string;
  description: string | null;
  parent_slug: string | null;
  restaurant_count?: number;
}
@Controller('categories')
export class CategoriesController {
  constructor(private readonly database: DatabaseService) {}
  @Get()
  async list() {
    try {
      const result = await this.database.query<CategoryRow>(
        `SELECT c.slug, c.name, c.description, p.slug AS parent_slug, COUNT(DISTINCT r.id)::int AS restaurant_count FROM category c LEFT JOIN category p ON p.id = c.parent_id LEFT JOIN restaurant_category rc ON rc.category_id = c.id LEFT JOIN restaurant r ON r.id = rc.restaurant_id AND r.status = 'active' WHERE c.is_active = true GROUP BY c.id, p.slug ORDER BY c.name`,
      );
      return { data: result.rows.map(this.toCategory) };
    } catch {
      throw new DatabaseUnavailableException();
    }
  }
  @Get(':slug')
  async getBySlug(@Param('slug') slug: string) {
    try {
      const result = await this.database.query<CategoryRow>(
        `SELECT c.slug, c.name, c.description, p.slug AS parent_slug, COUNT(DISTINCT r.id)::int AS restaurant_count FROM category c LEFT JOIN category p ON p.id = c.parent_id LEFT JOIN restaurant_category rc ON rc.category_id = c.id LEFT JOIN restaurant r ON r.id = rc.restaurant_id AND r.status = 'active' WHERE c.slug = $1 AND c.is_active = true GROUP BY c.id, p.slug`,
        [slug],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException('Category was not found.');
      return { data: this.toCategory(row) };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new DatabaseUnavailableException();
    }
  }
  private toCategory(row: CategoryRow) {
    return {
      slug: row.slug,
      name: row.name,
      description: row.description,
      parentSlug: row.parent_slug,
      restaurantCount: Number(row.restaurant_count ?? 0),
    };
  }
}
