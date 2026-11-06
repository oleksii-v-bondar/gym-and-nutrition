# Set-Completion Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give clear, satisfying feedback when a set is completed during a workout — per-exercise set dots and a brief "✓ Set logged" flash.

**Architecture:** Display-only, no backend change. `ExerciseLogger` renders a dot row for the current exercise's sets (completed/current/remaining), derived from its `setNumber`/`targetSets` props. `SessionPage` (which owns the log action) shows a fixed, auto-dismissing confirmation pill after each successful set `POST`. Styles live in `ui/styles.css`.

**Tech Stack:** React 18, Vitest + React Testing Library, plain CSS.

## Global Constraints

- Display-only: no backend, API, or data-model change.
- Set dots: render exactly `targetSets` dots; `completed = Math.min(Math.max(setNumber - 1, 0), targetSets)` filled; the dot at index `setNumber - 1` (when in range) is the accent "current" dot; the rest are hollow. Container `aria-label={`${completed} of ${targetSets} sets completed`}`.
- Flash: appears after the set `POST` resolves, reads **"✓ Set logged"**, auto-dismisses after ~1200ms (timeout cleared on unmount), fixed-position (no layout shift), `pointer-events: none`.
- `verbatimModuleSyntax` + `noUnusedLocals`/`noUnusedParameters` ON in web (the build type-checks test files). Conventional Commits. Co-author trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` on every commit.
- Web tests: `cd web && npm test -- <file>`. Build/typecheck: `cd web && npm run build`.

---

## File Structure

- `web/src/session/ExerciseLogger.tsx` — set-dots row (Task 1).
- `web/src/session/SessionPage.tsx` — flash state + pill (Task 2).
- `web/src/ui/styles.css` — `.set-dots`/`.dot` (Task 1) and `.flash-pill` (Task 2).
- Tests: `ExerciseLogger.test.tsx` (Task 1), `SessionPage.test.tsx` (Task 2).

---

## Task 1: Per-exercise set dots in `ExerciseLogger`

**Files:**
- Modify: `web/src/session/ExerciseLogger.tsx`, `web/src/ui/styles.css`
- Test: `web/src/session/ExerciseLogger.test.tsx`

**Interfaces:**
- Consumes: existing `setNumber: number`, `targetSets: number` props.
- Produces: a `div.set-dots` with `aria-label={`${completed} of ${targetSets} sets completed`}` containing `targetSets` `span.dot` children (`.done`/`.current`/plain).

- [ ] **Step 1: Add the failing tests to `web/src/session/ExerciseLogger.test.tsx`**

Append (keep existing tests):
```tsx
it('shows a set-dots row reflecting completed sets', () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Bench" targetReps={8} targetSets={3} setNumber={3}
    suggestedWeight={60} suggestionReason="x" extraSegmentTargets={[]} onLog={onLog} />);
  expect(screen.getByLabelText('2 of 3 sets completed')).toBeInTheDocument();
});

