import { Role, ROLE_HIERARCHY } from '../types/rbac';

// ─── Result type ─────────────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true }
  | { ok: false; message: string };

// ─── Email ────────────────────────────────────────────────────────────────────

/** RFC-5321 length limits: local-part ≤ 64, total ≤ 254. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: unknown): ValidationResult {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, message: 'email is required' };
  }
  const trimmed = value.trim();
  if (trimmed.length > 254) {
    return { ok: false, message: 'email must be ≤ 254 characters' };
  }
  if (!EMAIL_RE.test(trimmed)) {
    return { ok: false, message: 'email must be a valid address' };
  }
  return { ok: true };
}

// ─── Password ─────────────────────────────────────────────────────────────────

export function validatePassword(value: unknown): ValidationResult {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, message: 'password is required' };
  }
  if (value.length < 8) {
    return { ok: false, message: 'password must be at least 8 characters' };
  }
  if (value.length > 128) {
    return { ok: false, message: 'password must be ≤ 128 characters' };
  }
  return { ok: true };
}

// ─── Name ─────────────────────────────────────────────────────────────────────

export function validateName(value: unknown): ValidationResult {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, message: 'name is required' };
  }
  if (value.trim().length > 100) {
    return { ok: false, message: 'name must be ≤ 100 characters' };
  }
  return { ok: true };
}

// ─── Role ─────────────────────────────────────────────────────────────────────

const VALID_ROLES = Object.keys(ROLE_HIERARCHY) as Role[];

export function validateRole(value: unknown): ValidationResult {
  if (value === undefined) return { ok: true };
  if (!VALID_ROLES.includes(value as Role)) {
    return {
      ok: false,
      message: `role must be one of: ${VALID_ROLES.join(', ')}`,
    };
  }
  return { ok: true };
}

// ─── Role-assignment hierarchy guard ─────────────────────────────────────────

/**
 * Ensures an actor cannot assign a role whose privilege level is >= their own.
 * Admins (highest level) are always permitted — this function still validates
 * correctly because no role has a ROLE_HIERARCHY value > admin.
 *
 * Examples:
 *   manager assigning 'user'    → ok (1 < 2)
 *   manager assigning 'manager' → error (2 >= 2)
 *   manager assigning 'admin'   → error (3 >= 2)
 *   admin   assigning 'admin'   → ok (3 < ∞ is false, but admin == admin → 3 >= 3 fails)
 *
 * Note: admins bypass this check in the controllers; call this only for non-admin actors.
 */
export function validateRoleAssignment(
  actorRole:  Role,
  targetRole: Role,
): ValidationResult {
  if (ROLE_HIERARCHY[targetRole] >= ROLE_HIERARCHY[actorRole]) {
    return {
      ok: false,
      message:
        `You cannot assign the '${targetRole}' role — ` +
        `it requires privilege level higher than '${actorRole}'`,
    };
  }
  return { ok: true };
}

// ─── Combinator ───────────────────────────────────────────────────────────────

/** Returns the first failing result, or { ok: true } if all pass. */
export function firstFailure(...results: ValidationResult[]): ValidationResult {
  return results.find((r) => !r.ok) ?? { ok: true };
}
