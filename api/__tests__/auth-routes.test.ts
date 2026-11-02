import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb);
beforeEach(resetDb);
afterAll(teardownTestDb);

it('registers, logs in, and rejects bad credentials', async () => {
  const reg = await request(app).post('/api/auth/register').send({ login: 'Alice', password: 'pw123456' });
  expect(reg.status).toBe(201);
  expect(reg.body.login).toBe('alice');

  const login = await request(app).post('/api/auth/login').send({ login: 'alice', password: 'pw123456' });
  expect(login.status).toBe(200);
  expect(login.body.accessToken).toBeTruthy();
  expect(login.body.refreshToken).toBeTruthy();

  const bad = await request(app).post('/api/auth/login').send({ login: 'alice', password: 'nope' });
  expect(bad.status).toBe(401);
});

it('refresh exchanges a refresh token for an access token', async () => {
  await request(app).post('/api/auth/register').send({ login: 'bob', password: 'pw123456' });
  const login = await request(app).post('/api/auth/login').send({ login: 'bob', password: 'pw123456' });
  const res = await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
  expect(res.status).toBe(200);
  expect(res.body.accessToken).toBeTruthy();
});

it('rejects duplicate login', async () => {
  await request(app).post('/api/auth/register').send({ login: 'carol', password: 'pw123456' });
  const dup = await request(app).post('/api/auth/register').send({ login: 'carol', password: 'pw123456' });
  expect(dup.status).toBe(409);
});
