# Workout Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver three independent enhancements to the gym-tracker — negative (assisted/Gravitron) weight, per-segment target reps in the plan, and resuming in-progress sessions.

**Architecture:** Three features implemented in one conflict-aware order on a single branch. (A) Negative weight: drop `nonnegative()` on weight validators, add an "Assisted" display branch, relax the suggestion floor, and let weight inputs use the default (minus-capable) keypad. (B) Per-segment reps: change `day_exercises.extra_segments` from an int count to a jsonb array of `{reps}`, rippled through API/editor/logger. (C) Resume: make `POST /api/sessions` resume-or-start, add `GET /api/sessions/active`, derive the session's resume step from logged sets, and surface a Plans banner.

**Tech Stack:** Express 5, pg, Zod, Vitest + Supertest (api); React 18, react-router, @tanstack/react-query, Vitest + React Testing Library (web); Postgres 16.

## Global Constraints

- **Negative weight = assisted:** weight `> 0` added weight, `= 0` bodyweight, `< 0` assisted → display `"Assisted {|w|} kg × {reps} ({effort})"`. Reps stay non-negative; only **weight** validators drop `nonnegative()`.
- **Per-segment reps:** `day_exercises.extra_segments` is a jsonb array `[{ "reps": n }, …]` (reps-only; weight entered at workout). Count = array length. Logged values still store to `set_logs.extra_segments` as `{weight, reps}` (unchanged).
- **Resume:** `POST /api/sessions` returns an existing unfinished session for the `(user, plan_day_id)` with **200**, else creates with **201**. `GET /api/sessions/active` lists the user's unfinished sessions. Resume step = count of that session's logged sets.
- ESM `.js` import extensions in api source. `verbatimModuleSyntax` + `noUnusedLocals`/`noUnusedParameters` ON in web (the build type-checks test files). Conventional Commits. Co-author trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` on every commit.
- API tests: `cd api && npm run test:int -- <file>`. Web tests: `cd web && npm test -- <file>`. Web build/typecheck: `cd web && npm run build`.

---

## File Structure

- `api/src/sessions/routes.ts` — weight validators (Task 1); resume-or-start + `GET /active` (Task 6).
- `api/src/plans/schema.ts` — `starting_weight` negative (Task 1); `extra_segments` array (Task 3).
- `api/src/suggestion/suggest.ts` — remove deload floor (Task 1).
- `db/schema.sql` + `db/migrations/2026-11-06-extra-segment-reps.sql` — `extra_segments` jsonb (Task 3).
- `api/src/plans/repo.ts` — `extra_segments` jsonb store/return (Task 3).
- `api/src/sessions/repo.ts` — `getActiveSessionForDay`, `listActiveSessions` (Task 6).
- `web/src/history/setFormat.ts` — assisted branch (Task 2).
- `web/src/session/ExerciseLogger.tsx` — weight input keypad (Task 2); `extraSegmentTargets` (Task 5).
- `web/src/history/SessionEditPage.tsx` — weight input keypad (Task 2).
- `web/src/plans/PlanEditorPage.tsx` + `PlanViewPage.tsx` — segment editor + count (Task 4).
- `web/src/session/SessionPage.tsx` — pass targets (Task 5); resume logic (Task 7).
- `web/src/plans/InProgressBanner.tsx` (new) + `PlansPage.tsx` — resume banner (Task 8).
- Tests alongside each.

---

## Task 1: Negative weight — API validation + suggestion floor

**Files:**
- Modify: `api/src/sessions/routes.ts`, `api/src/plans/schema.ts`, `api/src/suggestion/suggest.ts`
- Test: `api/__tests__/negative-weight.test.ts` (create), `api/src/suggestion/suggest.test.ts` (add a case)

**Interfaces:**
- Produces: `weight_used`, segment `weight`, and `starting_weight` accept negative numbers. `suggestNextWeight` deload returns `lastWeight - increment` (no 0 floor).

- [ ] **Step 1: Write the failing API test `api/__tests__/negative-weight.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb, buildPlan } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(login: string) {
  await request(app).post('/api/auth/register').send({ login, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ login, password: 'pw123456' })).body.accessToken as string;
}

it('logs a set with a negative (assisted) weight and reads it back', async () => {
  const H = { Authorization: `Bearer ${await auth('grav')}` };
  const token = H.Authorization.slice('Bearer '.length);
  const { dayId, exId } = await buildPlan(app, token, {
    exercises: [{ exercise_name: 'Assisted Pull-up', target_sets: 1, target_reps: 8 }] });
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  const r = await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
    .send({ day_exercise_id: exId, set_number: 1, weight_used: -20, reps_done: 8, effort: 'ok',
      extra_segments: [{ weight: -10, reps: 5 }] });
  expect(r.status).toBe(201);
  const read = await request(app).get(`/api/sessions/${sess.body.id}`).set(H);
  expect(read.body.sets[0].weight_used).toBe(-20);
  expect(read.body.sets[0].extra_segments).toEqual([{ weight: -10, reps: 5 }]);
});

