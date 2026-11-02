# Admin Shared Templates + Manual Plan Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let any user create plans manually, and let a configured admin publish shared template plans that every user sees and silently forks (copy-on-edit) when they modify them.

**Architecture:** Additive change to the existing api (Node/Express 5 + TS + raw `pg`) and web (React + Vite) app. One new nullable-free column `plans.is_template`; admin identity from an env login; widened read access for templates; owner-only writes; a server fork endpoint returning id maps; client-orchestrated copy-on-edit in the editor.

**Tech Stack:** Existing — Express 5, pg, Zod, Vitest + Supertest (api); React 18, react-router, @tanstack/react-query, Vitest + RTL (web). Postgres 16.

## Global Constraints

- Admin identity: a user is admin iff `login === config.adminLogin`; `config.adminLogin = process.env.ADMIN_LOGIN ?? 'ascererak'`.
- Template = `plans.is_template = true`, owned by the admin. All other plans (incl. forks) are `is_template = false`.
- Read a plan (tree/export/day-detail) if you own it OR it is a template. Mutations and session-starts remain **owner-only** (non-owner → 404).
- Only the admin may set `is_template`; a non-admin request that includes `is_template` → **403**.
- Fork copies plan + days + exercises only (no sessions/history); the copy is owned by the forker, `is_template=false`; admin edits never propagate to existing copies.
- ESM `.js` import extensions. Conventional Commits. Build only what each task specifies.
- Dev/test Postgres runs at `postgres://gym:gym@localhost:5432/gym_test`; api tests: `cd api && npm run test:int -- <file>`. Web tests: `cd web && npx vitest run <file>`.

---

## File Structure

- `api/src/config.ts` — add `adminLogin`.
- `api/src/me/routes.ts` *(new)* — `GET /api/me` → `{ id, login, isAdmin }`.
- `db/schema.sql` — add `is_template` to `plans`.
- `api/src/plans/schema.ts` — add `is_template` to `planUpdate`; add `blankPlanCreate`.
- `api/src/plans/repo.ts` — `createBlankPlan`, `listVisiblePlans`, widen `getPlanTree`, `userCanReadPlanDay`, `forkPlan`, extend `updatePlan`, add `isAdminUser`.
- `api/src/plans/routes.ts` — `POST /api/plans`, `POST /api/plans/:id/fork`, admin-gate `is_template` in `PUT /api/plans/:id`, widen `GET /plan-days/:id` read; `GET /api/plans` uses `listVisiblePlans`.
- `api/src/app.ts` — mount `meRouter`.
- `web/src/auth/AuthContext.tsx` — expose `isAdmin` + `login` from `/api/me`.
- `web/src/plans/PlansPage.tsx` — "Create plan" button + "Template" badges.
- `web/src/plans/PlanEditorPage.tsx` — admin `is_template` toggle + fork-on-edit.

---

## Task 1: Admin config + `GET /api/me`

**Files:**
- Modify: `api/src/config.ts`, `api/src/app.ts`
- Create: `api/src/me/routes.ts`
- Test: `api/__tests__/me.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (sets `req.userId`), `query`, `config`.
- Produces: `config.adminLogin: string`; `meRouter` mounted at `/api/me`; `GET /api/me` → `200 { id, login, isAdmin }`.

- [ ] **Step 1: Add `adminLogin` to `api/src/config.ts`**

In the `config` object add:
```ts
  adminLogin: (process.env.ADMIN_LOGIN ?? 'ascererak').toLowerCase(),
