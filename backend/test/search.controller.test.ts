import assert from 'node:assert/strict';
import test from 'node:test';
import { RecommendationsController } from '../src/modules/search/search.controller';
import type {
  RestaurantPage,
  RestaurantSummary,
} from '../src/modules/restaurants/restaurants.types';

const restaurant = (id: string): RestaurantSummary => ({
  id,
  name: `Restaurant ${id}`,
  location: { formattedAddress: 'District 1', latitude: 10.77, longitude: 106.7 },
  categories: [{ slug: 'vegetarian', name: 'Vegetarian' }],
  rating: 4.5,
  reviewCount: 10,
  priceLevel: 2,
  coverImageUrl: null,
});

const page = (data: RestaurantSummary[]): RestaurantPage => ({
  data,
  meta: { nextCursor: null, limit: 20 },
});

test('recommendation forwards taste filters and applies the requested limit', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('one'), restaurant('two')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  const result = await controller.recommend({
    query: 'vegetarian food',
    filters: { taste: ['vegetarian'], priceLevel: 2 },
    limit: 1,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tastes, ['vegetarian']);
  assert.equal(calls[0].priceLevel, 2);
  assert.equal(result.data.length, 1);
  assert.equal(typeof result.data[0].explanation, 'string');
  assert.match(result.data[0].explanation ?? '', /vegetarian/);
});

test('an explicit vegetarian dish keeps its chay variant without requiring a vegetarian-only venue', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('tami')]);
    },
  } as never);

  await controller.recommend({ query: 'Tìm món mì Quảng chay', limit: 5 });
  assert.ok(calls.length > 0);
  assert.ok(calls.every((call) => call.category === undefined));
  assert.deepEqual(calls[0].dishQueries, ['mì quảng chay']);
  assert.ok(calls.every((call) => call.verifiedMenuOnly === true));
});

test('bún bò Huế chay remains an exact dish rather than a generic bún bò query', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('goc-hue')]);
    },
  } as never);

  await controller.recommend({ query: 'Bún Bò Huế chay', limit: 5 });
  assert.deepEqual(calls[0].dishQueries, ['bún bò huế chay']);
  assert.ok(calls.every((call) => call.category === undefined));
  assert.ok(calls.every((call) => call.verifiedMenuOnly === true));
});

test('an explicit ingredient suffix narrows the same verified dish', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('banh-canh')]);
    },
  } as never);

  await controller.recommend({ query: 'Tìm bánh canh cua tôm', limit: 5 });
  assert.deepEqual(calls[0].dishQueries, ['bánh canh cua tôm']);
  assert.ok(calls.every((call) => JSON.stringify(call.dishQueries) === JSON.stringify(['bánh canh cua tôm'])));
});

test('multiword menu variants do not collapse to the base bún bò dish', async () => {
  for (const [query, expected] of [
    ['Bún Bò Giò Chả Cua', 'bún bò giò chả cua'],
    ['Bún Bò Tái Chả', 'bún bò tái chả'],
    ['Bún Bò Đặc Biệt', 'bún bò đặc biệt'],
  ] as const) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
  }
});

test('bún đậu queries retain the dish and its named menu variant', async () => {
  for (const [query, expected] of [
    ['bún đậu', 'bún đậu'],
    ['bún đậu mắm tôm', 'bún đậu'],
    ['Bún đậu Homemade đặc biệt', 'bún đậu homemade đặc biệt'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([restaurant('dau')]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
  }
});

test('pizza requests stay strict and use a grounded summary', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('pizza')]);
    },
  };
  const controller = new RecommendationsController(restaurantsService as never);

  const result = await controller.recommend({
    query: 'tìm pizza gần tôi không có hả',
    location: { latitude: 10.78, longitude: 106.69 },
    limit: 5,
  });

  assert.equal(calls[0].strictFoodQuery, 'pizza');
  assert.equal(calls[0].radiusMeters, 5000);
  assert.deepEqual(calls[0].tastes, []);
  const understanding = 'understanding' in result.meta ? result.meta.understanding : null;
  assert.equal(understanding?.aiSummary, 'Bếp hiểu bạn muốn tìm pizza.');
});

test('pizza hải sản requires one verified dish instead of a pizza venue with unrelated seafood', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([]);
    },
  } as never);

  await controller.recommend({ query: 'pizza hải sản ở Quận 1', limit: 5 });
  assert.deepEqual(calls[0].dishQueries, ['pizza hải sản']);
  assert.equal(calls[0].district, 'Quận 1');
  assert.equal(calls[0].ingredientTerms, undefined);
  assert.equal(calls[0].verifiedMenuOnly, true);
});

test('specific noodle variants keep the full dish instead of collapsing to hủ tiếu or vịt tiềm', async () => {
  for (const [query, expected] of [
    ['mì vịt tiềm ở Quận 1', 'mì vịt tiềm'],
    ['hủ tiếu xào hải sản ở Gò Vấp', 'hủ tiếu xào hải sản'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
  }
});

test('mì xào in a district keeps both food words and permits a clearly labeled restaurant-name candidate', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([{ ...restaurant('mi-xao'), dishCandidate: true, dishEvidenceStatus: 'candidate_signal' }]);
    },
  } as never);

  const result = await controller.recommend({ query: 'quán mì xào quận 3', limit: 5 });
  assert.deepEqual(calls[0].dishQueries, ['mì xào']);
  assert.equal(calls[0].district, 'Quận 3');
  assert.equal(calls[0].category, undefined);
  assert.notEqual(calls[0].verifiedMenuOnly, true);
  assert.equal(result.data[0].restaurant.dishEvidenceStatus, 'candidate_signal');
});

