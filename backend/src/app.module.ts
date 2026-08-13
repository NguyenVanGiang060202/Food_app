import { Module } from '@nestjs/common';
import { SearchController, RecommendationsController } from './modules/search/search.controller';
import { HealthController } from './modules/health/health.controller';
import { RestaurantsController } from './modules/restaurants/restaurants.controller';
import { RestaurantsService } from './modules/restaurants/restaurants.service';
import { DatabaseModule } from './modules/database/database.module';
import { RestaurantsRepository } from './modules/restaurants/restaurants.repository';
import { CategoriesModule } from './modules/categories/categories.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { SavedModule } from './modules/saved/saved.module';
import { AiIntentService } from './modules/ai/ai-intent.service';
import { EmbeddingService } from './modules/ai/embedding.service';

@Module({
  imports: [DatabaseModule, CategoriesModule, AdminModule, AuthModule, SavedModule],
  controllers: [
    HealthController,
    RestaurantsController,
    SearchController,
    RecommendationsController,
  ],
  providers: [RestaurantsService, RestaurantsRepository, AiIntentService, EmbeddingService],
})
export class AppModule {}
