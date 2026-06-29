/**
 * Structured console logger.
 *
 * Each log line is a single JSON object so it plays nicely with log-aggregation
 * tools (Datadog, CloudWatch, etc.) while remaining readable in a terminal.
 *
 * Usage:
 *   const log = createLogger('crawler');
 *   log.info('Fetching page', { url });
 *   log.error('Request failed', { status: 404, url });
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
};

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info (message: string, meta?: Record<string, unknown>): void;
  warn (message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Parses the LOG_LEVEL env var (or falls back to INFO) and returns its numeric
 * threshold so callers can suppress noisy levels in production.
 */
export function resolveLogLevel(): LogLevel {
  const raw = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase();
  return LOG_LEVELS.includes(raw as LogLevel) ? (raw as LogLevel) : 'info';
}

/**
 * Creates a logger bound to a named context (e.g. 'crawler', 'guesty').
 * All output goes to stdout for `info`/`debug` and stderr for `warn`/`error`.
 *
 * @param context  Short label shown in every log line (e.g. 'crawler.airbnb').
 * @param minLevel Lowest level that will be emitted.  Defaults to LOG_LEVEL env var.
 */
export function createLogger(
  context:  string,
  minLevel: LogLevel = resolveLogLevel(),
): Logger {
  const threshold = LEVEL_VALUES[minLevel];

  function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_VALUES[level] < threshold) return;

    const entry = JSON.stringify({
      ts:      new Date().toISOString(),
      level,
      context,
      message,
      ...(meta ? { meta } : {}),
    });

    // Warnings and errors go to stderr; everything else to stdout
    if (level === 'warn' || level === 'error') {
      process.stderr.write(entry + '\n');
    } else {
      process.stdout.write(entry + '\n');
    }
  }

  return {
    debug: (m, meta) => emit('debug', m, meta),
    info:  (m, meta) => emit('info',  m, meta),
    warn:  (m, meta) => emit('warn',  m, meta),
    error: (m, meta) => emit('error', m, meta),
  };
}
