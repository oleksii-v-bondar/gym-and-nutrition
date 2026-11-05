# Workout Logging Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit the values of past sessions, fix clipped 2-digit reps inputs, present weight-0 sets as bodyweight exercises, and ask how many reps were completed when a set is marked "failed".

**Architecture:** One new owner-only `PATCH /api/sessions/:id/sets/:setId` endpoint updates a logged set's values (guarded so the set must belong to the session). The web side adds a separate `SessionEditPage` (mirroring the plan View/Edit split), a shared bodyweight set-line formatter, an inline "completed reps" prompt in `ExerciseLogger`, and a global CSS fix that hides number-input spin buttons.

**Tech Stack:** Existing — Express 5, pg, Zod, Vitest + Supertest (api); React 18, react-router, @tanstack/react-query, Vitest + React Testing Library (web). Postgres 16.

## Global Constraints

- **Values-only editing:** edit weight/reps/effort/extra_segments of existing sets. No add/remove sets; no change of exercise or set_number.
- **Bodyweight = weight 0:** no schema or data change; `weight_used = 0` already means bodyweight. Bodyweight handling is **display-only** ("Bodyweight × N reps") plus a caption hint in the logger.
- **Failed flow:** `easy`/`ok`/`hard` log immediately (unchanged); `failed` first shows an inline reps prompt pre-filled with the current reps value, then logs `effort='failed'` with the entered reps.
- **Permissions:** session detail/edit are the requester's own sessions only; `PATCH` returns 404 if the session isn't owned or the set isn't in that session.
- **Set-update body (verbatim contract):** `{ weight_used: number≥0, reps_done: int≥0, effort: 'easy'|'ok'|'hard'|'failed', extra_segments: Array<{ weight: number≥0, reps: int≥0 }> }` (all fields required).
- ESM `.js` import extensions in api source. Conventional Commits. Build only what each task specifies.
- API tests: `cd api && npm run test:int -- <file>`. Web tests: `cd web && npm test -- <file>`.
- Co-author every commit with: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

---

## File Structure

- `api/src/sessions/repo.ts` — add `updateSet(sessionId, setId, fields)`.
- `api/src/sessions/routes.ts` — add `PATCH /:id/sets/:setId` (owner-only, Zod-validated).
- `api/__tests__/session-edit.test.ts` — integration tests for the new endpoint (new).
- `web/src/ui/styles.css` — hide number-input spin buttons (global).
- `web/src/session/ExerciseLogger.tsx` — inline failed prompt, bodyweight caption, `inputMode="numeric"`.
- `web/src/session/ExerciseLogger.test.tsx` — add failed-flow test.
- `web/src/history/setFormat.ts` — `formatSetLine` + `formatSegment` (new).
- `web/src/history/setFormat.test.ts` — unit tests for the formatters (new).
- `web/src/history/SessionDetailPage.tsx` — Edit link + use the formatters.
- `web/src/history/SessionDetailPage.test.tsx` — add Edit-link + bodyweight assertions.
- `web/src/history/SessionEditPage.tsx` — new editable session page (new).
- `web/src/history/SessionEditPage.test.tsx` — component test (new).
- `web/src/App.tsx` — add `/history/:id/edit` route.

---

## Task 1: Backend — `PATCH /api/sessions/:id/sets/:setId`

**Files:**
- Modify: `api/src/sessions/repo.ts`, `api/src/sessions/routes.ts`
- Test: `api/__tests__/session-edit.test.ts` (create)

**Interfaces:**
- Consumes: `userOwnsSession(userId, sessionId)` (exists), `requireAuth`, `buildPlan` test helper.
- Produces: `updateSet(sessionId: string, setId: string, s: { weight_used: number; reps_done: number; effort: string; extra_segments: Array<{ weight: number; reps: number }> }): Promise<{ id: string } | null>` (null when no row matches both ids). `PATCH /api/sessions/:id/sets/:setId` → `200 { id }` on success, `404` if session not owned or set not in session, `400` on invalid body.