it('accepts a negative starting_weight on import', async () => {
  const H = { Authorization: `Bearer ${await auth('ascererak')}` };
  const planId = (await request(app).post('/api/plans/import').set(H)
    .send({ name: 'P', days: [{ name: 'D', exercises: [
      { exercise_name: 'Assisted Dip', target_sets: 3, target_reps: 8, starting_weight: -30 }] }] })).body.id;
  const tree = await request(app).get(`/api/plans/${planId}`).set(H);
  expect(Number(tree.body.days[0].exercises[0].starting_weight)).toBe(-30);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd api && npm run test:int -- __tests__/negative-weight.test.ts`
Expected: FAIL — the `weight_used: -20` / `starting_weight: -30` requests return 400/422 because of `nonnegative()`.

- [ ] **Step 3: Relax weight validators in `api/src/sessions/routes.ts`**

Replace `setBody`:
```ts
const setBody = z.object({
  day_exercise_id: z.string().uuid(),
  set_number: z.number().int().positive(),
  weight_used: z.number().nonnegative(),
  reps_done: z.number().int().nonnegative(),
  effort: z.enum(['easy', 'ok', 'hard', 'failed']),
  extra_segments: z.array(z.object({ weight: z.number().nonnegative(), reps: z.number().int().nonnegative() })).optional(),
});
```
with:
```ts
const setBody = z.object({
  day_exercise_id: z.string().uuid(),
  set_number: z.number().int().positive(),
  weight_used: z.number(),
  reps_done: z.number().int().nonnegative(),
  effort: z.enum(['easy', 'ok', 'hard', 'failed']),
  extra_segments: z.array(z.object({ weight: z.number(), reps: z.number().int().nonnegative() })).optional(),
});
```
Replace `patchSetBody`:
```ts
const patchSetBody = z.object({
  weight_used: z.number().nonnegative(),
  reps_done: z.number().int().nonnegative(),
  effort: z.enum(['easy', 'ok', 'hard', 'failed']),
  extra_segments: z.array(z.object({ weight: z.number().nonnegative(), reps: z.number().int().nonnegative() })),
});
```
with:
```ts
const patchSetBody = z.object({
  weight_used: z.number(),
  reps_done: z.number().int().nonnegative(),
  effort: z.enum(['easy', 'ok', 'hard', 'failed']),
  extra_segments: z.array(z.object({ weight: z.number(), reps: z.number().int().nonnegative() })),
});
```

- [ ] **Step 4: Allow negative `starting_weight` in `api/src/plans/schema.ts`**

Replace the whole `exerciseImport` object:
```ts
export const exerciseImport = z.object({
  exercise_name: z.string().min(1),
  target_sets: z.number().int().positive(),
  target_reps: z.number().int().positive(),
  rest_seconds: z.number().int().nonnegative().nullable().optional(),
  starting_weight: z.number().nonnegative().nullable().optional(),
  extra_segments: z.number().int().nonnegative().optional(),
});
```
with:
```ts
export const exerciseImport = z.object({
  exercise_name: z.string().min(1),
  target_sets: z.number().int().positive(),
  target_reps: z.number().int().positive(),
  rest_seconds: z.number().int().nonnegative().nullable().optional(),
  starting_weight: z.number().nullable().optional(),
  extra_segments: z.number().int().nonnegative().optional(),
});
```
Replace the whole `exerciseUpsert` object:
```ts
export const exerciseUpsert = z.object({
  exercise_name: z.string().min(1).optional(),
  order_index: z.number().int().nonnegative().optional(),
  target_sets: z.number().int().positive().optional(),
  target_reps: z.number().int().positive().optional(),
  rest_seconds: z.number().int().nonnegative().nullable().optional(),
  starting_weight: z.number().nonnegative().nullable().optional(),
  extra_segments: z.number().int().nonnegative().optional(),
});
```
with:
```ts
export const exerciseUpsert = z.object({
  exercise_name: z.string().min(1).optional(),
  order_index: z.number().int().nonnegative().optional(),
  target_sets: z.number().int().positive().optional(),
  target_reps: z.number().int().positive().optional(),
  rest_seconds: z.number().int().nonnegative().nullable().optional(),
  starting_weight: z.number().nullable().optional(),
  extra_segments: z.number().int().nonnegative().optional(),
});
```

- [ ] **Step 5: Add the failing suggestion test case to `api/src/suggestion/suggest.test.ts`**

Append this test (the file already imports `suggestNextWeight` and defines `base = { targetReps: 8, increment: 2.5, startingWeight: null }`):
```ts
it('assisted (negative) weight deloads further instead of clamping at 0', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 5, effort: 'failed', weight_used: -20 },
  ] });
  expect(r.weight).toBe(-22.5);
});
```

- [ ] **Step 6: Remove the deload floor in `api/src/suggestion/suggest.ts`**

Replace:
```ts
  if (anyFailed || missedReps) {
    return { weight: Math.max(0, lastWeight - increment), reason: `Deload −${increment} kg (missed reps / failed a set)` };
  }
```
with:
```ts
  if (anyFailed || missedReps) {
    return { weight: lastWeight - increment, reason: `Deload −${increment} kg (missed reps / failed a set)` };
  }
```

- [ ] **Step 7: Run both test files and watch them pass**

Run: `cd api && npm run test:int -- __tests__/negative-weight.test.ts src/suggestion/suggest.test.ts`
Expected: PASS (2 new API tests; suggest suite incl. the new case).

- [ ] **Step 8: Commit**

```bash
git add api/src/sessions/routes.ts api/src/plans/schema.ts api/src/suggestion/suggest.ts api/__tests__/negative-weight.test.ts api/src/suggestion/suggest.test.ts
git commit -m "feat(api): allow negative (assisted) weight and uncapped deload

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Negative weight — display + weight-input keypad

**Files:**
- Modify: `web/src/history/setFormat.ts`, `web/src/session/ExerciseLogger.tsx`, `web/src/history/SessionEditPage.tsx`
- Test: `web/src/history/setFormat.test.ts`

**Interfaces:**
- Consumes/Produces: `formatSetLine(weight, reps, effort)` returns `"Assisted {Math.abs(weight)} kg × {reps} ({effort})"` when `weight < 0`. Weight inputs no longer set `inputMode="numeric"` (reps inputs still do).

- [ ] **Step 1: Add the failing assisted-format test to `web/src/history/setFormat.test.ts`**

Append:
```ts
it('formats a negative weight as assisted (Gravitron)', () => {
  expect(formatSetLine(-20, 10, 'ok')).toBe('Assisted 20 kg × 10 (ok)');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npm test -- src/history/setFormat.test.ts`
Expected: FAIL — current `formatSetLine(-20,…)` returns `"-20 kg × 10 (ok)"`.

- [ ] **Step 3: Add the assisted branch in `web/src/history/setFormat.ts`**

Replace:
```ts
export function formatSetLine(weight: number, reps: number, effort: string): string {
  return weight === 0
    ? `Bodyweight × ${reps} reps (${effort})`
    : `${weight} kg × ${reps} (${effort})`;
}
```
with:
```ts
export function formatSetLine(weight: number, reps: number, effort: string): string {
  if (weight < 0) return `Assisted ${Math.abs(weight)} kg × ${reps} (${effort})`;
  return weight === 0
    ? `Bodyweight × ${reps} reps (${effort})`
    : `${weight} kg × ${reps} (${effort})`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd web && npm test -- src/history/setFormat.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Allow the minus key on weight inputs**

In `web/src/session/ExerciseLogger.tsx`, remove `inputMode="numeric"` from the **main weight** input and the **segment weight** input (keep it on the reps inputs).

Replace:
```tsx
          <input type="number" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <span style={cap}>weight (0 = bodyweight)</span>
```
with:
```tsx
          <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <span style={cap}>weight (0 = bodyweight, −assisted)</span>
