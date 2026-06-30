/**
 * Unit tests for the RBAC permission matrix, role hierarchy, and input
 * validation utilities.  These tests have no I/O and run entirely in-memory.
 */

import {
  Role,
  Permission,
  ROLE_PERMISSIONS,
  ROLE_HIERARCHY,
  hasPermission,
} from '../types/rbac';

import {
  validateEmail,
  validatePassword,
  validateName,
  validateRole,
  validateRoleAssignment,
  firstFailure,
} from '../utils/validation';

// ─── Permission matrix ────────────────────────────────────────────────────────

describe('RBAC — Permission matrix', () => {
  const ALL_PERMISSIONS: Permission[] = [
    'users:read_all',
    'users:read_own',
    'users:create',
    'users:update_any',
    'users:update_own',
    'users:delete',
    'roles:assign',
    'leads:read',
    'leads:run',
  ];

  test('admin has every defined permission', () => {
    for (const p of ALL_PERMISSIONS) {
      expect(hasPermission('admin', p)).toBe(true);
    }
  });

  test('guest has only users:read_own', () => {
    expect(hasPermission('guest', 'users:read_own')).toBe(true);
    const denied: Permission[] = [
      'users:read_all',
      'users:create',
      'users:update_any',
      'users:update_own',
      'users:delete',
      'roles:assign',
      'leads:read',
      'leads:run',
    ];
    for (const p of denied) {
      expect(hasPermission('guest', p)).toBe(false);
    }
  });

  test('user has read_own and update_own only', () => {
    expect(hasPermission('user', 'users:read_own')).toBe(true);
    expect(hasPermission('user', 'users:update_own')).toBe(true);
    expect(hasPermission('user', 'users:read_all')).toBe(false);
    expect(hasPermission('user', 'users:create')).toBe(false);
    expect(hasPermission('user', 'users:update_any')).toBe(false);
    expect(hasPermission('user', 'users:delete')).toBe(false);
    expect(hasPermission('user', 'roles:assign')).toBe(false);
    expect(hasPermission('user', 'leads:read')).toBe(false);
    expect(hasPermission('user', 'leads:run')).toBe(false);
  });

  test('manager can read all and assign roles but cannot create or delete', () => {
    expect(hasPermission('manager', 'users:read_all')).toBe(true);
    expect(hasPermission('manager', 'users:read_own')).toBe(true);
    expect(hasPermission('manager', 'users:update_own')).toBe(true);
    expect(hasPermission('manager', 'roles:assign')).toBe(true);
    expect(hasPermission('manager', 'users:create')).toBe(false);
    expect(hasPermission('manager', 'users:update_any')).toBe(false);
    expect(hasPermission('manager', 'users:delete')).toBe(false);
  });

  test('leads:read is admin+manager; leads:run is admin-only', () => {
    // read → admin and manager
    expect(hasPermission('admin',   'leads:read')).toBe(true);
    expect(hasPermission('manager', 'leads:read')).toBe(true);
    expect(hasPermission('user',    'leads:read')).toBe(false);
    expect(hasPermission('guest',   'leads:read')).toBe(false);
    // run → admin ONLY (manager can read but not trigger)
    expect(hasPermission('admin',   'leads:run')).toBe(true);
    expect(hasPermission('manager', 'leads:run')).toBe(false);
    expect(hasPermission('user',    'leads:run')).toBe(false);
    expect(hasPermission('guest',   'leads:run')).toBe(false);
  });

  test('ROLE_PERMISSIONS contains no unknown permission strings', () => {
    const roles: Role[] = ['admin', 'manager', 'user', 'guest'];
    for (const role of roles) {
      for (const perm of ROLE_PERMISSIONS[role]) {
        expect(ALL_PERMISSIONS).toContain(perm);
      }
    }
  });

  test('hasPermission is consistent with direct ROLE_PERMISSIONS lookup', () => {
    const roles: Role[]       = ['admin', 'manager', 'user', 'guest'];
    for (const role of roles) {
      for (const perm of ALL_PERMISSIONS) {
        const direct = (ROLE_PERMISSIONS[role] as readonly Permission[]).includes(perm);
        expect(hasPermission(role, perm)).toBe(direct);
      }
    }
  });
});

// ─── Role hierarchy ───────────────────────────────────────────────────────────

