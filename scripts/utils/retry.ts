/**
 * Exponential-backoff retry utility.
 *
 * Retries an async operation up to `maxAttempts` times using an exponential
 * delay strategy with optional full-jitter to spread thundering-herd load:
 *
 *   delay = random(0, baseDelayMs * factor^(attempt - 1))
 *
 * Usage:
 *   const result = await withRetry(() => fetchPage(url), {
 *     maxAttempts: 3,
 *     baseDelayMs: 1_000,
 *     factor:      2,
 *     shouldRetry: (err) => isTransient(err),
 *   });
 */

export interface RetryOptions {
  /** Maximum total attempts (first try + retries). */
  maxAttempts: number;
  /** Base delay in ms before the first retry. */
  baseDelayMs: number;
  /** Exponential growth factor applied to each successive delay. */
  factor: number;
  /**
   * Optional predicate.  Return false to abort retrying immediately.
   * Defaults to always retry.
   */
  shouldRetry?: (err: Error, attempt: number) => boolean;
  /** Called before each sleep so callers can log the retry event. */
  onRetry?: (attempt: number, err: Error, delayMs: number) => void;
}

/**
 * Sleeps for `ms` milliseconds.  Encapsulated here so the compiler sees the
 * correct return type and tests can potentially stub it.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async function with exponential-backoff retry logic.
 *
 * Throws the last error encountered if all attempts are exhausted or if
 * `shouldRetry` returns false.
 */
export async function withRetry<T>(
  fn:   () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const { maxAttempts, baseDelayMs, factor, shouldRetry, onRetry } = opts;

  let lastErr: Error = new Error('withRetry: no attempts were made');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));

      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt) break;

      if (shouldRetry && !shouldRetry(lastErr, attempt)) break;

      // Full-jitter exponential backoff — avoids coordinated retry storms
      const ceiling  = baseDelayMs * Math.pow(factor, attempt - 1);
      const delayMs  = Math.floor(Math.random() * ceiling);

      onRetry?.(attempt, lastErr, delayMs);

      await sleep(delayMs);
    }
  }

  throw lastErr;
}
