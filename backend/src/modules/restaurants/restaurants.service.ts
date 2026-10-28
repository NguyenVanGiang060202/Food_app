import { Injectable, Logger } from '@nestjs/common';
import { DatabaseUnavailableException } from '../../common/database-unavailable.exception';
import { RestaurantsRepository } from './restaurants.repository';
import type {
  RestaurantDetail,
  RestaurantFilters,
  RestaurantPage,
  RestaurantSummary,
} from './restaurants.types';

@Injectable()
export class RestaurantsService {
  private readonly logger = new Logger(RestaurantsService.name);

  constructor(private readonly repository: RestaurantsRepository) {}
  async findExactVerifiedDishName(query: string): Promise<string | undefined> {
    try {
      return await this.repository.findExactVerifiedDishName(query);
    } catch (error) {
      this.logger.error('verified dish name lookup failed', error instanceof Error ? error.stack : String(error));
      throw new DatabaseUnavailableException();
    }
  }
  async findUniqueVerifiedParentheticalDishName(query: string, district?: string): Promise<string | undefined> {
    try {
      return await this.repository.findUniqueVerifiedParentheticalDishName(query, district);
    } catch (error) {
      this.logger.error('parenthetical dish lookup failed', error instanceof Error ? error.stack : String(error));
      throw new DatabaseUnavailableException();
    }
  }
  async findUniqueVerifiedOrderedDishNameInDistrict(query: string, district: string): Promise<string | undefined> {
    try {
      return await this.repository.findUniqueVerifiedOrderedDishNameInDistrict(query, district);
    } catch (error) {
      this.logger.error('district-scoped ordered dish lookup failed', error instanceof Error ? error.stack : String(error));
      throw new DatabaseUnavailableException();
    }
  }
  async findVerifiedSlashDishNameInDistrict(query: string, district: string): Promise<string | undefined> {
    try {
      return await this.repository.findVerifiedSlashDishNameInDistrict(query, district);
    } catch (error) {
      this.logger.error('district-scoped composite dish lookup failed', error instanceof Error ? error.stack : String(error));
      throw new DatabaseUnavailableException();
    }
  }
  async list(filters: RestaurantFilters): Promise<RestaurantPage> {
    try {
      return await this.repository.list(filters);
    } catch (error) {
      this.logger.error(
        `restaurant catalog list failed (query=${filters.query ? 'text' : 'none'}, exactDishes=${filters.dishQueries?.length ?? 0}, alternativeDishes=${filters.dishQueriesAny?.length ?? 0}, radius=${filters.radiusMeters ?? 'none'}, embedding=${Boolean(filters.embedding)})`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new DatabaseUnavailableException();
    }
  }
  async listSimilar(id: string, limit?: number): Promise<RestaurantSummary[]> {
    try {
      return await this.repository.listSimilar(id, limit);
    } catch (error) {
      this.logger.error(
        `similar restaurant lookup failed (restaurantId=${id})`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new DatabaseUnavailableException();
    }
  }
  async findById(id: string): Promise<RestaurantDetail | undefined> {
    try {
      return await this.repository.findById(id);
    } catch (error) {
      this.logger.error(
        `restaurant detail lookup failed (restaurantId=${id})`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new DatabaseUnavailableException();
    }
  }
}