```
Replace:
```tsx
            <div style={{ flex: 1 }}><input type="number" inputMode="numeric" placeholder="weight" value={s.weight} onChange={(e) => setSegment(i, 'weight', e.target.value)} /></div>
```
with:
```tsx
            <div style={{ flex: 1 }}><input type="number" placeholder="weight" value={s.weight} onChange={(e) => setSegment(i, 'weight', e.target.value)} /></div>
```

In `web/src/history/SessionEditPage.tsx`, remove `inputMode="numeric"` from the **weight** input and the **segment weight** input.

Replace:
```tsx
                    <input type="number" inputMode="numeric" value={d.weight} onChange={(e) => upd(s.id, { weight: e.target.value })} />
```
with:
```tsx
                    <input type="number" value={d.weight} onChange={(e) => upd(s.id, { weight: e.target.value })} />
```
Replace:
```tsx
                    <div style={{ flex: 1 }}><input type="number" inputMode="numeric" placeholder="weight" value={sg.weight} onChange={(e) => updSeg(s.id, i, 'weight', e.target.value)} /></div>
```
with:
```tsx
                    <div style={{ flex: 1 }}><input type="number" placeholder="weight" value={sg.weight} onChange={(e) => updSeg(s.id, i, 'weight', e.target.value)} /></div>
```

- [ ] **Step 6: Verify the web build (test files are type-checked) and run the format test**

Run: `cd web && npm test -- src/history/setFormat.test.ts && npm run build`
Expected: test PASS; build clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/history/setFormat.ts web/src/history/setFormat.test.ts web/src/session/ExerciseLogger.tsx web/src/history/SessionEditPage.tsx
git commit -m "feat(web): show assisted (negative) weight and allow typing a minus

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Per-segment reps — DB + API

**Files:**
- Modify: `db/schema.sql`, `api/src/plans/schema.ts`, `api/src/plans/repo.ts`
- Create: `db/migrations/2026-11-06-extra-segment-reps.sql`
- Test: `api/__tests__/extra-segments-plan.test.ts` (rewrite)

**Interfaces:**
- Produces: `day_exercises.extra_segments` is a jsonb array `[{reps:number}]`. Import/upsert Zod accept `extra_segments: Array<{reps:number}>` (default `[]`). `getPlanTree`/`getDayWithExercises`/`exportPlan` return the array.

- [ ] **Step 1: Rewrite the test `api/__tests__/extra-segments-plan.test.ts`**

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

it('imports, reads, edits, and forks per-segment target reps', async () => {
  const t = await auth('ascererak'); const H = { Authorization: `Bearer ${t}` };
  const planId = (await request(app).post('/api/plans/import').set(H)
    .send({ name: 'P', days: [{ name: 'D', exercises: [
      { exercise_name: 'Bench', target_sets: 3, target_reps: 8, extra_segments: [{ reps: 10 }, { reps: 12 }] }] }] })).body.id;

  const tree = await request(app).get(`/api/plans/${planId}`).set(H);
  const ex = tree.body.days[0].exercises[0];
  expect(ex.extra_segments).toEqual([{ reps: 10 }, { reps: 12 }]);

  expect((await request(app).put(`/api/day-exercises/${ex.id}`).set(H).send({ extra_segments: [{ reps: 15 }] })).status).toBe(200);
  const tree2 = await request(app).get(`/api/plans/${planId}`).set(H);
  expect(tree2.body.days[0].exercises[0].extra_segments).toEqual([{ reps: 15 }]);

  const day = await request(app).get(`/api/plan-days/${tree.body.days[0].id}`).set(H);
  expect(day.body.exercises[0].extra_segments).toEqual([{ reps: 15 }]);

  const fork = await request(app).post(`/api/plans/${planId}/fork`).set(H);
  const copyTree = await request(app).get(`/api/plans/${fork.body.id}`).set(H);
  expect(copyTree.body.days[0].exercises[0].extra_segments).toEqual([{ reps: 15 }]);

  const exp = await request(app).get(`/api/plans/${planId}/export`).set(H);
  expect(exp.body.days[0].exercises[0].extra_segments).toEqual([{ reps: 15 }]);
});

it('defaults extra_segments to [] when omitted on import', async () => {
  const t = await auth('ascererak'); const H = { Authorization: `Bearer ${t}` };
  const planId = (await request(app).post('/api/plans/import').set(H)
    .send({ name: 'P', days: [{ name: 'D', exercises: [{ exercise_name: 'Squat', target_sets: 3, target_reps: 5 }] }] })).body.id;
  const tree = await request(app).get(`/api/plans/${planId}`).set(H);
  expect(tree.body.days[0].exercises[0].extra_segments).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd api && npm run test:int -- __tests__/extra-segments-plan.test.ts`
Expected: FAIL — import rejects the array (Zod expects a number) / stored as int.

- [ ] **Step 3: Change the column type in `db/schema.sql`**

In the `CREATE TABLE IF NOT EXISTS day_exercises (...)`, replace:
```sql
  extra_segments int NOT NULL DEFAULT 0
```
with:
```sql
  extra_segments jsonb NOT NULL DEFAULT '[]'
```

- [ ] **Step 4: Create the production migration `db/migrations/2026-11-06-extra-segment-reps.sql`**

```sql
-- One-time migration: convert day_exercises.extra_segments from an int count to a
-- jsonb array of {reps}. Each old count N becomes N segments defaulting to the
-- exercise's main target_reps; 0/null becomes an empty array.
ALTER TABLE day_exercises
  ALTER COLUMN extra_segments DROP DEFAULT,
  ALTER COLUMN extra_segments TYPE jsonb USING (
    CASE
      WHEN extra_segments IS NULL OR extra_segments <= 0 THEN '[]'::jsonb
      ELSE (SELECT jsonb_agg(jsonb_build_object('reps', target_reps))
            FROM generate_series(1, extra_segments))
    END),
  ALTER COLUMN extra_segments SET DEFAULT '[]'::jsonb;
ALTER TABLE day_exercises ALTER COLUMN extra_segments SET NOT NULL;
```

- [ ] **Step 5: Change the Zod shape in `api/src/plans/schema.ts`**

In `exerciseImport`, replace `extra_segments: z.number().int().nonnegative().optional(),` with:
```ts
  extra_segments: z.array(z.object({ reps: z.number().int().positive() })).optional(),
```
In `exerciseUpsert`, replace `extra_segments: z.number().int().nonnegative().optional(),` with:
```ts
  extra_segments: z.array(z.object({ reps: z.number().int().positive() })).optional(),
```

