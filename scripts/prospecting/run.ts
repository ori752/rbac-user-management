/**
 * Host Lead Intelligence — CLI entry point.
 *
 * Phase A: load listings from a (compliant) ListingSource.
 * Phase B: diagnose each listing's recurring problem (Claude or heuristic) and
 *          compute a public-signals-only distress score, then rank.
 * Later phases add the formal top-5 report and manager notification.
 *
 * Usage:
 *   npm run leads                      # fixture source, zero scraping/cost
 *   npm run leads -- --limit 3
 *   npm run leads -- --source partner  # documented stub (compliant creds only)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { selectSource } from './sources';
import { selectAnalyzer } from './analyzer';
import { computeDistress } from './distress';
import type { ReviewDiagnosis, DistressScore, SourceListing } from './types';
import { createLogger, resolveLogLevel } from '../utils/logger';

const log = createLogger('prospecting', resolveLogLevel());

interface CliArgs { source: string; limit?: number; json: boolean; }

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

interface Analyzed { listing: SourceListing; diagnosis: ReviewDiagnosis; distress: DistressScore; }

async function run(): Promise<void> {
  const { source: sourceName, limit, json } = parseArgs();
  const source = selectSource(sourceName);

  log.info('Loading listings', { source: source.name, limit });
  const listings = await source.fetchListings({ limit });
  log.info('Listings loaded', { count: listings.length });

  const analyzer = selectAnalyzer();
  const analyzed: Analyzed[] = [];
  for (const listing of listings) {
    const diagnosis = await analyzer.analyze(listing);
    const distress  = computeDistress(listing, diagnosis);
    analyzed.push({ listing, diagnosis, distress });
  }
  analyzed.sort((a, b) => b.distress.score - a.distress.score);

  if (json) {
    console.log(JSON.stringify({ source: source.name, analyzer: analyzer.name, analyzed }, null, 2));
    process.exit(0);
  }

  console.log(`\nAnalyzed ${analyzed.length} listing(s) from "${source.name}" via ${analyzer.name} analyzer (no scraping):\n`);
  console.log('  Ranked by inferred distress (public signals only — NOT a delisting status):\n');
  for (const a of analyzed) {
    console.log(`  [${String(a.distress.score).padStart(3)}] ${a.listing.title} — ${a.diagnosis.category} (sev ${a.diagnosis.severity}/5)`);
    console.log(`        ${a.diagnosis.summary}`);
    console.log(`        signals: ${a.distress.signals.join('; ')}`);
  }
  console.log('\n(Phase B: analysis + scoring. Top-5 report + manager notification arrive in Phase C.)\n');
  process.exit(0);
}

run().catch((err: unknown) => {
  log.error('Prospecting run failed', { error: (err as Error).message });
  process.exit(1);
});
