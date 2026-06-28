import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { store } from '../data/store';
import { Role, UserPublic } from '../types/rbac';

const VALID_ROLES: Role[] = ['admin', 'manager', 'user', 'guest'];

function toPublic(u: NonNullable<ReturnType<typeof store.findById>>): UserPublic {
  const { passwordHash: _, ...pub } = u;
  return pub;
}

export function listUsers(req: Request, res: Response): void {
  res.json(store.list().map(toPublic));
}

export function getUser(req: Request, res: Response): void {
  const { id } = req.params;
  const requestor = req.currentUser!;

  // non-admin can only fetch their own profile
  if (requestor.role !== 'admin' && requestor.role !== 'manager' && requestor.userId !== id) {
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

export function createUser(req: Request, res: Response): void {
  const { name, email, password, role } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
  };

  if (!name || !email || !password) {
    res.status(400).json({ error: 'name, email, and password are required' });
    return;
  }

  if (role && !VALID_ROLES.includes(role as Role)) {
    res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    return;
  }

  if (store.findByEmail(email)) {
    res.status(409).json({ error: 'Email already in use' });
    return;
  }

  const user = store.create({
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role: (role as Role) ?? 'user',
  });

  res.status(201).json(toPublic(user));
}

export function updateUser(req: Request, res: Response): void {
  const { id } = req.params;
  const requestor = req.currentUser!;

  const existing = store.findById(id);
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // non-admin/manager can only update themselves
  const canUpdateAny = requestor.role === 'admin' || requestor.role === 'manager';
  if (!canUpdateAny && requestor.userId !== id) {
    res.status(403).json({ error: 'You can only update your own profile' });
    return;
  }

  const { name, email, password, role } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
  };

  // only admins can assign roles
  if (role && requestor.role !== 'admin') {
    res.status(403).json({ error: 'Only admins can change roles' });
    return;
  }

  if (role && !VALID_ROLES.includes(role as Role)) {
    res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    return;
  }

  if (email && email !== existing.email && store.findByEmail(email)) {
    res.status(409).json({ error: 'Email already in use' });
    return;
  }

  const patch: Partial<typeof existing> = {};
  if (name) patch.name = name;
  if (email) patch.email = email;
  if (password) patch.passwordHash = bcrypt.hashSync(password, 10);
  if (role) patch.role = role as Role;

  const updated = store.update(id, patch);
  res.json(toPublic(updated!));
}

export function deleteUser(req: Request, res: Response): void {
  const { id } = req.params;
  const requestor = req.currentUser!;

  if (requestor.userId === id) {
    res.status(400).json({ error: 'You cannot delete your own account' });
    return;
  }

  if (!store.findById(id)) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  store.delete(id);
  res.status(204).send();
}
