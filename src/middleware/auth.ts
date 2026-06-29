import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload, Permission, ROLE_PERMISSIONS } from '../types/rbac';
import { store } from '../data/store';

// ─── Constants ────────────────────────────────────────────────────────────────

export const JWT_SECRET     = process.env.JWT_SECRET ?? 'dev-secret-change-in-prod';
export const JWT_EXPIRES_IN = '8h';

// ─── Extend Express Request type ─────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      currentUser?: JwtPayload;
    }
  }
}

// ─── authenticate ─────────────────────────────────────────────────────────────

/**
 * Validates the Bearer token on every protected request.
 *
 * Beyond standard JWT signature + expiry checks this middleware also:
 *  1. Rejects tokens for deactivated accounts (isActive === false).
 *  2. Rejects tokens whose tokenVersion no longer matches the stored value,
 *     which invalidates all previously-issued JWTs after a password change
 *     or a role reassignment without waiting for the 8-hour expiry.
 */
export function authenticate(
  req:  Request,
  res:  Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = header.slice(7);

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Validate account status and token version against the live store
  const user = store.findById(payload.userId);

  if (!user) {
    res.status(401).json({ error: 'Account not found' });
    return;
  }

  if (!user.isActive) {
    res.status(401).json({ error: 'Account has been deactivated' });
    return;
  }

  if (user.tokenVersion !== payload.tokenVersion) {
    res.status(401).json({
      error: 'Session has been invalidated — please log in again',
    });
    return;
  }

  req.currentUser = payload;
  next();
}

// ─── requirePermission ────────────────────────────────────────────────────────

/**
 * Route guard — must be used after authenticate().
 * Returns HTTP 403 when the authenticated user's role does not include the
 * requested permission.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.currentUser;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const allowed = ROLE_PERMISSIONS[user.role] as readonly Permission[];
    if (!allowed.includes(permission)) {
      res.status(403).json({
        error:    'Insufficient permissions',
        required: permission,
        yourRole: user.role,
      });
      return;
    }

    next();
  };
}
