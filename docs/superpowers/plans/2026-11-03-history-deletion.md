# Session History + Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a History view of finished sessions (with per-session detail), session deletion (owner), and plan deletion (owner or admin) that preserves workout history via soft-deleting plans.

**Architecture:** One additive column (`plans.deleted_at`). Deleting a plan sets that timestamp and all plan reads filter it out, so the plan's days/exercises/sessions/sets remain for History. Session deletion is a hard delete (cascades its sets). New session-list and session-delete endpoints plus an enriched session detail feed new web History/Detail pages.

**Tech Stack:** Existing — Express 5, pg, Zod, Vitest + Supertest (api); React 18, react-router, @tanstack/react-query, Vitest + RTL (web). Postgres 16.

## Global Constraints

- Keep-history = **soft-delete plans**: `plans.deleted_at timestamptz NULL`; "delete plan" sets it; plan reads filter `deleted_at IS NULL`.
- Session delete is a **hard delete** (owner-only). Plan delete is **soft** (owner or admin).
- Permissions: session history/detail/delete are the requester's own sessions only; plan delete allowed if `userOwnsPlan` OR `isAdminUser`, else 404.
- History shows **finished** sessions only (`finished_at IS NOT NULL`), newest first.
- Suggestion/trend endpoints and modules are unchanged.
- ESM `.js` import extensions. Conventional Commits. Build only what each task specifies.
- Dev/test Postgres at `postgres://gym:gym@localhost:5432/gym_test`; api tests: `cd api && npm run test:int -- <file>`. Web tests: `cd web && npx vitest run <file>`.

---

## File Structure

- `db/schema.sql` — add `deleted_at` to `plans`.
- `api/src/plans/repo.ts` — `softDeletePlan`; add `deleted_at IS NULL` to `listVisiblePlans`, `getPlanTree`, `forkPlan` source.
- `api/src/plans/routes.ts` — `DELETE /api/plans/:id`.
- `api/src/sessions/repo.ts` — `listUserSessions`, `deleteSession`, enrich `getSession`.
- `api/src/sessions/routes.ts` — `GET /api/sessions`, `DELETE /api/sessions/:id`.
- `web/src/ui/NavBar.tsx` — History link.
- `web/src/history/HistoryPage.tsx`, `web/src/history/SessionDetailPage.tsx` (new); `web/src/App.tsx` routes.
- `web/src/plans/PlanEditorPage.tsx` — Delete plan button.

---

## Task 1: Soft-delete plans + `DELETE /api/plans/:id`

**Files:**
- Modify: `db/schema.sql`, `api/src/plans/repo.ts`, `api/src/plans/routes.ts`
- Test: `api/__tests__/plan-delete.test.ts`

**Interfaces:**
- Consumes: `userOwnsPlan`, `isAdminUser`, `requireAuth`.
- Produces: `softDeletePlan(planId): Promise<boolean>` (true if a row was updated). `DELETE /api/plans/:id` → 204 (owner or admin), else 404. `listVisiblePlans`/`getPlanTree`/`forkPlan` exclude `deleted_at IS NOT NULL` plans.

- [ ] **Step 1: Add the column in `db/schema.sql`**

In `CREATE TABLE ... plans (...)`, add after `is_template boolean NOT NULL DEFAULT false`:
```sql
  is_template boolean NOT NULL DEFAULT false,
  deleted_at timestamptz
```

- [ ] **Step 2: Write the failing test `api/__tests__/plan-delete.test.ts`**

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
    .send({ name: 'P', days: [{ name: 'D', exercises: [{ exercise_name: 'Bench', target_sets: 1, target_reps: 8 }] }] })).body.id;
}

