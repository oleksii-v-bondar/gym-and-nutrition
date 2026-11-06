import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb, buildPlan } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}
async function seedDay(H: Record<string, string>) {
  const token = H.Authorization.slice('Bearer '.length);
  const { dayId } = await buildPlan(app, token, { exercises: [{ exercise_name: 'Bench', target_sets: 2, target_reps: 8 }] });
  return dayId;
}

it('resume-or-start returns the same session on a second POST', async () => {
  const H = { Authorization: `Bearer ${await auth('res')}` };
  const dayId = await seedDay(H);
  const first = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  expect(first.status).toBe(201);
  const second = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  expect(second.status).toBe(200);
  expect(second.body.id).toBe(first.body.id);
  const active = await request(app).get('/api/sessions/active').set(H);
  expect(active.body).toHaveLength(1);
});

it('starts a fresh session after the previous one is finished', async () => {
  const H = { Authorization: `Bearer ${await auth('res2')}` };
  const dayId = await seedDay(H);
  const first = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  await request(app).post(`/api/sessions/${first.body.id}/finish`).set(H);
  const second = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  expect(second.status).toBe(201);
  expect(second.body.id).not.toBe(first.body.id);
});

it('GET /active lists unfinished sessions with day_name and set_count; discard removes it', async () => {
  const H = { Authorization: `Bearer ${await auth('res3')}` };
  const token = H.Authorization.slice('Bearer '.length);
  const { dayId, exId } = await buildPlan(app, token, { exercises: [{ exercise_name: 'Bench', target_sets: 2, target_reps: 8 }] });
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
    .send({ day_exercise_id: exId, set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok' });

  const active = await request(app).get('/api/sessions/active').set(H);
  expect(active.body).toHaveLength(1);
  expect(active.body[0]).toMatchObject({ id: sess.body.id, plan_day_id: dayId, day_name: 'D', set_count: 1 });

  // other users don't see it
  const OH = { Authorization: `Bearer ${await auth('res3b')}` };
  expect((await request(app).get('/api/sessions/active').set(OH)).body).toHaveLength(0);

  // discard removes it from active
  expect((await request(app).delete(`/api/sessions/${sess.body.id}`).set(H)).status).toBe(204);
  expect((await request(app).get('/api/sessions/active').set(H)).body).toHaveLength(0);
});
