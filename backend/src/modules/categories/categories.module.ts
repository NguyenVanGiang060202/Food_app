import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { DishesController } from './dishes.controller';
import { DatabaseModule } from '../database/database.module';
@Module({ imports: [DatabaseModule], controllers: [CategoriesController, DishesController] })
export class CategoriesModule {}