```

- [ ] **Step 2: Write the failing test `api/__tests__/me.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}
it('reports isAdmin for the configured admin login only', async () => {
  const adminT = await auth('ascererak');
  const me = await request(app).get('/api/me').set('Authorization', `Bearer ${adminT}`);
  expect(me.status).toBe(200);
  expect(me.body).toMatchObject({ login: 'ascererak', isAdmin: true });
  expect(me.body.id).toBeTruthy();

  const userT = await auth('bob');
  const me2 = await request(app).get('/api/me').set('Authorization', `Bearer ${userT}`);
  expect(me2.body).toMatchObject({ login: 'bob', isAdmin: false });
});
it('requires auth', async () => {
  expect((await request(app).get('/api/me')).status).toBe(401);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd api && npm run test:int -- __tests__/me.test.ts` → FAIL (route 404).

- [ ] **Step 4: Write `api/src/me/routes.ts`**

```ts
import { Router } from 'express';
import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get('/', async (req, res) => {
  const r = await query<{ id: string; login: string }>('SELECT id, login FROM users WHERE id=$1', [req.userId]);
  const u = r.rows[0];
  if (!u) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ id: u.id, login: u.login, isAdmin: u.login === config.adminLogin });
});
```

- [ ] **Step 5: Mount in `api/src/app.ts`**

Add import `import { meRouter } from './me/routes.js';` and mount it **before** the `app.use('/api', plansSubRouter)` line (so it isn't shadowed by the broad `/api` sub-router): `app.use('/api/me', meRouter);`

- [ ] **Step 6: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/me.test.ts` → PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add api && git commit -m "feat: add admin login config and GET /api/me"
```

---

## Task 2: `is_template` column, manual plan creation, template-aware listing

**Files:**
- Modify: `db/schema.sql`, `api/src/plans/schema.ts`, `api/src/plans/repo.ts`, `api/src/plans/routes.ts`
- Test: `api/__tests__/plans-create-list.test.ts`

**Interfaces:**
- Consumes: `requireAuth`, `query`.
- Produces:
  - `blankPlanCreate = z.object({ name: z.string().min(1) })`.
  - `createBlankPlan(userId, name): Promise<{ id }>`.
  - `listVisiblePlans(userId): Promise<Array<{ id, name, is_active, is_template, owned:boolean }>>`.
  - `POST /api/plans` body `{ name }` → `201 { id }`.
  - `GET /api/plans` → rows with `is_template` + `owned`.

- [ ] **Step 1: Add the column in `db/schema.sql`**

In the `CREATE TABLE ... plans (...)` block add a final column:
```sql
  is_template boolean NOT NULL DEFAULT false
```
(Place it after `is_active`. The test harness drops & recreates the schema, so no ALTER is needed for tests; for the running dev DB, re-apply the schema as documented.)

- [ ] **Step 2: Add schemas/repo funcs — `api/src/plans/schema.ts`**

```ts
export const blankPlanCreate = z.object({ name: z.string().min(1) });
```

- [ ] **Step 3: Write the failing test `api/__tests__/plans-create-list.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}
it('creates a blank plan and lists it as owned, non-template', async () => {
  const t = await auth('bob'); const H = { Authorization: `Bearer ${t}` };
  const c = await request(app).post('/api/plans').set(H).send({ name: 'My Plan' });
  expect(c.status).toBe(201);
  const list = await request(app).get('/api/plans').set(H);
  expect(list.body).toHaveLength(1);
  expect(list.body[0]).toMatchObject({ name: 'My Plan', is_template: false, owned: true });
});
it('rejects a blank-plan create with no name', async () => {
  const t = await auth('carol');
  const c = await request(app).post('/api/plans').set({ Authorization: `Bearer ${t}` }).send({});
  expect(c.status).toBe(400);
});
```

- [ ] **Step 4: Run and watch it fail**

Run: `cd api && npm run test:int -- __tests__/plans-create-list.test.ts` → FAIL (POST /api/plans 404).

- [ ] **Step 5: Add repo functions in `api/src/plans/repo.ts`**

```ts
export async function createBlankPlan(userId: string, name: string): Promise<{ id: string }> {
  const r = await query<{ id: string }>(
    'INSERT INTO plans (user_id, name, is_active, is_template) VALUES ($1,$2,false,false) RETURNING id', [userId, name]);
  return r.rows[0];
}

export async function listVisiblePlans(userId: string) {
  const r = await query(
    `SELECT id, name, is_active, is_template, (user_id = $1) AS owned
     FROM plans WHERE user_id = $1 OR is_template = true ORDER BY is_template, name`, [userId]);
  return r.rows;
}
```

- [ ] **Step 6: Wire routes in `api/src/plans/routes.ts`**

Replace the existing `plansRouter.get('/', ...)` handler body to use `listVisiblePlans`, and add a POST handler. Import `createBlankPlan, listVisiblePlans` and `blankPlanCreate`:
```ts
plansRouter.get('/', async (req, res) => {
  res.json(await listVisiblePlans(req.userId!));
});
plansRouter.post('/', async (req, res) => {
  const p = blankPlanCreate.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  res.status(201).json(await createBlankPlan(req.userId!, p.data.name));
});
```
(Keep `POST /api/plans/import` as-is; Express routes by method+path so `POST /` and `POST /import` coexist.)

- [ ] **Step 7: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/plans-create-list.test.ts` → PASS (2 tests).