- [ ] **Step 1: Write the failing test `api/__tests__/session-edit.test.ts`**

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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd api && npm run test:int -- __tests__/session-edit.test.ts`
Expected: FAIL — `PATCH` route does not exist (404 for the success case, so the `toMatchObject` assertion fails).

- [ ] **Step 3: Add `updateSet` to `api/src/sessions/repo.ts`**

Append this function at the end of the file:
```ts
export async function updateSet(sessionId: string, setId: string, s: {
  weight_used: number; reps_done: number; effort: string;
  extra_segments: Array<{ weight: number; reps: number }>;
}): Promise<{ id: string } | null> {
  const r = await query<{ id: string }>(
    `UPDATE set_logs SET weight_used=$3, reps_done=$4, effort=$5, extra_segments=$6::jsonb
     WHERE id=$2 AND session_id=$1 RETURNING id`,
    [sessionId, setId, s.weight_used, s.reps_done, s.effort, JSON.stringify(s.extra_segments)]);
  return r.rows[0] ?? null;
}
```

- [ ] **Step 4: Add the route in `api/src/sessions/routes.ts`**

Update the import from `./repo.js` to include `updateSet`:
```ts
import { startSession, logSet, finishSession, getSession, userOwnsSession, listUserSessions, deleteSession, updateSet } from './repo.js';
```
Add a Zod schema next to `setBody`:
```ts
const patchSetBody = z.object({
  weight_used: z.number().nonnegative(),
  reps_done: z.number().int().nonnegative(),
  effort: z.enum(['easy', 'ok', 'hard', 'failed']),
  extra_segments: z.array(z.object({ weight: z.number().nonnegative(), reps: z.number().int().nonnegative() })),
});
```
Add the handler (place it after the `POST '/:id/sets'` handler):
```ts
sessionsRouter.patch('/:id/sets/:setId', async (req, res) => {
  if (!(await userOwnsSession(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  const p = patchSetBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  const updated = await updateSet(req.params.id, req.params.setId, p.data);
  if (!updated) { res.status(404).json({ error: 'not found' }); return; }
  res.json(updated);
});
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd api && npm run test:int -- __tests__/session-edit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/sessions/repo.ts api/src/sessions/routes.ts api/__tests__/session-edit.test.ts
git commit -m "feat(api): add PATCH endpoint to edit a logged set's values

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Web — bodyweight set formatters

**Files:**
- Create: `web/src/history/setFormat.ts`
- Test: `web/src/history/setFormat.test.ts` (create)

**Interfaces:**
- Produces: `formatSetLine(weight: number, reps: number, effort: string): string` and `formatSegment(weight: number, reps: number): string`. When `weight === 0`, `formatSetLine` returns `"Bodyweight × {reps} reps ({effort})"` and `formatSegment` returns `"×{reps}"`; otherwise `"{weight} kg × {reps} ({effort})"` and `"{weight}×{reps}"`. Consumed by Tasks 4 and 5.

- [ ] **Step 1: Write the failing test `web/src/history/setFormat.test.ts`**

```ts
import { formatSetLine, formatSegment } from './setFormat';

it('formats a weighted set with kg', () => {
  expect(formatSetLine(40, 8, 'ok')).toBe('40 kg × 8 (ok)');
});

it('formats a weight-0 set as bodyweight with reps as the metric', () => {
  expect(formatSetLine(0, 12, 'hard')).toBe('Bodyweight × 12 reps (hard)');
});

it('formats segments, dropping 0 weight to just reps', () => {
  expect(formatSegment(20, 12)).toBe('20×12');
  expect(formatSegment(0, 8)).toBe('×8');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npm test -- src/history/setFormat.test.ts`
Expected: FAIL — module `./setFormat` cannot be resolved.

- [ ] **Step 3: Create `web/src/history/setFormat.ts`**

```ts
export function formatSetLine(weight: number, reps: number, effort: string): string {
  return weight === 0
    ? `Bodyweight × ${reps} reps (${effort})`
    : `${weight} kg × ${reps} (${effort})`;
}

export function formatSegment(weight: number, reps: number): string {
  return weight === 0 ? `×${reps}` : `${weight}×${reps}`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd web && npm test -- src/history/setFormat.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/history/setFormat.ts web/src/history/setFormat.test.ts
git commit -m "feat(web): add bodyweight-aware set/segment formatters

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Web — `ExerciseLogger` failed prompt, bodyweight caption, numeric inputs + spinner CSS

**Files:**
- Modify: `web/src/session/ExerciseLogger.tsx`, `web/src/ui/styles.css`
- Test: `web/src/session/ExerciseLogger.test.tsx`

**Interfaces:**
- Consumes: existing `onLog(weight, reps, effort, segments)` prop (unchanged signature).
- Produces: no new exports. Behavioral change: tapping `failed` reveals an inline block with placeholder `reps completed` (pre-filled with the current reps value) and a `Confirm` button; `Confirm` calls `onLog(Number(weight), Number(failedReps), 'failed', segments)`. `easy`/`ok`/`hard` still call `onLog` immediately.

- [ ] **Step 1: Add the failing failed-flow test to `web/src/session/ExerciseLogger.test.tsx`**

Append this test below the existing one (keep the existing imports and test as-is):
```ts
it('failed shows a completed-reps prompt pre-filled with current reps, then logs with that number', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Pull-up" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={0} suggestionReason="x" extraSegments={0} onLog={onLog} />);

  await userEvent.click(screen.getByRole('button', { name: 'failed' }));
  expect(onLog).not.toHaveBeenCalled();

  const input = screen.getByPlaceholderText('reps completed');
  expect(input).toHaveValue(8); // pre-filled with current reps (targetReps default)
  await userEvent.clear(input);
  await userEvent.type(input, '5');
  await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

  expect(onLog).toHaveBeenCalledWith(0, 5, 'failed', []);
});

it('ok logs immediately without a completed-reps prompt', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Bench" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={60} suggestionReason="x" extraSegments={0} onLog={onLog} />);
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  expect(onLog).toHaveBeenCalledWith(60, 8, 'ok', []);
  expect(screen.queryByPlaceholderText('reps completed')).toBeNull();
});
```

- [ ] **Step 2: Run the logger tests and watch the new ones fail**

Run: `cd web && npm test -- src/session/ExerciseLogger.test.tsx`
Expected: FAIL — no `reps completed` input appears when `failed` is clicked (the old code logs immediately).

- [ ] **Step 3: Update `web/src/session/ExerciseLogger.tsx`**

Add two state hooks after the existing `segments` state:
```ts
  const [pendingFail, setPendingFail] = useState(false);
  const [failedReps, setFailedReps] = useState('');
```
Replace the existing `log` function:
```ts
  function log(ef: Effort) {
    const filled = segments
      .filter((s) => s.weight !== '' && s.reps !== '')
      .map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) }));
    props.onLog(Number(weight), Number(reps), ef, filled);
  }