test('regional and seafood rice variants keep their full verified menu identity', async () => {
  for (const [query, expected] of [
    ['bánh xèo miền Tây ở Quận 9', 'bánh xèo miền tây'],
    ['cơm chiên hải sản ở Quận 9', 'cơm chiên hải sản'],
    ['cơm chiên tôm ở Tân Bình', 'cơm chiên tôm'],
    ['mì udon thịt bò ở Tân Bình', 'mì udon thịt bò'],
    ['cơm tấm sườn ở Quận 1', 'cơm tấm sườn'],
    ['cơm tấm đùi gà ở Quận 1', 'cơm tấm đùi gà'],
    ['canh khổ qua ở Quận 1', 'canh khổ qua'],
    ['bánh mì Bà Huynh đặc biệt ở Quận 1', 'bánh mì bà huynh đặc biệt'],
    ['bánh mì trứng ốp la ở Quận 1', 'bánh mì trứng ốp la'],
    ['bánh mì nem nướng ở Quận 1', 'bánh mì nem nướng'],
    ['bún khô lụi heo nướng ở Tân Bình', 'bún khô lụi heo nướng'],
    ['cuốn lụi bò ở Tân Bình', 'cuốn lụi bò'],
    ['cuốn lụi heo ở Tân Bình', 'cuốn lụi heo'],
    ['gỏi tré trộn xoài ở Tân Bình', 'gỏi tré trộn xoài'],
    ['mì bò Đài Loan ở Quận 3', 'mì bò đài loan'],
    ['mì sườn bò hầm ở Quận 3', 'mì sườn bò hầm'],
    ['mì sủi cảo tôm ở Quận 3', 'mì sủi cảo tôm'],
    ['mì gà chiên ở Quận 3', 'mì gà chiên'],
    ['mì khô xá xíu ở Quận 3', 'mì khô xá xíu'],
    ['chả cá Đế Vương ở Quận 10', 'chả cá đế vương'],
    ['lẩu cá lăng ở Quận 10', 'lẩu cá lăng'],
    ['salad da cá ở Quận 10', 'salad da cá'],
    ['cháo cá ở Quận 10', 'cháo cá'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
    if (query.startsWith('bún khô') || query.startsWith('mì khô')) assert.equal(calls[0].dishStyle, undefined, query);
    assert.equal(calls[0].district, query.includes('Tân Bình') ? 'Tân Bình' : query.includes('Quận 10') ? 'Quận 10' : query.includes('Quận 1') ? 'Quận 1' : query.includes('Quận 3') ? 'Quận 3' : 'Quận 9', query);
  }
});

test('named Sushi World menu dishes use exact verified-menu retrieval in Củ Chi', async () => {
  for (const [query, expected] of [
    ['California maki ở Củ Chi', 'california maki'],
    ['Ebi tempura ở Củ Chi', 'ebi tempura'],
    ['Hotate sashimi ở Củ Chi', 'hotate sashimi'],
    ['Beef salad ở Củ Chi', 'beef salad'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
    assert.equal(calls[0].district, 'Củ Chi', query);
  }
});

test('named Pazzi menu dishes use exact verified-menu retrieval in Quận 1', async () => {
  for (const [query, expected] of [
    ['Pizza Margherita ở Quận 1', 'pizza margherita'],
    ['Pizza Calzone ở Quận 1', 'pizza calzone'],
    ['Salad cá hồi ở Quận 1', 'salad cá hồi'],
    ['Salad hải sản ở Quận 1', 'salad hải sản'],
    ['Mì Ý hải sản ở Quận 1', 'mì ý hải sản'],
    ['Cơm Ý hải sản ở Quận 1', 'cơm ý hải sản'],
    ['Súp bí đỏ ở Quận 1', 'súp bí đỏ'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
    assert.equal(calls[0].district, 'Quận 1', query);
  }
});

test('bare mì Ý resolves to verified spaghetti, while an unknown modifier stays exact', async () => {
  for (const [query, expected] of [
    ['Tìm mì Ý ở Quận 4', 'spaghetti'],
    ['Tìm mì Ý thịt bò ở Quận 4', 'mì ý'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
    assert.equal(calls[0].district, 'Quận 4', query);
  }
});

test('named Yagami mì kim chi variants require the exact verified menu in Củ Chi', async () => {
  for (const [query, expected] of [
    ['Mì bò viên Triều Châu ở Củ Chi', 'mì bò viên triều châu'],
    ['Mì kim chi thập cẩm ở Củ Chi', 'mì kim chi thập cẩm'],
    ['Mì kim chi sò điệp ở Củ Chi', 'mì kim chi sò điệp'],
    ['Mì kim chi hải sản ở Củ Chi', 'mì kim chi hải sản'],
    ['Mì kim chi bò Mỹ ở Củ Chi', 'mì kim chi bò mỹ'],
    ['Mì kim chi bò ở Củ Chi', 'mì kim chi bò'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
    assert.equal(calls[0].district, 'Củ Chi', query);
  }
});

test('Kim Hoa hủ tíu portion variants stay exact in Thủ Đức', async () => {
  for (const [query, expected] of [
    ['Hủ tíu Nam Vang nước tô đặc biệt ở Thủ Đức', 'hủ tíu nam vang nước tô đặc biệt'],
    ['Hủ tíu Nam Vang khô tô đặc biệt ở Thủ Đức', 'hủ tíu nam vang khô tô đặc biệt'],
    ['Hủ tíu nước bình thường ở Thủ Đức', 'hủ tíu nước bình thường'],
    ['Hủ tíu khô bình thường ở Thủ Đức', 'hủ tíu khô bình thường'],
    ['Hủ tíu nước nhỏ ở Thủ Đức', 'hủ tíu nước nhỏ'],
    ['Hủ tíu khô nhỏ ở Thủ Đức', 'hủ tíu khô nhỏ'],
    ['Hủ tíu em bé ở Thủ Đức', 'hủ tíu em bé'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
    assert.equal(calls[0].district, 'Thủ Đức', query);
  }
});

test('Phở Nhon chicken and rice variants stay exact in Thủ Đức', async () => {
  for (const [query, expected] of [
    ['Phở gà trống thiến thập cẩm ở Thủ Đức', 'phở gà trống thiến thập cẩm'],
    ['Phở lòng gà trứng non ở Thủ Đức', 'phở lòng gà trứng non'],
    ['Cơm gỏi gà xé ở Thủ Đức', 'cơm gỏi gà xé'],
    ['Xôi gà ta xé ở Thủ Đức', 'xôi gà ta xé'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
    assert.equal(calls[0].district, 'Thủ Đức', query);
  }
});

test('Tín Phát prepared cake labels stay exact in Gò Vấp', async () => {
  for (const [query, expected] of [
    ['Bánh kem mousse chanh dây ở Gò Vấp', 'bánh kem mousse chanh dây'],
    ['Bánh kem mousse trà xanh ở Gò Vấp', 'bánh kem mousse trà xanh'],
    ['Bánh kem bắp trái cây ở Gò Vấp', 'bánh kem bắp trái cây'],
    ['Bánh kem bento 90k ở Gò Vấp', 'bánh kem bento 90k'],
    ['Bánh kem tiramisu ở Gò Vấp', 'bánh kem tiramisu'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
    assert.equal(calls[0].district, 'Gò Vấp', query);
  }
});

test('Pizza & Bia official pizza labels and one common alias stay exact in Quận 3', async () => {
  for (const [query, expected] of [
    ['Pizza Pepperoni ở Quận 3', 'the pepperoni'],
    ['Pizza The Margherita ở Quận 3', 'the margherita'],
    ['Pizza The Fisherman ở Quận 3', 'the fisherman'],
    ['Truffle & Shroom pizza ở Quận 3', 'truffle shroom pizza'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
    assert.equal(calls[0].district, 'Quận 3', query);
  }
});

test('Xuân Hương menu-image dishes stay exact and district-scoped in Bình Chánh', async () => {
  for (const [query, expected] of [
    ['Chả giò Xuân Hương ở Bình Chánh', 'chả giò xuân hương'],
    ['Gỏi bò wasabi ở Bình Chánh', 'gỏi bò wasabi'],
    ['Gà đất hấp niêu ở Bình Chánh', 'gà đất hấp niêu'],
    ['Súp hải sản ở Bình Chánh', 'súp hải sản'],
    ['Đậu hũ chiên sả ớt ở Bình Chánh', 'đậu hũ chiên sả ớt'],
    ['Cơm cháy kho quẹt ở Bình Chánh', 'cơm cháy kho quẹt'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(calls[0].dishQueries, [expected], query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
    assert.equal(calls[0].district, 'Bình Chánh', query);
    assert.deepEqual(calls[0].ingredientTerms ?? [], [], query);
  }
});

test('new reviewed menu names resolve through the catalog without a static phrase entry', async () => {
  for (const [query, expectedLookup] of [
    ['Rau lang luộc ở Bình Chánh', 'Rau lang luộc'],
    ['Salad cá mòi ở Bình Chánh', 'Salad cá mòi'],
    ['Bò lúc lắc khoai tây ở Bình Chánh', 'Bò lúc lắc khoai tây'],
    ['Khổ qua xào trứng ở Bình Chánh', 'Khổ qua xào trứng'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const lookups: string[] = [];
    const service = {
      async findExactVerifiedDishName(phrase: string) {
        lookups.push(phrase);
        return phrase;
      },
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    };
    const controller = new RecommendationsController(service as never);
    await controller.recommend({ query, limit: 5 });
    assert.deepEqual(lookups, [expectedLookup], query);
    assert.equal((calls[0].dishQueries as string[]).length, 1, query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
    assert.equal(calls[0].district, 'Bình Chánh', query);
    assert.deepEqual(calls[0].ingredientTerms ?? [], [], query);
  }
});

test('a unique district menu suffix keeps the full verified dish when the user omits parentheses', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async findExactVerifiedDishName() { return undefined; },
    async findUniqueVerifiedParentheticalDishName(query: string, district?: string) {
      assert.equal(query, 'Ramen Xá Xíu');
      assert.equal(district, 'Thủ Đức');
      return 'Ramen Xá Xíu (nước)';
    },
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([{ ...restaurant('sushiway'), matchedDishes: ['Ramen Xá Xíu (nước)'], dishEvidenceStatus: 'verified_menu' }]);
    },
  } as never);
  const result = await controller.recommend({ query: 'Ramen Xá Xíu ở Thủ Đức', limit: 5 });
  assert.deepEqual(calls[0].dishQueries, ['Ramen Xá Xíu (nước)']);
  assert.equal(calls[0].district, 'Thủ Đức');
  assert.equal(calls[0].verifiedMenuOnly, true);
  assert.equal(calls[0].exactDishNameOnly, true);
  assert.equal(result.data[0].restaurant.dishEvidenceStatus, 'verified_menu');
});

test('a unique verified suffix resolves a dish request without a district', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async findExactVerifiedDishName() { return undefined; },
    async findUniqueVerifiedParentheticalDishName(query: string, district?: string) {
      assert.equal(query, 'Ramen Xá Xíu');
      assert.equal(district, undefined);
      return 'Ramen Xá Xíu (nước)';
    },
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([{ ...restaurant('sushiway'), matchedDishes: ['Ramen Xá Xíu (nước)'], dishEvidenceStatus: 'verified_menu' }]);
    },
  } as never);
  const result = await controller.recommend({ query: 'Ramen Xá Xíu', limit: 5 });
  assert.deepEqual(calls[0].dishQueries, ['Ramen Xá Xíu (nước)']);
  assert.equal(calls[0].verifiedMenuOnly, true);
  assert.equal(calls[0].exactDishNameOnly, true);
  assert.equal(result.data[0].restaurant.dishEvidenceStatus, 'verified_menu');
});

test('a unique ordered local menu name resolves a shortened dish phrase', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async findExactVerifiedDishName() { return undefined; },
    async findUniqueVerifiedParentheticalDishName() { return undefined; },
    async findUniqueVerifiedOrderedDishNameInDistrict(query: string, district: string) {
      assert.equal(query, 'Cơm chiên cua xé');
      assert.equal(district, 'Quận 3');
      return 'Cơm Chiên Thịt Cua Xé Sốt X.O';
    },
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([{ ...restaurant('lobster-bay'), matchedDishes: ['Cơm Chiên Thịt Cua Xé Sốt X.O'], dishEvidenceStatus: 'verified_menu' }]);
    },
  } as never);
  const result = await controller.recommend({ query: 'Cơm chiên cua xé ở Quận 3', limit: 5 });
  assert.deepEqual(calls[0].dishQueries, ['Cơm Chiên Thịt Cua Xé Sốt X.O']);
  assert.equal(calls[0].district, 'Quận 3');
  assert.equal(calls[0].verifiedMenuOnly, true);
  assert.equal(calls[0].exactDishNameOnly, true);
  assert.equal(result.data[0].restaurant.dishEvidenceStatus, 'verified_menu');
});

test('a full reviewed menu name outranks a shorter dish or cooking-method alias', async () => {
  for (const [query, dish] of [
    ['Dồi bò nướng ở Tân Phú', 'Dồi bò nướng'],
    ['Bò tơ hấp cuộn rau rừng ở Tân Phú', 'Bò tơ hấp cuộn rau rừng'],
    ['Vịt tiềm tứ vị+ Mì hấp tỏi ở Tân Phú', 'Vịt tiềm tứ vị+ Mì hấp tỏi'],
    ['Bún đậu no nê ở Tân Phú', 'Bún đậu no nê'],
    ['Chè của mẹ ở Tân Phú', 'Chè của mẹ'],
    ['Bánh mì xíu mại đồ chua riêng ở Quận 1', 'Bánh mì xíu mại (đồ chua riêng)'],
    ['Lẩu bò Nhân Phát ở Tân Phú', 'Lẩu bò Nhân Phát'],
    ['Thịt kho trứng nước dừa ở Tân Phú', 'Thịt kho trứng nước dừa'],
  ]) {
    const calls: Array<Record<string, unknown>> = [];
    const lookups: string[] = [];
    const expectedLookup = dish.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const controller = new RecommendationsController({
      async findExactVerifiedDishName(phrase: string) {
        lookups.push(phrase);
        return phrase === expectedLookup ? dish : undefined;
      },
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([]);
      },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.equal(lookups[0], expectedLookup, query);
    assert.deepEqual(calls[0].dishQueries, [dish], query);
    assert.equal(calls[0].verifiedMenuOnly, true, query);
    assert.equal(calls[0].exactDishNameOnly, true, query);
    assert.equal(calls[0].dishStyle, undefined, query);
    assert.equal(calls[0].district, query.includes('Quận 1') ? 'Quận 1' : 'Tân Phú', query);
  }
});

test('empty exact result in an explicit district retries only a verified local slash-composite label', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async findExactVerifiedDishName() { return 'BÁNH MÌ THỊT NƯỚNG'; },
    async findVerifiedSlashDishNameInDistrict(query: string, district: string) {
      assert.equal(query, 'Bánh mì thịt nướng');
      assert.equal(district, 'Quận 1');
      return 'Bánh mì thịt nướng/ BBQ/ Thổ Nhĩ Kỳ';
    },
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([]);
    },
  } as never);
  await controller.recommend({ query: 'Bánh mì thịt nướng ở Quận 1', limit: 5 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].dishQueries, ['BÁNH MÌ THỊT NƯỚNG']);
  assert.deepEqual(calls[1].dishQueries, ['Bánh mì thịt nướng/ BBQ/ Thổ Nhĩ Kỳ']);
  assert.equal(calls[1].exactDishNameOnly, true);
  assert.equal(calls[1].district, 'Quận 1');
});

test('generic mì nearby keeps a lexical food constraint and the GPS radius', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('mi')]);
    },
  } as never);

  await controller.recommend({
    query: 'quán mì gần tôi',
    location: { latitude: 10.772, longitude: 106.698 },
    filters: { radiusMeters: 5000 },
    limit: 5,
  });

  assert.equal(calls[0].query, 'mì');
  assert.equal(calls[0].strictFoodQuery, 'mì');
  assert.equal(calls[0].category, 'noodle');
  assert.equal(calls[0].radiusMeters, 5000);
});

test('mì hải sản stays an exact dish instead of collapsing to generic seafood', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([]);
    },
  } as never);

  const result = await controller.recommend({ query: 'Tìm món mì hải sản', limit: 5 });

  assert.deepEqual(calls[0].dishQueries, ['mì hải sản']);
  assert.equal(calls[0].strictFoodQuery, undefined);
  assert.equal(result.data.length, 0);
  assert.equal('quality' in result.meta ? result.meta.quality?.code : null, 'MENU_EVIDENCE_MISSING');
});

