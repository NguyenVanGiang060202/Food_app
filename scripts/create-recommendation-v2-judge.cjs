const { Client } = require('pg');
const fs = require('fs');

function loadDotEnv() {
  if (!fs.existsSync('.env')) return;
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadDotEnv();

const QUERIES = ['phở bò', 'bún bò huế', 'món nướng'];
const SEMANTIC_WEIGHT = 1.2;
const QUALITY_WEIGHT = 0.16;
const K = 10;

async function queryEmbedding(query) {
  const baseUrl = process.env.EMBEDDING_BASE_URL?.replace(/\/+$/, '');
  const apiKey = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL;
  if (!baseUrl || !apiKey || !model) throw new Error('Embedding provider is not configured.');
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: query, ...(process.env.EMBEDDING_DIMENSIONS ? { dimensions: Number(process.env.EMBEDDING_DIMENSIONS) } : {}) }),
  });
  if (!response.ok) throw new Error(`embedding provider ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json();
  if (!Array.isArray(payload.data?.[0]?.embedding)) throw new Error('Embedding response is missing embedding data.');
  return payload.data[0].embedding;
}

async function rank(client, query) {
  const vector = await queryEmbedding(query);
  const vectorLiteral = `[${vector.map((value) => value.toFixed(8)).join(',')}]`;
  const normalized = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const terms = [...new Set(normalized.split(/[^a-z0-9]+/).filter((term) => term.length >= 2 && term !== 'mon'))].slice(0, 6);
  const evidenceParams = terms.map((_, index) => `$${5 + index}`);
  const evidenceClause = evidenceParams.length
    ? `CASE WHEN EXISTS (SELECT 1 FROM dish evidence_ds JOIN dish_attribute evidence_da ON evidence_da.dish_id = evidence_ds.id JOIN food_attribute evidence_fa ON evidence_fa.id = evidence_da.attribute_id WHERE evidence_ds.restaurant_id = r.id AND evidence_ds.status = 'available' AND evidence_fa.is_active = true AND evidence_fa.normalized IN (${evidenceParams.join(', ')})) THEN 0.25 ELSE 0 END`
    : '0';
  const result = await client.query(
    `SELECT r.id, r.name, r.rating, r.review_count,
            (GREATEST(similarity(r.name, $1), similarity(r.normalized_name, $1))
              + $2 * (1 - (emb.embedding <=> $3::vector))
              + ${evidenceClause}
              + ${(QUALITY_WEIGHT * 2 / 3).toFixed(6)} * LEAST(COALESCE(r.rating, 0) / 5.0, 1.0)
              + ${(QUALITY_WEIGHT / 3).toFixed(6)} * LEAST(LN(1 + COALESCE(r.review_count, 0)) / LN(101), 1.0)) AS score
       FROM restaurant r
       JOIN restaurant_embedding emb ON emb.restaurant_id = r.id
        AND emb.model = (SELECT model FROM restaurant_embedding GROUP BY model ORDER BY COUNT(*) DESC, model LIMIT 1)
      WHERE r.status = 'active'
      ORDER BY score DESC, r.rating DESC NULLS LAST, r.id
      LIMIT $4`,
    [query, SEMANTIC_WEIGHT, vectorLiteral, K, ...terms],
  );
  return result.rows;
}

async function run() {
  const client = new Client({ host: '127.0.0.1', port: Number(process.env.POSTGRES_PORT || 5432), database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await client.connect();
  const output = {
    instructions: 'Chấm relevance 0-3 cho từng quán: 3 = rất phù hợp, 2 = phù hợp, 1 = hơi phù hợp, 0 = không phù hợp. Chấm độc lập theo query; không cần suy đoán ngoài thông tin bạn thấy trong app.',
    semanticWeight: SEMANTIC_WEIGHT,
    qualityWeight: QUALITY_WEIGHT,
    queries: {},
  };
  for (const query of QUERIES) {
    const rows = await rank(client, query);
    output.queries[query] = rows.map((row, index) => ({ rank: index + 1, restaurantId: row.id, restaurantName: row.name, rating: row.rating, reviewCount: row.review_count, relevance: null }));
  }
  await client.end();
  fs.writeFileSync('scripts/recommendation-v2-human-judge.json', `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ file: 'scripts/recommendation-v2-human-judge.json', queries: QUERIES, candidatesPerQuery: K }, null, 2));
}

run().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
