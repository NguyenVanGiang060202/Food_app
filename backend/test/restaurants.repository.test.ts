import assert from 'node:assert/strict';
import test from 'node:test';
import { RestaurantsRepository } from '../src/modules/restaurants/restaurants.repository';
import { RestaurantSort } from '../src/modules/restaurants/restaurants.dto';

test('exact verified dish lookup uses indexed full-name equality and trusted evidence', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const repository = new RestaurantsRepository({
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [{ name: 'Rau Lang Luộc' }], rowCount: 1 } as { rows: T[]; rowCount: number };
    },
  } as never);
  assert.equal(await repository.findExactVerifiedDishName('Rau lang luộc'), 'Rau Lang Luộc');
  assert.deepEqual(calls[0].values, ['rau lang luoc']);
  assert.match(calls[0].text, /d\.normalized_name = \$1/);
  assert.match(calls[0].text, /d\.normalized_name IN \(\$1 \|\| ' s', \$1 \|\| ' v'\)/);
  assert.match(calls[0].text, /right\(d\.name, 3\) IN \('\(s\)', '\(v\)'\)/);
  assert.match(calls[0].text, /mie\.model IN \('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1'\)/);
  assert.equal(await repository.findExactVerifiedDishName('rau'), undefined);
  assert.equal(calls.length, 1);
});

test('district composite lookup only considers slash-suffixed verified menu names', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const repository = new RestaurantsRepository({
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [{ name: 'Bánh mì thịt nướng/ BBQ/ Thổ Nhĩ Kỳ' }], rowCount: 1 } as { rows: T[]; rowCount: number };
    },
  } as never);
  assert.equal(await repository.findVerifiedSlashDishNameInDistrict('Bánh mì thịt nướng', 'Quận 1'), 'Bánh mì thịt nướng/ BBQ/ Thổ Nhĩ Kỳ');
  assert.deepEqual(calls[0].values, ['banh mi thit nuong', 'Quận 1']);
  assert.match(calls[0].text, /lower\(unaccent\(l\.district\)\) = lower\(unaccent\(\$2\)\)/);
  assert.match(calls[0].text, /lower\(unaccent\(d\.name\)\) LIKE \$1 \|\| '\/%'/);
  assert.match(calls[0].text, /mie\.status = 'completed'/);
  assert.equal(await repository.findVerifiedSlashDishNameInDistrict('bánh mì', 'Quận 1'), undefined);
  assert.equal(calls.length, 1);
});

test('parenthetical lookup requires one trusted full menu variant, with or without a district', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  let names = [{ name: 'Ramen Xá Xíu (nước)' }];
  const repository = new RestaurantsRepository({
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: names, rowCount: names.length } as { rows: T[]; rowCount: number };
    },
  } as never);
  assert.equal(await repository.findUniqueVerifiedParentheticalDishName('Ramen Xá Xíu', 'Thủ Đức'), 'Ramen Xá Xíu (nước)');
  assert.deepEqual(calls[0].values, ['ramen xa xiu', 'Thủ Đức']);
  assert.match(calls[0].text, /\$2::text IS NULL/);
  assert.equal(await repository.findUniqueVerifiedParentheticalDishName('Ramen Xá Xíu'), 'Ramen Xá Xíu (nước)');
  assert.deepEqual(calls[1].values, ['ramen xa xiu', null]);
  assert.match(calls[0].text, /d\.normalized_name LIKE \$1 \|\| ' %'/);
  assert.match(calls[0].text, /d\.name ~/);
  assert.match(calls[0].text, /mie\.status='completed'/);
  assert.match(calls[0].text, /de\.evidence_type='menu_image'/);
  names = [{ name: 'Ramen Xá Xíu (nước)' }, { name: 'Ramen Xá Xíu (khô)' }];
  assert.equal(await repository.findUniqueVerifiedParentheticalDishName('Ramen Xá Xíu'), undefined);
  assert.equal(await repository.findUniqueVerifiedParentheticalDishName('ramen', 'Thủ Đức'), undefined);
  assert.equal(calls.length, 3);
});

