/**
 * Phase B tests — deterministic heuristic analyzer + public-signals distress
 * scoring. These run with no API key and no network, so they're fast, free, and
 * stable, and they lock the "inference only" framing.
 */
import { HeuristicReviewAnalyzer } from '../analyzer/heuristic';
import { selectAnalyzer } from '../analyzer';
import { computeDistress } from '../distress';
import { FixtureListingSource } from '../sources/fixture';
import type { ProblemCategory } from '../types';

const VALID: ProblemCategory[] = ['cleanliness', 'communication', 'check_in', 'accuracy', 'maintenance', 'value'];

describe('HeuristicReviewAnalyzer (deterministic, no network)', () => {
  const analyzer = new HeuristicReviewAnalyzer();

  test('returns a valid diagnosis for every fixture listing', async () => {
    const listings = await new FixtureListingSource().fetchListings();
    for (const l of listings) {
      const d = await analyzer.analyze(l);
      expect(VALID).toContain(d.category);
      expect(d.severity).toBeGreaterThanOrEqual(1);
      expect(d.severity).toBeLessThanOrEqual(5);
      expect(d.summary.length).toBeGreaterThan(0);
    }
  });

  test('is deterministic (same input -> identical output)', async () => {
    const [l] = await new FixtureListingSource().fetchListings({ limit: 1 });
    expect(await analyzer.analyze(l)).toEqual(await analyzer.analyze(l));
  });

  test('diagnoses the maintenance-heavy cabin as maintenance', async () => {
    const listings = await new FixtureListingSource().fetchListings();
    const cabin = listings.find((l) => l.id === 'fx-003')!;
    expect((await analyzer.analyze(cabin)).category).toBe('maintenance');
  });
});

describe('computeDistress (public-signals-only inference)', () => {
  const analyzer = new HeuristicReviewAnalyzer();

  test('always labels basis as inference and lists signals', async () => {
    const listings = await new FixtureListingSource().fetchListings();
    for (const l of listings) {
      const ds = computeDistress(l, await analyzer.analyze(l));
      expect(ds.basis).toBe('inference_from_public_data');
      expect(ds.signals.length).toBeGreaterThan(0);
      expect(ds.score).toBeGreaterThanOrEqual(0);
      expect(ds.score).toBeLessThanOrEqual(100);
    }
  });

  test('a struggling host scores higher than a healthy one', async () => {
    const listings = await new FixtureListingSource().fetchListings();
    const harbor = listings.find((l) => l.id === 'fx-006')!; // low rating, lost superhost, dirty
    const studio = listings.find((l) => l.id === 'fx-004')!; // 4.7, superhost, spotless
    const harborScore = computeDistress(harbor, await analyzer.analyze(harbor)).score;
    const studioScore = computeDistress(studio, await analyzer.analyze(studio)).score;
    expect(harborScore).toBeGreaterThan(studioScore);
  });
});

describe('selectAnalyzer', () => {
  test('falls back to the deterministic heuristic when no API key is set', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(selectAnalyzer().name).toBe('heuristic');
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  test('selects the Claude analyzer when an API key is present', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test-not-a-real-key';
    try {
      // Constructing the client does not hit the network; only a real analyze()
      // call would. We only assert which implementation is chosen.
      expect(selectAnalyzer().name).toBe('claude');
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });
});