test('explicit bún bò with a price is not narrowed by AI to generic beef', async () => {
  const calls: Array<Record<string, unknown>> = [];
  let aiCalls = 0;
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => {
      aiCalls += 1;
      return {
        categories: [], dishes: ['bò'], tastes: [], district: null,
        priceLevel: 1, minRating: null, openNow: null, distanceKm: null,
        canonicalDishes: [{ dish: 'bò', confidence: 1, evidence: 'menu_evidence' }],
      };
    },
  };
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([]);
    },
  } as never, undefined, aiIntent as never);

  await controller.recommend({ query: 'Tìm quán bún bò dưới 50k', limit: 5 });

  assert.deepEqual(calls[0].dishQueries, ['bún bò']);
  assert.equal(calls[0].priceLevel, undefined);
  assert.equal(aiCalls, 0);
});

test('negated spicy preference is not interpreted as a request for spicy food', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('mild')]);
    },
  } as never);

  await controller.recommend({ query: 'Tôi không ăn cay', limit: 5 });

  assert.deepEqual(calls[0].tastes, []);
  assert.deepEqual(calls[0].excludedFoodTerms, ['cay']);
});

test('negated fried chicken remains a chicken search without a fried taste filter', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('chicken')]);
    },
  } as never);

  await controller.recommend({ query: 'Tôi muốn ăn gà nhưng không phải gà chiên', limit: 5 });

  assert.equal(calls[0].query, 'gà');
  assert.deepEqual(calls[0].tastes, []);
  assert.deepEqual(calls[0].excludedFoodTerms, ['gà chiên']);
});

test('a negative-only food preference remains actionable discovery', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('alternative')]);
    },
  } as never);

  const result = await controller.recommend({ query: 'Không ăn cơm hôm nay', limit: 5 });

  assert.equal(result.data.length, 1);
  assert.deepEqual(calls[0].excludedFoodTerms, ['cơm']);
  assert.equal(calls[0].category, undefined);
});