describe('RBAC — Role hierarchy', () => {
  test('admin > manager > user > guest', () => {
    expect(ROLE_HIERARCHY.admin).toBeGreaterThan(ROLE_HIERARCHY.manager);
    expect(ROLE_HIERARCHY.manager).toBeGreaterThan(ROLE_HIERARCHY.user);
    expect(ROLE_HIERARCHY.user).toBeGreaterThan(ROLE_HIERARCHY.guest);
  });

  test('all roles have non-negative integer hierarchy values', () => {
    for (const value of Object.values(ROLE_HIERARCHY)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

// ─── validateEmail ────────────────────────────────────────────────────────────

describe('validateEmail', () => {
  const valid = [
    'user@example.com',
    'alice.bob+tag@sub.domain.org',
    'x@y.z',
  ];
  const invalid = [
    '',
    '   ',
    'notanemail',
    '@nodomain.com',
    'no-at-sign',
    'a'.repeat(255) + '@x.com',
  ];

  test.each(valid)('accepts "%s"', (email) => {
    expect(validateEmail(email).ok).toBe(true);
  });

  test.each(invalid)('rejects "%s"', (email) => {
    const result = validateEmail(email);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.message).toBe('string');
  });

  test('rejects non-string values', () => {
    expect(validateEmail(undefined).ok).toBe(false);
    expect(validateEmail(null).ok).toBe(false);
    expect(validateEmail(42).ok).toBe(false);
  });
});

// ─── validatePassword ─────────────────────────────────────────────────────────

describe('validatePassword', () => {
  test('accepts passwords 8–128 characters', () => {
    expect(validatePassword('12345678').ok).toBe(true);
    expect(validatePassword('a'.repeat(128)).ok).toBe(true);
  });

  test('rejects passwords shorter than 8 characters', () => {
    expect(validatePassword('short').ok).toBe(false);
    expect(validatePassword('1234567').ok).toBe(false);
  });

  test('rejects passwords longer than 128 characters', () => {
    expect(validatePassword('a'.repeat(129)).ok).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validatePassword('').ok).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(validatePassword(undefined).ok).toBe(false);
    expect(validatePassword(null).ok).toBe(false);
  });
});

// ─── validateName ─────────────────────────────────────────────────────────────

describe('validateName', () => {
  test('accepts valid names', () => {
    expect(validateName('Alice').ok).toBe(true);
    expect(validateName('Maria Manager').ok).toBe(true);
  });

  test('rejects empty or whitespace-only strings', () => {
    expect(validateName('').ok).toBe(false);
    expect(validateName('   ').ok).toBe(false);
  });

  test('rejects names longer than 100 characters', () => {
    expect(validateName('a'.repeat(101)).ok).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(validateName(undefined).ok).toBe(false);
    expect(validateName(42).ok).toBe(false);
  });
});

// ─── validateRole ─────────────────────────────────────────────────────────────

describe('validateRole', () => {
  test('accepts all four valid roles', () => {
    const roles: Role[] = ['admin', 'manager', 'user', 'guest'];
    for (const r of roles) {
      expect(validateRole(r).ok).toBe(true);
    }
  });

  test('accepts undefined (role field is optional)', () => {
    expect(validateRole(undefined).ok).toBe(true);
  });

  test('rejects unknown role strings', () => {
    expect(validateRole('superuser').ok).toBe(false);
    expect(validateRole('root').ok).toBe(false);
    expect(validateRole('').ok).toBe(false);
  });
});

// ─── validateRoleAssignment ───────────────────────────────────────────────────

describe('validateRoleAssignment — privilege-escalation guard', () => {
  test('manager can assign user and guest', () => {
    expect(validateRoleAssignment('manager', 'user').ok).toBe(true);
    expect(validateRoleAssignment('manager', 'guest').ok).toBe(true);
  });

  test('manager cannot assign manager or admin', () => {
    expect(validateRoleAssignment('manager', 'manager').ok).toBe(false);
    expect(validateRoleAssignment('manager', 'admin').ok).toBe(false);
  });

  test('user can assign guest only', () => {
    expect(validateRoleAssignment('user', 'guest').ok).toBe(true);
    expect(validateRoleAssignment('user', 'user').ok).toBe(false);
    expect(validateRoleAssignment('user', 'manager').ok).toBe(false);
    expect(validateRoleAssignment('user', 'admin').ok).toBe(false);
  });

  test('error message includes the rejected role', () => {
    const result = validateRoleAssignment('manager', 'admin');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('admin');
  });
});

// ─── firstFailure ─────────────────────────────────────────────────────────────

describe('firstFailure combinator', () => {
  test('returns ok when all results pass', () => {
    expect(firstFailure({ ok: true }, { ok: true }).ok).toBe(true);
  });

  test('returns the first failing result', () => {
    const fail1 = { ok: false as const, message: 'first error' };
    const fail2 = { ok: false as const, message: 'second error' };
    const result = firstFailure({ ok: true }, fail1, fail2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('first error');
  });
});
