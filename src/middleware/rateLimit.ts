import { Request, Response, NextFunction } from 'express';

interface WindowEntry {
  count:       number;
  windowStart: number;
}

/**
 * Extracts the real client IP, respecting the X-Forwarded-For header that
 * reverse proxies (nginx, Railway, Cloudflare) set on behalf of the client.
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Creates a sliding-window rate limiter backed by an in-memory Map.
 *
 * Stale windows are pruned periodically so the Map does not grow
 * unbounded under sustained traffic.
 *
 * @param windowMs  Window size in milliseconds (e.g. 15 * 60 * 1000 = 15 min).
 * @param max       Maximum allowed requests per window per IP.
 * @param message   Body of the 429 error response.
 *
 * @example
 *   router.post('/login', rateLimit(15 * 60 * 1000, 10), login);
 */
export function rateLimit(
  windowMs: number,
  max:      number,
  message = 'Too many requests — please try again later.',
): (req: Request, res: Response, next: NextFunction) => void {
  const store = new Map<string, WindowEntry>();

  // Prune entries whose window has expired to prevent unbounded Map growth
  const pruneInterval = setInterval(() => {
    const threshold = Date.now() - windowMs;
    for (const [key, entry] of store) {
      if (entry.windowStart < threshold) store.delete(key);
    }
  }, windowMs);

  // Allow the Node.js event loop to exit even if this interval is still active
  pruneInterval.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Rate limiting is bypassed in the test environment so tests can make
    // many rapid requests without hitting the limit.
    if (process.env.NODE_ENV === 'test') {
      next();
      return;
    }

    const ip  = getClientIp(req);
    const now = Date.now();

    const entry = store.get(ip);

    // No existing entry, or the window has expired → start a fresh window
    if (!entry || now - entry.windowStart > windowMs) {
      store.set(ip, { count: 1, windowStart: now });
      next();
      return;
    }

    entry.count += 1;

    if (entry.count > max) {
      const retryAfterSecs = Math.ceil(
        (entry.windowStart + windowMs - now) / 1000,
      );
      res.setHeader('Retry-After', String(retryAfterSecs));
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}
