import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}
it('reports isAdmin for the configured admin login only', async () => {
  const adminT = await auth('ascererak');
  const me = await request(app).get('/api/me').set('Authorization', `Bearer ${adminT}`);
  expect(me.status).toBe(200);
  expect(me.body).toMatchObject({ login: 'ascererak', isAdmin: true });
  expect(me.body.id).toBeTruthy();

  const userT = await auth('bob');
  const me2 = await request(app).get('/api/me').set('Authorization', `Bearer ${userT}`);
  expect(me2.body).toMatchObject({ login: 'bob', isAdmin: false });
});
it('requires auth', async () => {
  expect((await request(app).get('/api/me')).status).toBe(401);
});