test('ordered district lookup resolves only a unique specific trusted dish', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  let names = [{ name: 'Cơm Chiên Thịt Cua Xé Sốt X.O' }];
  const repository = new RestaurantsRepository({
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: names, rowCount: names.length } as { rows: T[]; rowCount: number };
    },
  } as never);
  assert.equal(await repository.findUniqueVerifiedOrderedDishNameInDistrict('Cơm chiên cua xé', 'Quận 3'), 'Cơm Chiên Thịt Cua Xé Sốt X.O');
  assert.deepEqual(calls[0].values, ['(^| )com( [a-z0-9]+){0,2} chien( [a-z0-9]+){0,2} cua( [a-z0-9]+){0,2} xe( |$)', 'Quận 3']);
  assert.match(calls[0].text, /mie\.status='completed'/);
  assert.match(calls[0].text, /de\.evidence_type='menu_image'/);
  names = [{ name: 'Cơm Chiên Thịt Cua Xé Sốt X.O' }, { name: 'Cơm Chiên Cua Xé Sốt Tiêu' }];
  assert.equal(await repository.findUniqueVerifiedOrderedDishNameInDistrict('Cơm chiên cua xé', 'Quận 3'), undefined);
  assert.equal(await repository.findUniqueVerifiedOrderedDishNameInDistrict('Cơm chiên cua', 'Quận 3'), undefined);
  assert.equal(calls.length, 2);
});

test('listSimilar ranks candidates using menu and category signals before fallback signals', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return {
        rows: [
          {
            id: 'restaurant-2',
            name: 'Similar Kitchen',
            formatted_address: 'District 1',
            latitude: 10.77,
            longitude: 106.7,
            rating: 4.7,
            review_count: 80,
            price_level: 2,
            cover_image_url: null,
            source_url: null,
            categories: [{ slug: 'noodles', name: 'Noodles' }],
            distance_meters: null,
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
        rowCount: 1,
      } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  const result = await repository.listSimilar('restaurant-1', 6);

  assert.equal(result[0]?.id, 'restaurant-2');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, ['restaurant-1', 6]);
  assert.match(calls[0].text, /target_categories/);
  assert.match(calls[0].text, /target_dishes/);
  assert.match(
    calls[0].text,
    /similarity\(candidate_dish\.normalized_name, target_dish\.normalized_name\) >= 0\.62/,
  );
  assert.match(calls[0].text, /s\.category_overlap \* 12/);
  assert.match(calls[0].text, /s\.dish_overlap \* 10/);
  assert.match(
    calls[0].text,
    /CASE WHEN s\.category_overlap > 0 OR s\.dish_overlap > 0 THEN 1 ELSE 0 END/,
  );
});

test('listSimilar clamps the requested limit to the public maximum', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.listSimilar('restaurant-1', 999);

  assert.deepEqual(calls[0].values, ['restaurant-1', 20]);
});

test('list matches known taste values through the dish attribute taxonomy', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ tastes: ['nóng'], limit: 10 });

  assert.equal(calls.length, 1);
  // A canonical attribute ("nóng" -> normalized "nong") is matched via
  // dish_attribute joined to food_attribute, not by a literal dish-name ILIKE.
  assert.match(calls[0].text, /dish_attribute taste_da/);
  assert.match(calls[0].text, /food_attribute taste_fa/);
  assert.match(calls[0].text, /taste_fa\.normalized/);
  assert.ok(calls[0].values.includes('nong'));
  // The literal dish-name fallback remains as an OR branch so an unknown
  // dish phrase (e.g. "bún bò huế" from intent) still matches names.
  assert.match(calls[0].text, /OR EXISTS \(SELECT 1 FROM dish taste_ds2/);
});

test('list normalizes Vietnamese đ when matching verified taste attributes', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ tastes: ['thanh đạm'], limit: 10 });

  assert.equal(calls.length, 1);
  assert.ok(calls[0].values.includes('thanh dam'));
  assert.ok(calls[0].values.includes('%thanh dam%'));
  assert.ok(!calls[0].values.includes('thanh đam'));
});

