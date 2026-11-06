import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb, buildPlan } from '../src/test/helpers.js';

const app = createApp();

beforeAll(setupTestDb);
beforeEach(resetDb);
afterAll(teardownTestDb);

async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}

it('logs a set with a negative (assisted) weight and reads it back', async () => {
  const token = await auth('grav');
  const H = { Authorization: `Bearer ${token}` };
  const { dayId, exId } = await buildPlan(app, token, {
    exercises: [{ exercise_name: 'Assisted Pull-up', target_sets: 1, target_reps: 8 }],
  });
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  const r = await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
    .send({
      day_exercise_id: exId,
      set_number: 1,
      weight_used: -20,
      reps_done: 8,
      effort: 'ok',
      extra_segments: [{ weight: -10, reps: 5 }],
    });
  expect(r.status).toBe(201);
  const read = await request(app).get(`/api/sessions/${sess.body.id}`).set(H);
  expect(read.body.sets[0].weight_used).toBe(-20);
  expect(read.body.sets[0].extra_segments).toEqual([{ weight: -10, reps: 5 }]);
});

it('accepts a negative starting_weight on import', async () => {
  const token = await auth('ascererak');
  const H = { Authorization: `Bearer ${token}` };
  const planId = (await request(app).post('/api/plans/import').set(H)
    .send({
      name: 'P',
      days: [{
        name: 'D',
        exercises: [
          { exercise_name: 'Assisted Dip', target_sets: 3, target_reps: 8, starting_weight: -30 },
        ],
      }],
    })).body.id;
  const tree = await request(app).get(`/api/plans/${planId}`).set(H);
  expect(Number(tree.body.days[0].exercises[0].starting_weight)).toBe(-30);
});
