# Workout Logging Improvements — Design Spec

**Date:** 2026-11-05
**Status:** Approved (design); pending implementation plan
**Builds on:** the existing gym-tracker app (web + api + db).

---

## 1. Purpose

Four related improvements to the workout logging / history experience:

1. **Edit past trainings** — the owner can edit the **values** of sets in a finished session (weight, reps, effort, extra segments).
2. **Reps field visibility** — fix number inputs so 2-digit values (more than 9 reps) are fully visible.
3. **Bodyweight exercises** — when weight is `0`, present the set as a bodyweight exercise where reps are the primary metric.
4. **"Failed" prompts for completed reps** — tapping *failed* asks how many reps were actually completed before failing, and logs that number.

**Success criteria**
- From a session detail view, the owner can open an **Edit** page, change set values, **Save**, and see the updated values persist.
- Entering/viewing reps like `12` shows all digits in every number input (logger, edit page).
- A set logged with weight `0` renders as **"Bodyweight × N reps"** (not "0 kg × N") in history and the edit view.
- Tapping **failed** reveals an inline **"How many reps did you complete?"** input (pre-filled with the current reps value); confirming logs the set with `effort='failed'` and `reps_done` = the entered number.

**Non-goals (YAGNI)**
- Adding or removing sets from a past session (values-only editing).
- Changing which exercise or set number a logged set belongs to.
- Editing session date/metadata.
- Any data-model change for bodyweight (weight `0` is already representable and stored).

---

## 2. Edit past trainings (values-only)

Follows the established **View/Edit split** pattern already used for plans
(read-only `PlanViewPage` + separate `PlanEditorPage`).

**Web**
- New route `/history/:id/edit` → **`SessionEditPage`**.
- **`SessionDetailPage`** gains an **"Edit"** link to that route.
- The edit page fetches the session (`GET /api/sessions/:id`), renders each logged set grouped by exercise (same grouping as the detail page), with editable controls:
  - **weight** (number), **reps** (number), **effort** (`select`: easy/ok/hard/failed),
  - **extra segments**: each segment's **weight** and **reps** editable.
- **Save** issues a `PATCH` per set (only changed sets need to be sent; sending all is acceptable), then navigates back to `/history/:id`. React Query caches for `['session', id]` and `['sessions']` are invalidated so the detail/list reflect edits.

**Backend**
- New `PATCH /api/sessions/:id/sets/:setId` — owner-only via `userOwnsSession`.
  Body (all fields required, mirrors the create-set contract):
  `{ weight_used: number≥0, reps_done: int≥0, effort: 'easy'|'ok'|'hard'|'failed', extra_segments: Array<{weight≥0, reps:int≥0}> }`.
  Updates the matching `set_logs` row **only if it belongs to `:id`**; 404 if the session isn't owned or the set isn't in that session. Returns the updated set id.
- Repo: `updateSet(sessionId, setId, fields)` — `UPDATE set_logs SET ... WHERE id=$setId AND session_id=$sessionId RETURNING id`.

No schema change.

---

## 3. Reps field visibility (number inputs)

**Root cause:** native `type="number"` spin-button arrows sit on the right edge of the
input and, in narrow mobile fields, overlap/clip the typed value — so `12` looks cut off.

**Fix (`web/src/ui/styles.css`):** hide the spin buttons so the full width is available for the value:

```css
input[type="number"] { -moz-appearance: textfield; }
input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
```

Number inputs also get `inputMode="numeric"` (mobile numeric keypad). Applies to the logger and the new edit page. No behavioral change beyond visibility.

---

## 4. Bodyweight exercises (weight 0)

Display-layer only — `weight_used = 0` already means "bodyweight; reps are the metric".

- **`SessionDetailPage`** (and `SessionEditPage` read labels): a set with `weight_used === 0`
  renders **"Bodyweight × {reps} reps ({effort})"** instead of "0 kg × {reps}".
- **Extra segments** with `weight === 0` render as just the rep count (e.g. `×8`) rather than `0×8`.
- **`ExerciseLogger`**: the weight input caption hints that `0` means bodyweight
  (e.g. caption reads "weight (0 = bodyweight)"). No change to logging logic — `0` is submitted as today, and the suggestion engine already floors at `0`.

A small shared helper formats a set line (bodyweight vs weighted) so the detail and edit views stay consistent.

---

## 5. "Failed" prompts for completed reps

Currently every effort button (`easy/ok/hard/failed`) immediately calls `onLog`.

**New behavior (`ExerciseLogger`):**
- `easy`, `ok`, `hard` — unchanged: log immediately with the current reps value.
- `failed` — does **not** log immediately. The card reveals an inline block:
  - label **"How many reps did you complete?"**,
  - a number input **pre-filled with the current reps value**,
  - a **Confirm** button (and a way to cancel / pick another effort).
  - Confirm calls `onLog(weight, <entered reps>, 'failed', segments)`.

State: a local `failPrompt` boolean (or `pendingEffort`) plus a `failedReps` string.
Switching to a different effort while the prompt is open cancels it. Component resets per
exercise via the existing `key={exercise.id}` remount.

No API change — `reps_done` already carries the completed count and `effort='failed'` is stored as before.

---

## 6. Access Rules

| Action | Rule |
|--------|------|
| `GET /api/sessions/:id` (detail, used by edit page) | owner-only (unchanged) |
| `PATCH /api/sessions/:id/sets/:setId` | owner-only; set must belong to the session → 404 otherwise |

---

## 7. Testing

**API (integration):**
- `PATCH /api/sessions/:id/sets/:setId`: owner updates weight/reps/effort/extra_segments → 200 and `GET /api/sessions/:id` reflects new values.
- Non-owner → 404; a `setId` belonging to a **different** session → 404; invalid body → 400.

**Web (component, vitest):**
- `ExerciseLogger`: tapping **failed** shows the completed-reps prompt pre-filled with current reps; Confirm calls `onLog` with `effort='failed'` and the entered reps. Tapping `easy/ok/hard` still logs immediately (no prompt).
- Bodyweight formatting: a set/segment with weight `0` renders "Bodyweight …" / bare rep count (shared helper or `SessionDetailPage`).
- `SessionEditPage`: renders editable set values and Save issues `PATCH` for a changed set.
- `SessionDetailPage`: shows an **Edit** link to `/history/:id/edit`.

---

## 8. Files Touched (anticipated)

- `api/src/sessions/repo.ts` (`updateSet`), `api/src/sessions/routes.ts` (`PATCH /:id/sets/:setId`)
- `web/src/session/ExerciseLogger.tsx` (failed prompt, bodyweight caption, inputMode)
- `web/src/history/SessionDetailPage.tsx` (Edit link, bodyweight formatting)
- `web/src/history/SessionEditPage.tsx` (new edit page)
- `web/src/App.tsx` (route `/history/:id/edit`)
- `web/src/ui/styles.css` (hide number spin buttons)
- (optional) a small shared set-line formatting helper under `web/src/history/` or `web/src/ui/`
- Tests: API integration tests in `api/__tests__/` (e.g. a new `session-edit.test.ts`); web component tests as `*.test.tsx` beside components.
