/**
 * In-memory manager notification feed. Self-contained "notify the manager"
 * channel — no external service required. Resets on server restart.
 */
import { randomUUID } from 'crypto';

export interface AppNotification {
  id:          string;
  message:     string;
  propertyId?: string;
  guestyUrl?:  string;
  read:        boolean;
  createdAt:   string;
}

const notifications: AppNotification[] = [];

export const notificationStore = {
  add(input: { message: string; propertyId?: string; guestyUrl?: string; createdAt?: string }): AppNotification {
    const rec: AppNotification = {
      id:         randomUUID(),
      message:    input.message,
      propertyId: input.propertyId,
      guestyUrl:  input.guestyUrl,
      read:       false,
      createdAt:  input.createdAt ?? new Date().toISOString(),
    };
    notifications.unshift(rec);
    return rec;
  },
  list(): AppNotification[] { return notifications; },
  markAllRead(): void { notifications.forEach((n) => { n.read = true; }); },
};

// Seed one so the manager's feed isn't empty on first load.
notificationStore.add({
  message:    'New property imported from Airbnb: "*Magical Priv Cottage* — Pensacola" (49 photos)',
  propertyId: '6a42c9b8e1fee300116ac7bd',
  guestyUrl:  'https://app.guesty.com/properties/6a42c9b8e1fee300116ac7bd/overview',
});
