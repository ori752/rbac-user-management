import { Request, Response, NextFunction } from 'express';

// ─── Custom error type ────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    message:              string,
    public statusCode:    number = 500,
    public code?:         string,
  ) {
    super(message);
    this.name = 'AppError';
    // Preserve correct prototype chain in transpiled ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Global error handler ─────────────────────────────────────────────────────

/**
 * Central Express error handler.  Mount LAST, after all routes.
 *
 * Guarantees:
 *  - Stack traces are never exposed to clients in production.
 *  - All unhandled errors produce a consistent { error, code? } JSON body.
 *  - Every error is logged server-side for observability.
 */
// The unused _next parameter is required by Express to recognise this as a
// 4-argument error handler.
export function errorHandler(
  err:   AppError | Error,
  req:   Request,
  res:   Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const statusCode = (err as AppError).statusCode ?? 500;
  const code       = (err as AppError).code;
  const isDev      = process.env.NODE_ENV !== 'production';

  console.error(
    `[${new Date().toISOString()}] ERROR ${req.method} ${req.path} → HTTP ${statusCode}`,
    isDev ? err : err.message,
  );

  res.status(statusCode).json({
    error: err.message ?? 'An unexpected error occurred',
    ...(code       ? { code }        : {}),
    ...(isDev      ? { stack: err.stack } : {}),
  });
}

// ─── Async handler wrapper ────────────────────────────────────────────────────

/**
 * Wraps an async Express handler so that any thrown error is forwarded to
 * the next() error pipeline rather than silently rejecting a Promise.
 *
 * @example
 *   router.get('/users', asyncHandler(async (req, res) => {
 *     const users = await someAsyncOperation();
 *     res.json(users);
 *   }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
