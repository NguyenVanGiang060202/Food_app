import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { FoodIntelligenceService } from './food-intelligence.service';

@Controller('restaurants/:restaurantId/food-profile')
export class FoodIntelligenceController {
  constructor(private readonly intelligence: FoodIntelligenceService) {}

  @Get()
  async get(@Param('restaurantId') restaurantId: string) {
    return { data: await this.intelligence.getRestaurantProfile(restaurantId) };
  }

  @Post('rebuild')
  async rebuild(@Param('restaurantId') restaurantId: string) {
    return { data: await this.intelligence.rebuildRestaurantProfile(restaurantId) };
  }

  @Post('reviews/:reviewId/extract')
  async extractReview(@Param('reviewId') reviewId: string) {
    return { data: await this.intelligence.extractReviewOpinions(reviewId) };
  }

  @Post('reviews/extract-pending')
  async extractPending(@Body() body: { limit?: number }) {
    return { data: await this.intelligence.extractPendingReviewOpinions(body ?? {}) };
  }
}
