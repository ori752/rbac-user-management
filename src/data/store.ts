import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../types/rbac';

function now(): string {
  return new Date().toISOString();
}

function seedUser(
  name: string,
  email: string,
  password: string,
  role: User['role']
): User {
  return {
    id: uuidv4(),
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    createdAt: now(),
    updatedAt: now(),
  };
}

const users: Map<string, User> = new Map();

const seed = [
  seedUser('Admin User',   'admin@example.com',   'admin123',   'admin'),
  seedUser('Maria Manager','manager@example.com', 'manager123', 'manager'),
  seedUser('Regular User', 'user@example.com',    'user123',    'user'),
  seedUser('Guest Account','guest@example.com',   'guest123',   'guest'),
];

for (const u of seed) {
  users.set(u.id, u);
}

export const store = {
  users,

  findById(id: string): User | undefined {
    return users.get(id);
  },

  findByEmail(email: string): User | undefined {
    return [...users.values()].find((u) => u.email === email);
  },

  list(): User[] {
    return [...users.values()];
  },

  create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): User {
    const user: User = {
      ...data,
      id: uuidv4(),
      createdAt: now(),
      updatedAt: now(),
    };
    users.set(user.id, user);
    return user;
  },

  update(id: string, patch: Partial<Omit<User, 'id' | 'createdAt'>>): User | undefined {
    const existing = users.get(id);
    if (!existing) return undefined;
    const updated: User = { ...existing, ...patch, updatedAt: now() };
    users.set(id, updated);
    return updated;
  },

  delete(id: string): boolean {
    return users.delete(id);
  },
};
