import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb);
beforeEach(resetDb);
afterAll(teardownTestDb);

async function authFor(email: string) {
  await request(app).post('/api/auth/register').send({ login: email, password: 'pw123456' });
  const login = await request(app).post('/api/auth/login').send({ login: email, password: 'pw123456' });
  return login.body.accessToken as string;
}
const samplePlan = {
  name: 'PPL',
  days: [{ name: 'Push A', exercises: [
    { exercise_name: 'Bench', target_sets: 3, target_reps: 8, starting_weight: 40 },
    { exercise_name: 'OHP', target_sets: 3, target_reps: 10 },
  ] }],
};

it('requires auth', async () => {
  const res = await request(app).get('/api/plans');
  expect(res.status).toBe(401);
});

it('imports, lists, reads, and exports a plan', async () => {
  const token = await authFor('a@x.com');
  const imp = await request(app).post('/api/plans/import').set('Authorization', `Bearer ${token}`).send(samplePlan);
  expect(imp.status).toBe(201);
  const planId = imp.body.id;

  const list = await request(app).get('/api/plans').set('Authorization', `Bearer ${token}`);
  expect(list.body).toHaveLength(1);

  const tree = await request(app).get(`/api/plans/${planId}`).set('Authorization', `Bearer ${token}`);
  expect(tree.body.days[0].exercises).toHaveLength(2);
  expect(tree.body.days[0].exercises[0].exercise_name).toBe('Bench');

  const exp = await request(app).get(`/api/plans/${planId}/export`).set('Authorization', `Bearer ${token}`);
  expect(exp.body.name).toBe('PPL');
  expect(exp.body.days[0].exercises).toHaveLength(2);
});

it('rejects a malformed import', async () => {
  const token = await authFor('b@x.com');
  const res = await request(app).post('/api/plans/import').set('Authorization', `Bearer ${token}`)
    .send({ name: 'bad', days: [{ name: 'd', exercises: [{ exercise_name: '', target_sets: -1, target_reps: 0 }] }] });
  expect(res.status).toBe(400);
});

it('does not leak another user plan', async () => {
  const t1 = await authFor('owner@x.com');
  const imp = await request(app).post('/api/plans/import').set('Authorization', `Bearer ${t1}`).send(samplePlan);
  const t2 = await authFor('intruder@x.com');
  const res = await request(app).get(`/api/plans/${imp.body.id}`).set('Authorization', `Bearer ${t2}`);
  expect(res.status).toBe(404);
});
