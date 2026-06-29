import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { store } from '../data/store';
import { Role, UserPublic, ROLE_HIERARCHY, hasPermission } from '../types/rbac';
import {
  validateEmail,
  validatePassword,
  validateName,
  validateRole,
  validateRoleAssignment,
} from '../utils/validation';

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
 * GET /users
 * Permission: users:read_all  (admin, manager)
 *
 * Returns all users as public profiles (no password hashes, no tokenVersions).
 */
export function listUsers(_req: Request, res: Response): void {
  res.json(store.list().map(toPublic));
}

/**
 * GET /users/:id
 * Permission: users:read_own  (all authenticated roles)
 *
 * Admins and managers may fetch any user by ID.
 * All other roles may only fetch their own profile.
 */
export function getUser(req: Request, res: Response): void {
  const id        = req.params['id'] as string;
  const requestor = req.currentUser!;

  const canReadAll =
    requestor.role === 'admin' || requestor.role === 'manager';

  if (!canReadAll && requestor.userId !== id) {
    res.status(403).json({ error: 'You can only view your own profile' });
    return;
  }

  const user = store.findById(id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(toPublic(user));
}

/**
 * POST /users
 * Permission: users:create  (admin only)
 *
 * Creates a new user.  The creating admin cannot assign a role whose
 * privilege level is >= their own (enforced by validateRoleAssignment).
 * Admins are exempt from this check and can assign any role.
 */
export function createUser(req: Request, res: Response): void {
  const requestor = req.currentUser!;

  const { name, email, password, role } = req.body as {
    name?:     unknown;
    email?:    unknown;
    password?: unknown;
    role?:     unknown;
  };

  // Validate all required fields up-front
  const nameCheck  = validateName(name);
  if (!nameCheck.ok)  { res.status(400).json({ error: nameCheck.message });  return; }

  const emailCheck = validateEmail(email);
  if (!emailCheck.ok) { res.status(400).json({ error: emailCheck.message }); return; }

  const passCheck  = validatePassword(password);
  if (!passCheck.ok)  { res.status(400).json({ error: passCheck.message });  return; }

  const roleCheck  = validateRole(role);
  if (!roleCheck.ok)  { res.status(400).json({ error: roleCheck.message });  return; }

  const assignedRole: Role = (role as Role | undefined) ?? 'user';

  // Privilege escalation guard: non-admin cannot create a user with role >= their own.
  // Admins can create users with any role (including other admins).
  if (requestor.role !== 'admin') {
    const assignCheck = validateRoleAssignment(requestor.role, assignedRole);
    if (!assignCheck.ok) {
      res.status(403).json({ error: assignCheck.message });
      return;
    }
  }

  if (store.findByEmail(email as string)) {
    res.status(409).json({ error: 'Email already in use' });
    return;
  }

  const user = store.create({
    name:         (name as string).trim(),
    email:        email as string,
    passwordHash: bcrypt.hashSync(password as string, 10),
    role:         assignedRole,
  });

  store.addAudit(
    'USER_CREATED',
    { targetEmail: user.email, role: user.role },
    requestor.userId, requestor.role, user.id,
    getIp(req),
  );

  res.status(201).json(toPublic(user));
}

/**
 * PUT /users/:id
 * Permission: users:update_own (all authenticated roles except guest)
 *
 * Fine-grained ownership and role-assignment rules applied in the controller:
 *
 *  - Only admins can update any user's profile.
 *  - Managers and below can only update their own profile.
 *  - Role changes require the roles:assign permission.
 *    - Admins can assign any role (including admin).
 *    - Managers can assign roles strictly below their own level (guest, user).
 *  - Password or role changes bump tokenVersion, immediately invalidating the
 *    target user's existing JWTs.
 */
export function updateUser(req: Request, res: Response): void {
  const id        = req.params['id'] as string;
  const requestor = req.currentUser!;

  const existing = store.findById(id);
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Parse body early so the ownership check can inspect which fields are present
  const { name, email, password, role } = req.body as {
    name?:     unknown;
    email?:    unknown;
    password?: unknown;
    role?:     unknown;
  };

  // Ownership check
  // - Admins can update any user for any reason.
  // - Users can update only their own profile.
  // - Exception: actors with roles:assign permission may update another user's
  //   role field ONLY (no name / email / password changes permitted cross-user).
  if (requestor.role !== 'admin' && requestor.userId !== id) {
    const isRoleOnlyChange =
      role !== undefined &&
      name === undefined &&
      email === undefined &&
      (password === undefined || password === '');

    if (!isRoleOnlyChange || !hasPermission(requestor.role, 'roles:assign')) {
      res.status(403).json({ error: 'You can only update your own profile' });
      return;
    }
  }

  // Validate each provided field individually
  if (name !== undefined) {
    const r = validateName(name);
    if (!r.ok) { res.status(400).json({ error: r.message }); return; }
  }

  if (email !== undefined) {
    const r = validateEmail(email);
    if (!r.ok) { res.status(400).json({ error: r.message }); return; }
  }

  // An empty string password means "keep current"; non-empty strings are validated
  if (password !== undefined && password !== '') {
    const r = validatePassword(password);
    if (!r.ok) { res.status(400).json({ error: r.message }); return; }
  }

  // ── Role-change authorisation ──────────────────────────────────────────────
  if (role !== undefined) {
    const roleCheck = validateRole(role);
    if (!roleCheck.ok) { res.status(400).json({ error: roleCheck.message }); return; }

    // Requires roles:assign permission
    if (!hasPermission(requestor.role, 'roles:assign')) {
      res.status(403).json({ error: 'You do not have permission to change roles' });
      return;
    }

    // Non-admin: cannot assign a role whose privilege >= their own
    if (requestor.role !== 'admin') {
      const hierarchyCheck = validateRoleAssignment(requestor.role, role as Role);
      if (!hierarchyCheck.ok) {
        res.status(403).json({ error: hierarchyCheck.message });
        return;
      }
    }
  }

  // Email uniqueness: reject if the new email is already taken by another account
  if (
    email !== undefined &&
    (email as string).toLowerCase() !== existing.email &&
    store.findByEmail(email as string)
  ) {
    res.status(409).json({ error: 'Email already in use' });
    return;
  }

  // ── Build patch ────────────────────────────────────────────────────────────
  const patch: Parameters<typeof store.update>[1] = {};
  const auditDetail: Record<string, unknown>       = {};

  if (name !== undefined) {
    patch.name = (name as string).trim();
  }

  if (email !== undefined) {
    patch.email = email as string;
  }

  if (password !== undefined && password !== '') {
    patch.passwordHash = bcrypt.hashSync(password as string, 10);
    // Bump tokenVersion to invalidate all existing JWTs for this user
    patch.tokenVersion = existing.tokenVersion + 1;
    auditDetail.passwordChanged = true;
  }

  if (role !== undefined) {
    const newRole = role as Role;
    if (newRole !== existing.role) {
      patch.role = newRole;
      // Bump tokenVersion so the user's role claim is refreshed on next login
      patch.tokenVersion = (patch.tokenVersion ?? existing.tokenVersion) + 1;
      auditDetail.roleChanged = { from: existing.role, to: newRole };
    }
  }

  const updated = store.update(id, patch);
  if (!updated) {
    res.status(500).json({ error: 'Update failed unexpectedly' });
    return;
  }

  // Write the appropriate audit event
  if (auditDetail.roleChanged) {
    store.addAudit(
      'ROLE_ASSIGNED', auditDetail,
      requestor.userId, requestor.role, id, getIp(req),
    );
  } else if (auditDetail.passwordChanged) {
    store.addAudit(
      'PASSWORD_CHANGED', auditDetail,
      requestor.userId, requestor.role, id, getIp(req),
    );
  } else if (Object.keys(patch).length > 0) {
    store.addAudit(
      'USER_UPDATED', auditDetail,
      requestor.userId, requestor.role, id, getIp(req),
    );
  }

  res.json(toPublic(updated));
}

/**
 * DELETE /users/:id
 * Permission: users:delete  (admin only)
 *
 * Hard-deletes a user from the store.  Two additional safeguards:
 *  1. An admin cannot delete their own account.
 *  2. Admin-level accounts cannot be deleted at all (demote first).
 */
export function deleteUser(req: Request, res: Response): void {
  const id        = req.params['id'] as string;
  const requestor = req.currentUser!;

  // Self-deletion guard
  if (requestor.userId === id) {
    res.status(400).json({ error: 'You cannot delete your own account' });
    return;
  }

  const target = store.findById(id);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Prevent deleting admin accounts — demote first, then delete
  if (target.role === 'admin') {
    res.status(403).json({
      error:
        'Admin accounts cannot be deleted directly. ' +
        'Change the role to a lower level before deleting.',
    });
    return;
  }

  store.delete(id);

  store.addAudit(
    'USER_DELETED',
    { deletedEmail: target.email, deletedRole: target.role },
    requestor.userId, requestor.role, id,
    getIp(req),
  );

  res.status(204).send();
}

/**
 * GET /users/:id/audit  (admin only — enforced via route middleware)
 *
 * Returns all audit log entries related to a specific user (as actor or target).
 * Useful for compliance reviews and incident investigations.
 */
export function getUserAuditLog(req: Request, res: Response): void {
  const id = req.params['id'] as string;

  if (!store.findById(id)) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const entries = store
    .listAudits()
    .filter((e) => e.actorId === id || e.targetId === id);

  res.json(entries);
}

/**
 * GET /audit  (admin only — enforced via route middleware)
 *
 * Returns the full audit log, newest entries first.
 */
export function listAuditLog(_req: Request, res: Response): void {
  res.json(store.listAudits());
}
