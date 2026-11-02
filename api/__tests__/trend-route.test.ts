import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(email: string) {
  await request(app).post('/api/auth/register').send({ login: email, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login: email, password: 'pw123456' })).body.accessToken as string;
}

it('reports progressing across three rising sessions', async () => {
  const t = await auth('tr@x.com'); const H = { Authorization: `Bearer ${t}` };
  const plan = await request(app).post('/api/plans/import').set(H)
    .send({ name: 'P', days: [{ name: 'D', exercises: [{ exercise_name: 'Bench', target_sets: 1, target_reps: 8 }] }] });
  const tree = await request(app).get(`/api/plans/${plan.body.id}`).set(H);
  const dayId = tree.body.days[0].id; const exId = tree.body.days[0].exercises[0].id;
  for (const w of [40, 42.5, 45]) {
    const s = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
    await request(app).post(`/api/sessions/${s.body.id}/sets`).set(H)
      .send({ day_exercise_id: exId, set_number: 1, weight_used: w, reps_done: 8, effort: 'ok' });
    await request(app).post(`/api/sessions/${s.body.id}/finish`).set(H);
  }
  const res = await request(app).get(`/api/exercises/${exId}/trend`).set(H);
  expect(res.status).toBe(200);
  expect(res.body.label).toBe('progressing');
  expect(res.body.series).toHaveLength(3);
});
