/**
 * Integration tests for the /auth/* endpoints.
 *
 * Each describe block resets the module registry (jest resetModules: true in
 * jest.config.js) so the in-memory store starts fresh for every test file.
 * Within a file, tests share the same store instance; order-dependence is kept
 * to a minimum by only mutating state in clearly-labelled setup blocks.
 */

import request from 'supertest';
import app from '../app';

// ─── POST /auth/login ─────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  test('returns 200 + token + public user on valid credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@example.com', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(10);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('admin@example.com');
    expect(res.body.user.role).toBe('admin');
    // passwordHash and tokenVersion must never be returned
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.tokenVersion).toBeUndefined();
  });

  test('is case-insensitive for the email field', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'ADMIN@EXAMPLE.COM', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
  });

  test('returns 401 on wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    // Must NOT reveal whether the email existed
    expect(res.body.error).not.toContain('email');
    expect(res.body.error).not.toContain('user');
  });

  test('returns 401 on non-existent email', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'somepassword1' });

    expect(res.status).toBe(401);
  });

  test('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ password: 'admin123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  test('returns 400 when password is too short', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@example.com', password: 'short' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when email is malformed', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'validpassword1' });

    expect(res.status).toBe(400);
  });

  test('works for all four seed roles', async () => {
    const accounts = [
      { email: 'admin@example.com',   password: 'admin123',   role: 'admin' },
      { email: 'manager@example.com', password: 'manager123', role: 'manager' },
      { email: 'user@example.com',    password: 'user1234',   role: 'user' },
      { email: 'guest@example.com',   password: 'guest123',   role: 'guest' },
    ];

    for (const account of accounts) {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: account.email, password: account.password });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe(account.role);
    }
  });

  test('login response includes isActive field', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@example.com', password: 'admin123' });

    expect(res.body.user.isActive).toBe(true);
  });
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────

describe('GET /auth/me', () => {
  let token: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'user1234' });
    token = res.body.token;
  });

  test('returns 200 + own public profile with a valid token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('user@example.com');

    expect(res.body.role).toBe('user');
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.tokenVersion).toBeUndefined();
  });

  test('returns 401 with no Authorization header', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns 401 with a malformed token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer not.a.valid.jwt');
    expect(res.status).toBe(401);
  });

  test('returns 401 with a tampered token', async () => {
    const parts = token.split('.');
    // Flip one character in the signature segment
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('a') ? 'b' : 'a');
    const tampered = parts.join('.');

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  test('returns 401 when the "Bearer " prefix is absent', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', token);
    expect(res.status).toBe(401);
  });
});

// ─── GET /health ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns 200 with status ok (no auth required)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });
});
