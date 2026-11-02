# Dropsets / Upsets (Extra Set Segments) — Design Spec

**Date:** 2026-11-02
**Status:** Approved (design); pending implementation plan
**Builds on:** the existing gym-tracker app (web + api + db).

---

## 1. Purpose

Let a set carry one or more **extra segments** — additional `(weight, reps)` entries beyond the main working set. Entering lighter weights makes it a **dropset**; heavier makes it an **upset**. The app stays neutral about the label.

Two entry points:
- **Plan-time:** an exercise can declare a count of extra segments, so the session screen pre-renders that many extra input rows.
- **Logging-time:** during a workout the user can add/remove extra `(weight, reps)` rows per set ad-hoc.

**Success criteria**
- A plan exercise can specify an "extra segments" count (import JSON + in-app editor).
- In a workout, each set shows the planned number of extra weight+reps rows, plus an "add segment" button; filled segments are logged with the set.
- Logged segments are stored and returned when reading a session.
- Weight suggestions and the trend are **unchanged** — they use the main working set only.

**Non-goals (YAGNI)**
- Separate "dropset" vs "upset" types/labels.
- A per-segment effort rating (one effort per set, as today).
- Showing segments in the progress/trend screen (stored, but only surfaced in the session screen for now).
- Segments influencing the suggestion/trend algorithms.

---

## 2. Data Model (two additive columns)

```sql
ALTER TABLE day_exercises ADD COLUMN extra_segments int NOT NULL DEFAULT 0;
ALTER TABLE set_logs      ADD COLUMN extra_segments jsonb NOT NULL DEFAULT '[]';
```

- `day_exercises.extra_segments` — plan-time count (≥ 0) of extra segments to pre-render.
- `set_logs.extra_segments` — the logged drops/ups: a JSON array of `{ weight: number, reps: number }`.

For a fresh schema apply, both columns are declared inline on their tables.

---

## 3. API Changes

**Plan / exercise (count flows through everywhere an exercise is read/written):**
- Import schema `exerciseImport`: add `extra_segments: z.number().int().nonnegative().optional()` (default 0 on insert).
- `exerciseUpsert` (editor): add `extra_segments: z.number().int().nonnegative().optional()`.
- `createPlanFromImport`, `addExercise`, `updateExercise` persist it; `getPlanTree`, `getDayWithExercises`, `exportPlan`, and `forkPlan` carry it.

**Session set logging:**
- `POST /api/sessions/:id/sets` body gains optional
  `extra_segments: z.array(z.object({ weight: z.number().nonnegative(), reps: z.number().int().nonnegative() })).optional()` (defaults `[]`).
- `logSet` stores it (`$n::jsonb` with `JSON.stringify`).
- `GET /api/sessions/:id` returns each set's `extra_segments` (cast so numbers come back as numbers).

**Unchanged:** suggestion and trend endpoints/modules — they read the main set's `weight_used`/`reps_done` only.

---

## 4. Web Changes

**Plan editor (`PlanEditorPage`):** each exercise row gains a small **"extra"** number input bound to `extra_segments` (same owner-only / fork-on-edit rules as the other fields).

**Session screen (`ExerciseLogger`):**
- Local state holds a `segments: { weight: string; reps: string }[]` array, initialized to `exercise.extra_segments` empty rows.
- Renders each segment as a weight+reps pair with a "✕" remove; a **"+ add segment"** button appends a row.
- On effort tap, `onLog(weight, reps, effort, segments)` passes the filled segments (rows where both weight and reps are provided), parsed to numbers.
- `SessionPage.onLog` includes `extra_segments` in the POST body.

**No change** to the progress/trend screen.

---

## 5. Testing

**API (integration):**
- Log a set with `extra_segments` → `GET /api/sessions/:id` returns them with numeric weight/reps.
- A set logged with light extra segments still yields the same main-set-based suggestion (progression intact).
- Plan import with `extra_segments` on an exercise → `GET /api/plans/:id` returns the count; editor `PUT` updates it; `fork` copies it.

**Web (component):**
- `ExerciseLogger` pre-renders N segment rows from `exercise.extra_segments`; "+ add segment" adds a row; tapping effort calls `onLog` with the segments array.
- Editor renders and submits the `extra_segments` field.

---

## 6. Files Touched (anticipated)

- `db/schema.sql` (two columns)
- `api/src/plans/schema.ts` (import/upsert add field), `api/src/plans/repo.ts` (persist + carry in tree/day/export/fork/add/update)
- `api/src/sessions/routes.ts` (set body), `api/src/sessions/repo.ts` (logSet + getSession)
- `web/src/plans/PlanEditorPage.tsx` (editor field)
- `web/src/session/ExerciseLogger.tsx` (+ `SessionPage.tsx` for the onLog signature + plan-day type)
- Tests alongside each.
