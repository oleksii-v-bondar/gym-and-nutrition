import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb);
beforeEach(resetDb);
afterAll(teardownTestDb);

it('registers, logs in, and rejects bad credentials', async () => {
  const reg = await request(app).post('/api/auth/register').send({ email: 'A@x.com', password: 'pw123456' });
  expect(reg.status).toBe(201);
  expect(reg.body.email).toBe('a@x.com');

  const login = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw123456' });
  expect(login.status).toBe(200);
  expect(login.body.accessToken).toBeTruthy();
  expect(login.body.refreshToken).toBeTruthy();

  const bad = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'nope' });
  expect(bad.status).toBe(401);
});

it('refresh exchanges a refresh token for an access token', async () => {
  await request(app).post('/api/auth/register').send({ email: 'b@x.com', password: 'pw123456' });
  const login = await request(app).post('/api/auth/login').send({ email: 'b@x.com', password: 'pw123456' });
  const res = await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
  expect(res.status).toBe(200);
  expect(res.body.accessToken).toBeTruthy();
});

it('rejects duplicate email', async () => {
  await request(app).post('/api/auth/register').send({ email: 'c@x.com', password: 'pw123456' });
  const dup = await request(app).post('/api/auth/register').send({ email: 'c@x.com', password: 'pw123456' });
  expect(dup.status).toBe(409);
});
