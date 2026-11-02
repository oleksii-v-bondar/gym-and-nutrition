import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}
async function seed(H: Record<string,string>) {
  const plan = await request(app).post('/api/plans/import').set(H)
    .send({ name: 'P', days: [{ name: 'D', exercises: [{ exercise_name: 'Bench', target_sets: 1, target_reps: 8, starting_weight: 40 }] }] });
  const tree = await request(app).get(`/api/plans/${plan.body.id}`).set(H);
  return { dayId: tree.body.days[0].id, exId: tree.body.days[0].exercises[0].id };
}

it('logs a set with extra segments and returns them', async () => {
  const t = await auth('seg'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await seed(H);
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  const r = await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H).send({
    day_exercise_id: exId, set_number: 1, weight_used: 60, reps_done: 8, effort: 'hard',
    extra_segments: [{ weight: 40, reps: 10 }, { weight: 20, reps: 12 }],
  });
  expect(r.status).toBe(201);
  const read = await request(app).get(`/api/sessions/${sess.body.id}`).set(H);
  expect(read.body.sets[0].extra_segments).toEqual([{ weight: 40, reps: 10 }, { weight: 20, reps: 12 }]);
});

it('defaults extra_segments to [] when omitted', async () => {
  const t = await auth('seg2'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await seed(H);
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
    .send({ day_exercise_id: exId, set_number: 1, weight_used: 60, reps_done: 8, effort: 'ok' });
  const read = await request(app).get(`/api/sessions/${sess.body.id}`).set(H);
  expect(read.body.sets[0].extra_segments).toEqual([]);
});

it('extra segments do not change the main-set weight suggestion', async () => {
  const t = await auth('seg3'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await seed(H);
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H).send({
    day_exercise_id: exId, set_number: 1, weight_used: 40, reps_done: 8, effort: 'easy',
    extra_segments: [{ weight: 20, reps: 15 }],
  });
  await request(app).post(`/api/sessions/${sess.body.id}/finish`).set(H);
  const sug = await request(app).get(`/api/exercises/${exId}/suggestion`).set(H);
  expect(sug.body.weight).toBe(42.5);
});
