/**
 * Portfolio-health scoring — for listings sourced from a PMS you control
 * (e.g. Guesty). These signals are FACTS from your own account data (publish
 * status, active status, housekeeping), not inferences from public reviews, so
 * they flag managed listings that need attention with high confidence.
 */
import type { ListingHealth, ReviewDiagnosis, SourceListing } from './types';

export interface HealthContribution {
  score: number;
  signals: string[];
}

/** Additive distress contribution from a listing's operational health. */
export function healthDistress(h: ListingHealth): HealthContribution {
  const signals: string[] = [];
  let score = 0;

  if (h.isListed === false) {
    score += 35;
    signals.push('listing is unpublished — not bookable on any channel');
  }
  if (h.active === false) {
    score += 30;
    signals.push('listing is inactive in the PMS');
  }
  if ((h.cleaningStatus ?? '').toLowerCase() === 'dirty') {
    score += 15;
    signals.push('flagged dirty in housekeeping');
    if (typeof h.cleaningStaleDays === 'number' && h.cleaningStaleDays > 60) {
      score += 20;
      signals.push(`dirty status unresolved for ${h.cleaningStaleDays} days`);
    } else if (typeof h.cleaningStaleDays === 'number' && h.cleaningStaleDays > 14) {
      score += 8;
      signals.push(`dirty status unresolved for ${h.cleaningStaleDays} days`);
    }
  }

  return { score, signals };
}

/**
 * Diagnoses a managed listing's primary problem from operational health when
 * there are no public reviews to read (the Guesty/portfolio case). Maps onto the
 * existing ProblemCategory enum so the rest of the pipeline is unchanged.
 */
export function diagnoseFromHealth(listing: SourceListing): ReviewDiagnosis {
  const h = listing.health ?? {};

  if (h.isListed === false || h.active === false) {
    return {
      category: 'value',
      severity: 5,
      summary: 'Listing is offline/unpublished — generating no bookings or revenue.',
    };
  }
  if ((h.cleaningStatus ?? '').toLowerCase() === 'dirty') {
    const stale = typeof h.cleaningStaleDays === 'number' ? ` for ${h.cleaningStaleDays} days` : '';
    return {
      category: 'cleanliness',
      severity: 3,
      summary: `Flagged dirty in housekeeping${stale} — operational follow-up needed.`,
    };
  }
  return {
    category: 'value',
    severity: 1,
    summary: 'No outstanding operational issues detected.',
  };
}
