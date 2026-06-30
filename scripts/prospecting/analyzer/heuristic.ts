/**
 * Deterministic, network-free review analyzer.
 *
 * Used automatically when ANTHROPIC_API_KEY is unset (so the pipeline runs
 * end-to-end at zero cost and tests stay deterministic), and as a per-listing
 * fallback when a Claude call fails. Diagnoses the HOST's recurring problem from
 * public reviews in aggregate — reviewers are never identified.
 */
import type { ProblemCategory, ReviewAnalyzer, ReviewDiagnosis, SourceListing } from '../types';

const CATEGORY_PATTERNS: Record<ProblemCategory, RegExp> = {
  cleanliness:   /\b(dirty|filth|unclean|cleanlines?s|not clean|mold|mould|dust|stain|hair|crumbs?|mopp?ed|grimy|smell)\b/i,
  communication: /\b(communicat|respond|response|unanswered|never heard|reach (anyone|the host|someone)|messages?|repl(y|ies)|slow to)\b/i,
  check_in:      /\b(check.?in|lockbox|key ?code|the code|self check|instructions arrived|couldn'?t get in|locked out|waiting outside)\b/i,
  accuracy:      /\b(not as (described|pictured|shown)|inaccurate|misleading|oversell|oversold|description (oversells|is wrong)|weren'?t there|as advertised)\b/i,
  maintenance:   /\b(broken|repair|maintenance|leak|heating|heater|\bac\b|air condition|hot tub|stove|burner|fridge|out of order|fix|run.?down|neglect)\b/i,
  value:         /\b(overpriced|over-priced|\bvalue\b|rip.?off|too expensive|not worth|for the price|nightly rate)\b/i,
};

const LABEL: Record<ProblemCategory, string> = {
  cleanliness: 'cleanliness', communication: 'communication', check_in: 'check-in',
  accuracy: 'listing-accuracy', maintenance: 'maintenance', value: 'value',
};

/** Lower-rated reviews carry more diagnostic weight (1★ → 5, 5★ → 1). */
function weightForRating(rating?: number): number {
  return 6 - (typeof rating === 'number' ? Math.min(5, Math.max(1, rating)) : 3);
}

export class HeuristicReviewAnalyzer implements ReviewAnalyzer {
  readonly name = 'heuristic';

  async analyze(listing: SourceListing): Promise<ReviewDiagnosis> {
    const scores: Record<ProblemCategory, number> = {
      cleanliness: 0, communication: 0, check_in: 0, accuracy: 0, maintenance: 0, value: 0,
    };
    for (const review of listing.reviews) {
      const w = weightForRating(review.rating);
      (Object.keys(CATEGORY_PATTERNS) as ProblemCategory[]).forEach((cat) => {
        if (CATEGORY_PATTERNS[cat].test(review.text)) scores[cat] += w;
      });
    }

    // Deterministic winner (fixed iteration order is the tie-break).
    const order: ProblemCategory[] = ['cleanliness', 'maintenance', 'communication', 'check_in', 'accuracy', 'value'];
    let category: ProblemCategory = order[0];
    for (const cat of order) if (scores[cat] > scores[category]) category = cat;

    const negatives = listing.reviews.filter((r) => (r.rating ?? 3) <= 2).length;
    const share = listing.reviews.length ? negatives / listing.reviews.length : 0;
    const severity = Math.min(5, Math.max(1, 1 + Math.round(share * 4)));

    return {
      category,
      severity,
      summary: `Recurring ${LABEL[category]} complaints across ${negatives}/${listing.reviews.length} recent reviews.`,
    };
  }
}
