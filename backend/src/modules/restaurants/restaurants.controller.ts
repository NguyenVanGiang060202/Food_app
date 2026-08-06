import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ListRestaurantsQueryDto, SimilarRestaurantsQueryDto } from './restaurants.dto';
import { RestaurantsService } from './restaurants.service';

@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}
  @Get()
  async list(@Query() query: ListRestaurantsQueryDto) {
    const locationError = query.validateLocationPair();
    if (locationError) throw new BadRequestException(locationError);
    return this.restaurantsService.list(query);
  }
  @Get(':restaurantId/similar')
  async similar(
    @Param('restaurantId', new ParseUUIDPipe()) restaurantId: string,
    @Query() query: SimilarRestaurantsQueryDto,
  ) {
    const restaurant = await this.restaurantsService.findById(restaurantId);
    if (!restaurant) throw new NotFoundException('Restaurant was not found.');
    return { data: await this.restaurantsService.listSimilar(restaurantId, query.limit) };
  }
  @Get(':restaurantId')
  async getById(@Param('restaurantId', new ParseUUIDPipe()) restaurantId: string) {
    const restaurant = await this.restaurantsService.findById(restaurantId);
    if (!restaurant) throw new NotFoundException('Restaurant was not found.');
    return { data: restaurant };
  }
}
