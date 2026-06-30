// ─── Roles ───────────────────────────────────────────────────────────────────

export type Role = 'admin' | 'manager' | 'user' | 'guest';

/**
 * Numeric privilege levels for role-comparison logic.
 * Higher value = higher privilege.
 *
 * Used by validateRoleAssignment to prevent actors from assigning
 * a role whose privilege level is >= their own.
 */
export const ROLE_HIERARCHY: Record<Role, number> = {
  guest:   0,
  user:    1,
  manager: 2,
  admin:   3,
} as const;

// ─── Permissions ─────────────────────────────────────────────────────────────

export type Permission =
  | 'users:read_all'
  | 'users:read_own'
  | 'users:create'
  | 'users:update_any'
  | 'users:update_own'
  | 'users:delete'
  | 'roles:assign'
  // Host Lead Intelligence (B2B prospecting module)
  | 'leads:read'   // view the generated top-leads report
  | 'leads:run';   // trigger the prospecting pipeline (stricter than read)

/**
 * Canonical role → permission mapping.
 * This is the single source of truth for all access-control decisions.
 *
 *  admin   — unrestricted access to all operations
 *  manager — read all users, assign roles (below manager level), update own profile
 *  user    — read + update own profile only
 *  guest   — read own profile only
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: [
    'users:read_all',
    'users:read_own',
    'users:create',
    'users:update_any',
    'users:update_own',
    'users:delete',
    'roles:assign',
    'leads:read',
    'leads:run',
  ],
  manager: [
    'users:read_all',
    'users:read_own',
    'users:update_own',
    'roles:assign',
    'leads:read',
  ],
  user: [
    'users:read_own',
    'users:update_own',
  ],
  guest: [
    'users:read_own',
  ],
} as const;

/**
 * Returns true when the given role includes the given permission.
 * Prefer this helper over direct ROLE_PERMISSIONS indexing to keep
 * access-control logic centralised.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] as readonly Permission[]).includes(permission);
}

// ─── User model ──────────────────────────────────────────────────────────────

export interface User {
  id:           string;
  name:         string;
  /** Always lower-cased for case-insensitive uniqueness enforcement. */
  email:        string;
  passwordHash: string;
  role:         Role;
  /** When false the account exists in the store but cannot authenticate. */
  isActive:     boolean;
  /**
   * Monotonically-incremented counter.  Embedded in every JWT.
   * Bumped on password change or role change so that previously-issued
   * tokens are rejected immediately on the next request.
   */
  tokenVersion: number;
  createdAt:    string;   // ISO-8601
  updatedAt:    string;   // ISO-8601
}

/** Public projection — never exposes passwordHash or tokenVersion. */
export type UserPublic = Omit<User, 'passwordHash' | 'tokenVersion'>;

// ─── JWT ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId:       string;
  role:         Role;
  tokenVersion: number;
  /** Standard JWT "issued at" — populated automatically by jsonwebtoken. */
  iat?:         number;
  exp?:         number;
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export type AuditAction =
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'ROLE_ASSIGNED'
  | 'PASSWORD_CHANGED'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'ACCOUNT_DEACTIVATED';

export interface AuditEntry {
  id:        string;
  action:    AuditAction;
  /** null for system-generated events */
  actorId:   string | null;
  actorRole: Role   | null;
  /** The user affected by the action (may equal actorId for self-updates) */
  targetId:  string | null;
  /** Structured context about the action (e.g. changed fields, failure reason) */
  detail:    Record<string, unknown>;
  timestamp: string;        // ISO-8601
  ip:        string | null;
}
