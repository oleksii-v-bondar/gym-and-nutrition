import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}

it('forks a template into the users account with id maps; editing the fork leaves the template intact', async () => {
  const adminT = await auth('ascererak'); const AH = { Authorization: `Bearer ${adminT}` };
  const planId = (await request(app).post('/api/plans/import').set(AH)
    .send({ name: 'T', days: [{ name: 'Push', exercises: [
      { exercise_name: 'Bench', target_sets: 3, target_reps: 8, starting_weight: 40 }] }] })).body.id;
  await request(app).put(`/api/plans/${planId}`).set(AH).send({ is_template: true });
  const tmplTree = await request(app).get(`/api/plans/${planId}`).set(AH);
  const srcDayId = tmplTree.body.days[0].id;
  const srcExId = tmplTree.body.days[0].exercises[0].id;

  const userT = await auth('bob'); const UH = { Authorization: `Bearer ${userT}` };
  const fork = await request(app).post(`/api/plans/${planId}/fork`).set(UH);
  expect(fork.status).toBe(201);
  expect(fork.body.dayIdMap[srcDayId]).toBeTruthy();
  expect(fork.body.exerciseIdMap[srcExId]).toBeTruthy();

  const copy = await request(app).get(`/api/plans/${fork.body.id}`).set(UH);
  expect(copy.body).toMatchObject({ is_template: false, owned: true });
  expect(copy.body.days[0].exercises[0].exercise_name).toBe('Bench');

  await request(app).delete(`/api/day-exercises/${fork.body.exerciseIdMap[srcExId]}`).set(UH);
  const tmplAgain = await request(app).get(`/api/plans/${planId}`).set(AH);
  expect(tmplAgain.body.days[0].exercises).toHaveLength(1);
});

it('404 when forking a plan that is neither owned nor a template', async () => {
  const ownerT = await auth('owner'); const OH = { Authorization: `Bearer ${ownerT}` };
  const planId = (await request(app).post('/api/plans/import').set(OH)
    .send({ name: 'P', days: [] })).body.id;
  const other = await auth('intruder');
  const res = await request(app).post(`/api/plans/${planId}/fork`).set({ Authorization: `Bearer ${other}` });
  expect(res.status).toBe(404);
});
