import { Module } from '@nestjs/common';
import { FoodIntelligenceController } from './food-intelligence.controller';
import { FoodIntelligenceService } from './food-intelligence.service';

@Module({ controllers: [FoodIntelligenceController], providers: [FoodIntelligenceService], exports: [FoodIntelligenceService] })
export class FoodIntelligenceModule {}
