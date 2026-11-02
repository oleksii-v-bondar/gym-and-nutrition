import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(email: string) {
  await request(app).post('/api/auth/register').send({ login: email, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login: email, password: 'pw123456' })).body.accessToken as string;
}

it('returns a day with its exercises for the owner only', async () => {
  const t = await auth('d@x.com'); const H = { Authorization: `Bearer ${t}` };
  const plan = await request(app).post('/api/plans/import').set(H)
    .send({ name: 'P', days: [{ name: 'Push', exercises: [{ exercise_name: 'Bench', target_sets: 3, target_reps: 8 }] }] });
  const tree = await request(app).get(`/api/plans/${plan.body.id}`).set(H);
  const dayId = tree.body.days[0].id;

  const res = await request(app).get(`/api/plan-days/${dayId}`).set(H);
  expect(res.status).toBe(200);
  expect(res.body.name).toBe('Push');
  expect(res.body.exercises).toHaveLength(1);

  const intruder = await auth('x@x.com');
  const blocked = await request(app).get(`/api/plan-days/${dayId}`).set({ Authorization: `Bearer ${intruder}` });
  expect(blocked.status).toBe(404);
});
