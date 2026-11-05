import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb, buildPlan } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);

async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}
async function seedLoggedSet(H: Record<string, string>) {
  const token = H.Authorization.slice('Bearer '.length);
  const { dayId, exId } = await buildPlan(app, token, {
    exercises: [{ exercise_name: 'Bench', target_sets: 1, target_reps: 8, starting_weight: 40 }] });
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
    .send({ day_exercise_id: exId, set_number: 1, weight_used: 60, reps_done: 8, effort: 'ok' });
  const read = await request(app).get(`/api/sessions/${sess.body.id}`).set(H);
  return { sessionId: sess.body.id as string, setId: read.body.sets[0].id as string };
}

it('owner edits a logged set; GET reflects the new values', async () => {
  const H = { Authorization: `Bearer ${await auth('editor')}` };
  const { sessionId, setId } = await seedLoggedSet(H);
  const r = await request(app).patch(`/api/sessions/${sessionId}/sets/${setId}`).set(H)
    .send({ weight_used: 0, reps_done: 12, effort: 'failed', extra_segments: [{ weight: 20, reps: 5 }] });
  expect(r.status).toBe(200);
  const after = await request(app).get(`/api/sessions/${sessionId}`).set(H);
  expect(after.body.sets[0]).toMatchObject({
    weight_used: 0, reps_done: 12, effort: 'failed', extra_segments: [{ weight: 20, reps: 5 }] });
});

it('rejects an invalid body with 400', async () => {
  const H = { Authorization: `Bearer ${await auth('editbad')}` };
  const { sessionId, setId } = await seedLoggedSet(H);
  const r = await request(app).patch(`/api/sessions/${sessionId}/sets/${setId}`).set(H)
    .send({ weight_used: -1, reps_done: 8, effort: 'ok', extra_segments: [] });
  expect(r.status).toBe(400);
});

it('non-owner cannot edit; 404', async () => {
  const H = { Authorization: `Bearer ${await auth('owner2')}` };
  const { sessionId, setId } = await seedLoggedSet(H);
  const OH = { Authorization: `Bearer ${await auth('stranger2')}` };
  const r = await request(app).patch(`/api/sessions/${sessionId}/sets/${setId}`).set(OH)
    .send({ weight_used: 50, reps_done: 8, effort: 'ok', extra_segments: [] });
  expect(r.status).toBe(404);
});

it('a set id from another session returns 404', async () => {
  const H = { Authorization: `Bearer ${await auth('owner3')}` };
  const { setId } = await seedLoggedSet(H);
  const { sessionId: otherSession } = await seedLoggedSet(H);
  const r = await request(app).patch(`/api/sessions/${otherSession}/sets/${setId}`).set(H)
    .send({ weight_used: 50, reps_done: 8, effort: 'ok', extra_segments: [] });
  expect(r.status).toBe(404);
});
