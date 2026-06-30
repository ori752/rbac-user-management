import type { ListingSource } from '../types';
import { FixtureListingSource } from './fixture';

export type { ListingSource } from '../types';
export { FixtureListingSource } from './fixture';

/**
 * Selects a listing source by name. Defaults to the compliant fixture source so
 * the pipeline always runs with zero scraping unless a compliant source is
 * explicitly configured.
 *
 *   fixture — committed sample data (default; zero network/scraping)
 *   mock    — REAL Playwright scrape of a local mock marketplace (legal skill demo)
 *   guesty  — your own Guesty account via the official API (authorized data)
 *   partner — documented stub for a licensed/partner feed
 *
 * The mock/guesty/partner adapters are lazy-required so that merely importing
 * this module (e.g. in unit tests) never pulls in their heavy deps (playwright,
 * axios) — which keeps the default path fast and the test VM happy.
 */
export function selectSource(name = 'fixture'): ListingSource {
  switch (name) {
    case 'fixture': return new FixtureListingSource();
    case 'mock':    return new (require('./mockScrape').MockScrapeSource)() as ListingSource;
    case 'guesty':  return new (require('./guesty').GuestyListingSource)() as ListingSource;
    case 'partner': return new (require('./partnerApi').PartnerApiListingSource)() as ListingSource;
    default:
      throw new Error(`Unknown listing source "${name}". Available: fixture, mock, guesty, partner.`);
  }
}
