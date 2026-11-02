import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb);
beforeEach(resetDb);
afterAll(teardownTestDb);

async function auth(email: string) {
  await request(app).post('/api/auth/register').send({ email, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ email, password: 'pw123456' })).body.accessToken as string;
}
async function seedPlan(token: string) {
  return (await request(app).post('/api/plans/import').set('Authorization', `Bearer ${token}`)
    .send({ name: 'P', days: [{ name: 'Day', exercises: [{ exercise_name: 'Squat', target_sets: 3, target_reps: 5 }] }] })).body.id;
}

it('activates a plan, adds a day and exercise, edits and deletes', async () => {
  const t = await auth('e@x.com');
  const planId = await seedPlan(t);
  const H = { Authorization: `Bearer ${t}` };

  expect((await request(app).put(`/api/plans/${planId}`).set(H).send({ is_active: true })).status).toBe(200);

  const day = await request(app).post(`/api/plans/${planId}/days`).set(H).send({ name: 'Day 2' });
  expect(day.status).toBe(201);

  const ex = await request(app).post(`/api/plan-days/${day.body.id}/exercises`).set(H)
    .send({ exercise_name: 'Deadlift', target_sets: 1, target_reps: 5 });
  expect(ex.status).toBe(201);

  expect((await request(app).put(`/api/day-exercises/${ex.body.id}`).set(H).send({ target_reps: 3 })).status).toBe(200);
  expect((await request(app).delete(`/api/day-exercises/${ex.body.id}`).set(H)).status).toBe(204);
  expect((await request(app).delete(`/api/plan-days/${day.body.id}`).set(H)).status).toBe(204);
});

it('blocks editing another user resource', async () => {
  const owner = await auth('owner@x.com');
  const planId = await seedPlan(owner);
  const tree = await request(app).get(`/api/plans/${planId}`).set({ Authorization: `Bearer ${owner}` });
  const dayId = tree.body.days[0].id;
  const intruder = await auth('intruder@x.com');
  const res = await request(app).put(`/api/plan-days/${dayId}`).set({ Authorization: `Bearer ${intruder}` }).send({ name: 'hack' });
  expect(res.status).toBe(404);
});
