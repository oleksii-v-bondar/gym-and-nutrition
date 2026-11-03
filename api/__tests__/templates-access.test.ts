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
  const { planId } = await buildPlan(app, token, { name: 'Tmpl', dayName: 'D',
    exercises: [{ exercise_name: 'Bench', target_sets: 3, target_reps: 8 }] });
  return planId;
}

it('admin can mark a plan as a template; others then see it as a non-owned template', async () => {
  const adminT = await auth('ascererak'); const AH = { Authorization: `Bearer ${adminT}` };
  const planId = await makePlan(AH);
  expect((await request(app).put(`/api/plans/${planId}`).set(AH).send({ is_template: true })).status).toBe(200);

  const userT = await auth('bob'); const UH = { Authorization: `Bearer ${userT}` };
  const list = await request(app).get('/api/plans').set(UH);
  const row = list.body.find((p: any) => p.id === planId);
  expect(row).toMatchObject({ is_template: true, owned: false });

  const tree = await request(app).get(`/api/plans/${planId}`).set(UH);
  expect(tree.status).toBe(200);
  expect(tree.body).toMatchObject({ is_template: true, owned: false });

  const addDay = await request(app).post(`/api/plans/${planId}/days`).set(UH).send({ name: 'X' });
  expect(addDay.status).toBe(404);
});

it('a non-admin cannot set is_template on their own plan', async () => {
  const userT = await auth('carol'); const UH = { Authorization: `Bearer ${userT}` };
  const planId = await makePlan(UH);
  const res = await request(app).put(`/api/plans/${planId}`).set(UH).send({ is_template: true });
  expect(res.status).toBe(403);
});
