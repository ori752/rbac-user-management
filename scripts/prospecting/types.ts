/**
 * Host Lead Intelligence — domain types.
 *
 * The compliance posture is encoded in the TYPES, not just in comments:
 *   - The lead entity is ALWAYS the host/owner (a commercial operator).
 *   - Guests/reviewers are NEVER stored, profiled, or identified — `PublicReview`
 *     deliberately has no author/reviewer/profile field.
 *   - Enrichment is BUSINESS/professional contact only — `HostBusinessContact`
 *     has no personal address, personal social, or username field.
 *   - "Distress / delisting risk" is an INFERENCE from public data — the
 *     `DistressScore.basis` literal makes that non-optional.
 */

// ─── Host (the only lead entity) ──────────────────────────────────────────────

/**
 * Business/professional contact for the HOST/OWNER, for B2B outreach only.
 * No personal addresses, personal social accounts, or Sherlock-style username
 * hunting — by design there is nowhere in this shape to put them.
 */
export interface HostBusinessContact {
  /** Host or listing display name (a commercial operator). */
  hostName?: string;
  /** Management/property-management company name, if the operator is a business. */
  managementCompany?: string;
  /** Public business website. */
  businessWebsite?: string;
  /** Public business email. */
  businessEmail?: string;
  /** Public business phone. */
  businessPhone?: string;
  /** Company (organization) LinkedIn URL — not a personal profile. */
  companyLinkedIn?: string;
}

// ─── Reviews (read in aggregate; reviewers never identified) ───────────────────

/**
 * A public review, used IN AGGREGATE for analysis only. There is intentionally
 * no author/reviewer/user/profile field: we never store or identify the
 * individual who wrote it.
 */
export interface PublicReview {
  /** Review body text (analyzed; never attributed to an individual). */
  text: string;
  /** Star rating, normalised to 1..5 if published. */
  rating?: number;
  /** Coarse ISO date — for recency/trend signals only. */
  date?: string;
}

// ─── Operational health (PMS-sourced, e.g. Guesty) ────────────────────────────

/**
 * Operational health of a MANAGED listing, as reported by a PMS you control
 * (e.g. Guesty). Unlike review signals, these are FACTS from your own account
 * data — not inferences from public data — so they power a "portfolio /
 * retention health" view of listings you already manage.
 */
export interface ListingHealth {
  /** Listing is active in the PMS. */
  active?: boolean;
  /** Listing is currently published / bookable on channels. */
  isListed?: boolean;
  /** Housekeeping status, e.g. 'clean' | 'dirty'. */
  cleaningStatus?: string;
  /** Days since the housekeeping status was last updated (staleness). */
  cleaningStaleDays?: number;
}

// ─── Listing (as returned by a ListingSource) ─────────────────────────────────

export interface SourceListing {
  /** Stable id within the source. */
  id: string;
  /** Source platform identifier, e.g. 'airbnb' | 'booking' | 'fixture'. */
  platform: string;
  title: string;
  url?: string;
  city?: string;
  country?: string;
  /** Current overall rating, normalised to 1..5 if published. */
  rating?: number;
  /** Total number of reviews the listing has (may exceed the sampled `reviews`). */
  reviewsCount?: number;
  /** Whether the operator currently holds a Superhost-style badge. */
  isSuperhost?: boolean;
  /** Sampled public reviews for analysis (aggregate only — see `PublicReview`). */
  reviews: PublicReview[];
  /** Host/owner business contact — the only lead entity. */
  host: HostBusinessContact;
  /** Operational health, when the source is a PMS you control (e.g. Guesty). */
  health?: ListingHealth;
}

// ─── Listing source (pluggable) ───────────────────────────────────────────────

/**
 * A pluggable source of listings to evaluate. Implementations MUST be compliant:
 * no anti-bot evasion, respect robots.txt and rate limits. The default fixture
 * source performs NO network access at all.
 */
export interface ListingSource {
  /** Stable identifier, surfaced in logs and report provenance. */
  readonly name: string;
  fetchListings(opts?: { limit?: number }): Promise<SourceListing[]>;
}

// ─── Analysis + scoring (populated in later phases) ───────────────────────────

export type ProblemCategory =
  | 'cleanliness'
  | 'communication'
  | 'check_in'
  | 'accuracy'
  | 'maintenance'
  | 'value';

/**
 * Diagnosis of a listing's recurring problem, produced from public reviews read
 * in aggregate (LLM in production, deterministic stub when no API key). Never
 * attributed to any individual reviewer.
 */
export interface ReviewDiagnosis {
  category: ProblemCategory;
  /** 1 (minor) .. 5 (severe). */
  severity: number;
  /** Short human-readable summary of the host's core problem. */
  summary: string;
}

/**
 * Diagnoses a listing's recurring problem from its public reviews (aggregate).
 * Implementations: Claude (production) or a deterministic heuristic (no key).
 */
export interface ReviewAnalyzer {
  readonly name: string;
  analyze(listing: SourceListing): Promise<ReviewDiagnosis>;
}

/**
 * Distress / delisting-risk signal. This is explicitly an INFERENCE from PUBLIC
 * data only; it does NOT reflect any platform-internal delisting status. The
 * `basis` literal carries that disclaimer with the data itself.
 */
export interface DistressScore {
  /** 0..100 inferred likelihood the host needs management help. */
  score: number;
  /** The public signals behind the score (always populated). */
  signals: string[];
  /**
   * What the score is derived from:
   *   'inference_from_public_data' — public review/rating signals (prospecting)
   *   'operational_pms_data'       — facts from your own PMS account (portfolio)
   */
  basis: 'inference_from_public_data' | 'operational_pms_data';
}

/** A qualified B2B lead. The lead entity is ALWAYS the host/owner. */
export interface HostLead {
  listingId: string;
  listingTitle: string;
  listingUrl?: string;
  platform: string;
  location?: string;
  diagnosis: ReviewDiagnosis;
  distress: DistressScore;
  /** Business/professional contact only. */
  contact: HostBusinessContact;
}

export interface LeadsReport {
  generatedAt: string;
  source: string;
  /** Total listings evaluated. */
  evaluated: number;
  /** Qualified-lead distress floor; hosts below it are excluded (never padded). */
  minDistress: number;
  /** Top leads, ranked by distress score (up to 5 — may be fewer). */
  leads: HostLead[];
  /** Carried with every report so the inference framing is never lost. */
  disclaimer: string;
}

/** The mandatory framing statement, attached to every report. */
export const LEADS_DISCLAIMER =
  'Lead scores are an INFERENCE from public review/rating signals for B2B ' +
  'prospecting. They do not reflect Airbnb/Booking-internal delisting status. ' +
  'The lead is the host/owner (a commercial operator); guests who wrote reviews ' +
  'are never profiled or identified.';

/** Framing for the Guesty portfolio-health view (own-account operational data). */
export const PORTFOLIO_DISCLAIMER =
  'Scores reflect operational health signals from your OWN Guesty account ' +
  '(publish status, active status, housekeeping) — not public reviews. They flag ' +
  'managed listings that may need attention; they are not a delisting prediction.';
