/**
 * Claude-powered review analyzer (production path).
 *
 * Uses the official Anthropic SDK with STRUCTURED OUTPUTS (`messages.parse` +
 * `zodOutputFormat`) — closed enums for category/severity so results are
 * groupable for scoring. Deliberately:
 *   - sets NO temperature/top_p/top_k (removed on Opus 4.8 / Fable 5), so
 *     LEADS_MODEL stays swappable; structured outputs + a tight prompt give the
 *     consistency you'd otherwise reach for temperature=0 to get.
 *   - omits `thinking` entirely (safe across Sonnet 4.6 / Opus 4.x / Fable 5).
 *   - keeps withRetry at 2 attempts (the SDK already retries 429/5xx).
 * Falls back to the deterministic heuristic for any listing whose call fails.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ProblemCategory, ReviewAnalyzer, ReviewDiagnosis, SourceListing } from '../types';
import { withRetry } from '../../utils/retry';
import { createLogger } from '../../utils/logger';
import { HeuristicReviewAnalyzer } from './heuristic';

const log = createLogger('prospecting.analyzer.claude');
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const SEVERITY_TO_NUM: Record<string, number> = { minimal: 1, minor: 2, moderate: 3, major: 4, severe: 5 };

const DiagnosisSchema = z.object({
  category: z.enum(['cleanliness', 'communication', 'check_in', 'accuracy', 'maintenance', 'value']),
  severity: z.enum(['minimal', 'minor', 'moderate', 'major', 'severe']),
  summary:  z.string(),
});

const SYSTEM_PROMPT =
  'You are a B2B analyst for a property-management company evaluating short-term-rental ' +
  'listings as potential clients. You read PUBLIC guest reviews in aggregate to diagnose ' +
  "the HOST/OWNER's operational problems. The subject is always the host (a commercial " +
  'operator) — never the individual guests who wrote the reviews, whom you must never name, ' +
  'profile, or describe. Return only the structured diagnosis.';

function buildPrompt(listing: SourceListing): string {
  const reviews = listing.reviews
    .map((r) => `- (${r.rating ?? '?'}★${r.date ? ', ' + r.date : ''}) ${r.text}`)
    .join('\n');
  return [
    `Listing: "${listing.title}" on ${listing.platform}.`,
    listing.rating !== undefined ? `Current overall rating: ${listing.rating}/5.` : '',
    'Public guest reviews (aggregate; reviewers are anonymous to you):',
    reviews,
    '',
    "Identify the host's single most pressing recurring operational problem, rate its severity, " +
    "and summarize it in one short sentence (max ~140 characters) describing the host's problem — " +
    'not any individual guest.',
  ].filter(Boolean).join('\n');
}

export class ClaudeReviewAnalyzer implements ReviewAnalyzer {
  readonly name = 'claude';
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly fallback = new HeuristicReviewAnalyzer();

  constructor() {
    this.client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    this.model  = process.env['LEADS_MODEL'] ?? DEFAULT_MODEL;
  }

  async analyze(listing: SourceListing): Promise<ReviewDiagnosis> {
    try {
      const response = await withRetry(
        () => this.client.messages.parse({
          model:      this.model,
          max_tokens: 512,
          system:     SYSTEM_PROMPT,
          messages:   [{ role: 'user', content: buildPrompt(listing) }],
          output_config: { format: zodOutputFormat(DiagnosisSchema) },
        }),
        {
          maxAttempts: 2, baseDelayMs: 800, factor: 2,
          shouldRetry: (_err, attempt) => attempt < 2,
          onRetry: (attempt, err, delay) =>
            log.warn('Retrying diagnosis', { attempt, error: err.message, delayMs: delay }),
        },
      );

      const out = response.parsed_output;
      if (!out) throw new Error('Claude returned no structured diagnosis (possible refusal).');
      return {
        category: out.category as ProblemCategory,
        severity: SEVERITY_TO_NUM[out.severity] ?? 3,
        summary:  out.summary.slice(0, 200),
      };
    } catch (err) {
      log.warn('Claude analysis failed — using heuristic fallback for this listing', {
        listing: listing.id, error: (err as Error).message,
      });
      return this.fallback.analyze(listing);
    }
  }
}
