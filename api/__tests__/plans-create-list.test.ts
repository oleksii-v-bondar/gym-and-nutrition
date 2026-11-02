import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}
it('creates a blank plan and lists it as owned, non-template', async () => {
  const t = await auth('bob'); const H = { Authorization: `Bearer ${t}` };
  const c = await request(app).post('/api/plans').set(H).send({ name: 'My Plan' });
  expect(c.status).toBe(201);
  const list = await request(app).get('/api/plans').set(H);
  expect(list.body).toHaveLength(1);
  expect(list.body[0]).toMatchObject({ name: 'My Plan', is_template: false, owned: true });
});
it('rejects a blank-plan create with no name', async () => {
  const t = await auth('carol');
  const c = await request(app).post('/api/plans').set({ Authorization: `Bearer ${t}` }).send({});
  expect(c.status).toBe(400);
});