```
with a reps-parameterised logger plus the effort dispatcher:
```ts
  function doLog(ef: Effort, repsValue: string) {
    const filled = segments
      .filter((s) => s.weight !== '' && s.reps !== '')
      .map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) }));
    props.onLog(Number(weight), Number(repsValue), ef, filled);
  }
  function onEffort(ef: Effort) {
    if (ef === 'failed') { setFailedReps(reps); setPendingFail(true); return; }
    setPendingFail(false);
    doLog(ef, reps);
  }
```
Change the weight caption text and add `inputMode="numeric"` to the main inputs. Replace the main weight/reps block:
```tsx
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <span style={cap}>weight</span>
        </div>
        <div style={{ flex: 1 }}>
          <input type="number" value={reps} onChange={(e) => setReps(e.target.value)} />
          <span style={cap}>reps done</span>
        </div>
      </div>
```
with:
```tsx
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <input type="number" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <span style={cap}>weight (0 = bodyweight)</span>
        </div>
        <div style={{ flex: 1 }}>
          <input type="number" inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} />
          <span style={cap}>reps done</span>
        </div>
      </div>
```
Add `inputMode="numeric"` to the two segment inputs (in the `segments.map` block):
```tsx
            <div style={{ flex: 1 }}><input type="number" inputMode="numeric" placeholder="weight" value={s.weight} onChange={(e) => setSegment(i, 'weight', e.target.value)} /></div>
            <div style={{ flex: 1 }}><input type="number" inputMode="numeric" placeholder="reps" value={s.reps} onChange={(e) => setSegment(i, 'reps', e.target.value)} /></div>
```
Replace the effort buttons block:
```tsx
      <p style={{ color: 'var(--muted)' }}>How did it feel? (tap to log the set)</p>
      <div className="row">
        {efforts.map((ef) => (
          <button key={ef} className="big-tap" onClick={() => log(ef)}>{ef}</button>
        ))}
      </div>
