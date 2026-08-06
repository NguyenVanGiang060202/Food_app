import { Injectable } from '@nestjs/common';
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
  constructor(private readonly repository: RestaurantsRepository) {}
  async list(filters: RestaurantFilters): Promise<RestaurantPage> {
    try {
      return await this.repository.list(filters);
    } catch {
      throw new DatabaseUnavailableException();
    }
  }
  async listSimilar(id: string, limit?: number): Promise<RestaurantSummary[]> {
    try {
      return await this.repository.listSimilar(id, limit);
    } catch {
      throw new DatabaseUnavailableException();
    }
  }
  async findById(id: string): Promise<RestaurantDetail | undefined> {
    try {
      return await this.repository.findById(id);
    } catch {
      throw new DatabaseUnavailableException();
    }
  }
}