test('list applies excluded food terms as a hard venue and menu filter', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const repository = new RestaurantsRepository({
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  } as never);

  await repository.list({ excludedFoodTerms: ['cay'], limit: 10 });

  assert.match(calls[0].text, /NOT \(r\.name ILIKE/);
  assert.match(calls[0].text, /excluded_ds\.name ILIKE/);
  assert.ok(calls[0].values.includes('%cay%'));
});

test('vegetarian category requires an independent restaurant-name signal', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const repository = new RestaurantsRepository({
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  } as never);

  await repository.list({ category: 'vegetarian', limit: 10 });

  assert.match(calls[0].text, /r\.normalized_name ~ '\(\^\| \)\(chay\|vegan\|vegetarian\)\( \|\$\)'/);
});

test('ingredient combinations must match within one trusted dish or venue name', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const repository = new RestaurantsRepository({
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  } as never);

  await repository.list({ ingredientTerms: ['thịt bò', 'rau'], limit: 10 });

  assert.match(calls[0].text, /ingredient_ds\.normalized_name ~ ANY/);
  assert.match(calls[0].text, /ingredient_ds\.source IN \('menu_image:curated', 'website:menu:v1'\)/);
  assert.ok(calls[0].values.some((value) => Array.isArray(value) && value.includes('(^| )bo( |$)')));
  assert.ok(calls[0].values.some((value) => Array.isArray(value) && value.includes('(^| )rau( |$)')));
});

test('shrimp ingredient does not treat mắm tôm as a shrimp dish', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const repository = new RestaurantsRepository({
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  } as never);

  await repository.list({ ingredientTerms: ['tôm'], limit: 10 });

  assert.match(calls[0].text, /regexp_replace\(r\.normalized_name, '\(\^\| \)mam tom\( \|\$\)', ' ', 'g'\) ~ ANY/);
  assert.match(calls[0].text, /regexp_replace\(ingredient_ds\.normalized_name, '\(\^\| \)mam tom\( \|\$\)', ' ', 'g'\) ~ ANY/);
});

test('list matches a district exactly instead of matching district-number prefixes', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ district: 'Quận 1', limit: 10 });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /LOWER\(TRIM\(l\.district\)\) = LOWER\(TRIM\(\$\d+::text\)\)/);
  assert.match(calls[0].text, /ST_DWithin\(/);
  assert.ok(calls[0].values.includes(4500));
  assert.ok(calls[0].values.includes('Quận 1'));
});

