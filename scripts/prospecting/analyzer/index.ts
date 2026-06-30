import type { ReviewAnalyzer } from '../types';
import { HeuristicReviewAnalyzer } from './heuristic';
import { ClaudeReviewAnalyzer } from './claude';
import { createLogger } from '../../utils/logger';

export type { ReviewAnalyzer } from '../types';
export { HeuristicReviewAnalyzer } from './heuristic';
export { ClaudeReviewAnalyzer } from './claude';

const log = createLogger('prospecting.analyzer');

/**
 * Claude when ANTHROPIC_API_KEY is set; deterministic heuristic otherwise — so
 * the pipeline runs end-to-end at zero cost (and tests stay deterministic).
 */
export function selectAnalyzer(): ReviewAnalyzer {
  if (process.env['ANTHROPIC_API_KEY']) {
    log.info('Using Claude review analyzer', { model: process.env['LEADS_MODEL'] ?? 'claude-sonnet-4-6' });
    return new ClaudeReviewAnalyzer();
  }
  log.info('ANTHROPIC_API_KEY not set — using deterministic heuristic analyzer (zero cost)');
  return new HeuristicReviewAnalyzer();
}
