# Per-Segment Target Reps in the Plan — Design Spec

**Date:** 2026-11-06
**Status:** Approved (design); pending implementation plan
**Builds on:** the existing gym-tracker app (plan model, editor, session logger).

---

## 1. Purpose

Replace the exercise's **drops/ups count** (`day_exercises.extra_segments int`) with a list of **per-segment target reps**, defined when creating/editing a plan. Each drop/up segment carries its own target rep count; the weight is still entered at workout time.

**Success criteria**
- The plan editor shows a per-exercise list of drop/up segments, each with an editable **reps** value, plus add/remove controls.
- Starting a workout pre-renders one extra-segment row **per target**, with the target **reps pre-filled** (weight blank until entered).
- Import/export and fork round-trip the per-segment reps.
- Existing plans' drop/up counts are preserved via a one-time migration.

**Non-goals (YAGNI)**
- Per-segment target **weight** in the plan (reps only; weight is entered live).
- Changing how logged segment values are stored (`set_logs.extra_segments` stays `[{weight, reps}]`).

---

## 2. Data model

Change `day_exercises.extra_segments` from `int NOT NULL DEFAULT 0` to a **jsonb array of `{reps}` objects**:

- `schema.sql`: `extra_segments jsonb NOT NULL DEFAULT '[]'` — e.g. `[{"reps":10},{"reps":12}]`. The drop/up count is the array length.
- **One-time migration** (new `db/migrations/2026-11-06-extra-segment-reps.sql`, applied manually since the init script only runs on a fresh volume). Converts each old integer `N` to `N` objects, each defaulting `reps` to the exercise's main `target_reps`; `0`/null → `[]`:

```sql
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

---

## 3. API + validation

`extra_segments` becomes an array of `{reps}` wherever it appears:

- `api/src/plans/schema.ts`: in `exerciseImport` and `exerciseUpsert`, `extra_segments` → `z.array(z.object({ reps: z.number().int().positive() })).optional()` (default `[]`).
- `api/src/plans/repo.ts`: `createPlanFromImport`, `addExercise`, `updateExercise`, `forkPlan` store it as `$n::jsonb` (`JSON.stringify(ex.extra_segments ?? [])`); `getPlanTree`, `getDayWithExercises`, `exportPlan` return the parsed array (pg returns jsonb as a JS array).

An omitted `extra_segments` defaults to `[]`.

---

## 4. Plan editor UI (`PlanEditorPage`)

Replace the single `drops/ups` number input per exercise with a compact segment editor:
- One **reps input per segment** with a ✕ remove button, plus an **"+ add drop/up"** button.
- Changing a segment reps, adding, or removing updates `extra_segments` and `PUT`s the full array `{ extra_segments: [{reps}, …] }` (copy-on-edit fork flow unchanged).

---

## 5. Workout / logger (`SessionPage` + `ExerciseLogger`)

- `SessionPage`'s `Exercise.extra_segments` type becomes `Array<{reps:number}>`; it passes this to the logger.
- `ExerciseLogger`'s `extraSegments: number` prop becomes **`extraSegmentTargets: Array<{reps:number}>`**. It initializes one segment row per target with **reps pre-filled** (`weight: ''`). The existing add/remove-row controls and the "keep weight/reps across sets" behavior remain. Logged values still submit as `{weight, reps}` to `set_logs.extra_segments` (unchanged).

---

## 6. View + export/import

- `PlanViewPage` and the editor summary: `+{extra_segments.length} drops/ups` (count derived from the array); optionally list the target reps (e.g. `drops 10/12`).
- Export (`exportPlan`) emits `extra_segments: [{reps}, …]`; import validates the same shape.

---

## 7. Testing

**API:**
- Import with `extra_segments: [{reps:10},{reps:12}]` → `getPlanTree`/`getDayWithExercises` return the array; edit via `PUT` replaces it; fork and export round-trip it; omitted → `[]`.

**Web:**
- `PlanEditorPage`: adding a drop/up and setting its reps PUTs `extra_segments` as an array of `{reps}`; removing drops an entry.
- `ExerciseLogger`: given `extraSegmentTargets=[{reps:10}]`, pre-renders one segment row with reps `10` pre-filled and weight empty, and logs `{weight, reps}` for it.

---

## 8. Files Touched (anticipated)

- `db/schema.sql`, `db/migrations/2026-11-06-extra-segment-reps.sql` (new).
- `api/src/plans/schema.ts`, `api/src/plans/repo.ts`.
- `api/__tests__/extra-segments-plan.test.ts` (update to array shape).
- `web/src/plans/PlanEditorPage.tsx` (segment editor), `web/src/plans/PlanViewPage.tsx` (count from length).
- `web/src/session/SessionPage.tsx` (type + pass targets), `web/src/session/ExerciseLogger.tsx` (`extraSegmentTargets`, pre-fill reps).
- Tests alongside each.
