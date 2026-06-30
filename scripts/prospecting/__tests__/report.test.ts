/**
 * Phase C tests — report shape, ranking, the qualified-lead floor (no padding),
 * and the disclaimer surviving onto the JSON report AND the summary text.
 */
import { FixtureListingSource } from '../sources/fixture';
import { HeuristicReviewAnalyzer } from '../analyzer/heuristic';
import { computeDistress } from '../distress';
import { buildLeadsReport, formatReportText, type AnalyzedListing } from '../report';
import { LEADS_DISCLAIMER } from '../types';

async function analyzeAll(): Promise<AnalyzedListing[]> {
  const listings = await new FixtureListingSource().fetchListings();
  const analyzer = new HeuristicReviewAnalyzer();
  const out: AnalyzedListing[] = [];
  for (const listing of listings) {
    const diagnosis = await analyzer.analyze(listing);
    out.push({ listing, diagnosis, distress: computeDistress(listing, diagnosis) });
  }
  return out;
}

describe('buildLeadsReport', () => {
  test('ranks by distress, caps at 5, and excludes low-distress (healthy) hosts', async () => {
    const report = buildLeadsReport(await analyzeAll(), { source: 'fixture', minDistress: 40 });
    expect(report.leads.length).toBeGreaterThan(0);
    expect(report.leads.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < report.leads.length; i++) {
      expect(report.leads[i - 1].distress.score).toBeGreaterThanOrEqual(report.leads[i].distress.score);
    }
    // The healthy host (fx-004, distress 4) must never be a lead.
    expect(report.leads.some((l) => l.listingId === 'fx-004')).toBe(false);
    // The most-distressed host tops the list.
    expect(report.leads[0].listingId).toBe('fx-006');
  });

  test('does NOT pad to 5 when fewer hosts qualify', async () => {
    const report = buildLeadsReport(await analyzeAll(), { source: 'fixture', minDistress: 90 });
    expect(report.evaluated).toBe(6);
    expect(report.leads.length).toBe(1); // only Harbor View (100) clears 90
  });

  test('the disclaimer rides the JSON report (survives into the UI)', async () => {
    const report = buildLeadsReport(await analyzeAll(), { source: 'fixture' });
    expect(report.disclaimer).toBe(LEADS_DISCLAIMER);
  });

  test('leads carry the host BUSINESS contact only, never reviewer identity', async () => {
    const report = buildLeadsReport(await analyzeAll(), { source: 'fixture' });
    for (const lead of report.leads) {
      const c = lead.contact;
      expect(c.hostName || c.managementCompany || c.businessEmail).toBeTruthy();
      expect(JSON.stringify(lead)).not.toMatch(/reviewer|guestname|author|username/i);
    }
  });
});

describe('formatReportText', () => {
  test('includes the disclaimer and states when fewer than 5 qualify', async () => {
    const report = buildLeadsReport(await analyzeAll(), { source: 'fixture', minDistress: 90 });
    const text = formatReportText(report);
    expect(text).toContain(LEADS_DISCLAIMER);
    expect(text).toMatch(/fewer than 5/i);
  });

  test('lists each qualified lead with its diagnosis and evidence', async () => {
    const report = buildLeadsReport(await analyzeAll(), { source: 'fixture', minDistress: 40 });
    const text = formatReportText(report);
    expect(text).toContain('Harbor View Apartment');
    expect(text).toMatch(/distress 100\/100/);
    expect(text).not.toContain('Cozy Studio'); // healthy host excluded
  });
});
