const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Keep the benchmark runnable from a clean shell without adding a runtime
// dependency just for dotenv. Existing process env wins over .env values.
function loadDotEnv() {
  if (!fs.existsSync('.env')) return;
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
}

loadDotEnv();

const K = 10;
const queries = [
  'phở bò',
  'bún bò huế',
  'pizza',
  'quán chay',
  'hải sản',
  'lẩu',
  'cà phê',
  'món nướng',
];
const qrelsFile = process.env.RECOMMENDATION_QRELS_FILE || path.join('scripts', 'recommendation-v2-qrels.json');

const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function dcg(items) {
  return items.reduce((sum, rel, index) => sum + ((2 ** rel) - 1) / Math.log2(index + 2), 0);
}

function metrics(ids, qrels) {
  const ranked = ids.map((id) => qrels.get(id) ?? 0);
  const hits = ranked.slice(0, K).filter((rel) => rel > 0).length;
  const relevant = [...qrels.values()].filter((rel) => rel > 0).length;
  const ideal = [...qrels.values()].sort((a, b) => b - a).slice(0, K);
  return {
    recall: relevant ? hits / Math.min(K, relevant) : 0,
    ndcg: ideal.length ? dcg(ranked.slice(0, K)) / dcg(ideal) : 0,
  };
}

function loadHumanQrels() {
  if (!fs.existsSync(qrelsFile)) return null;
  const parsed = JSON.parse(fs.readFileSync(qrelsFile, 'utf8'));
  const result = new Map();
  for (const [query, rows] of Object.entries(parsed.queries ?? parsed)) {
    if (!Array.isArray(rows)) continue;
    const map = new Map();
    for (const row of rows) {
      if (!row || typeof row.restaurantId !== 'string') continue;
      const relevance = Number(row.relevance);
      if (Number.isFinite(relevance) && relevance > 0) map.set(row.restaurantId, Math.min(3, Math.max(1, relevance)));
    }
    if (map.size) result.set(query, map);
  }
  return result.size ? result : null;
}
async function labels(client, query) {
  const normalized = normalize(query);
  const tokens = normalized.split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
  const pattern = `%${normalized}%`;
  const tokenPatterns = tokens.map((token) => `%${token}%`);
  const result = await client.query(
    `SELECT r.id,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM dish d
                 WHERE d.restaurant_id = r.id AND d.status = 'available'
                   AND (d.normalized_name = $1 OR d.normalized_name ILIKE $2)
              ) THEN 3
              WHEN r.normalized_name ILIKE $2 OR COALESCE(r.semantic_profile, '') ILIKE $2 THEN 2
              WHEN EXISTS (
                SELECT 1 FROM dish d
                 WHERE d.restaurant_id = r.id AND d.status = 'available'
                   AND (${tokenPatterns.map((_, i) => `d.normalized_name ILIKE $${i + 3}`).join(' OR ') || 'false'})
              ) THEN 1
              ELSE 0
            END AS relevance
       FROM restaurant r
      WHERE r.status = 'active'
        AND (
          r.normalized_name ILIKE $2 OR COALESCE(r.semantic_profile, '') ILIKE $2
          OR EXISTS (SELECT 1 FROM dish d WHERE d.restaurant_id = r.id AND d.status = 'available' AND d.normalized_name ILIKE $2)
          OR EXISTS (SELECT 1 FROM dish d WHERE d.restaurant_id = r.id AND d.status = 'available' AND (${tokenPatterns.map((_, i) => `d.normalized_name ILIKE $${i + 3}`).join(' OR ') || 'false'}))
        )`,
    [normalized, pattern, ...tokenPatterns],
  );
  return new Map(result.rows.filter((row) => Number(row.relevance) > 0).map((row) => [row.id, Number(row.relevance)]));
}

