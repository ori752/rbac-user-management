/**
 * Portfolio-health scoring tests (the Guesty / own-PMS path). These signals are
 * facts from your own account, so the basis is 'operational_pms_data', distinct
 * from the public-review inference path.
 */
import { healthDistress, diagnoseFromHealth } from '../health';
import { computeDistress } from '../distress';
import type { SourceListing } from '../types';

const listing = (health: SourceListing['health']): SourceListing => ({
  id: 'g1', platform: 'guesty', title: 'Test', reviews: [], host: {}, health,
});

describe('healthDistress', () => {
  test('offline + inactive scores high with labeled signals', () => {
    const { score, signals } = healthDistress({ isListed: false, active: false });
    expect(score).toBe(65); // 35 + 30
    expect(signals.join(' ')).toMatch(/unpublished/);
    expect(signals.join(' ')).toMatch(/inactive/);
  });

  test('long-stale dirty status adds a staleness signal', () => {
    const { score, signals } = healthDistress({
      active: true, isListed: true, cleaningStatus: 'dirty', cleaningStaleDays: 124,
    });
    expect(score).toBe(35); // 15 + 20 (>60 days)
    expect(signals.join(' ')).toMatch(/124 days/);
  });

  test('a healthy listing contributes nothing', () => {
    expect(healthDistress({ active: true, isListed: true, cleaningStatus: 'clean' }).score).toBe(0);
  });
});

describe('diagnoseFromHealth', () => {
  test('offline/unpublished → value, severity 5', () => {
    const d = diagnoseFromHealth(listing({ isListed: false }));
    expect(d.category).toBe('value');
    expect(d.severity).toBe(5);
  });

  test('dirty → cleanliness', () => {
    const d = diagnoseFromHealth(listing({ active: true, isListed: true, cleaningStatus: 'dirty', cleaningStaleDays: 90 }));
    expect(d.category).toBe('cleanliness');
  });
});

describe('computeDistress with operational health', () => {
  test('an offline managed listing is flagged with operational_pms_data basis', () => {
    const l = listing({ isListed: false, active: false });
    const ds = computeDistress(l, diagnoseFromHealth(l));
    expect(ds.basis).toBe('operational_pms_data');
    expect(ds.score).toBeGreaterThanOrEqual(40);
  });

  test('a review-based listing keeps the public-inference basis (unchanged)', () => {
    const l: SourceListing = {
      id: 'r', platform: 'fixture', title: 'T', host: {},
      reviews: [{ text: 'dirty place', rating: 1 }],
    };
    const ds = computeDistress(l, { category: 'cleanliness', severity: 4, summary: '' });
    expect(ds.basis).toBe('inference_from_public_data');
  });
});
