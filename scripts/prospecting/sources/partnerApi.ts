/**
 * Compliant data-source adapter — DOCUMENTED STUB.
 *
 * This is the seam for a *compliant* second source: an official/partner API or a
 * licensed dataset, behind the same `ListingSource` interface as the fixture
 * adapter. It is intentionally left as a stub because no credentials exist.
 *
 * Hard guardrail: do NOT implement live-marketplace scraping, proxy rotation, or
 * any anti-bot/CAPTCHA evasion here. If you wire this up, point it at a source
 * you are licensed to use and that permits this access. Until then, use the
 * `fixture` source, which demonstrates the whole pipeline with zero scraping.
 */
import type { ListingSource, SourceListing } from '../types';

export class PartnerApiListingSource implements ListingSource {
  readonly name = 'partner-api';

  constructor(private readonly apiKey: string | undefined = process.env['LEADS_PARTNER_API_KEY']) {}

  async fetchListings(): Promise<SourceListing[]> {
    throw new Error(
      'PartnerApiListingSource is a documented stub. Wire it to a COMPLIANT data ' +
      'source (official/partner API or a licensed dataset) and set ' +
      'LEADS_PARTNER_API_KEY. No live scraping or anti-bot evasion is permitted — ' +
      'use the `fixture` source to run the pipeline end-to-end.',
    );
  }
}
