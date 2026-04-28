import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

const BASE = 'http://localhost:8301';
const P = '/api/v1';

const testUser = {
  email: `test-auth-${Date.now()}@flowra.test`,
  password: 'Password123!',
  name: 'Auth Tester',
};

describe('Auth API Flows', () => {
  let token = '';

  afterAll(async () => {
    if (token) {
      await request(BASE)
        .delete(P + '/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .catch(() => {});
    }
  });

  it('should register a new user', async () => {
    const res = await request(BASE)
      .post(P + '/auth/register')
      .send(testUser)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(testUser.email);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    token = res.body.data.accessToken;
  });

  it('should not allow duplicate registration', async () => {
    const res = await request(BASE)
      .post(P + '/auth/register')
      .send(testUser)
      .expect(409);
      
    expect(res.body.success).toBe(false);
  });

  it('should login with correct credentials', async () => {
    const res = await request(BASE)
      .post(P + '/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    token = res.body.data.accessToken; // update token
  });

  it('should reject invalid password', async () => {
    const res = await request(BASE)
      .post(P + '/auth/login')
      .send({ email: testUser.email, password: 'WrongPassword!' })
      .expect(401);
      
    expect(res.body.success).toBe(false);
  });

  it('should return user profile using me', async () => {
    const res = await request(BASE)
      .get(P + '/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(testUser.email);
  });
  
  it('should update user profile', async () => {
    const res = await request(BASE)
      .patch(P + '/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Auth Tester', settings: { theme: 'dark', notifications: false } })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.name).toBe('Updated Auth Tester');
    expect(res.body.data.user.settings.theme).toBe('dark');
  });
});
