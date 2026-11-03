import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb, buildPlan } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}
async function makePlan(H: Record<string,string>) {
  const token = H.Authorization.slice('Bearer '.length);
  const { planId } = await buildPlan(app, token, {
    exercises: [{ exercise_name: 'Bench', target_sets: 1, target_reps: 8 }] });
  return planId;
}

it('owner can delete a plan; it disappears from the list but its session history remains', async () => {
  const t = await auth('bob'); const H = { Authorization: `Bearer ${t}` };
  const planId = await makePlan(H);
  const tree = await request(app).get(`/api/plans/${planId}`).set(H);
  const dayId = tree.body.days[0].id; const exId = tree.body.days[0].exercises[0].id;
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
    .send({ day_exercise_id: exId, set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok' });
  await request(app).post(`/api/sessions/${sess.body.id}/finish`).set(H);

  expect((await request(app).delete(`/api/plans/${planId}`).set(H)).status).toBe(204);
  const list = await request(app).get('/api/plans').set(H);
  expect(list.body.find((p: any) => p.id === planId)).toBeUndefined();
  expect((await request(app).get(`/api/plans/${planId}`).set(H)).status).toBe(404);
  expect((await request(app).get(`/api/sessions/${sess.body.id}`).set(H)).status).toBe(200);
});

it('admin can delete another users plan; a stranger cannot', async () => {
  const owner = await auth('owner'); const OH = { Authorization: `Bearer ${owner}` };
  const planId = await makePlan(OH);
  const stranger = await auth('stranger');
  expect((await request(app).delete(`/api/plans/${planId}`).set({ Authorization: `Bearer ${stranger}` })).status).toBe(404);
  const admin = await auth('ascererak');
  expect((await request(app).delete(`/api/plans/${planId}`).set({ Authorization: `Bearer ${admin}` })).status).toBe(204);
});