test('list requires direct available-menu evidence for canonical dish intent', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ dishQueries: ['Bún bò Huế'], limit: 10 });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /verified_exact_menu AS MATERIALIZED/);
  assert.match(calls[0].text, /FROM dish exact_ds/);
  assert.match(calls[0].text, /exact_ds\.status = 'available'/);
  assert.match(calls[0].text, /JOIN dish_evidence exact_de/);
  assert.match(calls[0].text, /exact_de\.evidence_type = 'menu_image'/);
  assert.match(calls[0].text, /JOIN menu_image_extraction exact_mie/);
  assert.match(calls[0].text, /exact_mie\.status = 'completed'/);
  assert.match(calls[0].text, /exact_mie\.raw_ocr_text.*food_photo:/);
  assert.match(calls[0].text, /regexp_count\(/);
  assert.match(calls[0].text, /length\(COALESCE\(exact_mie\.raw_ocr_text/);
  assert.doesNotMatch(calls[0].text, /exact_ds\.source IS NULL/);
  assert.match(calls[0].text, /exact_ds\.normalized_name = exact_query\.query_normalized/);
  assert.match(calls[0].text, /exact_ds\.source = 'website:menu:v1'[\s\S]*?exact_ds\.description/);
  assert.match(calls[0].text, /canonical_dish_alias/);
  assert.doesNotMatch(calls[0].text, /similarity\(canonical_ds\.normalized_name/);
  assert.ok(calls[0].values.some((value) => Array.isArray(value) && value.includes('bun bo hue')));
});

test('exact dietary variant excludes candidate-only restaurant names', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const repository = new RestaurantsRepository({
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  } as never);

  await repository.list({ dishQueries: ['Bún bò Huế chay'], verifiedMenuOnly: true, limit: 10 });
  assert.match(calls[0].text, /JOIN dish_matches dish_match ON dish_match\.restaurant_id = r\.id/);
  assert.match(calls[0].text, /AND dish_match\.exact_match/);
  assert.doesNotMatch(calls[0].text, /AND \(dish_match\.exact_match OR dish_match\.candidate_match\)/);
});

test('exact dish budgets use a trusted VND menu price instead of venue price level', async () => {
  for (const [exclusive, operator] of [[true, '<'], [false, '<=']] as const) {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const repository = new RestaurantsRepository({
      async query<T extends object>(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
      },
    } as never);
    await repository.list({
      dishQueries: ['Sushi Tôm'], verifiedMenuOnly: true,
      maxDishPriceVnd: 50_000, maxDishPriceExclusive: exclusive, limit: 10,
    });
    assert.match(calls[0].text, /exact_ds\.currency_code = 'VND'/);
    assert.match(calls[0].text, new RegExp(`exact_ds\\.price_amount ${operator.replace('<=', '<=')} \\$\\d+`));
    assert.match(calls[0].text, /exact_de\.raw_price IS NOT NULL/);
    assert.ok(calls[0].values.includes(50_000));
    assert.match(calls[0].text, /JOIN dish_matches dish_match ON/);
    assert.match(calls[0].text, /dish_match\.exact_match/);
  }
});

test('exact menu lookup maps Vietnamese đ to the stored normalized dish name', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);
  await repository.list({ dishQueries: ['Bún đậu Homemade đặc biệt'], limit: 10 });
  assert.ok(calls[0].values.some((value) => Array.isArray(value) && value.includes('bun dau homemade dac biet')));
  assert.ok(!calls[0].values.some((value) => Array.isArray(value) && value.includes('bun đau homemade dac biet')));
});

test('exact menu lookup preserves a reviewed dish identity across plus signs', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);
  await repository.list({ dishQueries: ['Gà tiềm ớt hiểm + Mì'], verifiedMenuOnly: true, limit: 10 });
  assert.ok(calls[0].values.some((value) => Array.isArray(value) && value.includes('ga tiem ot hiem mi')));
  assert.match(calls[0].text, /exact_mie\.model = 'website:menu:v1'[\s\S]*?exact_de\.raw_name/);
});

test('full catalog label excludes other dishes that mention it only in descriptions', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);
  await repository.list({ dishQueries: ['Bún đậu no nê'], exactDishNameOnly: true, verifiedMenuOnly: true, limit: 10 });
  assert.match(calls[0].text, /exact_ds\.normalized_name = exact_query\.query_normalized/);
  assert.doesNotMatch(calls[0].text, /exact_ds\.normalized_name LIKE exact_query\.query_normalized/);
  assert.doesNotMatch(calls[0].text, /exact_ds\.description[\s\S]*?exact_query\.query_normalized/);
});

test('full catalog label accepts only an image-reviewed bilingual identity', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);
  await repository.list({ dishQueries: ['Súp Bí Đỏ'], exactDishNameOnly: true, verifiedMenuOnly: true, limit: 10 });

  assert.ok(calls[0].values.some((value) => Array.isArray(value) && value.includes('sup bi do')));
  assert.equal((calls[0].text.match(/exact_bilingual_alias\.source = 'curated_bilingual_menu:v1'/g) ?? []).length, 2);
  assert.match(calls[0].text, /exact_mie\.model = 'website:menu-image-curated:v1' AND EXISTS/);
  assert.doesNotMatch(calls[0].text, /exact_ds\.normalized_name LIKE exact_query\.query_normalized/);
});

test('list keeps strong menu-name signals as labeled candidates after verified menu rows', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ dishQueries: ['Phở bò'], limit: 10 });

  assert.match(calls[0].text, /candidate_mie/);
  assert.doesNotMatch(calls[0].text, /candidate_review/);
  assert.match(
    calls[0].text,
    /candidate_mie\.model IN \('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1'\)/,
  );
  assert.match(calls[0].text, /dish_candidate/);
  assert.match(calls[0].text, /candidate_signal/);
  assert.match(calls[0].text, /0\.16::real/);
  assert.match(calls[0].text, /candidate_score/);
  assert.doesNotMatch(calls[0].text, /candidate_ds\.source = 'enrichment:dish:lexicon:v1'/);
  assert.match(calls[0].text, /dishMatchExpr|dish_candidate/);
});

