import { Request, Response, NextFunction } from 'express';

/**
 * Comma-separated list of allowed CORS origins.
 * When empty (default in dev), all origins are permitted.
 */
const ALLOWED_ORIGINS: string[] = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Sets security-relevant HTTP response headers on every response.
 *
 * This is a zero-dependency equivalent of helmet, covering the most important
 * defences for a JSON API + single-page application deployment:
 *
 *  - X-Content-Type-Options  : prevents MIME-type sniffing
 *  - X-Frame-Options          : disallows iframing (clickjacking protection)
 *  - X-XSS-Protection         : legacy XSS filter hint (modern browsers ignore it)
 *  - Referrer-Policy          : limits referrer leakage on cross-origin navigations
 *  - Permissions-Policy       : disables sensitive browser APIs
 *  - Content-Security-Policy  : restricts resource loading origins
 *  - Strict-Transport-Security: instructs browsers to use HTTPS-only (HSTS)
 */
export function securityHeaders(
  _req: Request,
  res:  Response,
  next: NextFunction,
): void {
  res.setHeader('X-Content-Type-Options',   'nosniff');
  res.setHeader('X-Frame-Options',          'DENY');
  res.setHeader('X-XSS-Protection',         '1; mode=block');
  res.setHeader('Referrer-Policy',          'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',       'geolocation=(), camera=(), microphone=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",          // inline scripts in SPA
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
    ].join('; '),
  );
  // Only sent over HTTPS; harmless (and ignored) over HTTP in dev
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload',
  );
  next();
}

/**
 * CORS middleware with configurable origin allowlist.
 *
 * In development (ALLOWED_ORIGINS is empty) all origins are allowed.
 * In production set ALLOWED_ORIGINS=https://app.example.com to restrict access.
 */
export function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin ?? '';

  if (!ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin',  origin || '*');
    res.setHeader('Vary',                         'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age',        '86400');

  // Respond immediately to pre-flight requests
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}
