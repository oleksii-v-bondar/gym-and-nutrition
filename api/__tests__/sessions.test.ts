import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(email: string) {
  await request(app).post('/api/auth/register').send({ email, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ email, password: 'pw123456' })).body.accessToken as string;
}
async function seed(token: string) {
  const plan = await request(app).post('/api/plans/import').set('Authorization', `Bearer ${token}`)
    .send({ name: 'P', days: [{ name: 'D', exercises: [{ exercise_name: 'Bench', target_sets: 3, target_reps: 8, starting_weight: 40 }] }] });
  const tree = await request(app).get(`/api/plans/${plan.body.id}`).set('Authorization', `Bearer ${token}`);
  return { dayId: tree.body.days[0].id, exId: tree.body.days[0].exercises[0].id };
}

it('runs a full session: start, log sets, finish, read back', async () => {
  const t = await auth('s@x.com'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await seed(t);
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  expect(sess.status).toBe(201);
  for (let n = 1; n <= 3; n++) {
    const r = await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
      .send({ day_exercise_id: exId, set_number: n, weight_used: 40, reps_done: 8, effort: 'easy' });
    expect(r.status).toBe(201);
  }
  const fin = await request(app).post(`/api/sessions/${sess.body.id}/finish`).set(H);
  expect(fin.status).toBe(200);
  expect(fin.body.finished_at).toBeTruthy();
  const read = await request(app).get(`/api/sessions/${sess.body.id}`).set(H);
  expect(read.body.sets).toHaveLength(3);
  expect(read.body.sets[0].weight_used).toBe(40);
});

it('rejects an invalid effort value', async () => {
  const t = await auth('s2@x.com'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await seed(t);
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  const r = await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
    .send({ day_exercise_id: exId, set_number: 1, weight_used: 40, reps_done: 8, effort: 'nope' });
  expect(r.status).toBe(400);
});

it('blocks logging into another user session', async () => {
  const owner = await auth('o@x.com'); const Ho = { Authorization: `Bearer ${owner}` };
  const { dayId, exId } = await seed(owner);
  const sess = await request(app).post('/api/sessions').set(Ho).send({ plan_day_id: dayId });
  const intruder = await auth('i@x.com');
  const r = await request(app).post(`/api/sessions/${sess.body.id}/sets`).set({ Authorization: `Bearer ${intruder}` })
    .send({ day_exercise_id: exId, set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok' });
  expect(r.status).toBe(404);
});

it("blocks logging a set for another user's exercise", async () => {
  const tA = await auth('a@x.com'); const Ha = { Authorization: `Bearer ${tA}` };
  const { exId: aExId } = await seed(tA);

  const tB = await auth('b@x.com'); const Hb = { Authorization: `Bearer ${tB}` };
  const { dayId: bDayId } = await seed(tB);
  const bSess = await request(app).post('/api/sessions').set(Hb).send({ plan_day_id: bDayId });

  const r = await request(app).post(`/api/sessions/${bSess.body.id}/sets`).set(Hb)
    .send({ day_exercise_id: aExId, set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok' });
  expect(r.status).toBe(404);
});
