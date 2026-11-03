import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}

it('imports, reads, edits, and forks an exercise extra_segments count', async () => {
  const t = await auth('ascererak'); const H = { Authorization: `Bearer ${t}` };
  const planId = (await request(app).post('/api/plans/import').set(H)
    .send({ name: 'P', days: [{ name: 'D', exercises: [
      { exercise_name: 'Bench', target_sets: 3, target_reps: 8, extra_segments: 2 }] }] })).body.id;

  const tree = await request(app).get(`/api/plans/${planId}`).set(H);
  const ex = tree.body.days[0].exercises[0];
  expect(ex.extra_segments).toBe(2);

  expect((await request(app).put(`/api/day-exercises/${ex.id}`).set(H).send({ extra_segments: 3 })).status).toBe(200);
  const tree2 = await request(app).get(`/api/plans/${planId}`).set(H);
  expect(tree2.body.days[0].exercises[0].extra_segments).toBe(3);

  const day = await request(app).get(`/api/plan-days/${tree.body.days[0].id}`).set(H);
  expect(day.body.exercises[0].extra_segments).toBe(3);

  const fork = await request(app).post(`/api/plans/${planId}/fork`).set(H);
  const copyTree = await request(app).get(`/api/plans/${fork.body.id}`).set(H);
  expect(copyTree.body.days[0].exercises[0].extra_segments).toBe(3);

  const exp = await request(app).get(`/api/plans/${planId}/export`).set(H);
  expect(exp.body.days[0].exercises[0].extra_segments).toBe(3);
});

it('defaults extra_segments to 0 when omitted on import', async () => {
  const t = await auth('ascererak'); const H = { Authorization: `Bearer ${t}` };
  const planId = (await request(app).post('/api/plans/import').set(H)
    .send({ name: 'P', days: [{ name: 'D', exercises: [{ exercise_name: 'Squat', target_sets: 3, target_reps: 5 }] }] })).body.id;
  const tree = await request(app).get(`/api/plans/${planId}`).set(H);
  expect(tree.body.days[0].exercises[0].extra_segments).toBe(0);
});
