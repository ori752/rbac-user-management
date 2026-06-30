import type { ListingSource } from '../types';
import { FixtureListingSource } from './fixture';
import { PartnerApiListingSource } from './partnerApi';

export type { ListingSource } from '../types';
export { FixtureListingSource } from './fixture';
export { PartnerApiListingSource } from './partnerApi';

/**
 * Selects a listing source by name. Defaults to the compliant fixture source so
 * the pipeline always runs with zero scraping unless a compliant source is
 * explicitly configured.
 */
export function selectSource(name = 'fixture'): ListingSource {
  switch (name) {
    case 'fixture': return new FixtureListingSource();
    case 'partner': return new PartnerApiListingSource();
    default:
      throw new Error(`Unknown listing source "${name}". Available: fixture, partner.`);
  }
}
