/**
 * Role-scoped notification feed.
 *
 * Merges import notifications (notificationStore) with audit-log events
 * (store.listAudits), then filters by the requestor's role so the feed itself
 * respects RBAC:
 *   - admin   → all audit events + imports (system-wide)
 *   - manager → imports + user-management events for NON-admin targets
 *               (never admin activity, never login/security noise)
 *   - user/guest → only audit events about their OWN account
 *
 * Unread is tracked per-user via a "seen at" timestamp (in-memory), which works
 * uniformly across both sources. Backend remains the authority — the feed never
 * surfaces admin audit entries to lower roles.
 */
import { Request, Response } from 'express';
import { store } from '../data/store';
import { notificationStore } from '../data/notificationStore';
import { AuditEntry, JwtPayload } from '../types/rbac';

const seenAt = new Map<string, string>(); // userId -> ISO timestamp

interface FeedItem {
  id: string;
  message: string;
  createdAt: string;
  guestyUrl?: string;
  kind: 'import' | 'audit';
}

function auditToMessage(e: AuditEntry, isOwn: boolean): string | null {
  const d = e.detail as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  switch (e.action) {
    case 'USER_CREATED':
      return isOwn ? 'Your account was created'
        : `New user created${str(d['targetEmail']) ? `: ${str(d['targetEmail'])}` : ''}`;
    case 'USER_UPDATED':
      return isOwn ? 'Your profile was updated' : 'A user profile was updated';
    case 'USER_DELETED':
      return `User deleted${str(d['deletedEmail']) ? `: ${str(d['deletedEmail'])}` : ''}`;
    case 'ROLE_ASSIGNED': {
      const rc = d['roleChanged'] as { from?: string; to?: string } | undefined;
      return isOwn ? `Your role was changed${rc?.to ? ` to ${rc.to}` : ''}`
        : `Role changed${rc ? `: ${rc.from} → ${rc.to}` : ''}`;
    }
    case 'PASSWORD_CHANGED':
      return isOwn ? 'Your password was changed' : 'A user password was changed';
    case 'LOGIN_FAILURE':
      return 'Failed login attempt';
    case 'ACCOUNT_DEACTIVATED':
      return isOwn ? 'Your account was deactivated' : 'An account was deactivated';
    default:
      return null; // LOGIN_SUCCESS and anything else: suppressed as noise
  }
}

function auditVisibleToRole(e: AuditEntry, me: JwtPayload): boolean {
  if (me.role === 'admin') return true;
  if (me.role === 'manager') {
    if (e.actorRole === 'admin') return false;                 // never surface admin activity
    const target = e.targetId ? store.findById(e.targetId) : undefined;
    if (target && target.role === 'admin') return false;       // never surface events about admins
    return ['USER_CREATED', 'USER_UPDATED', 'USER_DELETED', 'ROLE_ASSIGNED'].includes(e.action);
  }
  // user / guest: only events about their own account
  return e.actorId === me.userId || e.targetId === me.userId;
}

export function listNotifications(req: Request, res: Response): void {
  const me = req.currentUser!;
  const items: FeedItem[] = [];

  // Imports are a property-management concern — admin + manager only.
  if (me.role === 'admin' || me.role === 'manager') {
    for (const n of notificationStore.list()) {
      items.push({ id: n.id, message: n.message, createdAt: n.createdAt, guestyUrl: n.guestyUrl, kind: 'import' });
    }
  }

  for (const e of store.listAudits()) {
    if (!auditVisibleToRole(e, me)) continue;
    const isOwn = e.actorId === me.userId || e.targetId === me.userId;
    const message = auditToMessage(e, isOwn);
    if (!message) continue;
    items.push({ id: e.id, message, createdAt: e.timestamp, kind: 'audit' });
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const capped = items.slice(0, 40);
  const seen = seenAt.get(me.userId) ?? '';
  const unread = capped.filter((i) => i.createdAt > seen).length;
  res.json({ items: capped, unread });
}

export function markNotificationsRead(req: Request, res: Response): void {
  seenAt.set(req.currentUser!.userId, new Date().toISOString());
  res.status(204).end();
}