test('exact dish retrieval does not also build the broad text-query branch', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ query: 'cơm tấm', dishQueries: ['Cơm tấm'], limit: 10 });

  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].text, /COALESCE\(r\.semantic_profile, ''\) ILIKE/);
  assert.doesNotMatch(calls[0].text, /similarity\(r\.name/);
  assert.match(calls[0].text, /verified_exact_menu AS MATERIALIZED/);
});

test('exact dish and candidate CTEs use the nearby set before menu/OCR scans', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    dishQueries: ['Cơm tấm'],
    latitude: 10.78,
    longitude: 106.69,
    radiusMeters: 5000,
    limit: 10,
  });

  assert.equal(calls.length, 1);
  const sql = calls[0].text;
  assert.match(sql, /WITH nearby_restaurants AS MATERIALIZED/);
  assert.match(
    sql,
    /JOIN nearby_restaurants exact_nearby ON exact_nearby\.id = exact_ds\.restaurant_id/,
  );
  assert.match(
    sql,
    /JOIN nearby_restaurants candidate_nearby ON candidate_nearby\.id = candidate_r\.id/,
  );
});

test('list accepts a verified concrete dish variant without broad fuzzy matching', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ dishQueries: ['Phở gà'], limit: 10 });

  assert.ok(calls[0].values.some((value) => Array.isArray(value) && value.includes('pho ga')));
  assert.match(
    calls[0].text,
    /exact_ds\.normalized_name LIKE exact_query\.query_normalized \|\| ' %'/,
  );
  // Review-derived lexicon dishes are intentionally not exact-dish candidate
  // evidence: they caused unrelated venues to outrank direct name/menu
  // signals for low-coverage dishes.
  assert.doesNotMatch(calls[0].text, /candidate_ds\.normalized_name LIKE candidate_query/);
  assert.doesNotMatch(calls[0].text, /similarity\(exact_ds\.normalized_name/);
});

test('list ranks dish candidates by menu evidence and uses the food profile only as a bounded tie-breaker', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    query: async (text: string, values: unknown[]) => {
      calls.push({ text, values });
      return { rows: [] };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ dishQueries: ['Bún bò Huế'], limit: 10 });

  assert.match(calls[0].text, /COALESCE\(exact_de\.confidence/);
  assert.match(calls[0].text, /dish_match\.max_confidence/);
  assert.match(calls[0].text, /restaurant_food_profile fp/);
  assert.match(calls[0].text, /fp\.status = 'ready'/);
  assert.match(calls[0].text, /dish_match\.max_confidence|COUNT\(DISTINCT dish_id\)/);
});

test('list matches the semantic_profile column in keyword and per-term clauses', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ query: 'bún cay', limit: 10 });

  assert.equal(calls.length, 1);
  const semanticMatches = (calls[0].text.match(/COALESCE\(r\.semantic_profile, ''\) ILIKE/g) ?? [])
    .length;
  // Both the whole-query push and each per-term clause search the profile.
  assert.ok(
    semanticMatches >= 3,
    `expected semantic_profile ILIKE clauses, got ${semanticMatches}`,
  );
  assert.match(calls[0].text, /term_ds\.normalized_name ILIKE/);
});

test('list adds a bounded canonical attribute evidence boost for query terms', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ query: 'món nướng', limit: 10 });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /JOIN dish_attribute evidence_da/);
  assert.match(calls[0].text, /JOIN food_attribute evidence_fa/);
  assert.match(calls[0].text, /evidence_fa\.normalized = \$\d+/);
  assert.match(calls[0].text, /CASE WHEN EXISTS \(/);
  assert.match(calls[0].text, /0\.25::real ELSE 0::real END/);
  assert.ok(calls[0].values.includes('nuong'));
});