- [ ] **Step 8: Run the full api suite, then commit**

Run: `cd api && npm run test:int` → all pass. Then:
```bash
git add api db/schema.sql && git commit -m "feat: add is_template column, manual plan creation, template-aware plan listing"
```

---

## Task 3: Widen template reads + admin-gate `is_template`

**Files:**
- Modify: `api/src/plans/schema.ts`, `api/src/plans/repo.ts`, `api/src/plans/routes.ts`
- Test: `api/__tests__/templates-access.test.ts`

**Interfaces:**
- Consumes: `query`, `config`, `requireAuth`, `userOwnsPlan`, `userOwnsPlanDay`.
- Produces:
  - `planUpdate` gains `is_template: z.boolean().optional()`.
  - `isAdminUser(userId): Promise<boolean>`.
  - `userCanReadPlanDay(userId, dayId): Promise<boolean>`.
  - `getPlanTree` now returns `{ id, name, is_active, is_template, owned, days: [...] }` for owned-or-template plans (null otherwise).
  - `updatePlan(planId, { name?, is_active?, is_template? })`.
  - `PUT /api/plans/:id` with `is_template` by a non-admin → 403; `GET /api/plans/:id` and `GET /api/plan-days/:id` readable for templates; mutations still owner-only.

- [ ] **Step 1: Extend `planUpdate` in `api/src/plans/schema.ts`**

```ts
export const planUpdate = z.object({
  name: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  is_template: z.boolean().optional(),
});
```