test('a pho alternative excludes beef instead of selecting the negated dish', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([]);
    },
  } as never);

  await controller.recommend({ query: 'Có món giống phở nhưng không phải phở bò không?', limit: 5 });

  assert.deepEqual(calls[0].dishQueries, ['phở gà']);
  assert.deepEqual(calls[0].excludedFoodTerms, ['phở bò', 'thịt bò']);
  assert.equal(calls[0].ingredientTerms, undefined);
  assert.equal(calls[0].strictFoodQuery, 'phở');

  await controller.recommend({ query: 'Có món nào giống phở nhưng không dùng thịt bò không?', limit: 5 });
  const alternateCall = calls.at(-1)!;
  assert.deepEqual(alternateCall.dishQueries, ['phở gà']);
  assert.deepEqual(alternateCall.excludedFoodTerms, ['thịt bò']);
  assert.equal(alternateCall.strictFoodQuery, 'phở');
  assert.equal(alternateCall.query, 'phở');
  assert.equal(alternateCall.verifiedMenuOnly, true);
});

test('seafood with mì keeps both ingredients rather than generic seafood only', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([]);
    },
  } as never);

  await controller.recommend({ query: 'Tôi muốn ăn món có hải sản và mì', limit: 5 });

  assert.deepEqual(calls[0].dishQueries, []);
  assert.deepEqual(calls[0].ingredientTerms, ['hải sản', 'mì']);
});

test('light-food evidence is not replaced with unrelated top-rated restaurants', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return filters.sort === 'rating' ? page([restaurant('unrelated')]) : page([]);
    },
  } as never);

  const result = await controller.recommend({ query: 'Tôi muốn món thanh đạm, ít dầu mỡ', limit: 5 });

  assert.equal(result.data.length, 0);
  assert.ok(calls.every((call) => JSON.stringify(call.tastes) === JSON.stringify(['thanh đạm'])));
  assert.equal('quality' in result.meta ? result.meta.quality?.code : null, 'NO_VERIFIED_TASTE_MATCH');
});

test('multi-ingredient requests require one grounded dish and never broaden to popular venues', async () => {
  const calls: Array<Record<string, unknown>> = [];
  let aiCalls = 0;
  const aiIntent = {
    isEnabled: () => true,
    async interpret() {
      aiCalls += 1;
      return null;
    },
  };
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([]);
    },
  } as never, undefined, aiIntent as never);

  const result = await controller.recommend({ query: 'Tìm món có thịt bò và rau', limit: 5 });

  assert.deepEqual(calls[0].ingredientTerms, ['thịt bò', 'rau']);
  assert.equal(calls.length, 1);
  assert.equal(aiCalls, 0);
  assert.equal('quality' in result.meta ? result.meta.quality?.code : null, 'NO_VERIFIED_INGREDIENT_MATCH');
});

test('an explicit single ingredient does not wait for AI to invent a dish', async () => {
  const calls: Array<Record<string, unknown>> = [];
  let aiCalls = 0;
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('tom')]);
    },
  } as never, undefined, {
    isEnabled: () => true,
    async interpret() {
      aiCalls += 1;
      return null;
    },
  } as never);

  const result = await controller.recommend({
    query: 'Tôi muốn tìm món có nguyên liệu chính là tôm',
    limit: 5,
  });

  assert.equal(result.data.length, 1);
  assert.deepEqual(calls[0].ingredientTerms, ['tôm']);
  assert.equal(aiCalls, 0);
  assert.equal('quality' in result.meta ? result.meta.quality?.code : null, 'CONSTRAINT_UNVERIFIED');
  assert.match('quality' in result.meta ? result.meta.quality?.message ?? '' : '', /thành phần món/);
});

test('unsupported protein constraint never drops the vegetarian category', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([]);
    },
  } as never);

  const result = await controller.recommend({ query: 'Món chay nhiều protein', limit: 5 });

  assert.equal(result.data.length, 0);
  assert.ok(calls.every((call) => call.category === 'vegetarian'));
});

test('vegetarian protein request can show category candidates with nutrition caveat', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const controller = new RecommendationsController({
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page(filters.category === 'vegetarian' && !filters.query ? [restaurant('vegetarian')] : []);
    },
  } as never);

  const result = await controller.recommend({ query: 'Món chay nhiều protein', limit: 5 });

  assert.equal(result.data.length, 1);
  assert.ok(calls.every((call) => call.category === 'vegetarian'));
  assert.equal(calls.at(-1)?.query, undefined);
  assert.equal('quality' in result.meta ? result.meta.quality?.code : null, 'CONSTRAINT_UNVERIFIED');
  assert.match('quality' in result.meta ? result.meta.quality?.message ?? '' : '', /protein/);
});

test('unverified nutrition, preparation and broad numeric price constraints are disclosed', async () => {
  for (const query of [
    'Món chay nhiều protein',
    'Tìm món gà bỏ da',
    'Tìm món gì đó ngon, giá dưới 50k',
  ]) {
    const controller = new RecommendationsController({
      async list() { return page([restaurant('candidate')]); },
    } as never);
    const result = await controller.recommend({ query, limit: 5 });
    assert.equal(result.data.length, 1);
    assert.equal('quality' in result.meta ? result.meta.quality?.code : null, 'CONSTRAINT_UNVERIFIED');
  }
});

test('an exact dish budget requires a verified menu price and preserves strict versus inclusive limits', async () => {
  for (const [query, amount, exclusive] of [
    ['Sushi Tôm ở Quận 8 giá dưới 50.000 đồng', 50_000, true],
    ['Sushi Tôm ở Quận 8 tối đa 50k', 50_000, false],
  ] as const) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async findExactVerifiedDishName() { return 'Sushi Tôm'; },
      async list(filters: Record<string, unknown>) {
        calls.push(filters);
        return page([{ ...restaurant('sushiway'), matchedDishes: ['Sushi Tôm'], dishEvidenceStatus: 'verified_menu' }]);
      },
    } as never);
    const result = await controller.recommend({ query, limit: 5 });
    assert.equal(calls[0].district, 'Quận 8');
    assert.deepEqual(calls[0].dishQueries, ['Sushi Tôm']);
    assert.equal(calls[0].verifiedMenuOnly, true);
    assert.equal(calls[0].maxDishPriceVnd, amount);
    assert.equal(calls[0].maxDishPriceExclusive, exclusive);
    assert.equal('quality' in result.meta ? result.meta.quality?.code : null, null);
  }
});

test('an exact dish above budget returns a price-aware empty result', async () => {
  const controller = new RecommendationsController({
    async findExactVerifiedDishName() { return 'Sushi Tôm'; },
    async list() { return page([]); },
  } as never);
  const result = await controller.recommend({ query: 'Sushi Tôm ở Quận 8 giá dưới 30.000 đồng', limit: 5 });
  assert.equal(result.data.length, 0);
  assert.equal('quality' in result.meta ? result.meta.quality?.code : null, 'MENU_EVIDENCE_MISSING');
  assert.match('quality' in result.meta ? result.meta.quality?.message ?? '' : '', /giá.*dưới 30\.000 đồng/);
});

test('a newly curated menu dish keeps its exact lookup text when a budget is present', async () => {
  for (const query of [
    'Maki Lươn ở Quận 8 giá dưới 50.000 đồng',
    'Maki Lươn ở Quận 8 tối đa 50k',
    'Maki Lươn ở Quận 8 ngân sách dưới 50k',
  ]) {
    const lookups: string[] = [];
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async findExactVerifiedDishName(phrase: string) { lookups.push(phrase); return phrase === 'Maki Lươn' ? 'Maki Lươn' : undefined; },
      async list(filters: Record<string, unknown>) { calls.push(filters); return page([]); },
    } as never);
    await controller.recommend({ query, limit: 5 });
    assert.ok(lookups.includes('Maki Lươn'), JSON.stringify({ query, lookups }));
    assert.deepEqual(calls[0].dishQueries, ['Maki Lươn']);
    assert.equal(calls[0].maxDishPriceVnd, 50_000);
  }
});

