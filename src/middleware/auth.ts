import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload, Permission, ROLE_PERMISSIONS } from '../types/rbac';

export const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-prod';
export const JWT_EXPIRES_IN = '8h';

declare global {
  namespace Express {
    interface Request {
      currentUser?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.currentUser = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.currentUser;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const allowed = ROLE_PERMISSIONS[user.role] ?? [];
    if (!allowed.includes(permission)) {
      res.status(403).json({
        error: `Role '${user.role}' does not have permission '${permission}'`,
      });
      return;
    }
    next();
  };
}
