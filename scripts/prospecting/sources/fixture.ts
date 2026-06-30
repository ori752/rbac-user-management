/**
 * Default, fully-compliant listing source: reads committed local fixtures.
 *
 * Performs NO network access — the entire feature is demonstrable end-to-end
 * with zero scraping and zero credentials. This is the default for exactly that
 * reason (see the compliance guardrails).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ListingSource, SourceListing } from '../types';

const DEFAULT_FIXTURE = path.resolve(__dirname, '..', 'fixtures', 'sample-listings.json');

export class FixtureListingSource implements ListingSource {
  readonly name = 'fixture';

  constructor(private readonly fixturePath: string = DEFAULT_FIXTURE) {}

  async fetchListings(opts: { limit?: number } = {}): Promise<SourceListing[]> {
    const raw = fs.readFileSync(this.fixturePath, 'utf8');
    const listings = JSON.parse(raw) as SourceListing[];
    return typeof opts.limit === 'number' ? listings.slice(0, opts.limit) : listings;
  }
}
