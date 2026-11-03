import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb, buildPlan } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(email: string) {
  await request(app).post('/api/auth/register').send({ login: email, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login: email, password: 'pw123456' })).body.accessToken as string;
}

it('suggests starting weight when there is no history, then bumps after an easy session', async () => {
  const t = await auth('sg@x.com'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await buildPlan(app, t, {
    exercises: [{ exercise_name: 'Bench', target_sets: 2, target_reps: 8, starting_weight: 40 }] });

  const first = await request(app).get(`/api/exercises/${exId}/suggestion`).set(H);
  expect(first.body).toEqual({ weight: 40, reason: expect.stringContaining('Starting') });

  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  for (let n = 1; n <= 2; n++)
    await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
      .send({ day_exercise_id: exId, set_number: n, weight_used: 40, reps_done: 8, effort: 'easy' });
  await request(app).post(`/api/sessions/${sess.body.id}/finish`).set(H);

  const next = await request(app).get(`/api/exercises/${exId}/suggestion`).set(H);
  expect(next.body.weight).toBe(42.5);
});
