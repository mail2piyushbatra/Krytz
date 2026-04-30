import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

const BASE = 'http://localhost:8301';
const P = '/api/v1';

const testUser = {
  email: `test-entry-${Date.now()}@flowra.test`,
  password: 'Password123!',
  name: 'Entry Tester',
};

const describeLive = process.env.KRYTZ_RUN_LIVE_API_TESTS === 'true' ? describe : describe.skip;

describeLive('Entry API Flows', () => {
  let token = '';
  let entryId = '';

  beforeAll(async () => {
    const res = await request(BASE)
      .post(P + '/auth/register')
      .send(testUser)
      .expect(201);
    token = res.body.data.accessToken;
  });

  afterAll(async () => {
    if (token) {
      await request(BASE)
        .delete(P + '/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .catch(() => {});
    }
  });

  it('should create a new entry', async () => {
    const res = await request(BASE)
      .post(P + '/entries')
      .set('Authorization', `Bearer ${token}`)
      .send({ rawText: 'Integration testing the entry pipeline is fun.', type: 'note' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.entry.rawText).toBe('Integration testing the entry pipeline is fun.');
    expect(res.body.data.entry.source).toBe('manual');
    entryId = res.body.data.entry.id;
  });

  it('should list user entries', async () => {
    const res = await request(BASE)
      .get(P + '/entries')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.entries)).toBe(true);
    expect(res.body.data.entries.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.entries[0].id).toBe(entryId);
  });

  it('should search user entries', async () => {
    const res = await request(BASE)
      .get(P + '/entries/search?q=pipeline')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.entries)).toBe(true);
    expect(res.body.data.entries.length).toBeGreaterThanOrEqual(1);
  });

  it('should update an entry', async () => {
    const res = await request(BASE)
      .put(P + '/entries/' + entryId)
      .set('Authorization', `Bearer ${token}`)
      .send({ rawText: 'Updated integration test content.' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.entry.rawText).toBe('Updated integration test content.');
  });

  it('should delete an entry', async () => {
    const res = await request(BASE)
      .delete(P + '/entries/' + entryId)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.success).toBe(true);

    await request(BASE)
      .get(P + '/entries/' + entryId)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
