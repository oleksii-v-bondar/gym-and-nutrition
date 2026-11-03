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
    .send({ name: 'P', days: [{ name: 'Push', exercises: [{ exercise_name: 'Bench', target_sets: 1, target_reps: 8, starting_weight: 40 }] }] });
  const tree = await request(app).get(`/api/plans/${plan.body.id}`).set(H);
  return { dayId: tree.body.days[0].id, exId: tree.body.days[0].exercises[0].id };
}
async function runSession(H: Record<string,string>, dayId: string, exId: string) {
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
    .send({ day_exercise_id: exId, set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok' });
  await request(app).post(`/api/sessions/${sess.body.id}/finish`).set(H);
  return sess.body.id as string;
}

it('lists only the users finished sessions with day name + set count, newest first', async () => {
  const t = await auth('bob'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await seed(H);
  const s1 = await runSession(H, dayId, exId);
  const s2 = await runSession(H, dayId, exId);
  await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  const other = await auth('carol'); const OH = { Authorization: `Bearer ${other}` };
  const o = await seed(OH); await runSession(OH, o.dayId, o.exId);

  const list = await request(app).get('/api/sessions').set(H);
  expect(list.status).toBe(200);
  expect(list.body.map((r: any) => r.id)).toEqual([s2, s1]);
  expect(list.body[0]).toMatchObject({ day_name: 'Push', set_count: 1 });
});

it('detail includes day_name and exercise_name per set', async () => {
  const t = await auth('dave'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await seed(H);
  const sid = await runSession(H, dayId, exId);
  const detail = await request(app).get(`/api/sessions/${sid}`).set(H);
  expect(detail.body.day_name).toBe('Push');
  expect(detail.body.sets[0].exercise_name).toBe('Bench');
});

it('owner deletes a session; non-owner gets 404', async () => {
  const t = await auth('erin'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await seed(H);
  const sid = await runSession(H, dayId, exId);
  const intruder = await auth('ivan');
  expect((await request(app).delete(`/api/sessions/${sid}`).set({ Authorization: `Bearer ${intruder}` })).status).toBe(404);
  expect((await request(app).delete(`/api/sessions/${sid}`).set(H)).status).toBe(204);
  const list = await request(app).get('/api/sessions').set(H);
  expect(list.body).toHaveLength(0);
});
