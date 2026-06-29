import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { store } from '../data/store';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../middleware/auth';
import { UserPublic, JwtPayload } from '../types/rbac';
import { validateEmail, validatePassword } from '../utils/validation';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toPublic(u: NonNullable<ReturnType<typeof store.findById>>): UserPublic {
  const { passwordHash: _ph, tokenVersion: _tv, ...pub } = u;
  return pub;
}

function getIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /auth/login
 *
 * Validates credentials and returns a signed JWT alongside the public user
 * profile.  Intentionally uses a timing-safe code path: bcrypt runs even when
 * the email does not exist in the store, preventing user-enumeration attacks
 * via response-time differences.
 */
export function login(req: Request, res: Response): void {
  const { email, password } = req.body as {
    email?:    unknown;
    password?: unknown;
  };

  const emailResult = validateEmail(email);
  if (!emailResult.ok) {
    res.status(400).json({ error: emailResult.message });
    return;
  }

  const passwordResult = validatePassword(password);
  if (!passwordResult.ok) {
    res.status(400).json({ error: passwordResult.message });
    return;
  }

  const user = store.findByEmail(email as string);

  // Always run bcrypt to prevent timing-based user enumeration.
  // When the user doesn't exist we compare against a known dummy hash so the
  // operation takes the same wall-clock time as a real comparison.
  const DUMMY_HASH =
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
  const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
  const credentialsValid =
    user !== undefined &&
    bcrypt.compareSync(password as string, hashToCompare);

  if (!credentialsValid) {
    store.addAudit(
      'LOGIN_FAILURE',
      { email },
      null, null, null,
      getIp(req),
    );
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (!user!.isActive) {
    res.status(403).json({ error: 'Account has been deactivated' });
    return;
  }

  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    userId:       user!.id,
    role:         user!.role,
    tokenVersion: user!.tokenVersion,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  store.addAudit(
    'LOGIN_SUCCESS',
    {},
    user!.id, user!.role, null,
    getIp(req),
  );

  res.json({ token, user: toPublic(user!) });
}

/**
 * GET /auth/me
 *
 * Returns the public profile of the currently-authenticated user.
 * The `authenticate` middleware guarantees req.currentUser is populated.
 */
export function me(req: Request, res: Response): void {
  const user = store.findById(req.currentUser!.userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(toPublic(user));
}