it('set-dots show 0 completed on the first set', () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Bench" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={60} suggestionReason="x" extraSegmentTargets={[]} onLog={onLog} />);
  expect(screen.getByLabelText('0 of 3 sets completed')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test -- src/session/ExerciseLogger.test.tsx`
Expected: FAIL — no element with that `aria-label` exists yet.

- [ ] **Step 3: Compute `completedSets` and render the dots in `web/src/session/ExerciseLogger.tsx`**

After the line `const efforts: Effort[] = ['easy', 'ok', 'hard', 'failed'];`, add:
```tsx
  const completedSets = Math.min(Math.max(props.setNumber - 1, 0), props.targetSets);
```
Then replace:
```tsx
      <p style={{ color: 'var(--muted)' }}>Set {props.setNumber}/{props.targetSets} • target {props.targetReps} reps</p>
      <p>💡 {props.suggestionReason}</p>
```
with:
```tsx
      <p style={{ color: 'var(--muted)' }}>Set {props.setNumber}/{props.targetSets} • target {props.targetReps} reps</p>
      <div className="set-dots" aria-label={`${completedSets} of ${props.targetSets} sets completed`}>
        {Array.from({ length: props.targetSets }, (_, i) => (
          <span key={i} className={i < completedSets ? 'dot done' : i === props.setNumber - 1 ? 'dot current' : 'dot'} />
        ))}
      </div>
      <p>💡 {props.suggestionReason}</p>
```

- [ ] **Step 4: Add the dot styles to `web/src/ui/styles.css`**

Append:
```css
.set-dots { display:flex; gap:6px; align-items:center; margin:4px 0 8px; }
.set-dots .dot { width:12px; height:12px; border-radius:50%; border:2px solid var(--muted); box-sizing:border-box; }
.set-dots .dot.done { background:var(--fg); border-color:var(--fg); }
.set-dots .dot.current { background:var(--accent); border-color:var(--accent); }
```

- [ ] **Step 5: Run the tests and the build**

Run: `cd web && npm test -- src/session/ExerciseLogger.test.tsx && npm run build`
Expected: PASS (existing + 2 new); build clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/session/ExerciseLogger.tsx web/src/session/ExerciseLogger.test.tsx web/src/ui/styles.css
git commit -m "feat(web): show per-exercise set-completion dots in the logger

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: "✓ Set logged" flash in `SessionPage`

**Files:**
- Modify: `web/src/session/SessionPage.tsx`, `web/src/ui/styles.css`
- Test: `web/src/session/SessionPage.test.tsx`

**Interfaces:**
- Consumes: the existing `onLog` flow (set `POST` then step advance).
- Produces: a `flash` state and a `div.flash-pill` reading "✓ Set logged" shown ~1200ms after each logged set.

- [ ] **Step 1: Add the failing test to `web/src/session/SessionPage.test.tsx`**

Append (keep existing tests; `renderAt` and imports already exist in the file):
```tsx
it('shows a confirmation flash after logging a set', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plan-days/d1') return { id: 'd1', name: 'Push', exercises: [
      { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 2, target_reps: 8, rest_seconds: null, starting_weight: 40, extra_segments: [] },
    ] } as any;
    if (path === '/api/sessions' && init?.method === 'POST') return { id: 's1', started_at: 'now' } as any;
    if (path === '/api/sessions/s1' && (!init || !init.method)) return { sets: [] } as any;
    if (path === '/api/exercises/e1/suggestion') return { weight: 40, reason: 'x' } as any;
    if (path === '/api/sessions/s1/sets' && init?.method === 'POST') return { id: 'set1' } as any;
    return {} as any;
  });
  renderAt('d1');
  await screen.findByText('Bench');
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  expect(await screen.findByText(/set logged/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npm test -- src/session/SessionPage.test.tsx`
Expected: FAIL — no "Set logged" text appears.

- [ ] **Step 3: Add flash state + timeout cleanup in `web/src/session/SessionPage.tsx`**

After the line `const [resumed, setResumed] = useState(false);`, add:
```tsx
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
```
(`useEffect`, `useRef`, `useState` are already imported.)

- [ ] **Step 4: Trigger the flash in `onLog`**

Replace:
```tsx
    await apiFetch(`/api/sessions/${sessionId}/sets`, { method: 'POST', body: JSON.stringify({
      day_exercise_id: exercise.id, set_number: setNumber, weight_used: weight, reps_done: reps, effort,
      extra_segments: segments }) });
    if (step + 1 >= steps.length) setDone(true);
    else setStep(step + 1);
```
with:
```tsx
    await apiFetch(`/api/sessions/${sessionId}/sets`, { method: 'POST', body: JSON.stringify({
      day_exercise_id: exercise.id, set_number: setNumber, weight_used: weight, reps_done: reps, effort,
      extra_segments: segments }) });
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 1200);
    if (step + 1 >= steps.length) setDone(true);
    else setStep(step + 1);
```

- [ ] **Step 5: Render the pill**

Replace:
```tsx
    <div className="app">
      <NavBar />
      <h1>{day.data.name}</h1>
```
with:
```tsx
    <div className="app">
      <NavBar />
      {flash && <div className="flash-pill">✓ Set logged</div>}
      <h1>{day.data.name}</h1>
```

- [ ] **Step 6: Add the pill styles to `web/src/ui/styles.css`**

Append:
```css
.flash-pill { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:var(--accent); color:#06240f; font-weight:700; padding:10px 18px; border-radius:999px; z-index:50; pointer-events:none; box-shadow:0 4px 14px rgba(0,0,0,0.4); animation:flash-fade 1.2s ease; }
@keyframes flash-fade { 0%{opacity:0} 15%{opacity:1} 80%{opacity:1} 100%{opacity:0} }
```

- [ ] **Step 7: Run the test and the build**

Run: `cd web && npm test -- src/session/SessionPage.test.tsx && npm run build`
Expected: PASS (existing + new); build clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/session/SessionPage.tsx web/src/session/SessionPage.test.tsx web/src/ui/styles.css
git commit -m "feat(web): show a 'Set logged' confirmation flash after each set

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Full regression + typecheck

**Files:** none (verification only).

- [ ] **Step 1: Full web suite + build**

Run: `cd web && npm test && npm run build`
Expected: all tests PASS; `tsc -b && vite build` clean.

- [ ] **Step 2: Lint the web changes**

Run: `cd web && npm run lint`
Expected: no new lint errors in the changed files (pre-existing warnings in `AuthContext.tsx`/`SessionPage.tsx` are acceptable; verify no new ones were introduced by the flash state/effect).

- [ ] **Step 3: Commit (only if lint/build auto-fixed anything; otherwise skip)**

```bash
git add -A
git commit -m "chore: regression fixups for set-completion feedback

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review Notes

- **Spec §2 (set dots):** Task 1 (dots + clamp + aria-label + CSS). ✓
- **Spec §3 (flash):** Task 2 (flash state, timeout+cleanup, pill, trigger after POST). ✓
- **Spec §4 (styles):** `.set-dots` in Task 1, `.flash-pill` in Task 2. ✓
- **Spec §5 (testing):** dot aria-label counts (Task 1), flash appears after logging (Task 2). ✓
- **Type consistency:** `completedSets` / `.set-dots` / `.dot` / `flash` / `flashTimer` / `.flash-pill` are self-consistent; both tasks append to `styles.css` at different blocks (no overlap).
