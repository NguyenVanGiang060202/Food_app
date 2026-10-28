import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';

export type RecommendationInteractionType = 'open' | 'save' | 'dismiss';

@Injectable()
export class RecommendationEventsRepository {
  constructor(private readonly database: DatabaseService) {}

  async record(
    userId: string,
    restaurantId: string,
    interactionType: RecommendationInteractionType,
    query?: string,
  ): Promise<void> {
    if (!['open', 'save', 'dismiss'].includes(interactionType)) return;
    const queryHash = query?.trim()
      ? createHash('sha256').update(query.trim().toLocaleLowerCase('vi-VN')).digest('hex')
      : null;
    await this.database.query(
      `INSERT INTO recommendation_interaction
        (user_id, restaurant_id, interaction_type, query_hash)
       SELECT $1, r.id, $3, $4
       FROM restaurant r
       WHERE r.id = $2 AND r.status = 'active'`,
      [userId, restaurantId, interactionType, queryHash],
    );
  }
}
