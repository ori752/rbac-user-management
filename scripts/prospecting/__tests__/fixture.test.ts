/**
 * Phase A tests — the fixture source + the compliance invariants encoded in the
 * data model. These tests are the contract that keeps the feature defensible:
 *   - reviewers are never identified
 *   - host enrichment is business-contact only
 */
import { FixtureListingSource } from '../sources/fixture';
import { selectSource } from '../sources';

describe('FixtureListingSource (compliant, no network)', () => {
  const source = new FixtureListingSource();

  test('loads sample listings without any network access', async () => {
    const listings = await source.fetchListings();
    expect(listings.length).toBeGreaterThanOrEqual(5);
    for (const l of listings) {
      expect(typeof l.title).toBe('string');
      expect(Array.isArray(l.reviews)).toBe(true);
    }
  });

  test('reviews never carry reviewer identity (guests are never profiled)', async () => {
    const listings = await source.fetchListings();
    const bannedReviewKey = /author|reviewer|user|guest|profile|username|account/i;
    for (const l of listings) {
      for (const review of l.reviews) {
        for (const key of Object.keys(review)) {
          expect(key).not.toMatch(bannedReviewKey);
        }
      }
    }
  });

  test('host enrichment is business-only (no personal/home/social/username fields)', async () => {
    const listings = await source.fetchListings();
    const bannedHostKey = /home_?address|residential|personal|instagram|facebook|tiktok|username|dob|ssn/i;
    for (const l of listings) {
      for (const key of Object.keys(l.host)) {
        expect(key).not.toMatch(bannedHostKey);
      }
      const c = l.host;
      const hasBusinessContact = !!(
        c.hostName || c.managementCompany || c.businessWebsite ||
        c.businessEmail || c.businessPhone || c.companyLinkedIn
      );
      expect(hasBusinessContact).toBe(true);
    }
  });

  test('limit caps the number of listings returned', async () => {
    const listings = await source.fetchListings({ limit: 2 });
    expect(listings.length).toBe(2);
  });

  test('selectSource defaults to the compliant fixture source', () => {
    expect(selectSource().name).toBe('fixture');
    expect(selectSource('partner').name).toBe('partner-api');
    expect(() => selectSource('scrape-everything')).toThrow(/Unknown listing source/);
  });
});