async function queryEmbedding(query) {
  const baseUrl = process.env.EMBEDDING_BASE_URL?.replace(/\/+$/, '');
  const apiKey = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL;
  if (!baseUrl || !apiKey || !model) throw new Error('Embedding provider is not configured.');
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: query,
      ...(process.env.EMBEDDING_DIMENSIONS ? { dimensions: Number(process.env.EMBEDDING_DIMENSIONS) } : {}),
    }),
  });
  if (!response.ok) throw new Error(`embedding provider ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json();
  const vector = payload.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error('embedding provider response is missing embedding data.');
  return vector;
}

async function rank(client, query, semanticWeight, qualityWeight) {
  const vector = await queryEmbedding(query);
  const vectorLiteral = `[${vector.map((value) => value.toFixed(8)).join(',')}]`;
  const normalized = normalize(query);
  const terms = [...new Set(normalized.split(/[^a-z0-9]+/).filter((term) => term.length >= 2 && term !== 'mon'))].slice(0, 6);
  const evidenceParams = terms.map((_, index) => `$${5 + index}`);
  const evidenceClause = evidenceParams.length
    ? `CASE WHEN EXISTS (
         SELECT 1
         FROM dish evidence_ds
         JOIN dish_attribute evidence_da ON evidence_da.dish_id = evidence_ds.id
         JOIN food_attribute evidence_fa ON evidence_fa.id = evidence_da.attribute_id
         WHERE evidence_ds.restaurant_id = r.id
           AND evidence_ds.status = 'available'
           AND evidence_fa.is_active = true
           AND evidence_fa.normalized IN (${evidenceParams.join(', ')})
       ) THEN 0.25 ELSE 0 END`
    : '0';
  const result = await client.query(
    `SELECT r.id,
            (GREATEST(similarity(r.name, $1), similarity(r.normalized_name, $1))
              + $2 * (1 - (emb.embedding <=> $3::vector))
              + ${evidenceClause}
              + ${(qualityWeight * 2 / 3).toFixed(6)} * LEAST(COALESCE(r.rating, 0) / 5.0, 1.0)
              + ${(qualityWeight / 3).toFixed(6)} * LEAST(LN(1 + COALESCE(r.review_count, 0)) / LN(101), 1.0)) AS score
       FROM restaurant r
       JOIN restaurant_embedding emb ON emb.restaurant_id = r.id
        AND emb.model = (SELECT model FROM restaurant_embedding GROUP BY model ORDER BY COUNT(*) DESC, model LIMIT 1)
      WHERE r.status = 'active'
      ORDER BY score DESC, r.rating DESC NULLS LAST, r.id
      LIMIT $4`,
    [query, semanticWeight, vectorLiteral, K, ...terms],
  );
  return result.rows.map((row) => row.id);
}

async function run() {
  const client = new Client({
    host: '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  });
  await client.connect();
  const modelResult = await client.query(
    `SELECT model, COUNT(*)::int AS count
       FROM restaurant_embedding
      GROUP BY model
      ORDER BY MAX(created_at) DESC, MIN(id::text) DESC`,
  );
  if (!modelResult.rows.length) throw new Error('No stored restaurant embeddings available.');
  console.log(JSON.stringify({ storedModels: modelResult.rows, queryModel: process.env.EMBEDDING_MODEL }));
  const humanQrels = loadHumanQrels();
  const benchmarkQueries = humanQrels ? [...humanQrels.keys()] : queries;
  const qrels = new Map();
  for (const query of benchmarkQueries) qrels.set(query, humanQrels?.get(query) ?? await labels(client, query));
  console.log(JSON.stringify({ qrelsSource: humanQrels ? qrelsFile : 'heuristic-fallback', queries: benchmarkQueries.length }));
  const variants = [
    [1.0, 0.12], [1.0, 0.14], [1.0, 0.16],
    [1.1, 0.12], [1.1, 0.14], [1.1, 0.16],
    [1.2, 0.12], [1.2, 0.14], [1.2, 0.16],
    [2.4, 0.12], [2.4, 0.14], [2.4, 0.16],
    [2.8, 0.12], [2.8, 0.14], [2.8, 0.16],
    [3.0, 0.12], [3.0, 0.14], [3.0, 0.16],
    [3.2, 0.12], [3.2, 0.14], [3.2, 0.16],
    [3.4, 0.12], [3.4, 0.14], [3.4, 0.16],
    [3.6, 0.12], [3.6, 0.14], [3.6, 0.16],
    [4.0, 0.16],
  ];
  for (const [semanticWeight, qualityWeight] of variants) {
    const rows = [];
    for (const query of benchmarkQueries) {
      const ids = await rank(client, query, semanticWeight, qualityWeight);
      const score = metrics(ids, qrels.get(query));
      rows.push({ query, qrels: qrels.get(query).size, ...score });
    }
    const macro = rows.reduce((acc, row) => ({ recall: acc.recall + row.recall, ndcg: acc.ndcg + row.ndcg }), { recall: 0, ndcg: 0 });
    macro.recall /= rows.length;
    macro.ndcg /= rows.length;
    console.log(JSON.stringify({ semanticWeight, qualityWeight, rows, macro }));
  }
  await client.end();
}

run().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
