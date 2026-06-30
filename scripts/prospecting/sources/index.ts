import type { ListingSource } from '../types';
import { FixtureListingSource } from './fixture';
import { PartnerApiListingSource } from './partnerApi';
import { GuestyListingSource } from './guesty';
import { MockScrapeSource } from './mockScrape';

export type { ListingSource } from '../types';
export { FixtureListingSource } from './fixture';
export { PartnerApiListingSource } from './partnerApi';
export { GuestyListingSource } from './guesty';
export { MockScrapeSource } from './mockScrape';

/**
 * Selects a listing source by name. Defaults to the compliant fixture source so
 * the pipeline always runs with zero scraping unless a compliant source is
 * explicitly configured.
 *
 *   fixture — committed sample data (default; zero network/scraping)
 *   mock    — REAL Playwright scrape of a local mock marketplace (legal skill demo)
 *   guesty  — your own Guesty account via the official API (authorized data)
 *   partner — documented stub for a licensed/partner feed
 */
export function selectSource(name = 'fixture'): ListingSource {
  switch (name) {
    case 'fixture': return new FixtureListingSource();
    case 'mock':    return new MockScrapeSource();
    case 'guesty':  return new GuestyListingSource();
    case 'partner': return new PartnerApiListingSource();
    default:
      throw new Error(`Unknown listing source "${name}". Available: fixture, mock, guesty, partner.`);
  }
}