test('dry dish retrieval excludes broth or hotpot venue identities', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ dishStyle: 'dry', limit: 10 });

  assert.match(calls[0].text, /NOT \(dry_r\.normalized_name ILIKE ANY \(ARRAY/);
  assert.match(calls[0].text, /'%lau%'/);
  assert.match(calls[0].text, /'%bun bo%'/);
});

test('verified exact dish evidence supplies the displayed dish even when a style filter is also present', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const repository = new RestaurantsRepository({
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  } as never);

  await repository.list({ dishQueries: ['Thịt kho trứng nước dừa'], dishStyle: 'brothy', verifiedMenuOnly: true, limit: 10 });
  assert.match(calls[0].text, /dish_match\.matched_dishes AS matched_dishes/);
  assert.doesNotMatch(calls[0].text, /brothy_match\.matched_dishes AS matched_dishes/);
});

test('explicit nearby hard-food requests sort by distance before generic relevance', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    strictFoodQuery: 'pizza',
    query: 'pizza',
    latitude: 10.78,
    longitude: 106.69,
    radiusMeters: 5000,
    limit: 10,
  });

  const orderStart = calls[0].text.lastIndexOf(' ORDER BY ');
  const orderBy = orderStart >= 0 ? calls[0].text.slice(orderStart + 10).split(' LIMIT ')[0] : '';
  assert.match(orderBy, /^distance_meters ASC NULLS LAST,/);
});

test('diacritic strict food matching avoids normalized-name collisions', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ query: 'lẩu', strictFoodQuery: 'lẩu', limit: 10 });

  assert.match(calls[0].text, /r\.name ILIKE \$\d+/);
  const whereClause = calls[0].text.split(' WHERE ').slice(1).join(' WHERE ');
  assert.doesNotMatch(whereClause, /r\.normalized_name ILIKE \$\d+/);
  assert.match(calls[0].text, /'candidate_signal'::text AS dish_evidence_status/);
});

test('generic mì matching excludes sandwich names and broad semantic profiles', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const repository = new RestaurantsRepository({
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  } as never);

  await repository.list({ query: 'mì', strictFoodQuery: 'mì', category: 'noodle', limit: 10 });

  assert.match(calls[0].text, /r\.name ~\* \$\d+ AND r\.name !~\* \$\d+/);
  assert.match(calls[0].text, /strict_ds\.name ~\* \$\d+ AND strict_ds\.name !~\* \$\d+/);
  assert.match(calls[0].text, /strict_ds\.source IN \('menu_image:curated', 'website:menu:v1'\)/);
  assert.ok(calls[0].values.includes('(^|[^[:alpha:]])(mì|mỳ|ramen|udon|soba)([^[:alpha:]]|$)'));
  assert.ok(calls[0].values.includes('(^|[^[:alpha:]])bánh[[:space:]]+mì([^[:alpha:]]|$)'));
});

test('brothy dish retrieval requires trusted menu evidence for broth-like dishes', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ dishStyle: 'brothy', limit: 10 });

  assert.match(calls[0].text, /brothy_menu_matches AS MATERIALIZED/);
  assert.match(calls[0].text, /brothy_ds\.normalized_name ~/);
  assert.match(calls[0].text, /brothy_mie\.status = 'completed'/);
  assert.match(calls[0].text, /JOIN brothy_menu_matches brothy_match/);
  assert.match(calls[0].text, /NOT \(brothy_ds\.normalized_name ILIKE ANY \(ARRAY/);
  assert.match(calls[0].text, /'%bun thit nuong%'/);
});

