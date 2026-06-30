/**
 * Distress / delisting-risk scoring — from PUBLIC signals only.
 *
 * IMPORTANT: this score is an INFERENCE for B2B prospecting. It does NOT reflect
 * any Airbnb/Booking-internal delisting status. That framing is carried in the
 * returned `basis` literal and in every signal label.
 */
import type { DistressScore, ReviewDiagnosis, SourceListing } from './types';
import { healthDistress } from './health';

/** Recent-vs-older review-rating trend (a public, derivable signal). */
function recentVsOlderTrend(listing: SourceListing): 'declining' | 'stable' | 'improving' | 'unknown' {
  const dated = listing.reviews.filter((r) => r.date && typeof r.rating === 'number');
  if (dated.length < 4) return 'unknown';
  const sorted = [...dated].sort((a, b) => (a.date! < b.date! ? 1 : -1)); // newest first
  const half = Math.floor(sorted.length / 2);
  const avg = (arr: typeof sorted) => arr.reduce((s, r) => s + (r.rating as number), 0) / arr.length;
  const diff = avg(sorted.slice(0, half)) - avg(sorted.slice(half));
  if (diff <= -0.5) return 'declining';
  if (diff >= 0.5) return 'improving';
  return 'stable';
}

export function computeDistress(listing: SourceListing, diagnosis: ReviewDiagnosis): DistressScore {
  const signals: string[] = [];
  const reviews = listing.reviews;
  let score = 0;

  const lowRecent = reviews.filter((r) => (r.rating ?? 3) <= 2).length;
  if (lowRecent >= 3)       { score += 30; signals.push(`cluster of ${lowRecent} recent low-rated reviews`); }
  else if (lowRecent === 2) { score += 20; signals.push('2 recent low-rated reviews'); }
  else if (lowRecent === 1) { score += 8;  signals.push('a recent low-rated review'); }

  if (typeof listing.rating === 'number') {
    if (listing.rating < 3.5)      { score += 24; signals.push(`low overall rating (${listing.rating}/5)`); }
    else if (listing.rating < 4.3) { score += 12; signals.push(`below-par overall rating (${listing.rating}/5)`); }
  }

  if (recentVsOlderTrend(listing) === 'declining') {
    score += 14; signals.push('declining recent-vs-older review ratings');
  }

  if (listing.isSuperhost === false && reviews.some((r) => /superhost/i.test(r.text))) {
    score += 12; signals.push('public mention of lost Superhost status');
  }

  if (reviews.some((r) => /\bcancel(l?ed|lation)?\b/i.test(r.text))) {
    score += 10; signals.push('cancellation/policy complaint in reviews');
  }

  score += diagnosis.severity * 4; // up to +20
  signals.push(`diagnosed ${diagnosis.category} problem (severity ${diagnosis.severity}/5)`);

  // Operational health (PMS-sourced, e.g. Guesty) — facts from your own account.
  // When present, the score is grounded in operational data rather than a public
  // inference, which the basis literal records.
  let basis: DistressScore['basis'] = 'inference_from_public_data';
  if (listing.health) {
    const hc = healthDistress(listing.health);
    score += hc.score;
    signals.push(...hc.signals);
    basis = 'operational_pms_data';
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    signals,
    basis,
  };
}