test('a radius written in metres is never treated as a dish-price budget', async () => {
  for (const query of ['Tìm bún bò cách tôi dưới 3000m', 'Tìm bún bò cách tôi dưới 3.000 m']) {
    const calls: Array<Record<string, unknown>> = [];
    const controller = new RecommendationsController({
      async list(filters: Record<string, unknown>) { calls.push(filters); return page([]); },
    } as never);
    await controller.recommend({ query, location: { latitude: 10.78, longitude: 106.69 }, limit: 5 });
    assert.ok(calls.every((call) => call.maxDishPriceVnd === undefined), query);
  }
});

test('dry-food requests become a dish-style constraint, not a taste word', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('dry')]);
    },
  };
  const controller = new RecommendationsController(restaurantsService as never);

  const result = await controller.recommend({
    query: 'tìm món khô gần tôi',
    location: { latitude: 10.78, longitude: 106.69 },
    limit: 5,
  });

  assert.equal(calls[0].dishStyle, 'dry');
  assert.deepEqual(calls[0].tastes, []);
  const understanding = 'understanding' in result.meta ? result.meta.understanding : null;
  assert.equal(understanding?.filters.dishStyle, 'dry');
  assert.equal(understanding?.aiSummary, 'Bếp hiểu bạn muốn tìm món khô.');
});

test('brothy-food requests become a menu-backed dish-style constraint', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('brothy')]);
    },
  };
  const controller = new RecommendationsController(restaurantsService as never);

  const result = await controller.recommend({ query: 'tìm món nước', limit: 5 });

  assert.equal(calls[0].dishStyle, 'brothy');
  assert.deepEqual(calls[0].tastes, []);
  const understanding = 'understanding' in result.meta ? result.meta.understanding : null;
  assert.equal(understanding?.filters.dishStyle, 'brothy');
  assert.equal(understanding?.aiSummary, 'Bếp hiểu bạn muốn tìm món nước.');
});

test('strict pizza requests do not enqueue semantic embedding work', async () => {
  let embedCalls = 0;
  const embedding = {
    isEnabled: () => true,
    activeModel: async () => 'bge-m3@doc:v3',
    embed: async () => {
      embedCalls += 1;
      return [0.1];
    },
  };
  const restaurantsService = {
    async list() {
      return page([restaurant('pizza')]);
    },
  };
  const controller = new RecommendationsController(
    restaurantsService as never,
    undefined,
    undefined,
    embedding as never,
  );

  await controller.recommend({ query: 'pizza gần tôi', limit: 5 });

  assert.equal(embedCalls, 0);
});

test('deterministic pizza and dish-style requests bypass the AI intent round trip', async () => {
  let aiCalls = 0;
  const restaurantsService = {
    async list() {
      return page([restaurant('deterministic')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => {
      aiCalls += 1;
      return null;
    },
  };
  const controller = new RecommendationsController(
    restaurantsService as never,
    undefined,
    aiIntent as never,
  );

  await controller.recommend({ query: 'tìm pizza gần tôi', limit: 5 });
  await controller.recommend({ query: 'tìm món khô gần tôi', limit: 5 });

  assert.equal(aiCalls, 0);
});

test('recommendation forwards the authenticated user only to ranking context', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('personalized')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  const result = await controller.recommend({ query: 'phở', limit: 5 }, {
    user: { id: 'user-1', email: 'user@example.com', role: 'user' },
  } as never);

  assert.equal(result.data.length, 1);
  assert.equal(calls[0].personalizationUserId, 'user-1');
});

test('recommendation does not drop an unresolved food phrase into unrelated fallback results', async () => {
  const queries: Array<string | undefined> = [];
  const databaseService = {
    list: async (filters: { query?: string }) => {
      queries.push(filters.query);
      return page([]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  const result = await controller.recommend({ query: 'tìm món không tồn tại xyzabc', limit: 10 });

  assert.deepEqual(queries, ['xyzabc']);
  assert.equal(result.data.length, 0);
  const quality = 'quality' in result.meta ? result.meta.quality : null;
  assert.deepEqual(quality, {
    code: 'NO_RELEVANT_RESULTS',
    message: 'Chưa tìm thấy kết quả phù hợp với "xyzabc".',
  });
});

test('simple food lookups bypass AI and embedding timeouts', async () => {
  let aiCalls = 0;
  let embedCalls = 0;
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      assert.equal(filters.query, 'xyzabc');
      return page([]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => {
      aiCalls += 1;
      return null;
    },
  };
  const embedding = {
    isEnabled: () => true,
    activeModel: async () => 'bge-m3@doc:v3',
    embed: async () => {
      embedCalls += 1;
      return [0.1];
    },
  };
  const controller = new RecommendationsController(
    restaurantsService as never,
    undefined,
    aiIntent as never,
    embedding as never,
  );

  const result = await controller.recommend({ query: 'tìm món xyzabc', limit: 5 });

  assert.equal(aiCalls, 0);
  assert.equal(embedCalls, 0);
  assert.equal(result.data.length, 0);
});

test('broad food requests return ranked discovery results without inventing a dish', async () => {
  let calls = 0;
  let aiCalls = 0;
  const restaurantsService = {
    async list() {
      calls += 1;
      return page([restaurant('discovery')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => {
      aiCalls += 1;
      return null;
    },
  };
  const controller = new RecommendationsController(
    restaurantsService as never,
    undefined,
    aiIntent as never,
  );

  const result = await controller.recommend({ query: 'tôi muốn ăn gì đó ngon', limit: 10 });

  assert.equal(calls, 1);
  assert.equal(aiCalls, 0);
  assert.equal(result.data.length, 1);
  assert.equal('quality' in result.meta ? result.meta.quality : undefined, undefined);
});

test('broad nearby requests preserve the location filter', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('nearby')]);
    },
  };
  const controller = new RecommendationsController(restaurantsService as never);

  const result = await controller.recommend({
    query: 'món ngon gần tôi',
    location: { latitude: 10.78, longitude: 106.69 },
    limit: 10,
  });

  assert.equal(result.data.length, 1);
  assert.equal(calls[0].radiusMeters, 5000);
});

test('"chưa biết ăn gì" returns broad discovery without calling the AI provider', async () => {
  let aiCalls = 0;
  let calls = 0;
  const restaurantsService = {
    async list() {
      calls += 1;
      return page([restaurant('discovery')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => {
      aiCalls += 1;
      return null;
    },
  };
  const controller = new RecommendationsController(
    restaurantsService as never,
    undefined,
    aiIntent as never,
  );

  const result = await controller.recommend({
    query: 'Tôi chưa biết ăn gì, hãy gợi ý cho tôi.',
    limit: 10,
  });

  assert.equal(calls, 1);
  assert.equal(aiCalls, 0);
  assert.equal(result.data.length, 1);
});

test('discovery prompts with a time phrase return broad results', async () => {
  let calls = 0;
  const restaurantsService = {
    async list() {
      calls += 1;
      return page([restaurant('dinner')]);
    },
  };
  const controller = new RecommendationsController(restaurantsService as never);

  const result = await controller.recommend({ query: 'ăn gì hôm nay ngon', limit: 10 });

  assert.equal(calls, 1);
  assert.equal(result.data.length, 1);
});

test('non-taxonomy cuisine phrases become strict food constraints', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([]);
    },
  };
  const controller = new RecommendationsController(restaurantsService as never);

  await controller.recommend({ query: 'lẩu gần tôi', limit: 5 });

  assert.equal(calls[0].strictFoodQuery, 'lẩu');
  assert.equal(calls[0].category, undefined);
});

test('taste-only requests bypass AI and semantic embedding', async () => {
  let aiCalls = 0;
  let embedCalls = 0;
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      assert.deepEqual(filters.tastes, ['cay']);
      return page([restaurant('spicy')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => {
      aiCalls += 1;
      return null;
    },
  };
  const embedding = {
    isEnabled: () => true,
    activeModel: async () => 'bge-m3@doc:v3',
    embed: async () => {
      embedCalls += 1;
      return [0.1];
    },
  };
  const controller = new RecommendationsController(
    restaurantsService as never,
    undefined,
    aiIntent as never,
    embedding as never,
  );

  const result = await controller.recommend({ query: 'món cay', limit: 5 });

  assert.equal(aiCalls, 0);
  assert.equal(embedCalls, 0);
  assert.equal(result.data[0].restaurant.id, 'spicy');
});

test('recommendation falls back to rated restaurants but preserves the taste filters', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return filters.sort === 'rating' ? page([restaurant('rated')]) : page([]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  const result = await controller.recommend({
    query: 'món nóng',
    filters: { taste: ['nóng'] },
    limit: 10,
  });

  assert.equal(result.data[0].restaurant.id, 'rated');
  assert.equal(calls.at(-1)?.sort, 'rating');
  // The discovery fallback drops only the free-text query; the user's explicit
  // taste filter remains so we never return unrelated top-rated restaurants.
  assert.deepEqual(calls.at(-1)?.tastes, ['nóng']);
});

test('unsupported cuisine phrases do not fall back to unrelated restaurants', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  const result = await controller.recommend({ query: 'Gợi ý quán BBQ ngon gần tôi', limit: 5 });

  assert.equal(result.data.length, 0);
  assert.equal(calls[0].category, undefined);
  assert.equal(calls.length, 1);
});

test('"gợi ý" does not map to the Italian cuisine alias', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('any')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({
    query: 'hiện tại trời mưa, hãy gợi ý cho tôi quán gần đây',
    limit: 5,
  });

  assert.equal(calls[0].category, undefined);
});

test('rainy weather maps to a hot-comfort taste and semantic query', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('warm')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({ query: 'trời mưa rét, quán nào ấm bụng', limit: 5 });

  assert.deepEqual(calls[0].tastes, ['nóng']);
  assert.equal(calls[0].semanticQuery, 'món nóng ấm bụng');
});

test('natural rainy-weather sentence becomes a food-only hot comfort query', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('rainy-day')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({
    query: 'Hiện tại trời đang mưa, tôi muốn tìm món gì đó phù hợp với thời tiết này',
    limit: 5,
  });

  assert.deepEqual(calls[0].tastes, ['nóng']);
  assert.equal(calls[0].semanticQuery, 'món nóng ấm bụng');
  assert.equal(calls[0].query, undefined);
});

