/**
 * Guesty listing source — pulls listings from the connected Guesty account via
 * the OFFICIAL Guesty Open API (OAuth client-credentials). This is authorized
 * access to YOUR OWN account data — no scraping, no third-party platforms, no
 * proxies or anti-bot evasion.
 *
 * Because Guesty holds the properties you MANAGE, this naturally powers a
 * "portfolio / retention health" view (which of our managed listings are
 * struggling), rather than discovering outside prospects.
 *
 * Note on signal: review/rating data is not present on the Guesty listing object
 * itself. A production account with channel-synced reviews would populate
 * `reviews` via the reviews API; a fresh Sandbox has none, so distress scoring
 * will be thin there (which the engine reports honestly — no signal, no lead).
 */
import type { ListingSource, SourceListing, PublicReview, HostBusinessContact, ListingHealth } from '../types';
import { GuestyClient } from '../../guesty/client';
import { createLogger } from '../../utils/logger';

const log = createLogger('source.guesty');

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

export class GuestyListingSource implements ListingSource {
  readonly name = 'guesty';

  constructor(private readonly client: GuestyClient = new GuestyClient()) {}

  async fetchListings(opts: { limit?: number } = {}): Promise<SourceListing[]> {
    const limit = opts.limit ?? 25;
    const raw = await this.client.listListings(limit);
    log.info('Fetched listings from Guesty account', { count: raw.length });
    return raw.map((l) => this.mapListing(l));
  }

  private mapListing(l: Record<string, unknown>): SourceListing {
    const addr   = (l['address'] ?? {}) as Record<string, unknown>;
    const owners = Array.isArray(l['owners']) ? (l['owners'] as Record<string, unknown>[]) : [];
    const owner  = owners[0] ?? {};

    // Reviews/ratings are not on the Guesty listing object. Left empty here; a
    // production account would populate these from channel-synced reviews.
    const reviews: PublicReview[] = [];

    // The "host" for outreach is the property owner — the PM company's own client
    // (authorized, internal data), or the listing nickname as a fallback label.
    const host: HostBusinessContact = {
      hostName:      str(owner['fullName']) ?? str(owner['firstName']) ?? str(l['nickname']) ?? str(l['title']),
      businessEmail: str(owner['email']),
      businessPhone: str(owner['phone']),
    };

    // Operational health — facts from your own account that drive the
    // portfolio-health score (no public reviews involved).
    const cleaning = (l['cleaningStatus'] ?? {}) as Record<string, unknown>;
    const updatedAt = str(cleaning['updatedAt']);
    const health: ListingHealth = {
      active:         typeof l['active'] === 'boolean' ? (l['active'] as boolean) : undefined,
      isListed:       typeof l['isListed'] === 'boolean' ? (l['isListed'] as boolean) : undefined,
      cleaningStatus: str(cleaning['value']),
      cleaningStaleDays: updatedAt
        ? Math.max(0, Math.floor((Date.now() - Date.parse(updatedAt)) / 86_400_000))
        : undefined,
    };

    return {
      id:           String(l['_id']),
      platform:     'guesty',
      title:        str(l['title']) ?? str(l['nickname']) ?? 'Untitled listing',
      city:         str(addr['city']),
      country:      str(addr['country']),
      reviews,
      host,
      health,
    };
  }
}
