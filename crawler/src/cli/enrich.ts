// One-shot enrichment CLI.
//
//   npm run enrich:once --workspace crawler            # enrich all gaps
//   npm run enrich:once --workspace crawler -- --limit 200
//   npm run enrich:once --workspace crawler -- --dry-run
//
// Requires a migrated database (022_enrichment_provenance.sql).

import { EnrichmentLoader } from '../enrichment/enrichment-loader';

function parseArgs(argv: string[]): { limit: number; dryRun: boolean } {
  let limit = 0;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--limit') {
      limit = Number(argv[index + 1]);
      if (!Number.isInteger(limit) || limit < 0) {
        throw new Error('--limit must be a non-negative integer.');
      }
    } else if (argv[index] === '--dry-run') {
      dryRun = true;
    }
  }
  return { limit, dryRun };
}

async function main(): Promise<void> {
  const { limit, dryRun } = parseArgs(process.argv.slice(2));
  const loader = new EnrichmentLoader();
  try {
    const summary = await loader.enrich({ limit, dryRun });
    console.log(
      JSON.stringify({
        event: 'enrichment_completed',
        dryRun,
        ...summary,
      }),
    );
  } finally {
    await loader.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'enrichment_failed', message: String(error) }));
  process.exitCode = 1;
});
