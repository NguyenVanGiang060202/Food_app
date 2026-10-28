const fs = require('fs');
const path = require('path');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

loadLocalEnv();

const allCases = JSON.parse(fs.readFileSync(path.join(__dirname, 'food-query-test-cases.json'), 'utf8'));
const selectedIds = process.env.FOOD_QUERY_CASE_IDS
  ? new Set(process.env.FOOD_QUERY_CASE_IDS.split(',').map((value) => Number(value.trim())))
  : null;
const cases = selectedIds ? allCases.filter((testCase) => selectedIds.has(testCase.id)) : allCases;
if (!cases.length) throw new Error('No benchmark cases selected.');
const baseUrl = (
  process.env.BENCHMARK_API_URL ||
  process.env.RECOMMENDATION_API_URL ||
  'http://127.0.0.1:3000/api/v1/recommendations'
).replace(/\/$/, '');
const outputPath = process.env.FOOD_QUERY_BENCHMARK_OUT || path.join(__dirname, '..', 'tmp', 'food-query-benchmark.json');
const syntheticLocation = { latitude: 10.78, longitude: 106.69 };
const requestTimeoutMs = Number(process.env.FOOD_QUERY_TIMEOUT_MS || 20000);
const maxRateLimitRetries = 2;

async function fetchWithRateLimitRetry(body) {
  for (let attempt = 0; attempt <= maxRateLimitRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response;
    try {
      response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status !== 429 || attempt === maxRateLimitRetries) {
      return { response, rateLimitRetries: attempt };
    }
    const retrySeconds = Number(response.headers.get('retry-after'));
    const delayMs = Number.isFinite(retrySeconds) && retrySeconds > 0
      ? Math.min(65_000, Math.ceil(retrySeconds * 1000) + 250)
      : 1_000 * (attempt + 1);
    console.warn(`Rate limited; retrying after ${delayMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function districtMatches(address, district) {
  if (!address || !district) return false;
  const escaped = district.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|,\\s*)${escaped}(?:,|$)`, 'i').test(address);
}

const normalize = (value) => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();

function semanticChecks(testCase, rows, understanding) {
  const failures = [];
  const names = rows.map((row) => [row?.restaurant?.name, ...(row?.restaurant?.matchedDishes || [])]);
  const excludedHit = (part, term) => term === 'thịt bò'
    ? /(?:^| )bo(?: |$)/u.test(normalize(part))
    : normalize(part).includes(normalize(term));
  for (const term of testCase.excludedTerms || []) {
    if ((understanding?.filters?.tastes || []).some((taste) => normalize(taste) === normalize(term))) {
      failures.push(`negated_taste_included:${term}`);
    }
    if (names.some((parts) => parts.some((part) => excludedHit(part, term)))) {
      failures.push(`excluded_food_returned:${term}`);
    }
  }
  for (const phrase of testCase.excludedVenuePhrases || []) {
    if (rows.some((row) => normalize(row?.restaurant?.name).includes(normalize(phrase)))) {
      failures.push(`excluded_venue_returned:${phrase}`);
    }
  }
  if (testCase.expectedDish && !(understanding?.filters?.dishes || []).some(
    (dish) => normalize(dish.dish) === normalize(testCase.expectedDish))) {
    failures.push(`dish_not_understood:${testCase.expectedDish}`);
  }
  if (testCase.expectedCategory && understanding?.filters?.category !== testCase.expectedCategory) {
    failures.push(`category_not_understood:${testCase.expectedCategory}`);
  }
  for (const term of testCase.expectedIngredients || []) {
    if (!(understanding?.filters?.ingredients || []).some((ingredient) =>
      normalize(ingredient) === normalize(term))) {
      failures.push(`ingredient_not_understood:${term}`);
    }
  }
  if (testCase.verifiedTaste && rows.some((row) =>
    row?.restaurant?.dishEvidenceStatus !== 'verified_menu' ||
    !row?.restaurant?.matchedDishes?.length)) {
    failures.push('unverified_taste_claim');
  }
  if (testCase.vegetarianNames && rows.some((row) =>
    !/(?:chay|vegan|vegetarian)/i.test(normalize(row?.restaurant?.name)))) {
    failures.push('unverified_vegetarian_venue');
  }
  return failures;
}

async function runCase(testCase) {
  const location = testCase.requiresLocation ? syntheticLocation : undefined;
  const filters = testCase.radiusKm ? { radiusMeters: testCase.radiusKm * 1000 } : undefined;
  const expectNonEmpty = testCase.expectNonEmpty !== false;
  const started = performance.now();
  try {
    const { response, rateLimitRetries } = await fetchWithRateLimitRetry(
      JSON.stringify({ query: testCase.query, limit: 10, location, filters }),
    );
    const body = await response.json().catch(() => ({}));
    const rows = Array.isArray(body.data) ? body.data : [];
    const addresses = rows
      .map((row) => row?.restaurant?.location?.formattedAddress)
      .filter(Boolean);
    const understanding = body?.meta?.understanding ?? null;
    const quality = body?.meta?.quality ?? null;
    const semanticFailures = semanticChecks(testCase, rows, understanding);
    const radiusPass = filters?.radiusMeters === undefined ? null : rows.every((row) =>
      Number.isFinite(Number(row?.restaurant?.distanceMeters)) &&
      Number(row.restaurant.distanceMeters) <= filters.radiusMeters + 25);
    return {
      id: testCase.id,
      group: testCase.group || 'legacy',
      query: testCase.query,
      status: response.status,
      rateLimitRetries,
      ok: response.ok,
      durationMs: Math.round(performance.now() - started),
      resultCount: rows.length,
      qualityCode: quality?.code ?? null,
      qualityMessage: quality?.message ?? null,
      topResults: rows.slice(0, 5).map((row) => ({
        name: row?.restaurant?.name ?? null,
        matchedDishes: row?.restaurant?.matchedDishes ?? [],
        evidence: row?.restaurant?.dishEvidenceStatus ?? null,
        distanceMeters: row?.restaurant?.distanceMeters ?? null,
      })),
      semanticFailures,
      radiusPass,
      understoodFilters: understanding?.filters ?? null,
      locationSent: Boolean(location),
      radiusMetersSent: filters?.radiusMeters ?? null,
      expectedDistrict: testCase.expectedDistrict ?? null,
      districtMatches: testCase.expectedDistrict
        ? addresses.filter((address) => districtMatches(address, testCase.expectedDistrict)).length
        : null,
      addressesChecked: testCase.expectedDistrict ? addresses.length : null,
      districtPass: testCase.expectedDistrict
        ? rows.length === 0 ? null : addresses.length === rows.length &&
          addresses.every((address) => districtMatches(address, testCase.expectedDistrict))
        : null,
      expectNonEmpty,
      nonEmptyPass: expectNonEmpty ? rows.length > 0 : null,
    };
  } catch (error) {
    return {
      id: testCase.id,
      group: testCase.group || 'legacy',
      query: testCase.query,
      status: 0,
      ok: false,
      durationMs: Math.round(performance.now() - started),
      resultCount: 0,
      error: error?.name === 'AbortError' ? `request_timeout_${requestTimeoutMs}ms` : String(error),
      timedOut: error?.name === 'AbortError',
      locationSent: Boolean(location),
      radiusMetersSent: filters?.radiusMeters ?? null,
      expectNonEmpty,
      nonEmptyPass: expectNonEmpty ? false : null,
      districtPass: testCase.expectedDistrict ? false : null,
    };
  }
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

async function main() {
  const results = [];
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < cases.length) {
      const testCase = cases[nextIndex++];
      const result = await runCase(testCase);
      results.push(result);
      console.log(
        `${String(result.id).padStart(2, '0')} ${result.status || 'ERR'} ${String(result.durationMs).padStart(5, ' ')}ms ${String(result.resultCount).padStart(2, ' ')} results | ${result.query}`,
      );
    }
  }
  await Promise.all([worker(), worker()]);

  const durations = results.map((result) => result.durationMs);
  const summary = {
    generatedAt: new Date().toISOString(),
    api: baseUrl,
    caseCount: results.length,
    successCount: results.filter((result) => result.ok).length,
    httpErrorCount: results.filter((result) => result.status > 0 && !result.ok).length,
    http429Count: results.filter((result) => result.status === 429).length,
    http503Count: results.filter((result) => result.status === 503).length,
    transportErrorCount: results.filter((result) => result.status === 0).length,
    timeoutCount: results.filter((result) => result.timedOut).length,
    rateLimitRetryCases: results.filter((result) => result.rateLimitRetries > 0).length,
    locationCases: results.filter((result) => result.locationSent).length,
    locationCasesWithRadius: results.filter((result) => result.radiusMetersSent !== null).length,
    districtCase13: results.find((result) => result.id === 13) ?? null,
    emptyResultCases: results.filter((result) => result.ok && result.resultCount === 0).map((result) => result.id),
    requiredNonEmptyFailures: results
      .filter((result) => result.expectNonEmpty && !result.nonEmptyPass)
      .map((result) => result.id),
    districtFailures: results
      .filter((result) => result.expectedDistrict && result.districtPass === false)
      .map((result) => result.id),
    radiusFailures: results.filter((result) => result.radiusPass === false).map((result) => result.id),
    semanticFailures: results.filter((result) => result.semanticFailures?.length)
      .map((result) => ({ id: result.id, failures: result.semanticFailures })),
    groupSummary: Object.values(results.reduce((groups, result) => {
      const group = result.group || 'legacy';
      const current = groups[group] || { group, cases: 0, success: 0, empty: 0, requiredNonEmptyFailures: 0, districtFailures: 0 };
      current.cases += 1;
      if (result.ok) current.success += 1;
      if (result.ok && result.resultCount === 0) current.empty += 1;
      if (result.expectNonEmpty && !result.nonEmptyPass) current.requiredNonEmptyFailures += 1;
      if (result.expectedDistrict && result.districtPass === false) current.districtFailures += 1;
      groups[group] = current;
      return groups;
    }, {})),
    qualityCodes: results.reduce((counts, result) => {
      const code = result.qualityCode || 'NONE';
      counts[code] = (counts[code] || 0) + 1;
      return counts;
    }, {}),
    latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), max: Math.max(...durations) },
    results,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nSaved benchmark report to ${outputPath}`);
  console.log(JSON.stringify({
    caseCount: summary.caseCount,
    successCount: summary.successCount,
    httpErrorCount: summary.httpErrorCount,
    http429Count: summary.http429Count,
    http503Count: summary.http503Count,
    transportErrorCount: summary.transportErrorCount,
    timeoutCount: summary.timeoutCount,
    rateLimitRetryCases: summary.rateLimitRetryCases,
    emptyResultCases: summary.emptyResultCases,
    requiredNonEmptyFailures: summary.requiredNonEmptyFailures,
    districtFailures: summary.districtFailures,
    radiusFailures: summary.radiusFailures,
    semanticFailures: summary.semanticFailures,
    groupSummary: summary.groupSummary,
    qualityCodes: summary.qualityCodes,
    latencyMs: summary.latencyMs,
  }, null, 2));
  if (
    summary.httpErrorCount || summary.transportErrorCount ||
    summary.districtFailures.length || summary.radiusFailures.length ||
    summary.semanticFailures.length
  ) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
