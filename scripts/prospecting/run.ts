/**
 * Host Lead Intelligence — CLI entry point.
 *
 * Phase A: loads listings from a (compliant) ListingSource and prints them.
 * Later phases extend this orchestrator with LLM review analysis, distress
 * scoring, a ranked top-5 report, and manager notification.
 *
 * Usage:
 *   npm run leads                      # default: fixture source, zero scraping
 *   npm run leads -- --limit 3
 *   npm run leads -- --source partner  # documented stub (needs compliant creds)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { selectSource } from './sources';
import { createLogger, resolveLogLevel } from '../utils/logger';

const log = createLogger('prospecting', resolveLogLevel());

interface CliArgs {
  source: string;
  limit?: number;
  json: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const limitRaw = get('--limit');
  return {
    source: get('--source') ?? 'fixture',
    limit:  limitRaw !== undefined ? Number(limitRaw) : undefined,
    json:   args.includes('--json'),
  };
}

async function run(): Promise<void> {
  const { source: sourceName, limit, json } = parseArgs();
  const source = selectSource(sourceName);

  log.info('Loading listings', { source: source.name, limit });
  const listings = await source.fetchListings({ limit });
  log.info('Listings loaded', { count: listings.length });

  if (json) {
    console.log(JSON.stringify({ source: source.name, count: listings.length, listings }, null, 2));
    process.exit(0);
  }

  console.log(`\nLoaded ${listings.length} listing(s) from "${source.name}" (no scraping):\n`);
  for (const l of listings) {
    const host = l.host.managementCompany ?? l.host.hostName ?? '—';
    console.log(
      `  • ${l.title}  [${l.platform}]  rating=${l.rating ?? '—'}  ` +
      `reviews=${l.reviews.length}/${l.reviewsCount ?? '?'}  superhost=${l.isSuperhost ?? '?'}  host=${host}`,
    );
  }
  console.log('\n(Phase A: source layer only — analysis, scoring, report, and notify arrive in later phases.)\n');
  process.exit(0);
}

run().catch((err: unknown) => {
  log.error('Prospecting run failed', { error: (err as Error).message });
  process.exit(1);
});
