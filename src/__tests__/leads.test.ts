/**
 * Integration tests for the /leads/* endpoints (Host Lead Intelligence).
 *
 * Asserts the per-role RBAC contract end-to-end:
 *   GET  /leads      leads:read → admin/manager 200, user/guest 403, no-token 401
 *   POST /leads/run  leads:run  → admin only; manager/user/guest 403
 * plus the concurrency lock (409 while running) and the guarantee that a failed
 * run releases the lock (so the endpoint can never wedge at 409 forever).
 *
 * The admin POST happy-path spawns the CLI as a child process and is verified by
 * the live per-role proof, not here — these tests stay fast and side-effect-free.
 */

import request from 'supertest';
import app from '../app';
import { leadsRunInProgress, runWithLeadsLock } from '../controllers/leadsController';

async function getToken(email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

let adminToken: string;
let managerToken: string;
let userToken: string;
let guestToken: string;

beforeAll(async () => {
  [adminToken, managerToken, userToken, guestToken] = await Promise.all([
    getToken('admin@example.com', 'admin123'),
    getToken('manager@example.com', 'manager123'),
    getToken('user@example.com', 'user1234'),
    getToken('guest@example.com', 'guest123'),
  ]);
});

// ─── GET /leads (leads:read) ───────────────────────────────────────────────────

describe('GET /leads — leads:read (admin + manager)', () => {
  test('no token → 401', async () => {
    const res = await request(app).get('/leads');
    expect(res.status).toBe(401);
  });

  test('guest → 403', async () => {
    const res = await request(app).get('/leads').set('Authorization', `Bearer ${guestToken}`);
    expect(res.status).toBe(403);
    expect(res.body.required).toBe('leads:read');
  });

  test('user → 403', async () => {
    const res = await request(app).get('/leads').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
    expect(res.body.required).toBe('leads:read');
  });

  test('manager → 200 (report or empty-state)', async () => {
    const res = await request(app).get('/leads').set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    // Either a generated report (has leads[]) or the empty-state placeholder.
    expect(Array.isArray(res.body.leads) || res.body.empty === true).toBe(true);
  });

  test('admin → 200', async () => {
    const res = await request(app).get('/leads').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

// ─── POST /leads/run (leads:run — admin only) ──────────────────────────────────

describe('POST /leads/run — leads:run (admin only)', () => {
  test('guest → 403', async () => {
    const res = await request(app).post('/leads/run').set('Authorization', `Bearer ${guestToken}`);
    expect(res.status).toBe(403);
    expect(res.body.required).toBe('leads:run');
  });

  test('user → 403', async () => {
    const res = await request(app).post('/leads/run').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
    expect(res.body.required).toBe('leads:run');
  });

  test('manager → 403 (can read the report, cannot trigger a run)', async () => {
    const res = await request(app).post('/leads/run').set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.required).toBe('leads:run');
  });

  test('returns 409 to an admin while a run already holds the lock', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const held = runWithLeadsLock(() => gate); // acquire the lock, keep it held

    const res = await request(app).post('/leads/run').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);

    release();
    await held;
    expect(leadsRunInProgress()).toBe(false);
  });
});

// ─── Concurrency lock release guarantee ────────────────────────────────────────

describe('leads run-lock', () => {
  test('a failed run releases the lock (no permanent 409 wedge)', async () => {
    await expect(runWithLeadsLock(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(leadsRunInProgress()).toBe(false);

    // A subsequent run proceeds normally now that the lock is free.
    const value = await runWithLeadsLock(() => Promise.resolve('ok'));
    expect(value).toBe('ok');
    expect(leadsRunInProgress()).toBe(false);
  });
});
