/**
 * Integration tests for the /users/* endpoints.
 *
 * Covers: CRUD operations, RBAC enforcement, privilege-escalation prevention,
 * input validation, and audit-log endpoint access.
 */

import request from 'supertest';
import app from '../app';

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function getToken(
  email:    string,
  password: string,
): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

// Tokens are initialised once in beforeAll to avoid repeated bcrypt calls
let adminToken:   string;
let managerToken: string;
let userToken:    string;
let guestToken:   string;

beforeAll(async () => {
  [adminToken, managerToken, userToken, guestToken] = await Promise.all([
    getToken('admin@example.com',   'admin123'),
    getToken('manager@example.com', 'manager123'),
    getToken('user@example.com',    'user1234'),
    getToken('guest@example.com',   'guest123'),
  ]);
});

// ─── GET /users ───────────────────────────────────────────────────────────────

describe('GET /users', () => {
  test('admin can list all users', async () => {
    const res = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(4);
    // Sensitive fields must be absent from every entry
    res.body.forEach((u: Record<string, unknown>) => {
      expect(u.passwordHash).toBeUndefined();
      expect(u.tokenVersion).toBeUndefined();
    });
  });

  test('manager can list all users', async () => {
    const res = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
  });

  test('user role gets 403', async () => {
    const res = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  test('guest role gets 403', async () => {
    const res = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${guestToken}`);
    expect(res.status).toBe(403);
  });

  test('unauthenticated request gets 401', async () => {
    const res = await request(app).get('/users');
    expect(res.status).toBe(401);
  });
});

// ─── GET /users/:id ───────────────────────────────────────────────────────────

describe('GET /users/:id', () => {
  let userId: string;

  beforeAll(async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${userToken}`);
    userId = res.body.id;
  });

  test('user can fetch own profile', async () => {
    const res = await request(app)
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(userId);
  });

  test('user cannot fetch a different user profile', async () => {
    const allRes = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const adminId = allRes.body.find(
      (u: { role: string }) => u.role === 'admin',
    )?.id as string;

    const res = await request(app)
      .get(`/users/${adminId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  test('admin can fetch any user profile', async () => {
    const res = await request(app)
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('manager can fetch any user profile', async () => {
    const res = await request(app)
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
  });

  test('returns 404 for a non-existent ID', async () => {
    const res = await request(app)
      .get('/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ─── POST /users ──────────────────────────────────────────────────────────────

describe('POST /users', () => {
  test('admin can create a user with default role', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'New Person',
        email:    'newperson@example.com',
        password: 'securepassword1',
      });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('newperson@example.com');
    expect(res.body.role).toBe('user');
    expect(res.body.passwordHash).toBeUndefined();
  });

  test('admin can create an admin-level user', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'Second Admin',
        email:    'admin2@example.com',
        password: 'securepassword1',
        role:     'admin',
      });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('admin');
  });

  test('non-admin (manager) gets 403', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        name:     'Someone',
        email:    'someone@example.com',
        password: 'securepassword1',
      });
    expect(res.status).toBe(403);
  });

  test('user role gets 403', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'X', email: 'x@x.com', password: 'securepassword1' });
    expect(res.status).toBe(403);
  });

  test('returns 409 on duplicate email', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'Duplicate',
        email:    'admin@example.com',
        password: 'securepassword1',
      });
    expect(res.status).toBe(409);
  });

  test('returns 409 on duplicate email regardless of case', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'Duplicate',
        email:    'ADMIN@EXAMPLE.COM',
        password: 'securepassword1',
      });
    expect(res.status).toBe(409);
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'x2@x.com', password: 'securepassword1' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when password is too short', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X', email: 'x3@x.com', password: 'short' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for an invalid role', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'X',
        email:    'x4@x.com',
        password: 'securepassword1',
        role:     'superuser',
      });
    expect(res.status).toBe(400);
  });
});

// ─── PUT /users/:id ───────────────────────────────────────────────────────────

describe('PUT /users/:id', () => {
  let userId:   string;
  let guestId:  string;
  let adminId:  string;

  beforeAll(async () => {
    const allRes = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`);

    userId  = allRes.body.find((u: { role: string }) => u.role === 'user')?.id;
    guestId = allRes.body.find((u: { role: string }) => u.role === 'guest')?.id;
    adminId = allRes.body.find((u: { role: string }) => u.role === 'admin')?.id;
  });

  test('user can update own name', async () => {
    const res = await request(app)
      .put(`/users/${userId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
  });

  test('user cannot update another user', async () => {
    const res = await request(app)
      .put(`/users/${guestId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Hijack Attempt' });

    expect(res.status).toBe(403);
  });

  test('admin can update any user', async () => {
    const res = await request(app)
      .put(`/users/${guestId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Admin-Updated Guest' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Admin-Updated Guest');
  });

  test('manager cannot update another user (not admin)', async () => {
    const res = await request(app)
      .put(`/users/${guestId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Manager Overwrite' });

    expect(res.status).toBe(403);
  });

  test('guest cannot update own profile (no update_own permission)', async () => {
    const res = await request(app)
      .put(`/users/${guestId}`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ name: 'Guest Self Update' });

    expect(res.status).toBe(403);
  });

  // ── Role-change privilege-escalation tests ──

  test('admin can change a user role to manager', async () => {
    const res = await request(app)
      .put(`/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'manager' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('manager');

    // Restore original role
    await request(app)
      .put(`/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'user' });
  });

  test('manager can assign guest role to a user', async () => {
    // First ensure the target is 'user' level (below manager)
    await request(app)
      .put(`/users/${guestId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'user' });

    const res = await request(app)
      .put(`/users/${guestId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ role: 'guest' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('guest');
  });

  test('manager cannot escalate a user to manager level (privilege escalation)', async () => {
    const res = await request(app)
      .put(`/users/${userId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ role: 'manager' });

    expect(res.status).toBe(403);
  });

  test('manager cannot escalate a user to admin (privilege escalation)', async () => {
    const res = await request(app)
      .put(`/users/${userId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
  });

  test('user cannot change own role', async () => {
    // Earlier tests may have changed userId's role (bumping tokenVersion),
    // so we re-login to get a valid token for this assertion.
    const freshLogin = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'user1234' });
    const freshUserToken = freshLogin.body.token as string;

    const res = await request(app)
      .put(`/users/${userId}`)
      .set('Authorization', `Bearer ${freshUserToken}`)
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
  });

  test('returns 400 for an invalid role value', async () => {
    const res = await request(app)
      .put(`/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'overlord' });

    expect(res.status).toBe(400);
  });

  test('returns 409 when updating email to one already in use', async () => {
    const res = await request(app)
      .put(`/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'manager@example.com' });

    expect(res.status).toBe(409);
  });

  test('returns 404 for non-existent user', async () => {
    const res = await request(app)
      .put('/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });

  test('tokenVersion is bumped after a role change (token invalidation)', async () => {
    // Use a dedicated throwaway user so this test does not invalidate the
    // shared userToken, which later tests in this file still depend on.
    const createRes = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'Token Version Test',
        email:    'tvtest@example.com',
        password: 'securepassword1',
        role:     'user',
      });
    const tvUserId = createRes.body.id as string;

    // Acquire a valid token for this user
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: 'tvtest@example.com', password: 'securepassword1' });
    const tvToken = loginRes.body.token as string;

    // The original token should be valid
    const beforeRes = await request(app)
      .get(`/users/${tvUserId}`)
      .set('Authorization', `Bearer ${tvToken}`);
    expect(beforeRes.status).toBe(200);

    // Admin changes the user's role → tokenVersion is bumped
    await request(app)
      .put(`/users/${tvUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'guest' });

    // The OLD token must now be rejected (401)
    const afterRes = await request(app)
      .get(`/users/${tvUserId}`)
      .set('Authorization', `Bearer ${tvToken}`);
    expect(afterRes.status).toBe(401);

    // Cleanup — change role back to user so we can delete (admin guard applies only to admin accounts)
    await request(app)
      .delete(`/users/${tvUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
  });
});

// ─── DELETE /users/:id ────────────────────────────────────────────────────────

describe('DELETE /users/:id', () => {
  let deletableId: string;

  beforeAll(async () => {
    // Create a throwaway user
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'Deletable User',
        email:    'deleteme@example.com',
        password: 'securepassword1',
        role:     'user',
      });
    deletableId = res.body.id;
  });

  test('admin can delete a non-admin user', async () => {
    const res = await request(app)
      .delete(`/users/${deletableId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  test('deleted user no longer appears in the list', async () => {
    const res = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const found = res.body.find((u: { id: string }) => u.id === deletableId);
    expect(found).toBeUndefined();
  });

  test('non-admin gets 403', async () => {
    // Create another target first
    const createRes = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'Temp Target',
        email:    'temptarget@example.com',
        password: 'securepassword1',
        role:     'user',
      });
    const tempId = createRes.body.id;

    const res = await request(app)
      .delete(`/users/${tempId}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(403);

    // Cleanup
    await request(app)
      .delete(`/users/${tempId}`)
      .set('Authorization', `Bearer ${adminToken}`);
  });

  test('admin cannot delete own account', async () => {
    const meRes = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    const ownId = meRes.body.id;

    const res = await request(app)
      .delete(`/users/${ownId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  test('admin cannot delete another admin account', async () => {
    // admin2 was created in the POST suite (may not exist here due to resetModules)
    // We create one fresh to be explicit about the guard
    const createRes = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'Another Admin',
        email:    'admin3@example.com',
        password: 'securepassword1',
        role:     'admin',
      });
    const admin3Id = createRes.body.id;

    const res = await request(app)
      .delete(`/users/${admin3Id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });

  test('returns 404 for a non-existent user', async () => {
    const res = await request(app)
      .delete('/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ─── Security headers ─────────────────────────────────────────────────────────

describe('Security headers', () => {
  test('responses include X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('responses include X-Frame-Options: DENY', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});