test('list ranks by weighted relevance + semantic score when an embedding is attached', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    query: 'bún bò huế',
    embedding: { vector: [0.1, 0.2, 0.3], model: 'bge-m3@doc:v3' },
    limit: 10,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /FROM restaurant_embedding emb/);
  assert.match(calls[0].text, /emb\.embedding <=>/);
  assert.match(calls[0].text, /emb\.model = \$\d+/);
  assert.match(calls[0].text, /AS semantic_score/);
  assert.ok(calls[0].values.includes('[0.10000000,0.20000000,0.30000000]'));
  assert.ok(calls[0].values.includes('bge-m3@doc:v3'));
  assert.match(
    calls[0].text,
    /COALESCE\(GREATEST\(similarity\(r\.name, \$\d+(?:::text)?\), similarity\(r\.normalized_name, \$\d+(?:::text)?\)\), 0\) \+ 1\.200000 \* COALESCE\(\(SELECT/,
  );
  assert.match(calls[0].text, /LEAST\(COALESCE\(r\.rating, 0\) \/ 5\.0, 1\.0\)/);
  assert.match(
    calls[0].text,
    /LEAST\(LN\(1 \+ COALESCE\(r\.review_count, 0\)\) \/ LN\(101\), 1\.0\)/,
  );
});

test('list uses the evaluated Recommendation V2 defaults when weights are not configured', async () => {
  const previousSemantic = process.env.RECOMMENDATION_SEMANTIC_WEIGHT;
  const previousQuality = process.env.RECOMMENDATION_QUALITY_WEIGHT;
  delete process.env.RECOMMENDATION_SEMANTIC_WEIGHT;
  delete process.env.RECOMMENDATION_QUALITY_WEIGHT;
  try {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const database = {
      async query<T extends object>(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
      },
    };
    const repository = new RestaurantsRepository(database as never);

    await repository.list({
      query: 'bún bò huế',
      embedding: { vector: [0.1], model: 'bge-m3@doc:v3' },
      limit: 10,
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /\+ 1\.200000 \* COALESCE\(\(SELECT/);
    assert.match(
      calls[0].text,
      /COALESCE\(\(SELECT CASE WHEN fp\.status = 'ready'[\s\S]*?FROM restaurant_food_profile fp WHERE fp\.restaurant_id = r\.id\), 0::real\)/,
      'restaurants without a food profile must receive a zero bonus, not a null rank',
    );
    assert.match(calls[0].text, /0\.106667 \* LEAST\(COALESCE\(r\.rating, 0\) \/ 5\.0, 1\.0\)/);
    assert.match(
      calls[0].text,
      /0\.053333 \* LEAST\(LN\(1 \+ COALESCE\(r\.review_count, 0\)\) \/ LN\(101\), 1\.0\)/,
    );
  } finally {
    if (previousSemantic === undefined) delete process.env.RECOMMENDATION_SEMANTIC_WEIGHT;
    else process.env.RECOMMENDATION_SEMANTIC_WEIGHT = previousSemantic;
    if (previousQuality === undefined) delete process.env.RECOMMENDATION_QUALITY_WEIGHT;
    else process.env.RECOMMENDATION_QUALITY_WEIGHT = previousQuality;
  }
});

test('list keeps the rating order without the semantic rank for non-default sorts', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    query: 'bún',
    sort: RestaurantSort.Rating,
    embedding: { vector: [0.1], model: 'bge-m3@doc:v3' },
    limit: 10,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /r\.review_count DESC NULLS LAST/);
  assert.ok(
    !/0\.4 \* COALESCE\(semantic_score, 0\)/.test(calls[0].text),
    'rating sort must not use the semantic rank in ORDER BY',
  );
  const referencedParameters = new Set(
    [...calls[0].text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])),
  );
  assert.deepEqual(
    [...referencedParameters].sort((a, b) => a - b),
    calls[0].values.map((_, index) => index + 1),
    'rating sort must not allocate parameters unused by its SQL',
  );
});

test('list supports pure semantic discovery without a text query', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    embedding: { vector: [0.1], model: 'bge-m3@doc:v3' },
    limit: 10,
  });

  assert.equal(calls.length, 1);
  // No text query means no keyword/ILIKE clauses, but the semantic score is
  // still selected and drives the default (relevance) ordering.
  assert.ok(!/ILIKE/.test(calls[0].text));
  assert.match(calls[0].text, /0::real AS relevance_score/);
  assert.match(calls[0].text, /AS semantic_score/);
  assert.match(calls[0].text, /COALESCE\(0::real, 0\) \+ 1\.200000 \* COALESCE\(\(SELECT/);
  assert.match(calls[0].text, /0\.106667 \* LEAST\(COALESCE\(r\.rating, 0\) \/ 5\.0, 1\.0\)/);
});