it('owner can delete a plan; it disappears from the list but its session history remains', async () => {
  const t = await auth('bob'); const H = { Authorization: `Bearer ${t}` };
  const planId = await makePlan(H);
  const tree = await request(app).get(`/api/plans/${planId}`).set(H);
  const dayId = tree.body.days[0].id; const exId = tree.body.days[0].exercises[0].id;
  // log + finish a session so there is history
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
    .send({ day_exercise_id: exId, set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok' });
  await request(app).post(`/api/sessions/${sess.body.id}/finish`).set(H);

  expect((await request(app).delete(`/api/plans/${planId}`).set(H)).status).toBe(204);
  // gone from the list
  const list = await request(app).get('/api/plans').set(H);
  expect(list.body.find((p: any) => p.id === planId)).toBeUndefined();
  // tree now 404
  expect((await request(app).get(`/api/plans/${planId}`).set(H)).status).toBe(404);
  // history preserved: the finished session still reads
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
```

- [ ] **Step 3: Run and watch it fail**

Run: `cd api && npm run test:int -- __tests__/plan-delete.test.ts` → FAIL (DELETE route 404 for all).

- [ ] **Step 4: Repo changes in `api/src/plans/repo.ts`**

Add `softDeletePlan`:
```ts
export async function softDeletePlan(planId: string): Promise<boolean> {
  const r = await query('UPDATE plans SET deleted_at=now() WHERE id=$1 RETURNING id', [planId]);
  return r.rowCount! > 0;
}
```
In `listVisiblePlans`, add the filter:
```ts
    `SELECT id, name, is_active, is_template, (user_id = $1) AS owned
     FROM plans WHERE (user_id = $1 OR is_template = true) AND deleted_at IS NULL ORDER BY is_template, name`, [userId]);
```
In `getPlanTree`, add the filter to the plan lookup:
```ts
    `SELECT id, name, is_active, is_template, (user_id = $2) AS owned
     FROM plans WHERE id=$1 AND (user_id=$2 OR is_template=true) AND deleted_at IS NULL`, [planId, userId]);
```
In `forkPlan`, add the filter to the source select:
```ts
    const src = await client.query<{ name: string }>(
      'SELECT name FROM plans WHERE id=$1 AND (user_id=$2 OR is_template=true) AND deleted_at IS NULL', [planId, userId]);
```

- [ ] **Step 5: Route in `api/src/plans/routes.ts`**

Import `softDeletePlan` (and `isAdminUser` is already imported). Add to `plansRouter`:
```ts
plansRouter.delete('/:id', async (req, res) => {
  const owns = await userOwnsPlan(req.userId!, req.params.id);
  if (!owns && !(await isAdminUser(req.userId!))) { res.status(404).json({ error: 'not found' }); return; }
  const ok = await softDeletePlan(req.params.id);
  if (!ok) { res.status(404).json({ error: 'not found' }); return; }
  res.status(204).end();
});
```

- [ ] **Step 6: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/plan-delete.test.ts` → PASS (2 tests).

- [ ] **Step 7: Full api suite + commit**

Run: `cd api && npm run test:int` → all pass. Then:
```bash
git add api db/schema.sql && git commit -m "feat: soft-delete plans (owner or admin) preserving history"
```

---

## Task 2: Session history list, delete, and enriched detail

**Files:**
- Modify: `api/src/sessions/repo.ts`, `api/src/sessions/routes.ts`
- Test: `api/__tests__/session-history.test.ts`

**Interfaces:**
- Consumes: `requireAuth`, `userOwnsSession`.
- Produces:
  - `listUserSessions(userId): Promise<Array<{ id, finished_at, plan_day_id, day_name, set_count:number }>>` (finished only, newest first).
  - `deleteSession(sessionId): Promise<void>`.
  - enriched `getSession` → `{ id, plan_day_id, started_at, finished_at, day_name, sets: Array<{ ..., exercise_name }> }`.
  - `GET /api/sessions` → 200 list. `DELETE /api/sessions/:id` → 204 owner / 404 otherwise.

- [ ] **Step 1: Write the failing test `api/__tests__/session-history.test.ts`**

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
  // an unfinished session must be excluded
  await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  // another user's session must be excluded
  const other = await auth('carol'); const OH = { Authorization: `Bearer ${other}` };
  const o = await seed(OH); await runSession(OH, o.dayId, o.exId);

  const list = await request(app).get('/api/sessions').set(H);
  expect(list.status).toBe(200);
  expect(list.body.map((r: any) => r.id)).toEqual([s2, s1]); // newest first, only finished, only mine
  expect(list.body[0]).toMatchObject({ day_name: 'Push', set_count: 1 });
});

