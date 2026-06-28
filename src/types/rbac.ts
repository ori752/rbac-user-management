export type Role = 'admin' | 'manager' | 'user' | 'guest';

export type Permission =
  | 'users:read_all'
  | 'users:read_own'
  | 'users:create'
  | 'users:update_any'
  | 'users:update_own'
  | 'users:delete'
  | 'roles:assign';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'users:read_all',
    'users:read_own',
    'users:create',
    'users:update_any',
    'users:update_own',
    'users:delete',
    'roles:assign',
  ],
  manager: [
    'users:read_all',
    'users:read_own',
    'users:update_own',
    'roles:assign',
  ],
  user: [
    'users:read_own',
    'users:update_own',
  ],
  guest: [
    'users:read_own',
  ],
};

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export type UserPublic = Omit<User, 'passwordHash'>;

export interface JwtPayload {
  userId: string;
  role: Role;
}