```
with the dispatcher-wired buttons plus the inline failed prompt:
```tsx
      <p style={{ color: 'var(--muted)' }}>How did it feel? (tap to log the set)</p>
      <div className="row">
        {efforts.map((ef) => (
          <button key={ef} className="big-tap" onClick={() => onEffort(ef)}>{ef}</button>
        ))}
      </div>

      {pendingFail && (
        <div className="card" style={{ marginTop: 8 }}>
          <p>How many reps did you complete?</p>
          <input type="number" inputMode="numeric" placeholder="reps completed"
            value={failedReps} onChange={(e) => setFailedReps(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="big-tap" onClick={() => { setPendingFail(false); doLog('failed', failedReps); }}>Confirm</button>
            <button className="secondary" style={{ width: 'auto' }} onClick={() => setPendingFail(false)}>Cancel</button>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Add the global spin-button CSS to `web/src/ui/styles.css`**

Append at the end of the file:
```css
input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
```

- [ ] **Step 5: Run the logger tests and watch them pass**

Run: `cd web && npm test -- src/session/ExerciseLogger.test.tsx`
Expected: PASS (existing test + 2 new tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/session/ExerciseLogger.tsx web/src/session/ExerciseLogger.test.tsx web/src/ui/styles.css
git commit -m "feat(web): prompt for completed reps on failed; bodyweight hint; readable number inputs

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Web — `SessionDetailPage` Edit link + bodyweight display

**Files:**
- Modify: `web/src/history/SessionDetailPage.tsx`
- Test: `web/src/history/SessionDetailPage.test.tsx`

**Interfaces:**
- Consumes: `formatSetLine`, `formatSegment` from Task 2; route `/history/:id/edit` (added in Task 5, but the link is inert until then).
- Produces: an `Edit` link to `/history/${id}/edit`; set lines rendered via `formatSetLine`; segments via `formatSegment`.

- [ ] **Step 1: Update the test `web/src/history/SessionDetailPage.test.tsx`**

Replace the whole file with (adds a bodyweight set and asserts the Edit link + bodyweight line; keeps the weighted-set assertion):
```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { SessionDetailPage } from './SessionDetailPage';
import * as client from '../api/client';

it('renders sets grouped by exercise, shows bodyweight for weight 0, and links to edit', async () => {
  vi.spyOn(client, 'apiFetch').mockImplementation(async (path: string) => {
    if (path === '/api/sessions/s1') return {
      id: 's1', day_name: 'Push', finished_at: '2026-11-01T10:00:00Z',
      sets: [
        { id: 'x', exercise_name: 'Bench', set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok', extra_segments: [{ weight: 20, reps: 12 }] },
        { id: 'y', exercise_name: 'Pull-up', set_number: 1, weight_used: 0, reps_done: 10, effort: 'hard', extra_segments: [] },
      ],
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
  expect(screen.getByText(/Bodyweight × 10 reps \(hard\)/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute('href', '/history/s1/edit');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npm test -- src/history/SessionDetailPage.test.tsx`
Expected: FAIL — no Edit link and no "Bodyweight ×" text yet.

- [ ] **Step 3: Update `web/src/history/SessionDetailPage.tsx`**

Change the imports at the top:
```tsx
import { useParams } from 'react-router-dom';
```
to:
```tsx
import { useParams, Link } from 'react-router-dom';
import { formatSetLine, formatSegment } from './setFormat';
```
Replace the title line:
```tsx
      <h1>{session.data.day_name ?? 'Workout'}</h1>
```
with a title row that includes the Edit link:
```tsx
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>{session.data.day_name ?? 'Workout'}</h1>
        <Link to={`/history/${id}/edit`}>Edit</Link>
      </div>
```
Replace the set line and segment rendering:
```tsx
              <div>Set {s.set_number}: {s.weight_used} kg × {s.reps_done} ({s.effort})</div>
              {s.extra_segments.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  + {s.extra_segments.map((x) => `${x.weight}×${x.reps}`).join(', ')}
                </div>
              )}
```
with:
```tsx
              <div>Set {s.set_number}: {formatSetLine(s.weight_used, s.reps_done, s.effort)}</div>
              {s.extra_segments.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  + {s.extra_segments.map((x) => formatSegment(x.weight, x.reps)).join(', ')}
                </div>
              )}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd web && npm test -- src/history/SessionDetailPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/history/SessionDetailPage.tsx web/src/history/SessionDetailPage.test.tsx
git commit -m "feat(web): show bodyweight sets and add Edit link on session detail

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Web — `SessionEditPage` + route

**Files:**
- Create: `web/src/history/SessionEditPage.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/src/history/SessionEditPage.test.tsx` (create)

**Interfaces:**
- Consumes: `GET /api/sessions/:id` (existing detail shape), `PATCH /api/sessions/:id/sets/:setId` (Task 1), `apiFetch`, `NavBar`.
- Produces: `SessionEditPage` component exported by name; route `/history/:id/edit`. On **Save**, issues one `PATCH` per set with the set-update body, invalidates `['session', id]` and `['sessions']`, then navigates to `/history/:id`.

- [ ] **Step 1: Write the failing test `web/src/history/SessionEditPage.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { SessionEditPage } from './SessionEditPage';
import * as client from '../api/client';

it('loads set values, edits reps, and saves via PATCH', async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  vi.spyOn(client, 'apiFetch').mockImplementation(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === '/api/sessions/s1' && (!init || !init.method)) return {
      id: 's1', day_name: 'Push', finished_at: '2026-11-01T10:00:00Z',
      sets: [{ id: 'set1', exercise_name: 'Bench', set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok', extra_segments: [] }],
    } as any;
    return {} as any;
  });
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}><AuthProvider>
      <MemoryRouter initialEntries={['/history/s1/edit']}>
        <Routes><Route path="/history/:id/edit" element={<SessionEditPage />} /></Routes>
      </MemoryRouter>
    </AuthProvider></QueryClientProvider>
  );

  const reps = await screen.findByDisplayValue('8');
  await userEvent.clear(reps);
  await userEvent.type(reps, '10');
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

  await waitFor(() => {
    const patch = calls.find((c) => c.init?.method === 'PATCH');
    expect(patch?.path).toBe('/api/sessions/s1/sets/set1');
    expect(JSON.parse(patch!.init!.body as string)).toMatchObject({ weight_used: 40, reps_done: 10, effort: 'ok', extra_segments: [] });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npm test -- src/history/SessionEditPage.test.tsx`
Expected: FAIL — module `./SessionEditPage` cannot be resolved.

- [ ] **Step 3: Create `web/src/history/SessionEditPage.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';

interface Segment { weight: number; reps: number; }
interface SetLog { id: string; exercise_name: string | null; set_number: number; weight_used: number; reps_done: number; effort: string; extra_segments: Segment[]; }
interface SessionDetail { id: string; day_name: string | null; finished_at: string | null; sets: SetLog[]; }
interface Draft { weight: string; reps: string; effort: string; segments: Array<{ weight: string; reps: string }>; }

const cap: CSSProperties = { fontSize: 11, color: 'var(--muted)', textAlign: 'center', display: 'block', marginTop: 2 };
const efforts = ['easy', 'ok', 'hard', 'failed'];

export function SessionEditPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ['session', id], queryFn: () => apiFetch<SessionDetail>(`/api/sessions/${id}`) });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session.data) return;
    const d: Record<string, Draft> = {};
    for (const s of session.data.sets) {
      d[s.id] = {
        weight: String(s.weight_used), reps: String(s.reps_done), effort: s.effort,
        segments: s.extra_segments.map((x) => ({ weight: String(x.weight), reps: String(x.reps) })),
      };
    }
    setDrafts(d);
  }, [session.data]);

  const byExercise = useMemo(() => {
    const m = new Map<string, SetLog[]>();
    for (const s of session.data?.sets ?? []) {
      const name = s.exercise_name ?? 'Exercise';
      if (!m.has(name)) m.set(name, []);
      m.get(name)!.push(s);
    }
    return m;
  }, [session.data]);

  function upd(setId: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [setId]: { ...prev[setId], ...patch } }));
  }
  function updSeg(setId: string, i: number, field: 'weight' | 'reps', value: string) {
    setDrafts((prev) => ({ ...prev, [setId]: { ...prev[setId],
      segments: prev[setId].segments.map((sg, j) => (j === i ? { ...sg, [field]: value } : sg)) } }));
  }

  async function save() {
    if (!session.data) return;
    setSaving(true);
    for (const s of session.data.sets) {
      const d = drafts[s.id];
      if (!d) continue;
      await apiFetch(`/api/sessions/${id}/sets/${s.id}`, { method: 'PATCH', body: JSON.stringify({
        weight_used: Number(d.weight), reps_done: Number(d.reps), effort: d.effort,
        extra_segments: d.segments
          .filter((x) => x.weight !== '' && x.reps !== '')
          .map((x) => ({ weight: Number(x.weight), reps: Number(x.reps) })),
      }) });
    }
    await qc.invalidateQueries({ queryKey: ['session', id] });
    await qc.invalidateQueries({ queryKey: ['sessions'] });
    setSaving(false);
    nav(`/history/${id}`);
  }

  if (session.isLoading) return <div className="app"><NavBar />Loading…</div>;
  if (!session.data) return <div className="app"><NavBar />Not found</div>;

  return (
    <div className="app">
      <NavBar />
      <h1>Edit — {session.data.day_name ?? 'Workout'}</h1>
      {[...byExercise.entries()].map(([name, sets]) => (
        <div className="card" key={name}>
          <strong>{name}</strong>
          {sets.map((s) => {
            const d = drafts[s.id];
            if (!d) return null;
            return (
              <div key={s.id} style={{ marginTop: 10 }}>
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>Set {s.set_number}</p>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <input type="number" inputMode="numeric" value={d.weight} onChange={(e) => upd(s.id, { weight: e.target.value })} />
                    <span style={cap}>weight (0 = bodyweight)</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <input type="number" inputMode="numeric" value={d.reps} onChange={(e) => upd(s.id, { reps: e.target.value })} />
                    <span style={cap}>reps</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <select value={d.effort} onChange={(e) => upd(s.id, { effort: e.target.value })}>
                      {efforts.map((ef) => <option key={ef} value={ef}>{ef}</option>)}
                    </select>
                    <span style={cap}>effort</span>
                  </div>
                </div>
                {d.segments.map((sg, i) => (
                  <div className="row" key={i} style={{ marginTop: 6 }}>
                    <div style={{ flex: 1 }}><input type="number" inputMode="numeric" placeholder="weight" value={sg.weight} onChange={(e) => updSeg(s.id, i, 'weight', e.target.value)} /></div>
                    <div style={{ flex: 1 }}><input type="number" inputMode="numeric" placeholder="reps" value={sg.reps} onChange={(e) => updSeg(s.id, i, 'reps', e.target.value)} /></div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
      <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      <button className="secondary" onClick={() => nav(`/history/${id}`)}>Cancel</button>
    </div>
  );
}
```

- [ ] **Step 4: Wire the route in `web/src/App.tsx`**

Add the import next to the other history imports:
```tsx
import { SessionEditPage } from './history/SessionEditPage';
```
Add the route directly after the existing `/history/:id` route:
```tsx
            <Route path="/history/:id/edit" element={<RequireAuth><SessionEditPage /></RequireAuth>} />
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd web && npm test -- src/history/SessionEditPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/history/SessionEditPage.tsx web/src/history/SessionEditPage.test.tsx web/src/App.tsx
git commit -m "feat(web): add session edit page to change past set values

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: Full regression + typecheck

**Files:** none (verification only).

- [ ] **Step 1: Run the full web test suite + build typecheck**

Run: `cd web && npm test && npm run build`
Expected: all tests PASS; `tsc -b && vite build` completes with no type errors.

- [ ] **Step 2: Run the full api integration suite**

Run: `cd api && npm run test:int`
Expected: all tests PASS (including the new `session-edit.test.ts`).

- [ ] **Step 3: Lint the web changes**

Run: `cd web && npm run lint`
Expected: no new lint errors in the changed files.

- [ ] **Step 4: Commit (only if lint/build auto-fixed anything; otherwise skip)**

```bash
git add -A
git commit -m "chore: regression fixups for workout logging improvements

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review Notes

- **Spec §2 (edit past trainings):** Task 1 (PATCH endpoint) + Task 5 (edit page/route) + Task 4 (Edit link). ✓
- **Spec §3 (reps visibility):** Task 3 (spinner CSS + `inputMode`), applied globally so the edit page inherits it. ✓
- **Spec §4 (bodyweight):** Task 2 (formatters), Task 4 (detail display), Task 3 (logger caption), Task 5 (edit caption). ✓
- **Spec §5 (failed prompt):** Task 3. ✓
- **Spec §6 (access rules):** Task 1 enforces owner-only + set-belongs-to-session, covered by the 404 tests. ✓
- **Spec §7 (testing):** API PATCH tests (Task 1), logger failed-flow (Task 3), bodyweight formatting (Task 2), edit page PATCH (Task 5), detail Edit link (Task 4). ✓
- **Type consistency:** `updateSet` / `formatSetLine` / `formatSegment` / `SessionEditPage` names match across tasks; the set-update body matches between the route Zod schema, the edit page `save()`, and the API tests.