- [ ] **Step 2: Write the failing test `api/__tests__/templates-access.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}
async function makePlan(H: Record<string,string>) {
  return (await request(app).post('/api/plans/import').set(H)
    .send({ name: 'Tmpl', days: [{ name: 'D', exercises: [{ exercise_name: 'Bench', target_sets: 3, target_reps: 8 }] }] })).body.id;
}

it('admin can mark a plan as a template; others then see it as a non-owned template', async () => {
  const adminT = await auth('ascererak'); const AH = { Authorization: `Bearer ${adminT}` };
  const planId = await makePlan(AH);
  expect((await request(app).put(`/api/plans/${planId}`).set(AH).send({ is_template: true })).status).toBe(200);

  const userT = await auth('bob'); const UH = { Authorization: `Bearer ${userT}` };
  const list = await request(app).get('/api/plans').set(UH);
  const row = list.body.find((p: any) => p.id === planId);
  expect(row).toMatchObject({ is_template: true, owned: false });

  // template is readable by the non-owner
  const tree = await request(app).get(`/api/plans/${planId}`).set(UH);
  expect(tree.status).toBe(200);
  expect(tree.body).toMatchObject({ is_template: true, owned: false });
  // but a mutation by the non-owner is rejected
  const addDay = await request(app).post(`/api/plans/${planId}/days`).set(UH).send({ name: 'X' });
  expect(addDay.status).toBe(404);
});

it('a non-admin cannot set is_template on their own plan', async () => {
  const userT = await auth('carol'); const UH = { Authorization: `Bearer ${userT}` };
  const planId = await makePlan(UH);
  const res = await request(app).put(`/api/plans/${planId}`).set(UH).send({ is_template: true });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `cd api && npm run test:int -- __tests__/templates-access.test.ts` → FAIL (403/template behaviors absent).

- [ ] **Step 4: Repo changes in `api/src/plans/repo.ts`**

Add imports at top if missing: `import { config } from '../config.js';`

Add helpers:
```ts
export async function isAdminUser(userId: string): Promise<boolean> {
  const r = await query<{ login: string }>('SELECT login FROM users WHERE id=$1', [userId]);
  return r.rows[0]?.login === config.adminLogin;
}
export async function userCanReadPlanDay(userId: string, dayId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM plan_days pd JOIN plans p ON p.id=pd.plan_id
     WHERE pd.id=$1 AND (p.user_id=$2 OR p.is_template=true)`, [dayId, userId]);
  return r.rowCount! > 0;
}
```

Replace `getPlanTree`'s plan lookup to allow templates and expose `is_template`/`owned`:
```ts
export async function getPlanTree(userId: string, planId: string) {
  const plan = await query<{ id: string; name: string; is_active: boolean; is_template: boolean; owned: boolean }>(
    `SELECT id, name, is_active, is_template, (user_id = $2) AS owned
     FROM plans WHERE id=$1 AND (user_id=$2 OR is_template=true)`, [planId, userId]);
  if (!plan.rows[0]) return null;
  const days = await query(
    'SELECT id, name, order_index FROM plan_days WHERE plan_id=$1 ORDER BY order_index', [planId]);
  const exercises = await query(
    `SELECT de.id, de.plan_day_id, de.exercise_name, de.order_index, de.target_sets, de.target_reps, de.rest_seconds, de.starting_weight
     FROM day_exercises de JOIN plan_days pd ON pd.id = de.plan_day_id
     WHERE pd.plan_id=$1 ORDER BY de.order_index`, [planId]);
  return {
    ...plan.rows[0],
    days: days.rows.map((d: any) => ({
      ...d,
      exercises: exercises.rows.filter((x: any) => x.plan_day_id === d.id).map(({ plan_day_id, ...rest }: any) => rest),
    })),
  };
}
```

Extend `updatePlan` to handle `is_template`:
```ts
export async function updatePlan(planId: string, fields: { name?: string; is_active?: boolean; is_template?: boolean }) {
  const sets: string[] = []; const vals: unknown[] = [];
  if (fields.name !== undefined) { vals.push(fields.name); sets.push(`name=$${vals.length}`); }
  if (fields.is_active !== undefined) { vals.push(fields.is_active); sets.push(`is_active=$${vals.length}`); }
  if (fields.is_template !== undefined) { vals.push(fields.is_template); sets.push(`is_template=$${vals.length}`); }
  if (!sets.length) return;
  vals.push(planId);
  await query(`UPDATE plans SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
}
```

- [ ] **Step 5: Route changes in `api/src/plans/routes.ts`**

Import `isAdminUser, userCanReadPlanDay` from repo. Replace the `PUT /:id` handler to admin-gate `is_template`:
```ts
plansRouter.put('/:id', async (req, res) => {
  if (!(await userOwnsPlan(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  const p = planUpdate.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  if (p.data.is_template !== undefined && !(await isAdminUser(req.userId!))) {
    res.status(403).json({ error: 'admin only' }); return;
  }
  await updatePlan(req.params.id, p.data);
  res.json({ id: req.params.id, ...p.data });
});
```

In `plansSubRouter`, change the `GET /plan-days/:id` read gate from `userOwnsPlanDay` to `userCanReadPlanDay`:
```ts
plansSubRouter.get('/plan-days/:id', async (req, res) => {
  if (!(await userCanReadPlanDay(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  res.json(await getDayWithExercises(req.params.id));
});
```
(`GET /api/plans/:id` and `/export` already call `getPlanTree`, now widened — no route edit needed. All mutation routes keep `userOwnsPlan`/`userOwnsPlanDay`/`userOwnsExercise`.)

- [ ] **Step 6: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/templates-access.test.ts` → PASS (2 tests).

- [ ] **Step 7: Full api suite + commit**

Run: `cd api && npm run test:int` → all pass. Then:
```bash
git add api && git commit -m "feat: widen template read access and admin-gate is_template"
```

---

## Task 4: Fork endpoint (deep copy with id maps)

**Files:**
- Modify: `api/src/plans/repo.ts`, `api/src/plans/routes.ts`
- Test: `api/__tests__/fork.test.ts`

**Interfaces:**
- Consumes: `pool`, `query`, `requireAuth`.
- Produces:
  - `forkPlan(userId, planId): Promise<{ id, dayIdMap: Record<string,string>, exerciseIdMap: Record<string,string> } | null>` — deep-copies an owned-or-template plan into `userId`'s account (`is_template=false`, `is_active=false`); null if source unreadable.
  - `POST /api/plans/:id/fork` → `201 { id, dayIdMap, exerciseIdMap }`, or 404.

- [ ] **Step 1: Write the failing test `api/__tests__/fork.test.ts`**

```ts
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

  // delete the copy's exercise; template is unchanged
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
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd api && npm run test:int -- __tests__/fork.test.ts` → FAIL (route 404).

- [ ] **Step 3: Add `forkPlan` to `api/src/plans/repo.ts`**

```ts
export async function forkPlan(userId: string, planId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const src = await client.query<{ name: string }>(
      'SELECT name FROM plans WHERE id=$1 AND (user_id=$2 OR is_template=true)', [planId, userId]);
    if (!src.rows[0]) { await client.query('ROLLBACK'); return null; }
    const newPlan = await client.query<{ id: string }>(
      'INSERT INTO plans (user_id, name, is_active, is_template) VALUES ($1,$2,false,false) RETURNING id',
      [userId, src.rows[0].name]);
    const newPlanId = newPlan.rows[0].id;
    const dayIdMap: Record<string, string> = {};
    const exerciseIdMap: Record<string, string> = {};
    const days = await client.query<{ id: string; name: string; order_index: number }>(
      'SELECT id, name, order_index FROM plan_days WHERE plan_id=$1 ORDER BY order_index', [planId]);
    for (const d of days.rows) {
      const nd = await client.query<{ id: string }>(
        'INSERT INTO plan_days (plan_id, name, order_index) VALUES ($1,$2,$3) RETURNING id',
        [newPlanId, d.name, d.order_index]);
      dayIdMap[d.id] = nd.rows[0].id;
    }
    const exs = await client.query<any>(
      `SELECT de.id, de.plan_day_id, de.exercise_name, de.order_index, de.target_sets, de.target_reps, de.rest_seconds, de.starting_weight
       FROM day_exercises de JOIN plan_days pd ON pd.id=de.plan_day_id
       WHERE pd.plan_id=$1 ORDER BY de.order_index`, [planId]);
    for (const e of exs.rows) {
      const ne = await client.query<{ id: string }>(
        `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [dayIdMap[e.plan_day_id], e.exercise_name, e.order_index, e.target_sets, e.target_reps, e.rest_seconds, e.starting_weight]);
      exerciseIdMap[e.id] = ne.rows[0].id;
    }
    await client.query('COMMIT');
    return { id: newPlanId, dayIdMap, exerciseIdMap };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Add the route in `api/src/plans/routes.ts`**

Import `forkPlan`. Add to `plansRouter`:
```ts
plansRouter.post('/:id/fork', async (req, res) => {
  const forked = await forkPlan(req.userId!, req.params.id);
  if (!forked) { res.status(404).json({ error: 'not found' }); return; }
  res.status(201).json(forked);
});
```

- [ ] **Step 5: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/fork.test.ts` → PASS (2 tests).

- [ ] **Step 6: Full api suite + commit**

Run: `cd api && npm run test:int` → all pass. Then:
```bash
git add api && git commit -m "feat: add plan fork endpoint with day/exercise id maps"
```

---

## Task 5: Web — isAdmin in AuthContext + Create-plan & template badges

**Files:**
- Modify: `web/src/auth/AuthContext.tsx`, `web/src/auth/LoginPage.test.tsx`, `web/src/plans/PlansPage.tsx`
- Test: `web/src/plans/PlansPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `getAccessToken`. API: `GET /api/me`, `POST /api/plans`, `GET /api/plans` (rows now `{ id, name, is_active, is_template, owned }`).
- Produces: `useAuth()` additionally returns `isAdmin: boolean`. `PlansPage` has an inline "Create plan" input+button and shows a "Template" badge on template rows.

- [ ] **Step 1: Extend `web/src/auth/AuthContext.tsx`**

Add `isAdmin` to the context. Full provider body:
```tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiFetch, setTokens, clearTokens, getAccessToken } from '../api/client';

interface AuthCtx {
  isAuthed: boolean; isAdmin: boolean;
  login(l: string, p: string): Promise<void>; register(l: string, p: string): Promise<void>; logout(): void;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthed, setAuthed] = useState<boolean>(!!getAccessToken());
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  async function refreshMe() {
    try { const me = await apiFetch<{ isAdmin: boolean }>('/api/me'); setIsAdmin(!!me.isAdmin); }
    catch { setIsAdmin(false); }
  }
  useEffect(() => { if (getAccessToken()) refreshMe(); }, []);

  async function login(loginId: string, password: string) {
    const { accessToken, refreshToken } = await apiFetch<{ accessToken: string; refreshToken: string }>(
      '/api/auth/login', { method: 'POST', body: JSON.stringify({ login: loginId, password }) });
    setTokens(accessToken, refreshToken); setAuthed(true); await refreshMe();
  }
  async function register(loginId: string, password: string) {
    await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ login: loginId, password }) });
    await login(loginId, password);
  }
  function logout() { clearTokens(); setAuthed(false); setIsAdmin(false); }

  return <Ctx.Provider value={{ isAuthed, isAdmin, login, register, logout }}>{children}</Ctx.Provider>;
}
export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
```

- [ ] **Step 2: Fix the existing `web/src/auth/LoginPage.test.tsx` mock**

The `useAuth` mock must include `isAdmin`. Change the `mockReturnValue(...)` call to:
```tsx
  vi.spyOn(AuthCtx, 'useAuth').mockReturnValue({ isAuthed: false, isAdmin: false, login, register: vi.fn(), logout: vi.fn() });
```

- [ ] **Step 3: Write the failing test `web/src/plans/PlansPage.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { PlansPage } from './PlansPage';
import * as client from '../api/client';

function renderPage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}><AuthProvider><MemoryRouter><PlansPage /></MemoryRouter></AuthProvider></QueryClientProvider>
  );
}

it('badges templates and creates a plan', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plans' && (!init || init.method === undefined)) return [
      { id: 'p1', name: 'Mine', is_active: false, is_template: false, owned: true },
      { id: 't1', name: 'Shared', is_active: false, is_template: true, owned: false },
    ] as any;
    if (path === '/api/plans' && init?.method === 'POST') return { id: 'new1' } as any;
    return {} as any;
  });
  renderPage();
  expect(await screen.findByText('Shared')).toBeInTheDocument();
  expect(screen.getByText(/template/i)).toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText(/new plan name/i), 'Legs');
  await userEvent.click(screen.getByRole('button', { name: /create plan/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/plans',
    expect.objectContaining({ method: 'POST', body: expect.stringContaining('Legs') })));
});
```

- [ ] **Step 4: Run and watch it fail**

Run: `cd web && npx vitest run src/plans/PlansPage.test.tsx` → FAIL (no badge / create input).

- [ ] **Step 5: Rewrite `web/src/plans/PlansPage.tsx`**

```tsx
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { readPlanFile } from './importPlan';
import { NavBar } from '../ui/NavBar';

interface PlanRow { id: string; name: string; is_active: boolean; is_template: boolean; owned: boolean; }
export function PlansPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState('');
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiFetch<PlanRow[]>('/api/plans') });
  const importMut = useMutation({
    mutationFn: async (data: unknown) => apiFetch('/api/plans/import', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  });
  const createMut = useMutation({
    mutationFn: (name: string) => apiFetch<{ id: string }>('/api/plans', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: (r) => nav(`/plan/${r.id}`),
  });
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { importMut.mutate(await readPlanFile(file)); } catch { alert('Invalid JSON file'); }
  }
  return (
    <div className="app">
      <NavBar />
      <h1>Your plans</h1>
      <div className="card">
        <input placeholder="New plan name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button onClick={() => { if (newName.trim()) createMut.mutate(newName.trim()); }}>Create plan</button>
        <input ref={fileRef} type="file" accept="application/json" onChange={onFile} hidden />
        <button className="secondary" style={{ marginTop: 8 }} onClick={() => fileRef.current?.click()}>Import plan (JSON)</button>
        {importMut.isError && <p style={{ color: 'var(--danger)' }}>Import failed (check the file schema).</p>}
      </div>
      {plans.isLoading && <p>Loading…</p>}
      {plans.data?.map((p) => (
        <Link key={p.id} to={`/plan/${p.id}`}>
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{p.name}{p.is_active ? ' • active' : ''}</span>
            {p.is_template && <span style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa' }}>Template</span>}
          </div>
        </Link>
      ))}
      {plans.data?.length === 0 && <p className="card">No plans yet — create one or import.</p>}
    </div>
  );
}
```

- [ ] **Step 6: Run and watch it pass**

Run: `cd web && npx vitest run src/plans/PlansPage.test.tsx` → PASS.

- [ ] **Step 7: Full web suite + typecheck + commit**

Run: `cd web && npx vitest run && npx tsc -b` → all pass, clean. Then:
```bash
git add web && git commit -m "feat(web): expose isAdmin, add manual plan creation and template badges"
```

---

## Task 6: Web — editor template toggle + copy-on-edit fork

**Files:**
- Modify: `web/src/plans/PlanEditorPage.tsx`, `web/src/plans/PlanEditorPage.test.tsx`
- Test: `web/src/plans/PlanEditorPage.test.tsx` (extended)

**Interfaces:**
- Consumes: `apiFetch`, `useAuth().isAdmin`. API: `GET /api/plans/:id` (now returns `is_template`, `owned`), `POST /api/plans/:id/fork` → `{ id, dayIdMap, exerciseIdMap }`, `PUT /api/plans/:id` (admin `is_template`).
- Produces: admin sees a template toggle on owned plans; non-owned templates fork on first edit.

- [ ] **Step 1: Update the existing editor test to provide AuthProvider**

In `web/src/plans/PlanEditorPage.test.tsx`, wrap the render tree in `AuthProvider` (editor now calls `useAuth`). Change the imports + `renderAt` helper:
```tsx
import { AuthProvider } from '../auth/AuthContext';
// ...
function renderAt(id: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/plan/${id}`]}>
          <Routes><Route path="/plan/:planId" element={<PlanEditorPage />} /></Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```
Also, the existing mocked plan tree must now include `is_template`/`owned`. In the `apiFetch` mock's plan-tree branch, return an object that includes `is_template: false, owned: true` alongside the existing fields.

- [ ] **Step 2: Add the failing fork-on-edit test (append to the same file)**

```tsx
it('forks a non-owned template on first edit', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plans/t1') return {
      id: 't1', name: 'Shared', is_active: false, is_template: true, owned: false,
      days: [{ id: 'd1', name: 'Push', order_index: 0, exercises: [] }],
    } as any;
    if (path === '/api/plans/t1/fork' && init?.method === 'POST')
      return { id: 'c1', dayIdMap: { d1: 'cd1' }, exerciseIdMap: {} } as any;
    if (path === '/api/plan-days/cd1/exercises' && init?.method === 'POST') return { id: 'e9' } as any;
    return {} as any;
  });
  renderAt('t1');
  await screen.findByText('Shared');
  await userEvent.click(screen.getByRole('button', { name: /add exercise/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/plans/t1/fork', expect.objectContaining({ method: 'POST' })));
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `cd web && npx vitest run src/plans/PlanEditorPage.test.tsx` → the fork test FAILS (no fork call).

- [ ] **Step 4: Rewrite `web/src/plans/PlanEditorPage.tsx`**

```tsx
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { NavBar } from '../ui/NavBar';

interface Exercise { id: string; exercise_name: string; order_index: number; target_sets: number; target_reps: number; rest_seconds: number | null; starting_weight: number | null; }
interface Day { id: string; name: string; order_index: number; exercises: Exercise[]; }
interface PlanTree { id: string; name: string; is_active: boolean; is_template: boolean; owned: boolean; days: Day[]; }
interface Fork { id: string; dayIdMap: Record<string, string>; exerciseIdMap: Record<string, string>; }

export function PlanEditorPage() {
  const { planId } = useParams();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const key = ['plan', planId];
  const plan = useQuery({ queryKey: key, queryFn: () => apiFetch<PlanTree>(`/api/plans/${planId}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const owned = plan.data?.owned ?? false;

  const fork = () => apiFetch<Fork>(`/api/plans/${planId}/fork`, { method: 'POST' });

  const addDay = useMutation({ mutationFn: () => apiFetch(`/api/plans/${planId}/days`, { method: 'POST', body: JSON.stringify({ name: 'New day' }) }), onSuccess: refresh });
  const addExercise = useMutation({ mutationFn: (dayId: string) => apiFetch(`/api/plan-days/${dayId}/exercises`, { method: 'POST', body: JSON.stringify({ exercise_name: 'New exercise', target_sets: 3, target_reps: 8 }) }), onSuccess: refresh });
  const delExercise = useMutation({ mutationFn: (id: string) => apiFetch(`/api/day-exercises/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const patchExercise = useMutation({ mutationFn: (p: { id: string; body: Partial<Exercise> }) => apiFetch(`/api/day-exercises/${p.id}`, { method: 'PUT', body: JSON.stringify(p.body) }), onSuccess: refresh });
  const setTemplate = useMutation({ mutationFn: (v: boolean) => apiFetch(`/api/plans/${planId}`, { method: 'PUT', body: JSON.stringify({ is_template: v }) }), onSuccess: refresh });

  // Fork-on-edit: for a non-owned template, apply the action to a fresh copy then navigate to it.
  async function onAddDay() {
    if (owned) { addDay.mutate(); return; }
    const f = await fork();
    await apiFetch(`/api/plans/${f.id}/days`, { method: 'POST', body: JSON.stringify({ name: 'New day' }) });
    nav(`/plan/${f.id}`);
  }
  async function onAddExercise(dayId: string) {
    if (owned) { addExercise.mutate(dayId); return; }
    const f = await fork();
    await apiFetch(`/api/plan-days/${f.dayIdMap[dayId]}/exercises`, { method: 'POST', body: JSON.stringify({ exercise_name: 'New exercise', target_sets: 3, target_reps: 8 }) });
    nav(`/plan/${f.id}`);
  }
  async function onDelExercise(exId: string) {
    if (owned) { delExercise.mutate(exId); return; }
    const f = await fork();
    await apiFetch(`/api/day-exercises/${f.exerciseIdMap[exId]}`, { method: 'DELETE' });
    nav(`/plan/${f.id}`);
  }
  async function onPatchExercise(exId: string, body: Partial<Exercise>) {
    if (owned) { patchExercise.mutate({ id: exId, body }); return; }
    const f = await fork();
    await apiFetch(`/api/day-exercises/${f.exerciseIdMap[exId]}`, { method: 'PUT', body: JSON.stringify(body) });
    nav(`/plan/${f.id}`);
  }
  async function onStartSession(dayId: string) {
    if (owned) { nav(`/session/${dayId}`); return; }
    const f = await fork();
    nav(`/session/${f.dayIdMap[dayId]}`);
  }

  async function exportPlan() {
    const data = await apiFetch(`/api/plans/${planId}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${plan.data?.name ?? 'plan'}.json`; a.click();
  }

  if (plan.isLoading) return <div className="app"><NavBar />Loading…</div>;
  if (!plan.data) return <div className="app"><NavBar />Not found</div>;
  return (
    <div className="app">
      <NavBar />
      <h1>{plan.data.name}</h1>
      {!owned && <p className="card" style={{ color: 'var(--muted)' }}>This is a shared template — editing will make your own copy.</p>}
      {isAdmin && owned && (
        <label className="card" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={plan.data.is_template}
            onChange={(e) => setTemplate.mutate(e.target.checked)} />
          Shared template (visible to all users)
        </label>
      )}
      <button className="secondary" onClick={exportPlan}>Export JSON</button>
      {plan.data.days.map((day) => (
        <div className="card" key={day.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{day.name}</strong>
            <button className="big-tap" onClick={() => onStartSession(day.id)}>Start session</button>
          </div>
          {day.exercises.map((ex) => (
            <div key={ex.id} className="row" style={{ alignItems: 'center', marginTop: 8 }}>
              <input defaultValue={ex.exercise_name}
                onBlur={(e) => { if (e.target.value !== ex.exercise_name) onPatchExercise(ex.id, { exercise_name: e.target.value }); }} />
              <input type="number" defaultValue={ex.target_sets} style={{ width: 70 }}
                onBlur={(e) => { if (Number(e.target.value) !== ex.target_sets) onPatchExercise(ex.id, { target_sets: Number(e.target.value) }); }} />
              <input type="number" defaultValue={ex.target_reps} style={{ width: 70 }}
                onBlur={(e) => { if (Number(e.target.value) !== ex.target_reps) onPatchExercise(ex.id, { target_reps: Number(e.target.value) }); }} />
              <Link to={`/progress/${ex.id}`}><button className="secondary">📈</button></Link>
              <button className="secondary" onClick={() => onDelExercise(ex.id)}>✕</button>
            </div>
          ))}
          <button className="secondary" style={{ marginTop: 8 }} onClick={() => onAddExercise(day.id)}>Add exercise</button>
        </div>
      ))}
      <button onClick={onAddDay}>Add day</button>
    </div>
  );
}
```

- [ ] **Step 5: Run and watch it pass**

Run: `cd web && npx vitest run src/plans/PlanEditorPage.test.tsx` → PASS (both the original add-exercise test and the new fork test).

- [ ] **Step 6: Full web suite + typecheck + commit**

Run: `cd web && npx vitest run && npx tsc -b` → all pass, clean. Then:
```bash
git add web && git commit -m "feat(web): add admin template toggle and copy-on-edit fork in the plan editor"
```

---

## Appendix: Spec Coverage Map

- §1 manual plan creation → Task 2 (`POST /api/plans`) + Task 5 (UI).
- §1/§2 admin identity + `/api/me` → Task 1.
- §3 `is_template` column → Task 2.
- §4 access rules (read templates, owner-only writes, admin-only `is_template`) → Task 3.
- §5 fork endpoint + copy-on-edit → Task 4 (endpoint) + Task 6 (client flow).
- §6 fork flow details → Task 6.
- §7 UI (create button, badges, template toggle, preview hint) → Tasks 5 & 6.
- §8 testing → tests in every task.