test('short rainy-weather sentence does not leave a suitability keyword filter', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('rainy-day')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({
    query: 'trời đang mưa, tôi muốn tìm món gì phù hợp',
    limit: 5,
  });

  assert.equal(calls[0].query, undefined);
  assert.deepEqual(calls[0].dishQueriesAny, [
    'bún bò Huế',
    'phở bò',
    'phở gà',
    'bún riêu',
    'lẩu bò',
    'bánh canh cua',
    'bún cá',
    'hủ tiếu',
    'cháo',
  ]);
});

test('rainy-weather filler words do not become a SQL text filter', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('rainy-day')]);
    },
  };
  const controller = new RecommendationsController(restaurantsService as never);

  await controller.recommend({ query: 'trời đang mưa, nên ăn gì', limit: 5 });

  assert.equal(calls[0].query, undefined);
  assert.deepEqual(calls[0].dishQueriesAny, [
    'bún bò Huế',
    'phở bò',
    'phở gà',
    'bún riêu',
    'lẩu bò',
    'bánh canh cua',
    'bún cá',
    'hủ tiếu',
    'cháo',
  ]);
});

test('rainy weather does not infer a nearby radius when the filter is off', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('nearby-rainy-day')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  const result = await controller.recommend({
    query: 'trời đang mưa, gợi ý món phù hợp',
    location: { latitude: 10.7769, longitude: 106.7009 },
    limit: 5,
  });

  assert.equal(calls[0].radiusMeters, undefined);
  assert.equal(calls[0].latitude, 10.7769);
  assert.equal(calls[0].longitude, 106.7009);
  const understanding = 'understanding' in result.meta ? result.meta.understanding : null;
  assert.equal(understanding?.filters.distanceKm, undefined);
});

test('rainy weather keeps an explicitly enabled nearby filter', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('nearby-rainy-day')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({
    query: 'trời đang mưa, gợi ý món phù hợp',
    location: { latitude: 10.7769, longitude: 106.7009 },
    filters: { radiusMeters: 5000 },
    limit: 5,
  });

  assert.equal(calls[0].radiusMeters, 5000);
});

test('weather alternatives skip embedding because menu evidence and radius are authoritative', async () => {
  let embedCalls = 0;
  const embedding = {
    isEnabled: () => true,
    activeModel: async () => 'bge-m3@doc:v3',
    embed: async () => {
      embedCalls += 1;
      return [0.1];
    },
  };
  const restaurantsService = {
    async list() {
      return page([restaurant('weather')]);
    },
  };
  const controller = new RecommendationsController(
    restaurantsService as never,
    undefined,
    undefined,
    embedding as never,
  );

  await controller.recommend({
    query: 'trời mưa, tìm món ấm bụng gần tôi',
    location: { latitude: 10.78, longitude: 106.69 },
    limit: 5,
  });

  assert.equal(embedCalls, 0);
});

test('deterministic weather-only recommendations bypass the AI round trip', async () => {
  let aiCalls = 0;
  const restaurantsService = {
    async list() {
      return page([restaurant('weather')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => {
      aiCalls += 1;
      return null;
    },
  };
  const controller = new RecommendationsController(
    restaurantsService as never,
    undefined,
    aiIntent as never,
  );

  await controller.recommend({
    query: 'trời mưa, tìm món ấm bụng gần tôi',
    location: { latitude: 10.78, longitude: 106.69 },
    limit: 5,
  });

  assert.equal(aiCalls, 0);
});

test('generic rainy weather ignores AI-invented exact dishes so nearby ordering stays active', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('rainy')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => ({
      categories: [],
      dishes: ['bún riêu', 'phở bò'],
      tastes: ['nóng'],
      district: null,
      priceLevel: null,
      minRating: null,
      openNow: null,
      distanceKm: null,
      summary: 'Món bún riêu hoặc phở bò cho trời mưa.',
      semanticQuery: 'món nóng ấm bụng',
      canonicalDishes: [
        { dish: 'Bún riêu', confidence: 1, evidence: 'inferred' },
        { dish: 'Phở bò', confidence: 1, evidence: 'inferred' },
      ],
    }),
  };
  const controller = new RecommendationsController(
    restaurantsService as never,
    undefined,
    aiIntent as never,
  );

  await controller.recommend({
    query: 'trời đang mưa, tìm món gì đó phù hợp gần tôi',
    location: { latitude: 10.78, longitude: 106.69 },
    limit: 5,
  });

  assert.deepEqual(calls[0].dishQueries, []);
  assert.deepEqual(calls[0].dishQueriesAny, [
    'bún bò Huế',
    'phở bò',
    'phở gà',
    'bún riêu',
    'lẩu bò',
    'bánh canh cua',
    'bún cá',
    'hủ tiếu',
    'cháo',
  ]);
  assert.equal(calls[0].radiusMeters, 5000);
});

test('cold weather maps to hot comfort food instead of the "mát" taste', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('warm')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({ query: 'trời trở lạnh, ăn gì cho ấm', limit: 5 });

  assert.deepEqual(calls[0].tastes, ['nóng']);
  assert.equal(calls[0].semanticQuery, 'món nóng ấm bụng');
});

test('hot weather maps to cold/refreshing food instead of the "nóng" taste', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('cool')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({
    query: 'trời đang nóng, tìm gì đó phù hợp gần đây cho tôi',
    limit: 5,
  });

  assert.deepEqual(calls[0].tastes, ['mát']);
  assert.equal(calls[0].semanticQuery, 'món mát lạnh');
});

test('hot weather wins over the LLM reading the word "nóng" as hot food', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('cool')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => ({
      categories: [],
      dishes: [],
      tastes: ['nóng', 'phù hợp'],
      district: null,
      priceLevel: null,
      minRating: null,
      openNow: null,
      distanceKm: null,
      summary: 'Bếp hiểu trời đang nóng.',
      semanticQuery: 'món ăn cho thời tiết nóng',
    }),
  };
  const controller = new RecommendationsController(
    databaseService as never,
    undefined,
    aiIntent as never,
  );

  await controller.recommend({ query: 'trời nóng, tìm gì đó phù hợp gần đây cho tôi', limit: 5 });

  // Deterministic weather reading ("mát") wins; the LLM's "nóng" + "phù hợp"
  // are dropped so they cannot AND into a filter that matches nothing.
  assert.deepEqual(calls[0].tastes, ['mát']);
  assert.equal(calls[0].semanticQuery, 'món mát lạnh');
});

