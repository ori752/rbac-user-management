import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { User, AuditEntry, AuditAction, Role } from '../types/rbac';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function seedUser(
  name:     string,
  email:    string,
  password: string,
  role:     User['role'],
): User {
  return {
    id:           randomUUID(),
    name,
    email:        email.toLowerCase(),
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    isActive:     true,
    tokenVersion: 0,
    createdAt:    now(),
    updatedAt:    now(),
  };
}

// ─── Seed data ────────────────────────────────────────────────────────────────

const seedAccounts: User[] = [
  seedUser('Admin User',    'admin@example.com',   'admin123',   'admin'),
  seedUser('Maria Manager', 'manager@example.com', 'manager123', 'manager'),
  seedUser('Regular User',  'user@example.com',    'user1234',   'user'),
  seedUser('Guest Account', 'guest@example.com',   'guest123',   'guest'),
];

// ─── In-memory storage ───────────────────────────────────────────────────────

const users  = new Map<string, User>();
const audits = new Map<string, AuditEntry>();

for (const u of seedAccounts) {
  users.set(u.id, u);
}

// ─── Store API ───────────────────────────────────────────────────────────────

export const store = {
  /** Exposed for direct inspection in tests only — prefer the methods below. */
  users,
  audits,

  // ── User CRUD ──────────────────────────────────────────────────────────────

  findById(id: string): User | undefined {
    return users.get(id);
  },

  /** Case-insensitive lookup. */
  findByEmail(email: string): User | undefined {
    const lc = email.toLowerCase();
    return [...users.values()].find((u) => u.email === lc);
  },

  list(): User[] {
    return [...users.values()];
  },

  create(
    data: Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'tokenVersion' | 'isActive'>,
  ): User {
    const user: User = {
      ...data,
      email:        data.email.toLowerCase(),
      id:           randomUUID(),
      isActive:     true,
      tokenVersion: 0,
      createdAt:    now(),
      updatedAt:    now(),
    };
    users.set(user.id, user);
    return user;
  },

  update(
    id:    string,
    patch: Partial<Omit<User, 'id' | 'createdAt'>>,
  ): User | undefined {
    const existing = users.get(id);
    if (!existing) return undefined;

    const updated: User = {
      ...existing,
      ...patch,
      // Always normalise email to lower-case
      email:     (patch.email ?? existing.email).toLowerCase(),
      updatedAt: now(),
    };
    users.set(id, updated);
    return updated;
  },

  /** Marks the account as inactive without removing it from the store. */
  deactivate(id: string): User | undefined {
    return store.update(id, { isActive: false });
  },

  /** Hard-delete.  Prefer deactivate() unless a hard delete is explicitly required. */
  delete(id: string): boolean {
    return users.delete(id);
  },

  // ── Audit log ──────────────────────────────────────────────────────────────

  addAudit(
    action:    AuditAction,
    detail:    Record<string, unknown> = {},
    actorId:   string | null           = null,
    actorRole: Role   | null           = null,
    targetId:  string | null           = null,
    ip:        string | null           = null,
  ): AuditEntry {
    const entry: AuditEntry = {
      id:        randomUUID(),
      action,
      actorId,
      actorRole,
      targetId,
      detail,
      timestamp: now(),
      ip,
    };
    audits.set(entry.id, entry);
    return entry;
  },

  /** Returns all audit entries, newest first. */
  listAudits(): AuditEntry[] {
    return [...audits.values()].sort(
      (a, b) => b.timestamp.localeCompare(a.timestamp),
    );
  },
};
