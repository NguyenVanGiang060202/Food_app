// One-shot embedding CLI (docs/05 Stage 7).
//
//   npm run embed:once --workspace crawler                       # backfill, all gaps
//   npm run embed:once --workspace crawler -- --limit 200
//   npm run embed:once --workspace crawler -- --dry-run
//   npm run embed:once --workspace crawler -- --refresh --dry-run
//
// Requires a migrated database (023_embedding_run_log.sql) and EMBEDDING_API_KEY
// for a real run; dry runs compute document hashes and counts without calling
// any provider.

import { EmbeddingLoader } from '../embedding/embedding-loader';

function parseArgs(argv: string[]) {
  let limit = 0;
  let dryRun = false;
  let refresh = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--limit') {
      limit = Number(argv[index + 1]);
      if (!Number.isInteger(limit) || limit < 0) {
        throw new Error('--limit must be a non-negative integer.');
      }
    } else if (argv[index] === '--dry-run') {
      dryRun = true;
    } else if (argv[index] === '--refresh') {
      refresh = true;
    }
  }
  return { limit, dryRun, refresh };
}

async function main(): Promise<void> {
  const { limit, dryRun, refresh } = parseArgs(process.argv.slice(2));
  const loader = new EmbeddingLoader();
  try {
    const summary = await loader.embed({ limit, dryRun, refresh });
    console.log(
      JSON.stringify({
        event: 'embedding_completed',
        dryRun,
        refresh,
        ...summary,
      }),
    );
  } finally {
    await loader.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({ event: 'embedding_failed', message: String(error) }),
  );
  process.exitCode = 1;
});