test('list adds only a bounded proximity boost when location context is available', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    embedding: { vector: [0.1], model: 'bge-m3@doc:v3' },
    latitude: 10.78,
    longitude: 106.69,
    limit: 10,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /0\.120000 \* EXP\(-ST_Distance\(/);
  assert.match(calls[0].text, /\/ 5000\.0\)/);
  assert.match(calls[0].text, /distance_meters/);
});

test('relevance ranking does not make absolute distance outrank food relevance', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    query: async (text: string, values: unknown[]) => {
      calls.push({ text, values });
      return { rows: [] };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    query: 'món nóng ấm bụng',
    embedding: { vector: [0.1], model: 'bge-m3@doc:v3' },
    latitude: 10.78,
    longitude: 106.69,
    radiusMeters: 5000,
    limit: 10,
  });

  const orderBy = calls[0].text.match(/ORDER BY ([\s\S]*?) LIMIT/)?.[1] ?? '';
  assert.doesNotMatch(orderBy, /^distance_meters ASC/);
  assert.match(calls[0].text, /semanticExpr|embedding <=>/);
});

test('list boosts direct taste evidence instead of using taste only as a filter', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    query: async (text: string, values: unknown[]) => {
      calls.push({ text, values });
      return { rows: [] };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ tastes: ['nóng'], limit: 10 });

  assert.match(calls[0].text, /score_fa\.normalized/);
  assert.match(calls[0].text, /0\.32::real/);
});

test('weather alternatives rank verified dish match, then quality before semantic noise', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    dishQueriesAny: ['Bún bò Huế', 'Bún riêu'],
    embedding: { vector: [0.1], model: 'bge-m3@doc:v3' },
    limit: 10,
  });

  const orderStart = calls[0].text.lastIndexOf(' ORDER BY ');
  const orderBy = orderStart >= 0 ? calls[0].text.slice(orderStart) : '';
  assert.match(orderBy, /DESC, .*DESC, .*DESC/);
  assert.ok(orderBy.includes('0.45::real'));
});

test('weather alternatives with an explicit radius prefer nearer verified matches', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    dishQueriesAny: ['Bún bò Huế', 'Bún riêu'],
    latitude: 10.78,
    longitude: 106.69,
    radiusMeters: 5000,
    limit: 10,
  });

  const orderStart = calls[0].text.lastIndexOf(' ORDER BY ');
  const orderBy = orderStart >= 0 ? calls[0].text.slice(orderStart) : '';
  assert.ok(orderBy.includes('distance_meters ASC NULLS LAST'));
  assert.ok(orderBy.indexOf('distance_meters ASC NULLS LAST') > orderBy.indexOf('0.45::real'));
  assert.ok(
    orderBy.indexOf('weather_match.max_confidence DESC') >
      orderBy.indexOf('distance_meters ASC NULLS LAST'),
  );
});

test('weather candidate signals ignore rejected not-menu OCR', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ dishQueriesAny: ['Phở bò'], limit: 10 });

  assert.match(calls[0].text, /candidate_mie\.status = 'completed'/);
  assert.doesNotMatch(calls[0].text, /candidate_mie\.status IN \('completed', 'not_menu'\)/);
});

test('weather candidates use the nearby CTE before scanning catalog signals', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    dishQueriesAny: ['Bánh canh cua'],
    latitude: 10.78,
    longitude: 106.69,
    radiusMeters: 5000,
    limit: 10,
  });

  assert.match(calls[0].text, /weather_candidate_nearby\.id = candidate_r\.id/);
  assert.match(calls[0].text, /WITH nearby_restaurants AS MATERIALIZED/);
});

test('exact dish candidates ignore food-photo OCR markers', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ dishQueries: ['Phở bò'], limit: 10 });

  assert.match(calls[0].text, /candidate_mie\.status = 'completed'/);
  assert.match(
    calls[0].text,
    /COALESCE\(candidate_mie\.raw_ocr_text, ''\) NOT ILIKE 'food_photo:%'/,
  );
});
