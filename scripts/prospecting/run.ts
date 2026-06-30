/**
 * Host Lead Intelligence — CLI entry point.
 *
 *   A: load listings from a (compliant) ListingSource.
 *   B: diagnose each listing's recurring problem + public-signals distress score.
 *   C: build a ranked top-5 report (qualified-lead floor), write it to JSON for
 *      the web layer, print a human-readable summary, and notify the manager.
 *
 * Usage:
 *   npm run leads                      # fixture source, zero scraping/cost
 *   npm run leads -- --limit 3
 *   npm run leads -- --json            # print the report JSON
 *   npm run leads -- --source partner  # documented stub (compliant creds only)
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { selectSource } from './sources';
import { selectAnalyzer } from './analyzer';
import { computeDistress } from './distress';
import { diagnoseFromHealth } from './health';
import { PORTFOLIO_DISCLAIMER } from './types';
import { buildLeadsReport, formatReportText, type AnalyzedListing } from './report';
import { notifyReport } from '../notifier/report';
import { createLogger, resolveLogLevel } from '../utils/logger';

const log = createLogger('prospecting', resolveLogLevel());

/** Where the latest report is written (read by the web GET /leads route). */
export const REPORT_DIR  = path.resolve(__dirname, 'output');
export const REPORT_PATH = path.join(REPORT_DIR, 'leads-latest.json');

interface CliArgs { source: string; limit?: number; json: boolean; }

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const limitRaw = get('--limit');
  return {
    // --source flag → LEADS_SOURCE env → fixture. The env lets the web "Run
    // pipeline" button (which spawns this CLI) target a configured source.
    source: get('--source') ?? process.env['LEADS_SOURCE'] ?? 'fixture',
    limit:  limitRaw !== undefined ? Number(limitRaw) : undefined,
    json:   args.includes('--json'),
  };
}

async function run(): Promise<void> {
  const { source: sourceName, limit, json } = parseArgs();
  const source = selectSource(sourceName);

  log.info('Loading listings', { source: source.name, limit });
  const listings = await source.fetchListings({ limit });

  const analyzer = selectAnalyzer();
  const analyzed: AnalyzedListing[] = [];
  for (const listing of listings) {
    // Listings with no public reviews but operational health (the Guesty /
    // portfolio case) are diagnosed from that health; otherwise from reviews.
    const diagnosis = listing.reviews.length === 0 && listing.health
      ? diagnoseFromHealth(listing)
      : await analyzer.analyze(listing);
    analyzed.push({ listing, diagnosis, distress: computeDistress(listing, diagnosis) });
  }

  const report = buildLeadsReport(analyzed, {
    source:     source.name,
    disclaimer: source.name === 'guesty' ? PORTFOLIO_DISCLAIMER : undefined,
  });

  // Persist for the web layer (Phase D renders GET /leads from this file).
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  log.info('Report written', { path: REPORT_PATH, qualified: report.leads.length, evaluated: report.evaluated });

  const text = formatReportText(report);
  if (json) console.log(JSON.stringify(report, null, 2));
  else      console.log('\n' + text + '\n');

  // Notify the manager (console always; email/Slack when configured).
  await notifyReport({
    subject: `Host Lead Intelligence — ${report.leads.length} qualified hot lead(s)`,
    text,
  });

  process.exit(0);
}

run().catch((err: unknown) => {
  log.error('Prospecting run failed', { error: (err as Error).message });
  process.exit(1);
});