test('solar heat phrases like "nắng nóng" also map to cold food', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('cool')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({ query: 'trời nắng nóng quá, quán nào có kem gần đây', limit: 5 });

  assert.deepEqual(calls[0].tastes, ['mát']);
});

test('recommendation uses the LLM intent when the AI service is enabled', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('ai-restaurant')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => ({
      categories: ['bun'],
      dishes: ['bún bò huế'],
      tastes: ['nóng'],
      district: 'Quận 1',
      priceLevel: 3,
      minRating: 4.4,
      openNow: true,
      distanceKm: 5,
      summary: 'Bếp hiểu bạn muốn món bún.',
      canonicalDishes: [{ dish: 'bún bò Huế', confidence: 1, evidence: 'exact' }],
    }),
  };
  const controller = new RecommendationsController(
    databaseService as never,
    undefined,
    aiIntent as never,
  );

  const result = await controller.recommend({
    query: 'món bún bò huế nóng gần quận 1, giá cao cấp, từ 4.4 sao, đang mở cửa',
    limit: 5,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].category, undefined);
  assert.equal(calls[0].priceLevel, 3);
  assert.equal(calls[0].minRating, 4.4);
  assert.equal(calls[0].openNow, true);
  assert.equal(calls[0].radiusMeters, 5000);
  assert.deepEqual(calls[0].tastes, ['nóng']);
  assert.deepEqual(calls[0].dishQueries, ['bún bò Huế']);
  assert.match(result.data[0].explanation ?? '', /nóng/);
  const understanding = 'understanding' in result.meta ? result.meta.understanding : null;
  assert.equal(understanding?.aiSummary, 'Bếp hiểu bạn muốn tìm món bún bò Huế.');
  assert.equal(understanding?.filters.category, undefined);
  assert.equal(understanding?.filters.district, 'Quận 1');
  assert.deepEqual(understanding?.filters.tastes, ['nóng']);
  assert.deepEqual(understanding?.filters.dishes, [
    { dish: 'bún bò Huế', confidence: 1, evidence: 'exact' },
  ]);
});

test('recommendation grounds noisy local-model filters in the user query', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('weather-grounded')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => ({
      categories: ['bun'],
      dishes: ['phở gà'],
      tastes: ['nóng', 'mặn', 'nướng'],
      district: 'Quận 1',
      priceLevel: 2,
      minRating: 4.0,
      openNow: true,
      distanceKm: 5,
      summary: 'Món nóng cho ngày mưa.',
      semanticQuery: 'phở gà nóng',
      canonicalDishes: [],
    }),
  };
  const controller = new RecommendationsController(
    databaseService as never,
    undefined,
    aiIntent as never,
  );

  await controller.recommend({
    query: 'trời đang mưa, tìm món phù hợp',
    limit: 5,
  });

  assert.equal(calls[0].category, undefined);
  assert.deepEqual(calls[0].dishQueries, []);
  assert.deepEqual(calls[0].tastes, ['nóng']);
  assert.equal(calls[0].district, undefined);
  assert.equal(calls[0].priceLevel, undefined);
  assert.equal(calls[0].minRating, undefined);
  assert.equal(calls[0].openNow, undefined);
  assert.equal(calls[0].radiusMeters, undefined);
});

test('weather recommendation keeps the understanding summary grounded', async () => {
  const restaurantsService = {
    async list() {
      return page([restaurant('weather-grounded-summary')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => ({
      categories: [],
      dishes: [],
      tastes: ['nóng'],
      district: null,
      priceLevel: null,
      minRating: null,
      openNow: null,
      distanceKm: null,
      summary: 'Món phở gà, bún bò Huế hoặc bún riêu sẽ rất hợp trời mưa.',
      semanticQuery: 'món nóng ấm bụng',
      canonicalDishes: [],
    }),
  };
  const controller = new RecommendationsController(
    restaurantsService as never,
    undefined,
    aiIntent as never,
  );

  const result = await controller.recommend({
    query: 'trời đang mưa, tìm món phù hợp',
    limit: 5,
  });

  const understanding = 'understanding' in result.meta ? result.meta.understanding : null;
  const summary = understanding?.aiSummary ?? '';
  assert.equal(summary, 'Món nóng, ấm bụng phù hợp trời mưa.');
  assert.doesNotMatch(summary, /phở gà|bún bò Huế|bún riêu/);
});

test('recommendation keeps a concrete dish modifier instead of collapsing to its family', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('variant')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => ({
      categories: ['noodle'],
      dishes: ['phở bò'],
      tastes: [],
      district: null,
      priceLevel: null,
      minRating: null,
      openNow: null,
      distanceKm: null,
      summary: 'Phở bò tái.',
      semanticQuery: 'phở bò tái',
      canonicalDishes: [],
    }),
  };
  const controller = new RecommendationsController(
    databaseService as never,
    undefined,
    aiIntent as never,
  );

  await controller.recommend({ query: 'tìm phở bò tái', limit: 5 });

  assert.deepEqual(calls[0].dishQueries, ['phở bò tái']);
});

test('low-coverage dish lookups stay exact-menu/candidate grounded', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('dish')]);
    },
  };
  const controller = new RecommendationsController(restaurantsService as never);

  await controller.recommend({ query: 'bún cá', limit: 5 });
  await controller.recommend({ query: 'hủ tiếu', limit: 5 });
  await controller.recommend({ query: 'cháo', limit: 5 });

  assert.deepEqual(calls.map((call) => call.dishQueries), [
    ['bún cá'],
    ['hủ tiếu'],
    ['cháo'],
  ]);
  // The repository deliberately ignores the distilled text when dishQueries
  // are present; keeping it in the controller payload is harmless and useful
  // for diagnostics.
  assert.deepEqual(calls.map((call) => call.query), ['bún cá', 'hủ tiếu', 'cháo']);
});

test('recommendation does not trust an AI district that is absent from the query', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('grounded')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => ({
      categories: [],
      dishes: [],
      tastes: [],
      district: 'Quận 1',
      priceLevel: null,
      minRating: null,
      openNow: null,
      distanceKm: null,
      summary: 'Bếp đoán bạn muốn Quận 1.',
      semanticQuery: 'món ăn',
      canonicalDishes: [],
    }),
  };
  const controller = new RecommendationsController(
    databaseService as never,
    undefined,
    aiIntent as never,
  );

  await controller.recommend({ query: 'tìm bún gần đây', limit: 5 });

  assert.equal(calls[0].district, undefined);
});

test('recommendation keeps a district only when it is present in the query', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('grounded')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => ({
      categories: [],
      dishes: [],
      tastes: [],
      district: 'Quận 1',
      priceLevel: null,
      minRating: null,
      openNow: null,
      distanceKm: null,
      summary: 'Bếp hiểu bạn muốn Quận 1.',
      semanticQuery: 'món ăn',
      canonicalDishes: [],
    }),
  };
  const controller = new RecommendationsController(
    databaseService as never,
    undefined,
    aiIntent as never,
  );

  await controller.recommend({ query: 'tìm bún gần Quận 1', limit: 5 });

  assert.equal(calls[0].district, 'Quận 1');
});

test('dish intent is a hard menu-evidence filter and is not converted into a taste', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('bun-bo')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never, undefined);

  await controller.recommend({ query: 'tìm bún bò huế', limit: 5 });

  assert.deepEqual(calls[0].dishQueries, ['bún bò huế']);
  assert.deepEqual(calls[0].tastes, []);
  assert.equal(calls[0].category, undefined);
});

test('deterministic parsing preserves a concrete dish phrase containing a cooking method', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return { data: [], meta: { nextCursor: null } };
    },
  };
  const controller = new RecommendationsController(restaurantsService as never);
  await controller.recommend({ query: 'bún thịt nướng', limit: 5 });
  assert.equal((calls[0].dishQueries as string[] | undefined)?.[0], 'bún thịt nướng');
  assert.deepEqual(calls[0].tastes, []);
});