it('detail includes day_name and exercise_name per set', async () => {
  const t = await auth('d'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await seed(H);
  const sid = await runSession(H, dayId, exId);
  const detail = await request(app).get(`/api/sessions/${sid}`).set(H);
  expect(detail.body.day_name).toBe('Push');
  expect(detail.body.sets[0].exercise_name).toBe('Bench');
});

it('owner deletes a session; non-owner gets 404', async () => {
  const t = await auth('e'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await seed(H);
  const sid = await runSession(H, dayId, exId);
  const intruder = await auth('i');
  expect((await request(app).delete(`/api/sessions/${sid}`).set({ Authorization: `Bearer ${intruder}` })).status).toBe(404);
  expect((await request(app).delete(`/api/sessions/${sid}`).set(H)).status).toBe(204);
  const list = await request(app).get('/api/sessions').set(H);
  expect(list.body).toHaveLength(0);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd api && npm run test:int -- __tests__/session-history.test.ts` → FAIL (GET /api/sessions 404 / no exercise_name).

- [ ] **Step 3: Repo changes in `api/src/sessions/repo.ts`**

Add list + delete:
```ts
export async function listUserSessions(userId: string) {
  const r = await query(
    `SELECT ws.id, ws.finished_at, ws.plan_day_id, pd.name AS day_name, COUNT(sl.id)::int AS set_count
     FROM workout_sessions ws
     LEFT JOIN plan_days pd ON pd.id = ws.plan_day_id
     LEFT JOIN set_logs sl ON sl.session_id = ws.id
     WHERE ws.user_id=$1 AND ws.finished_at IS NOT NULL
     GROUP BY ws.id, pd.name
     ORDER BY ws.finished_at DESC`, [userId]);
  return r.rows;
}
export async function deleteSession(sessionId: string): Promise<void> {
  await query('DELETE FROM workout_sessions WHERE id=$1', [sessionId]);
}
```
Enrich `getSession` (replace the two queries):
```ts
export async function getSession(sessionId: string) {
  const s = await query<any>(
    `SELECT ws.id, ws.plan_day_id, ws.started_at, ws.finished_at, pd.name AS day_name
     FROM workout_sessions ws LEFT JOIN plan_days pd ON pd.id = ws.plan_day_id
     WHERE ws.id=$1`, [sessionId]);
  if (!s.rows[0]) return null;
  const sets = await query(
    `SELECT sl.id, sl.day_exercise_id, de.exercise_name, sl.set_number, sl.weight_used::float8 AS weight_used,
            sl.reps_done, sl.effort, sl.extra_segments, sl.created_at
     FROM set_logs sl LEFT JOIN day_exercises de ON de.id = sl.day_exercise_id
     WHERE sl.session_id=$1 ORDER BY sl.set_number`, [sessionId]);
  return { ...s.rows[0], sets: sets.rows };
}
```

- [ ] **Step 4: Routes in `api/src/sessions/routes.ts`**

Import `listUserSessions, deleteSession` (alongside existing repo imports). Add:
```ts
sessionsRouter.get('/', async (req, res) => {
  res.json(await listUserSessions(req.userId!));
});

sessionsRouter.delete('/:id', async (req, res) => {
  if (!(await userOwnsSession(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  await deleteSession(req.params.id);
  res.status(204).end();
});
```
(Existing `POST /`, `GET /:id`, `POST /:id/sets`, `POST /:id/finish` stay; Express routes by method+path so `GET /` and `DELETE /:id` coexist.)

- [ ] **Step 5: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/session-history.test.ts` → PASS (3 tests).

- [ ] **Step 6: Full api suite + commit**

Run: `cd api && npm run test:int` → all pass. Then:
```bash
git add api && git commit -m "feat: add session history list, delete, and enriched detail"
```

---

## Task 3: Web — History page + detail + nav link

**Files:**
- Modify: `web/src/ui/NavBar.tsx`, `web/src/App.tsx`
- Create: `web/src/history/HistoryPage.tsx`, `web/src/history/SessionDetailPage.tsx`
- Test: `web/src/history/HistoryPage.test.tsx`, `web/src/history/SessionDetailPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`. API: `GET /api/sessions`, `GET /api/sessions/:id`, `DELETE /api/sessions/:id`.
- Produces: `HistoryPage` (route `/history`), `SessionDetailPage` (route `/history/:id`), a "History" nav link.

- [ ] **Step 1: Add the History link in `web/src/ui/NavBar.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
export function NavBar() {
  const { logout } = useAuth();
  return (
    <div className="row" style={{ marginBottom: 12 }}>
      <Link to="/"><button className="secondary">Plans</button></Link>
      <Link to="/history"><button className="secondary">History</button></Link>
      <button className="secondary" onClick={logout}>Log out</button>
    </div>
  );
}
```

- [ ] **Step 2: Write the failing test `web/src/history/HistoryPage.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { HistoryPage } from './HistoryPage';
import * as client from '../api/client';

function renderPage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}><AuthProvider><MemoryRouter><HistoryPage /></MemoryRouter></AuthProvider></QueryClientProvider>
  );
}

it('lists finished sessions and deletes one', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/sessions' && (!init || init.method === undefined)) return [
      { id: 's1', finished_at: '2026-11-01T10:00:00Z', plan_day_id: 'd1', day_name: 'Push', set_count: 3 },
    ] as any;
    if (path === '/api/sessions/s1' && init?.method === 'DELETE') return undefined as any;
    return {} as any;
  });
  renderPage();
  expect(await screen.findByText('Push')).toBeInTheDocument();
  expect(screen.getByText(/3 sets/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /delete/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/sessions/s1', expect.objectContaining({ method: 'DELETE' })));
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `cd web && npx vitest run src/history/HistoryPage.test.tsx` → FAIL (`./HistoryPage` not found).

- [ ] **Step 4: Write `web/src/history/HistoryPage.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';

interface SessionRow { id: string; finished_at: string; plan_day_id: string; day_name: string | null; set_count: number; }
export function HistoryPage() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => apiFetch<SessionRow[]>('/api/sessions') });
  const del = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <div className="app">
      <NavBar />
      <h1>History</h1>
      {sessions.isLoading && <p>Loading…</p>}
      {sessions.data?.map((s) => (
        <div className="card" key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link to={`/history/${s.id}`} style={{ flex: 1 }}>
            <div>{s.day_name ?? 'Workout'}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(s.finished_at).toLocaleString()} • {s.set_count} sets</div>
          </Link>
          <button className="secondary" style={{ width: 'auto' }}
            onClick={() => { if (window.confirm('Delete this session?')) del.mutate(s.id); }}>Delete</button>
        </div>
      ))}
      {sessions.data?.length === 0 && <p className="card">No finished sessions yet.</p>}
    </div>
  );
}
```

- [ ] **Step 5: Run and watch it pass**

Run: `cd web && npx vitest run src/history/HistoryPage.test.tsx` → PASS.

- [ ] **Step 6: Write the failing test `web/src/history/SessionDetailPage.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { SessionDetailPage } from './SessionDetailPage';
import * as client from '../api/client';

it('renders sets grouped by exercise', async () => {
  vi.spyOn(client, 'apiFetch').mockImplementation(async (path: string) => {
    if (path === '/api/sessions/s1') return {
      id: 's1', day_name: 'Push', finished_at: '2026-11-01T10:00:00Z',
      sets: [{ id: 'x', exercise_name: 'Bench', set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok', extra_segments: [{ weight: 20, reps: 12 }] }],
    } as any;
    return {} as any;
  });
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}><AuthProvider>
      <MemoryRouter initialEntries={['/history/s1']}>
        <Routes><Route path="/history/:id" element={<SessionDetailPage />} /></Routes>
      </MemoryRouter>
    </AuthProvider></QueryClientProvider>
  );
  expect(await screen.findByText('Bench')).toBeInTheDocument();
  expect(screen.getByText(/40 kg × 8 \(ok\)/i)).toBeInTheDocument();
});
```

- [ ] **Step 7: Write `web/src/history/SessionDetailPage.tsx`**

```tsx
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';

interface Segment { weight: number; reps: number; }
interface SetLog { id: string; exercise_name: string | null; set_number: number; weight_used: number; reps_done: number; effort: string; extra_segments: Segment[]; }
interface SessionDetail { id: string; day_name: string | null; finished_at: string | null; sets: SetLog[]; }

export function SessionDetailPage() {
  const { id } = useParams();
  const session = useQuery({ queryKey: ['session', id], queryFn: () => apiFetch<SessionDetail>(`/api/sessions/${id}`) });
  if (session.isLoading) return <div className="app"><NavBar />Loading…</div>;
  if (!session.data) return <div className="app"><NavBar />Not found</div>;
  const byExercise = new Map<string, SetLog[]>();
  for (const s of session.data.sets) {
    const name = s.exercise_name ?? 'Exercise';
    if (!byExercise.has(name)) byExercise.set(name, []);
    byExercise.get(name)!.push(s);
  }
  return (
    <div className="app">
      <NavBar />
      <h1>{session.data.day_name ?? 'Workout'}</h1>
      {session.data.finished_at && <p style={{ color: 'var(--muted)' }}>{new Date(session.data.finished_at).toLocaleString()}</p>}
      {[...byExercise.entries()].map(([name, sets]) => (
        <div className="card" key={name}>
          <strong>{name}</strong>
          {sets.map((s) => (
            <div key={s.id} style={{ marginTop: 6 }}>
              <div>Set {s.set_number}: {s.weight_used} kg × {s.reps_done} ({s.effort})</div>
              {s.extra_segments.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  + {s.extra_segments.map((x) => `${x.weight}×${x.reps}`).join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Run and watch it pass**

Run: `cd web && npx vitest run src/history/SessionDetailPage.test.tsx` → PASS.

- [ ] **Step 9: Wire routes in `web/src/App.tsx`**

Add imports:
```tsx
import { HistoryPage } from './history/HistoryPage';
import { SessionDetailPage } from './history/SessionDetailPage';
```
Add routes inside `<Routes>` (with the others):
```tsx
            <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
            <Route path="/history/:id" element={<RequireAuth><SessionDetailPage /></RequireAuth>} />
```

- [ ] **Step 10: Full web suite + typecheck + commit**

Run: `cd web && npx vitest run && npx tsc -b` → all pass, clean. Then:
```bash
git add web && git commit -m "feat(web): add History page, session detail, and nav link"
```

---

## Task 4: Web — Delete plan button in the editor

**Files:**
- Modify: `web/src/plans/PlanEditorPage.tsx`, `web/src/plans/PlanEditorPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `useAuth().isAdmin`, `DELETE /api/plans/:id`.
- Produces: a "Delete plan" button shown when `owned || isAdmin`, confirms, deletes, navigates to `/`.

- [ ] **Step 1: Add the failing test (append to `web/src/plans/PlanEditorPage.test.tsx`)**

```tsx
it('deletes the plan when confirmed', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plans/p1') return {
      id: 'p1', name: 'P', is_active: false, is_template: false, owned: true,
      days: [], } as any;
    if (path === '/api/plans/p1' && init?.method === 'DELETE') return undefined as any;
    return {} as any;
  });
  renderAt('p1');
  await screen.findByText('P');
  await userEvent.click(screen.getByRole('button', { name: /delete plan/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/plans/p1', expect.objectContaining({ method: 'DELETE' })));
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd web && npx vitest run src/plans/PlanEditorPage.test.tsx` → the new test FAILS (no delete button).

- [ ] **Step 3: Add the button in `web/src/plans/PlanEditorPage.tsx`**

Add a delete mutation after the existing mutations:
```ts
  const deletePlan = useMutation({ mutationFn: () => apiFetch(`/api/plans/${planId}`, { method: 'DELETE' }), onSuccess: () => nav('/') });
```
Render the button right after the `Export JSON` button:
```tsx
      {(owned || isAdmin) && (
        <button className="secondary" style={{ color: 'var(--danger)' }}
          onClick={() => { if (window.confirm('Delete this plan?')) deletePlan.mutate(); }}>Delete plan</button>
      )}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd web && npx vitest run src/plans/PlanEditorPage.test.tsx` → PASS (all editor tests).

- [ ] **Step 5: Full web suite + typecheck + commit**

Run: `cd web && npx vitest run && npx tsc -b` → all pass, clean. Then:
```bash
git add web && git commit -m "feat(web): add delete-plan button (owner or admin) to the editor"
```

---

## Appendix: Spec Coverage Map

- §2/§3 soft-delete column + mechanism → Task 1.
- §4 `DELETE /api/plans/:id` → Task 1; `GET /api/sessions`, `DELETE /api/sessions/:id`, enriched `GET /api/sessions/:id` → Task 2; plan-read `deleted_at` filters → Task 1.
- §5 access rules → Tasks 1 (plan delete owner/admin, read filters) & 2 (session owner-only).
- §6 web: History page + detail + nav → Task 3; delete-plan button → Task 4.
- §7 testing → tests in every task.