- [ ] **Step 6: Store/return the array in `api/src/plans/repo.ts`**

In `createPlanFromImport`, replace:
```ts
        await client.query(
          `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight, extra_segments)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [dayId, ex.exercise_name, e, ex.target_sets, ex.target_reps, ex.rest_seconds ?? null, ex.starting_weight ?? null, ex.extra_segments ?? 0]);
```
with:
```ts
        await client.query(
          `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight, extra_segments)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [dayId, ex.exercise_name, e, ex.target_sets, ex.target_reps, ex.rest_seconds ?? null, ex.starting_weight ?? null, JSON.stringify(ex.extra_segments ?? [])]);
```
In `addExercise`, replace:
```ts
    `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight, extra_segments)
     VALUES ($1,$2,(SELECT COALESCE(MAX(order_index)+1,0) FROM day_exercises WHERE plan_day_id=$1),$3,$4,$5,$6,$7) RETURNING id`,
    [dayId, ex.exercise_name, ex.target_sets, ex.target_reps, ex.rest_seconds ?? null, ex.starting_weight ?? null, ex.extra_segments ?? 0]);
```
with:
```ts
    `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight, extra_segments)
     VALUES ($1,$2,(SELECT COALESCE(MAX(order_index)+1,0) FROM day_exercises WHERE plan_day_id=$1),$3,$4,$5,$6,$7::jsonb) RETURNING id`,
    [dayId, ex.exercise_name, ex.target_sets, ex.target_reps, ex.rest_seconds ?? null, ex.starting_weight ?? null, JSON.stringify(ex.extra_segments ?? [])]);
```
Replace `updateExercise`:
```ts
export async function updateExercise(exId: string, fields: Record<string, unknown>) {
  const cols = ['exercise_name','order_index','target_sets','target_reps','rest_seconds','starting_weight','extra_segments'];
  const sets: string[] = []; const vals: unknown[] = [];
  for (const c of cols) if (fields[c] !== undefined) { vals.push(fields[c]); sets.push(`${c}=$${vals.length}`); }
  if (!sets.length) return;
  vals.push(exId);
  await query(`UPDATE day_exercises SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
}
```
with:
```ts
export async function updateExercise(exId: string, fields: Record<string, unknown>) {
  const cols = ['exercise_name','order_index','target_sets','target_reps','rest_seconds','starting_weight','extra_segments'];
  const sets: string[] = []; const vals: unknown[] = [];
  for (const c of cols) if (fields[c] !== undefined) {
    if (c === 'extra_segments') { vals.push(JSON.stringify(fields[c])); sets.push(`${c}=$${vals.length}::jsonb`); }
    else { vals.push(fields[c]); sets.push(`${c}=$${vals.length}`); }
  }
  if (!sets.length) return;
  vals.push(exId);
  await query(`UPDATE day_exercises SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
}
```
In `forkPlan`, replace:
```ts
      const ne = await client.query<{ id: string }>(
        `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight, extra_segments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [dayIdMap[e.plan_day_id], e.exercise_name, e.order_index, e.target_sets, e.target_reps, e.rest_seconds, e.starting_weight, e.extra_segments]);
```
with:
```ts
      const ne = await client.query<{ id: string }>(
        `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight, extra_segments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
        [dayIdMap[e.plan_day_id], e.exercise_name, e.order_index, e.target_sets, e.target_reps, e.rest_seconds, e.starting_weight, JSON.stringify(e.extra_segments)]);
```
(`getPlanTree`, `getDayWithExercises`, and `exportPlan` need no change — pg returns the jsonb column as a JS array, which they pass through.)

- [ ] **Step 7: Run the plan test, then the full api suite**

Run: `cd api && npm run test:int -- __tests__/extra-segments-plan.test.ts` → PASS.
Run: `cd api && npm run test:int` → all PASS (confirms no other api test asserted the old numeric shape).

- [ ] **Step 8: Commit**

```bash
git add db/schema.sql db/migrations/2026-11-06-extra-segment-reps.sql api/src/plans/schema.ts api/src/plans/repo.ts api/__tests__/extra-segments-plan.test.ts
git commit -m "feat(api): store per-segment target reps as jsonb on exercises

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Per-segment reps — plan editor + view

**Files:**
- Modify: `web/src/plans/PlanEditorPage.tsx`, `web/src/plans/PlanViewPage.tsx`
- Test: `web/src/plans/PlanEditorPage.test.tsx`, `web/src/plans/PlanViewPage.test.tsx`

**Interfaces:**
- Consumes: `extra_segments: Array<{reps:number}>` on an exercise.
- Produces: the editor PUTs `{ extra_segments: [{reps}, …] }`; the view shows `+{extra_segments.length} drop/ups`.

- [ ] **Step 1: Update the editor test `web/src/plans/PlanEditorPage.test.tsx`**

Replace the whole test `it('edits an exercise extra_segments count', …)` with:
```tsx
it('edits a drop/up segment reps and PUTs the array', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plans/p1') return {
      id: 'p1', name: 'P', is_active: false, is_template: false, owned: true,
      days: [{ id: 'd1', name: 'Push', order_index: 0, exercises: [
        { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 3, target_reps: 8, rest_seconds: null, starting_weight: 40, extra_segments: [{ reps: 10 }] },
      ] }],
    } as any;
    if (path === '/api/day-exercises/e1' && init?.method === 'PUT') return { id: 'e1' } as any;
    return {} as any;
  });
  renderAt('p1');
  const input = await screen.findByLabelText(/drop\/up 1 reps/i);
  await userEvent.clear(input);
  await userEvent.type(input, '12');
  input.blur();
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/day-exercises/e1',
    expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"extra_segments":[{"reps":12}]') })));
});
```
Then, in the remaining `it('shows days and exercises and can add an exercise', …)` test, change the mock exercise's `extra_segments: 2` to `extra_segments: [{ reps: 8 }, { reps: 8 }]`.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npm test -- src/plans/PlanEditorPage.test.tsx`
Expected: FAIL — no `drop/up 1 reps` control; and the array mock isn't rendered by the old number input.

- [ ] **Step 3: Update the `Exercise` interface and the segment editor in `web/src/plans/PlanEditorPage.tsx`**

