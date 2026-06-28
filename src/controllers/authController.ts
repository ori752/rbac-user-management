import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { store } from '../data/store';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../middleware/auth';
import { UserPublic } from '../types/rbac';

function toPublic(u: ReturnType<typeof store.findById>): UserPublic | null {
  if (!u) return null;
  const { passwordHash: _, ...pub } = u;
  return pub;
}

export function login(req: Request, res: Response): void {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const user = store.findByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = jwt.sign(
    { userId: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({ token, user: toPublic(user) });
}

export function me(req: Request, res: Response): void {
  const user = store.findById(req.currentUser!.userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(toPublic(user));
}
