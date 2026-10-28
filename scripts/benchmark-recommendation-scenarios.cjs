const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

if (fs.existsSync(path.join(__dirname, '..', '.env'))) {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const baseUrl = (process.env.RECOMMENDATION_API_URL || 'http://127.0.0.1:3000/api/v1/recommendations').replace(/\/$/, '');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'recommendation-scenarios.json'), 'utf8'));
const K = Number(process.env.RECOMMENDATION_K || config.k || 10);
const requests = Number(process.env.RECOMMENDATION_REQUESTS || 1);

const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const dcg = (values) => values.reduce((sum, relevance, index) => sum + ((2 ** relevance) - 1) / Math.log2(index + 2), 0);
const metric = (rows, relevant) => {
  const labels = rows.map((row) => Number(relevant.get(row.restaurant?.id) || 0)).slice(0, K);
  const relevantCount = [...relevant.values()].filter((value) => value > 0).length;
  const ideal = [...relevant.values()].sort((a, b) => b - a).slice(0, K);
  return {
    recall: relevantCount ? labels.filter((value) => value > 0).length / Math.min(K, relevantCount) : null,
    ndcg: ideal.length && dcg(ideal) ? dcg(labels) / dcg(ideal) : null,
  };
};

async function loadQrels(client, scenario) {
  const trusted = `EXISTS (SELECT 1 FROM dish_evidence de JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id WHERE de.dish_id = d.id AND de.evidence_type = 'menu_image' AND mie.status = 'completed' AND mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1') AND COALESCE(mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%')`;
  let sql = `SELECT DISTINCT r.id, 1 AS relevance FROM restaurant r JOIN location ql ON ql.id = r.location_id WHERE r.status = 'active'`;
  if (scenario.expected === 'pizza') sql += ` AND (r.normalized_name ILIKE '%pizza%' OR EXISTS (SELECT 1 FROM restaurant_category rc JOIN category c ON c.id = rc.category_id WHERE rc.restaurant_id = r.id AND c.slug IN ('pizza','italian'))) `;
  if (scenario.expected === 'dry_style') sql += ` AND EXISTS (SELECT 1 FROM dish d WHERE d.restaurant_id = r.id AND d.status = 'available' AND ${trusted} AND d.normalized_name ~ '(com|mi xao|mi chien|banh mi|pizza|banh xeo|nuong|chien|kho|xao|rang|cuon|goi|sushi|salad|khoai|bap|nem|sot|trung|chien)') AND NOT EXISTS (SELECT 1 FROM dish d WHERE d.restaurant_id = r.id AND d.status = 'available' AND d.normalized_name ~ '(pho|bun|canh|lau|chao|sup|mien nuoc|mi nuoc|hu tieu|bun nuoc)')`;
  if (scenario.expected === 'brothy_style' || scenario.expected === 'weather_nearby') sql += ` AND EXISTS (SELECT 1 FROM dish d WHERE d.restaurant_id = r.id AND d.status = 'available' AND ${trusted} AND d.normalized_name ~ '(pho|bun|canh|lau|chao|sup|mien nuoc|mi nuoc|hu tieu|bun nuoc|nuoc dung)')`;
  if (scenario.radiusMeters && scenario.location) sql += ` AND ql.coordinates IS NOT NULL AND ST_DWithin(ql.coordinates, ST_SetSRID(ST_MakePoint(${scenario.location.longitude}, ${scenario.location.latitude}), 4326)::geography, ${scenario.radiusMeters})`;
  const result = await client.query(sql);
  return new Map(result.rows.map((row) => [row.id, Number(row.relevance)]));
}

async function request(scenario) {
  const started = performance.now();
  try {
    const response = await fetch(baseUrl, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ query: scenario.query, location: scenario.location, limit: K }) });
    const body = await response.json().catch(() => ({}));
    return { scenario, status: response.status, ms: performance.now() - started, body };
  } catch (error) {
    return { scenario, status: 0, ms: performance.now() - started, error: String(error) };
  }
}

function percentile(values, p) { if (!values.length) return null; const sorted = [...values].sort((a,b) => a-b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]; }
async function main() {
  const client = new Client({ host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || process.env.POSTGRES_PORT || 5432), database: process.env.PGDATABASE || process.env.POSTGRES_DB || 'food_app', user: process.env.PGUSER || process.env.POSTGRES_USER || 'food_app', password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD });
  await client.connect();
  const results = [];
  for (const scenario of config.scenarios) for (let i = 0; i < requests; i++) results.push(await request(scenario));
  const byScenario = [];
  for (const scenario of config.scenarios) {
    const samples = results.filter((result) => result.scenario.name === scenario.name);
    const ok = samples.find((sample) => sample.status >= 200 && sample.status < 300);
    const rows = ok?.body?.data || [];
    const relevant = await loadQrels(client, scenario);
    const scores = metric(rows, relevant);
    const relevantAtK = rows.filter((row) => relevant.has(row.restaurant?.id)).length;
    const menuVerifiedAtK = rows.filter((row) => row.restaurant?.dishEvidenceStatus === 'verified_menu').length;
    byScenario.push({ name: scenario.name, query: scenario.query, qrels: relevant.size, qrelSource: scenario.expected === 'pizza' ? 'restaurant_name_or_category' : 'trusted_completed_menu_evidence', statusCodes: samples.map((sample) => sample.status), p50Ms: percentile(samples.map((sample) => sample.ms), .5), p95Ms: percentile(samples.map((sample) => sample.ms), .95), resultCount: rows.length, relevantCoverageAtK: rows.length ? relevantAtK / rows.length : 0, menuVerifiedRateAtK: rows.length ? menuVerifiedAtK / rows.length : 0, ...scores });
  }
  const allMs = results.map((result) => result.ms);
  const summary = { api: baseUrl, k: K, requestsPerScenario: requests, generatedAt: new Date().toISOString(), scenarios: byScenario, overall: { p50Ms: percentile(allMs, .5), p95Ms: percentile(allMs, .95), http503Rate: results.length ? results.filter((result) => result.status === 503).length / results.length : 0, transportErrorRate: results.length ? results.filter((result) => result.status === 0).length / results.length : 0 } };
  await client.end();
  console.log(JSON.stringify(summary, null, 2));
  if (process.env.RECOMMENDATION_BENCHMARK_OUT) fs.writeFileSync(process.env.RECOMMENDATION_BENCHMARK_OUT, `${JSON.stringify(summary, null, 2)}\n`);
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