Replace the interface line:
```tsx
interface Exercise { id: string; exercise_name: string; order_index: number; target_sets: number; target_reps: number; rest_seconds: number | null; starting_weight: number | null; extra_segments: number; }
```
with:
```tsx
interface Exercise { id: string; exercise_name: string; order_index: number; target_sets: number; target_reps: number; rest_seconds: number | null; starting_weight: number | null; extra_segments: Array<{ reps: number }>; }
```
Replace the drops/ups input block:
```tsx
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: 10, color: 'var(--muted)', width: 64 }}>drops/ups
                <input type="number" defaultValue={ex.extra_segments} title="extra segments"
                  onBlur={(e) => { if (Number(e.target.value) !== ex.extra_segments) onPatchExercise(ex.id, { extra_segments: Number(e.target.value) }); }} />
              </label>
```
with:
```tsx
              <div style={{ display: 'flex', flexDirection: 'column', fontSize: 10, color: 'var(--muted)', width: '100%' }}>drops/ups (target reps)
                <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                  {ex.extra_segments.map((seg, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <input type="number" inputMode="numeric" style={{ width: 56 }} defaultValue={seg.reps} aria-label={`drop/up ${i + 1} reps`}
                        onBlur={(e) => { const reps = Number(e.target.value); if (reps !== seg.reps) onPatchExercise(ex.id, { extra_segments: ex.extra_segments.map((s, j) => (j === i ? { reps } : s)) }); }} />
                      <button className="secondary" style={{ width: 'auto' }} aria-label={`remove drop/up ${i + 1}`}
                        onClick={() => onPatchExercise(ex.id, { extra_segments: ex.extra_segments.filter((_, j) => j !== i) })}>✕</button>
                    </div>
                  ))}
                  <button className="secondary" style={{ width: 'auto' }}
                    onClick={() => onPatchExercise(ex.id, { extra_segments: [...ex.extra_segments, { reps: ex.target_reps }] })}>+ drop/up</button>
                </div>
              </div>
```

- [ ] **Step 4: Update `web/src/plans/PlanViewPage.tsx`**

Replace the interface line:
```tsx
interface Exercise { id: string; exercise_name: string; order_index: number; target_sets: number; target_reps: number; rest_seconds: number | null; starting_weight: number | null; extra_segments: number; }
```
with:
```tsx
interface Exercise { id: string; exercise_name: string; order_index: number; target_sets: number; target_reps: number; rest_seconds: number | null; starting_weight: number | null; extra_segments: Array<{ reps: number }>; }
```
Replace:
```tsx
              <span>{ex.exercise_name} — {ex.target_sets}×{ex.target_reps}{ex.extra_segments > 0 ? ` +${ex.extra_segments} drop/ups` : ''}</span>
```
with:
```tsx
              <span>{ex.exercise_name} — {ex.target_sets}×{ex.target_reps}{ex.extra_segments.length > 0 ? ` +${ex.extra_segments.length} drop/ups` : ''}</span>
```
Then, in `web/src/plans/PlanViewPage.test.tsx`, change the mock exercise's `extra_segments: 2` to `extra_segments: [{ reps: 8 }, { reps: 8 }]`.

- [ ] **Step 5: Run the editor + view tests and the build**

Run: `cd web && npm test -- src/plans/PlanEditorPage.test.tsx src/plans/PlanViewPage.test.tsx && npm run build`
Expected: PASS; build clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/plans/PlanEditorPage.tsx web/src/plans/PlanEditorPage.test.tsx web/src/plans/PlanViewPage.tsx web/src/plans/PlanViewPage.test.tsx
git commit -m "feat(web): edit per-segment target reps in the plan editor

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Per-segment reps — logger pre-fill

**Files:**
- Modify: `web/src/session/ExerciseLogger.tsx`, `web/src/session/SessionPage.tsx`
- Test: `web/src/session/ExerciseLogger.test.tsx` (rewrite), `web/src/session/SessionPage.test.tsx` (mock shape)

**Interfaces:**
- Consumes: exercise `extra_segments: Array<{reps:number}>`.
- Produces: `ExerciseLogger` prop `extraSegmentTargets: Array<{ reps: number }>` — pre-renders one segment row per target with reps pre-filled and weight empty. `SessionPage` passes `extraSegmentTargets={exercise.extra_segments ?? []}`.

- [ ] **Step 1: Rewrite `web/src/session/ExerciseLogger.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseLogger } from './ExerciseLogger';

it('pre-renders target segments with reps pre-filled, and logs them with the set', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Bench" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={60} suggestionReason="x" extraSegmentTargets={[{ reps: 12 }]} onLog={onLog} />);

  expect(screen.getAllByPlaceholderText('weight')).toHaveLength(1);
  expect(screen.getByPlaceholderText('reps')).toHaveValue(12);

  await userEvent.type(screen.getByPlaceholderText('weight'), '40');
  await userEvent.click(screen.getByRole('button', { name: 'easy' }));

  expect(onLog).toHaveBeenCalledWith(60, 8, 'easy', [{ weight: 40, reps: 12 }]);
});

it('failed shows a completed-reps prompt pre-filled with current reps, then logs with that number', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Pull-up" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={0} suggestionReason="x" extraSegmentTargets={[]} onLog={onLog} />);
  await userEvent.click(screen.getByRole('button', { name: 'failed' }));
  expect(onLog).not.toHaveBeenCalled();
  const input = screen.getByPlaceholderText('reps completed');
  expect(input).toHaveValue(8);
  await userEvent.clear(input);
  await userEvent.type(input, '5');
  await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
  expect(onLog).toHaveBeenCalledWith(0, 5, 'failed', []);
});

it('ok logs immediately without a completed-reps prompt', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Bench" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={60} suggestionReason="x" extraSegmentTargets={[]} onLog={onLog} />);
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  expect(onLog).toHaveBeenCalledWith(60, 8, 'ok', []);
  expect(screen.queryByPlaceholderText('reps completed')).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npm test -- src/session/ExerciseLogger.test.tsx`
Expected: FAIL — the `extraSegmentTargets` prop isn't recognized; the segment reps isn't pre-filled.

- [ ] **Step 3: Update `web/src/session/ExerciseLogger.tsx`**

Replace the `Props` interface line:
```tsx
  suggestedWeight: number | null; suggestionReason: string; extraSegments: number;
```
with:
```tsx
  suggestedWeight: number | null; suggestionReason: string; extraSegmentTargets: Array<{ reps: number }>;
```
Replace the segments initializer:
```tsx
  const [segments, setSegments] = useState<Segment[]>(
    () => Array.from({ length: props.extraSegments }, () => ({ weight: '', reps: '' })));
```
with:
```tsx
  const [segments, setSegments] = useState<Segment[]>(
    () => props.extraSegmentTargets.map((t) => ({ weight: '', reps: String(t.reps) })));
```