test('bare concrete dish recommendations bypass the local model', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('fast-exact-dish')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => {
      throw new Error('simple exact dish should not call the local model');
    },
  };
  const controller = new RecommendationsController(
    restaurantsService as never,
    undefined,
    aiIntent as never,
  );

  await controller.recommend({ query: 'bún thịt nướng', limit: 5 });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].dishQueries, ['bún thịt nướng']);
});

test('concrete dish with nearby wrapper bypasses the local model', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([restaurant('fast-nearby-exact-dish')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => {
      throw new Error('nearby exact dish should use the deterministic path');
    },
  };
  const controller = new RecommendationsController(
    restaurantsService as never,
    undefined,
    aiIntent as never,
  );

  await controller.recommend({ query: 'tìm cơm tấm gần tôi', limit: 5 });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].dishQueries, ['cơm tấm']);
  assert.equal(calls[0].radiusMeters, 5000);
});

test('deterministic parsing hardens non-taxonomy concrete dishes against broad fallback', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return { data: [], meta: { nextCursor: null } };
    },
  };
  const controller = new RecommendationsController(restaurantsService as never);
  await controller.recommend({ query: 'lẩu bò', limit: 5 });
  assert.deepEqual(calls[0].dishQueries, ['lẩu bò']);
  assert.equal(calls.length, 1);
});

test('exact dish empty results expose a menu-evidence quality notice', async () => {
  const restaurantsService = {
    async list() {
      return page([]);
    },
  };
  const controller = new RecommendationsController(restaurantsService as never);
  const result = await controller.recommend({ query: 'phở bò', limit: 5 });
  assert.equal(result.data.length, 0);
  const quality = 'quality' in result.meta ? result.meta.quality : null;
  assert.deepEqual(quality, {
    code: 'MENU_EVIDENCE_MISSING',
    message: 'Chưa tìm thấy quán có món phở bò với menu đã xác minh trong các bộ lọc hiện tại.',
    dishes: ['phở bò'],
  });
});

test('combined dish and taste empty results do not blame missing dish evidence alone', async () => {
  let aiCalls = 0;
  const calls: Array<Record<string, unknown>> = [];
  const restaurantsService = {
    async list(filters: Record<string, unknown>) {
      calls.push(filters);
      return page([]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    async interpret() {
      aiCalls += 1;
      return null;
    },
  };
  const controller = new RecommendationsController(restaurantsService as never, undefined, aiIntent as never);
  const result = await controller.recommend({
    query: 'Tìm quán bún bò cay vừa, cách tôi dưới 3 km',
    location: { latitude: 10.78, longitude: 106.69 },
    filters: { radiusMeters: 3000 },
    limit: 5,
  });
  const quality = 'quality' in result.meta ? result.meta.quality : null;
  assert.equal(quality?.code, 'NO_VERIFIED_COMBINATION');
  assert.match(quality?.message ?? '', /bún bò.*cay/);
  assert.equal(aiCalls, 0);
  assert.ok(calls.every((call) => call.maxDishPriceVnd === undefined));
});

test('weather empty results expose a menu-evidence quality notice', async () => {
  const restaurantsService = {
    async list() {
      return page([]);
    },
  };
  const controller = new RecommendationsController(restaurantsService as never);
  const result = await controller.recommend({
    query: 'trời đang mưa, tìm món nóng',
    limit: 5,
  });

  const quality = 'quality' in result.meta ? result.meta.quality : null;
  assert.deepEqual(quality, {
    code: 'MENU_EVIDENCE_MISSING',
    message: 'Chưa tìm thấy món nóng/ấm bụng có menu đã xác minh trong các bộ lọc hiện tại.',
    dishes: [
      'bún bò Huế',
      'phở bò',
      'phở gà',
      'bún riêu',
      'lẩu bò',
      'bánh canh cua',
      'bún cá',
      'hủ tiếu',
      'cháo',
    ],
  });
});

test('for-you uses all saved category and price preferences and removes duplicates', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      const category = filters.category as string | undefined;
      const priceLevel = filters.priceLevel as number | undefined;
      return page([
        restaurant(`${category ?? 'none'}-${priceLevel ?? 'none'}`),
        restaurant('shared'),
      ]);
    },
  };
  const auth = {
    getPreferences: async () => ({
      favoriteCategorySlugs: ['pho', 'bun'],
      dietaryPreferences: ['vegetarian'],
      preferredPriceLevels: [1, 2],
    }),
  };
  const controller = new RecommendationsController(databaseService as never, auth as never);

  const result = await controller.forYou({
    user: { id: 'user-1', email: 'user@example.com', displayName: null },
  });

  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => JSON.stringify(call.tastes) === JSON.stringify(['vegetarian'])));
  assert.equal(result.data.length, 5);
  assert.equal(new Set(result.data.map((item) => item.restaurant.id)).size, result.data.length);
  assert.match(result.data[0].explanation ?? '', /mức giá 1, 2/);
});

test('for-you falls back to rating when saved preferences have no matches', async () => {
  let calls = 0;
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls += 1;
      return filters.sort === 'rating' && calls > 1 ? page([restaurant('fallback')]) : page([]);
    },
  };
  const auth = {
    getPreferences: async () => ({
      favoriteCategorySlugs: ['pho'],
      dietaryPreferences: [],
      preferredPriceLevels: [],
    }),
  };
  const controller = new RecommendationsController(databaseService as never, auth as never);

  const result = await controller.forYou({
    user: { id: 'user-2', email: 'user@example.com', displayName: null },
  });

  assert.equal(result.data[0].restaurant.id, 'fallback');
  assert.equal(calls, 2);
});

test('recommendation does not turn the raw sentence into a text filter when interpretation consumed it', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('cool')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({ query: 'trời đang nóng', limit: 5 });

  // The whole sentence became a comfort taste + semantic query; the SQL text
  // filter must stay undefined instead of LIKE-matching "trời"/"nóng".
  assert.equal(calls[0].query, undefined);
  assert.deepEqual(calls[0].tastes, ['mát']);
  assert.equal(calls[0].semanticQuery, 'món mát lạnh');
});

test('structured weather requests do not need embedding to return a useful page', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const embedding = {
    isEnabled: () => true,
    activeModel: async () => 'bge-m3@doc:v3',
    embed: async () => new Array(1024).fill(0),
  };
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('one')]);
    },
  };
  const controller = new RecommendationsController(
    databaseService as never,
    undefined,
    undefined,
    embedding as never,
  );

  const result = await controller.recommend({ query: 'trời đang nóng', limit: 5 });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tastes, ['mát']);
  assert.equal(result.data.length, 1);
});

test('low-oil light-food requests stay deterministic and bypass the AI provider', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('light')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => {
      throw new Error('AI should not be called for a structured light-food request');
    },
  };
  const controller = new RecommendationsController(databaseService as never, aiIntent as never);

  const result = await controller.recommend({
    query: 'Tôi muốn ăn món thanh đạm, ít dầu mỡ',
    limit: 5,
  });

  assert.equal(result.data.length, 1);
  assert.deepEqual(calls[0].tastes, ['thanh đạm']);
  assert.equal(calls[0].query, undefined);
});

test('district requests with a city qualifier stay deterministic', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('district-1')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => {
      throw new Error('AI should not be called for a district-only request');
    },
  };
  const controller = new RecommendationsController(databaseService as never, aiIntent as never);

  const result = await controller.recommend({
    query: 'Tìm quán ăn ngon ở Quận 1, TP.HCM',
    limit: 5,
  });

  assert.equal(result.data.length, 1);
  assert.equal(calls[0].district, 'Quận 1');
  assert.equal(calls[0].query, undefined);
});

test('recommendation keeps explicit UI tastes when the embedding page is short', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const embedding = {
    isEnabled: () => true,
    activeModel: async () => 'bge-m3@doc:v3',
    embed: async () => new Array(1024).fill(0),
  };
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('one')]);
    },
  };
  const controller = new RecommendationsController(
    databaseService as never,
    undefined,
    undefined,
    embedding as never,
  );

  await controller.recommend({
    query: 'trời đang nóng',
    filters: { taste: ['mát'] },
    limit: 5,
  });

  // Only one call: the explicitly chosen taste is intent, never dropped.
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tastes, ['mát']);
});