- [ ] **Step 4: Pass targets from `web/src/session/SessionPage.tsx`**

Replace the `Exercise` interface line:
```tsx
interface Exercise { id: string; exercise_name: string; target_sets: number; target_reps: number; extra_segments: number; }
```
with:
```tsx
interface Exercise { id: string; exercise_name: string; target_sets: number; target_reps: number; extra_segments: Array<{ reps: number }>; }
```
Replace:
```tsx
              extraSegments={exercise.extra_segments ?? 0}
```
with:
```tsx
              extraSegmentTargets={exercise.extra_segments ?? []}
```

- [ ] **Step 5: Fix the `SessionPage.test.tsx` mock exercise shape**

In `web/src/session/SessionPage.test.tsx`, change every mock exercise's `extra_segments: 0` to `extra_segments: []` (there are three occurrences across the day mocks).

- [ ] **Step 6: Run both logger/session tests and the build**

Run: `cd web && npm test -- src/session/ExerciseLogger.test.tsx src/session/SessionPage.test.tsx && npm run build`
Expected: PASS; build clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/session/ExerciseLogger.tsx web/src/session/ExerciseLogger.test.tsx web/src/session/SessionPage.tsx web/src/session/SessionPage.test.tsx
git commit -m "feat(web): pre-fill target reps for drop/up segments in the logger

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: Resume — API (resume-or-start + active list)

**Files:**
- Modify: `api/src/sessions/repo.ts`, `api/src/sessions/routes.ts`
- Test: `api/__tests__/session-resume.test.ts` (create)

**Interfaces:**
- Produces: `getActiveSessionForDay(userId, planDayId): Promise<{ id: string; started_at: string } | null>`; `listActiveSessions(userId): Promise<Array<{ id; plan_day_id; day_name; set_count; started_at }>>`. `POST /api/sessions` → 200 `{id, started_at}` when resuming, 201 when new. `GET /api/sessions/active` → the user's unfinished sessions.

- [ ] **Step 1: Write the failing test `api/__tests__/session-resume.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd api && npm run test:int -- __tests__/session-resume.test.ts`
Expected: FAIL — second POST returns 201 with a new id; `/api/sessions/active` 404s (route missing).

- [ ] **Step 3: Add repo functions in `api/src/sessions/repo.ts`**

Append:
```ts
export async function getActiveSessionForDay(userId: string, planDayId: string) {
  const r = await query<{ id: string; started_at: string }>(
    `SELECT id, started_at FROM workout_sessions
     WHERE user_id=$1 AND plan_day_id=$2 AND finished_at IS NULL
     ORDER BY started_at DESC, id DESC LIMIT 1`, [userId, planDayId]);
  return r.rows[0] ?? null;
}
export async function listActiveSessions(userId: string) {
  const r = await query(
    `SELECT ws.id, ws.plan_day_id, ws.started_at, pd.name AS day_name, COUNT(sl.id)::int AS set_count
     FROM workout_sessions ws
     LEFT JOIN plan_days pd ON pd.id = ws.plan_day_id
     LEFT JOIN set_logs sl ON sl.session_id = ws.id
     WHERE ws.user_id=$1 AND ws.finished_at IS NULL
     GROUP BY ws.id, pd.name
     ORDER BY ws.started_at DESC`, [userId]);
  return r.rows;
}
```

- [ ] **Step 4: Wire the routes in `api/src/sessions/routes.ts`**

Extend the import from `./repo.js` to include the two new functions:
```ts
import { startSession, logSet, finishSession, getSession, userOwnsSession, listUserSessions, deleteSession, updateSet, getActiveSessionForDay, listActiveSessions } from './repo.js';
```
Replace the `POST '/'` handler:
```ts
sessionsRouter.post('/', async (req, res) => {
  const p = startBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  if (!(await userOwnsPlanDay(req.userId!, p.data.plan_day_id))) { res.status(404).json({ error: 'not found' }); return; }
  res.status(201).json(await startSession(req.userId!, p.data.plan_day_id));
});
```
with:
```ts
sessionsRouter.post('/', async (req, res) => {
  const p = startBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  if (!(await userOwnsPlanDay(req.userId!, p.data.plan_day_id))) { res.status(404).json({ error: 'not found' }); return; }
  const existing = await getActiveSessionForDay(req.userId!, p.data.plan_day_id);
  if (existing) { res.status(200).json(existing); return; }
  res.status(201).json(await startSession(req.userId!, p.data.plan_day_id));
});
```
Immediately after the `GET '/'` handler (and **before** `GET '/:id'`), add:
```ts
sessionsRouter.get('/active', async (req, res) => {
  res.json(await listActiveSessions(req.userId!));
});
```

- [ ] **Step 5: Run the resume test, then the full api suite**

Run: `cd api && npm run test:int -- __tests__/session-resume.test.ts` → PASS.
Run: `cd api && npm run test:int` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/sessions/repo.ts api/src/sessions/routes.ts api/__tests__/session-resume.test.ts
git commit -m "feat(api): resume-or-start sessions and list in-progress sessions

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: Resume — SessionPage resumes at the right step

**Files:**
- Modify: `web/src/session/SessionPage.tsx`
- Test: `web/src/session/SessionPage.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `POST /api/sessions` (resume-or-start), `GET /api/sessions/:id` (logged sets).
- Produces: on mount, derives the starting step = number of logged sets (once), shows the finish screen if complete, and pre-fills the current exercise's weight from its last logged set this session.

- [ ] **Step 1: Rewrite `web/src/session/SessionPage.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SessionPage } from './SessionPage';
import { AuthProvider } from '../auth/AuthContext';
import * as client from '../api/client';

function renderAt(dayId: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/session/${dayId}`]}>
          <Routes><Route path="/session/:dayId" element={<SessionPage />} /></Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

it('starts a session and logs a set with the chosen effort', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plan-days/d1') return { id: 'd1', name: 'Push', exercises: [
      { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 1, target_reps: 8, rest_seconds: null, starting_weight: 40, extra_segments: [] },
    ] } as any;
    if (path === '/api/sessions' && init?.method === 'POST') return { id: 's1', started_at: 'now' } as any;
    if (path === '/api/sessions/s1' && (!init || !init.method)) return { sets: [] } as any;
    if (path === '/api/exercises/e1/suggestion') return { weight: 40, reason: 'Starting weight 40 kg' } as any;
    if (path === '/api/sessions/s1/sets' && init?.method === 'POST') return { id: 'set1' } as any;
    if (path === '/api/sessions/s1/finish') return { id: 's1', finished_at: 'now' } as any;
    return {} as any;
  });
  renderAt('d1');
  expect(await screen.findByText('Bench')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'easy' }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/sessions/s1/sets',
    expect.objectContaining({ method: 'POST', body: expect.stringContaining('"effort":"easy"') })));
});

it('runs a superset day round-major: one set of each exercise per round', async () => {
  const setLogs: Array<{ day_exercise_id: string; set_number: number }> = [];
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plan-days/sd') return { id: 'sd', name: 'Circuit', is_superset: true, exercises: [
      { id: 'e1', exercise_name: 'A', order_index: 0, target_sets: 2, target_reps: 8, rest_seconds: null, starting_weight: 20, extra_segments: [] },
      { id: 'e2', exercise_name: 'B', order_index: 1, target_sets: 2, target_reps: 10, rest_seconds: null, starting_weight: 30, extra_segments: [] },
    ] } as any;
    if (path === '/api/sessions' && init?.method === 'POST') return { id: 's1' } as any;
    if (path === '/api/sessions/s1' && (!init || !init.method)) return { sets: [] } as any;
    if (path === '/api/exercises/e1/suggestion') return { weight: 20, reason: 'x' } as any;
    if (path === '/api/exercises/e2/suggestion') return { weight: 30, reason: 'y' } as any;
    if (path === '/api/sessions/s1/sets' && init?.method === 'POST') { setLogs.push(JSON.parse(init.body as string)); return { id: 'set' } as any; }
    return {} as any;
  });
  renderAt('sd');
  await screen.findByRole('heading', { name: 'A' });
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  await screen.findByRole('heading', { name: 'B' });
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  await screen.findByRole('heading', { name: 'A' });
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  await screen.findByRole('heading', { name: 'B' });
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));

  await waitFor(() => expect(setLogs).toHaveLength(4));
  expect(setLogs.map((l) => [l.day_exercise_id, l.set_number])).toEqual([
    ['e1', 1], ['e2', 1], ['e1', 2], ['e2', 2],
  ]);
});

it('keeps the entered weight/reps for the next set of the same exercise', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plan-days/d1') return { id: 'd1', name: 'Push', exercises: [
      { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 2, target_reps: 8, rest_seconds: null, starting_weight: 40, extra_segments: [] },
    ] } as any;
    if (path === '/api/sessions' && init?.method === 'POST') return { id: 's1', started_at: 'now' } as any;
    if (path === '/api/sessions/s1' && (!init || !init.method)) return { sets: [] } as any;
    if (path === '/api/exercises/e1/suggestion') return { weight: 60, reason: 'x' } as any;
    if (path === '/api/sessions/s1/sets' && init?.method === 'POST') return { id: 'set1' } as any;
    return {} as any;
  });
  renderAt('d1');
  await screen.findByText('Bench');
  const inputs = screen.getAllByRole('spinbutton');
  await userEvent.clear(inputs[0]);
  await userEvent.type(inputs[0], '55');
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  await waitFor(() => expect(screen.getByText(/set 2\/2/i)).toBeInTheDocument());
  expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(55);
});

it('resumes at the next unlogged set with the weight pre-filled from this session', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plan-days/d1') return { id: 'd1', name: 'Push', exercises: [
      { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 3, target_reps: 8, rest_seconds: null, starting_weight: 40, extra_segments: [] },
    ] } as any;
    if (path === '/api/sessions' && init?.method === 'POST') return { id: 's1', started_at: 'now' } as any;
    if (path === '/api/sessions/s1' && (!init || !init.method)) return { sets: [
      { day_exercise_id: 'e1', set_number: 1, weight_used: 52 },
      { day_exercise_id: 'e1', set_number: 2, weight_used: 52 },
    ] } as any;
    if (path === '/api/exercises/e1/suggestion') return { weight: 60, reason: 'x' } as any;
    return {} as any;
  });
  renderAt('d1');
  // resumes on set 3 of 3, not set 1
  expect(await screen.findByText(/set 3\/3/i)).toBeInTheDocument();
  // weight pre-filled from the last logged set this session (52), not the suggestion (60)
  expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(52);
});
```

- [ ] **Step 2: Run it and watch the resume test fail**

Run: `cd web && npm test -- src/session/SessionPage.test.tsx`
Expected: FAIL — the resume test shows "Set 1/3" and weight 60 (no resume logic yet). Other tests may also fail because the session-detail query isn't consumed yet.

- [ ] **Step 3: Add the session-detail query + resume state in `web/src/session/SessionPage.tsx`**

Immediately after the existing start-session effect (the block ending with `}, [dayId, sessionId]);`), add:
```tsx
  const sessionDetail = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => apiFetch<{ sets: Array<{ day_exercise_id: string; set_number: number; weight_used: number }> }>(`/api/sessions/${sessionId}`),
    enabled: !!sessionId,
  });
  const resumedRef = useRef(false);
```

- [ ] **Step 4: Derive the resume step and prefill weight**

Immediately after the line `const setNumber = current?.setNumber ?? 1;`, add:
```tsx
  useEffect(() => {
    if (resumedRef.current || !day.data || !sessionDetail.data) return;
    resumedRef.current = true;
    const logged = sessionDetail.data.sets.length;
    if (logged >= steps.length) setDone(true);
    else setStep(logged);
  }, [day.data, sessionDetail.data, steps.length]);

  const resumeWeight = useMemo(() => {
    if (!exercise || !sessionDetail.data) return null;
    const mine = sessionDetail.data.sets.filter((s) => s.day_exercise_id === exercise.id);
    if (!mine.length) return null;
    return mine.reduce((a, b) => (b.set_number > a.set_number ? b : a)).weight_used;
  }, [exercise, sessionDetail.data]);
```

- [ ] **Step 5: Gate render until resume info is loaded, and use the prefill**

After the line `if (!day.data) return <div className="app"><NavBar />Day not found</div>;`, add:
```tsx
  if (!sessionId || !sessionDetail.isSuccess) return <div className="app"><NavBar />Loading…</div>;
```
Replace the ExerciseLogger prop:
```tsx
              suggestedWeight={suggestion.data?.weight ?? null}
```
with:
```tsx
              suggestedWeight={resumeWeight ?? suggestion.data?.weight ?? null}
```

- [ ] **Step 6: Run the session tests and the build**

Run: `cd web && npm test -- src/session/SessionPage.test.tsx && npm run build`
Expected: PASS (incl. the resume test); build clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/session/SessionPage.tsx web/src/session/SessionPage.test.tsx
git commit -m "feat(web): resume a session at the next unlogged set with weight prefilled

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 8: Resume — in-progress banner on Plans

**Files:**
- Create: `web/src/plans/InProgressBanner.tsx`
- Modify: `web/src/plans/PlansPage.tsx`
- Test: `web/src/plans/InProgressBanner.test.tsx` (create), `web/src/plans/PlansPage.test.tsx` (mock active)

**Interfaces:**
- Consumes: `GET /api/sessions/active`, `DELETE /api/sessions/:id`.
- Produces: `InProgressBanner` exported by name; renders a Resume link to `/session/${plan_day_id}` and a Discard button per unfinished session; renders nothing when none.

- [ ] **Step 1: Write the failing test `web/src/plans/InProgressBanner.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { InProgressBanner } from './InProgressBanner';
import * as client from '../api/client';

function renderBanner() {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><MemoryRouter><InProgressBanner /></MemoryRouter></QueryClientProvider>);
}

it('shows a resume link and discards an in-progress session', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/sessions/active' && (!init || !init.method)) return [
      { id: 's1', plan_day_id: 'd1', day_name: 'Push', set_count: 2, started_at: 'now' },
    ] as any;
    return {} as any;
  });
  renderBanner();
  const link = await screen.findByRole('link', { name: /resume/i });
  expect(link).toHaveAttribute('href', '/session/d1');
  await userEvent.click(screen.getByRole('button', { name: /discard/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/sessions/s1', expect.objectContaining({ method: 'DELETE' })));
});

it('renders nothing when there are no in-progress sessions', async () => {
  vi.spyOn(client, 'apiFetch').mockResolvedValue([] as any);
  const { container } = renderBanner();
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npm test -- src/plans/InProgressBanner.test.tsx`
Expected: FAIL — module `./InProgressBanner` cannot be resolved.

- [ ] **Step 3: Create `web/src/plans/InProgressBanner.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

interface ActiveSession { id: string; plan_day_id: string; day_name: string | null; set_count: number; started_at: string; }

export function InProgressBanner() {
  const qc = useQueryClient();
  const active = useQuery({ queryKey: ['sessions', 'active'], queryFn: () => apiFetch<ActiveSession[]>('/api/sessions/active') });
  const discard = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions', 'active'] }),
  });
  if (!active.data || active.data.length === 0) return null;
  return (
    <>
      {active.data.map((s) => (
        <div className="card" key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: '3px solid var(--accent)' }}>
          <div>
            <div>⏳ In progress: {s.day_name ?? 'Workout'}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.set_count} sets logged</div>
          </div>
          <div className="row" style={{ width: 'auto' }}>
            <Link to={`/session/${s.plan_day_id}`}><button className="big-tap" style={{ width: 'auto' }}>Resume</button></Link>
            <button className="secondary" style={{ width: 'auto' }}
              onClick={() => { if (window.confirm('Discard this in-progress workout?')) discard.mutate(s.id); }}>Discard</button>
          </div>
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Render the banner in `web/src/plans/PlansPage.tsx`**

Add the import next to the other imports:
```tsx
import { InProgressBanner } from './InProgressBanner';
```
Replace:
```tsx
      <NavBar />
      <h1>Your plans</h1>
```
with:
```tsx
      <NavBar />
      <InProgressBanner />
      <h1>Your plans</h1>
```

- [ ] **Step 5: Keep `PlansPage.test.tsx` green by mocking the active list**

In `web/src/plans/PlansPage.test.tsx`, add this as the first line inside the `spy.mockImplementation(async (path: string) => {` body (before the `/api/plans` branch):
```tsx
    if (path === '/api/sessions/active') return [] as any;
```

- [ ] **Step 6: Run the banner + plans tests and the build**

Run: `cd web && npm test -- src/plans/InProgressBanner.test.tsx src/plans/PlansPage.test.tsx && npm run build`
Expected: PASS; build clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/plans/InProgressBanner.tsx web/src/plans/InProgressBanner.test.tsx web/src/plans/PlansPage.tsx web/src/plans/PlansPage.test.tsx
git commit -m "feat(web): show in-progress sessions on Plans with resume and discard

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 9: Full regression + typecheck

**Files:** none (verification only).

- [ ] **Step 1: Full web suite + build**

Run: `cd web && npm test && npm run build`
Expected: all tests PASS; `tsc -b && vite build` clean.

- [ ] **Step 2: Full api integration suite**

Run: `cd api && npm run test:int`
Expected: all PASS (incl. `negative-weight`, `extra-segments-plan`, `session-resume`).

- [ ] **Step 3: Lint the web changes**

Run: `cd web && npm run lint`
Expected: no new lint errors in changed files (pre-existing warnings in `AuthContext.tsx`/`SessionPage.tsx` are acceptable, but verify the `SessionPage.tsx` warning set did not grow with new hook issues).

- [ ] **Step 4: Commit (only if lint/build auto-fixed anything; otherwise skip)**

```bash
git add -A
git commit -m "chore: regression fixups for workout enhancements

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review Notes

- **Negative weight spec:** §3 validation (Task 1), §4 display (Task 2), §5 input keypad (Task 2), §6 suggestion floor (Task 1). ✓
- **Per-segment reps spec:** §2 schema+migration (Task 3), §3 API (Task 3), §4 editor (Task 4), §5 logger (Task 5), §6 view (Task 4). ✓
- **Resume spec:** §2 resume-or-start (Task 6), §3 resume step/prefill (Task 7), §4 active list + banner (Tasks 6+8). ✓
- **Shared-file ordering:** `setFormat` (Task 2 only); `ExerciseLogger` weight inputs (Task 2) then segments prop (Task 5) — different lines; `SessionPage` segments prop (Task 5) then resume (Task 7); `schema.ts` starting_weight (Task 1, whole-object) then extra_segments (Task 3, single line within the Task-1 output). Each later edit is written against the earlier task's output.
- **Type consistency:** `extra_segments: Array<{reps:number}>` used in api Zod/repo (Task 3), editor/view (Task 4), SessionPage/ExerciseLogger `extraSegmentTargets` (Task 5); `getActiveSessionForDay`/`listActiveSessions` names match between repo and routes (Task 6) and the banner's `/api/sessions/active` shape (Task 8).
