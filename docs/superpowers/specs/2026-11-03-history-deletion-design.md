# Session History + Deletion (sessions & plans) — Design Spec

**Date:** 2026-11-03
**Status:** Approved (design); pending implementation plan
**Builds on:** the existing gym-tracker app (web + api + db).

---

## 1. Purpose

Three related capabilities:

1. **View previous sessions** — a History page listing the user's finished workouts (date, day name, summary), with a per-session detail view of the logged sets.
2. **Delete a session** — the owner can delete one of their past sessions.
3. **Delete a plan** — the plan's **owner** or the **admin** can delete a plan; the plan's past workout history is **preserved**.

**Success criteria**
- A "History" nav link opens a list of the user's **finished** sessions (newest first) with date, day name, and a set count.
- Tapping a session shows its sets grouped by exercise (weight×reps, effort, and any additional reps/weight).
- A user can delete their own session (it disappears from History; its set rows are removed).
- A plan's owner or the admin can delete a plan; it vanishes from all plan lists, but its past sessions remain visible in History.

**Non-goals (YAGNI)**
- Editing past sessions.
- Restoring deleted plans (soft-deleted rows stay hidden; no "trash" UI).
- Deleting individual sets from a past session.
- Admin browsing other users' session history.

---

## 2. Keep-history mechanism — Approach A (soft-delete plans)

Sessions (`workout_sessions.plan_day_id`) and logged sets (`set_logs.day_exercise_id`) reference a plan's days/exercises with `ON DELETE CASCADE`. A hard delete of a plan would therefore wipe its history. Instead:

- Add `plans.deleted_at timestamptz NULL`.
- "Delete plan" **sets `deleted_at = now()`** rather than removing rows.
- All plan **reads/lists filter `deleted_at IS NULL`**, so a deleted plan disappears everywhere — but its days/exercises/sessions/sets stay intact, so History keeps full names and detail.
- Session deletion remains a **hard delete** (a session + its `set_logs` via existing cascade).

---

## 3. Data Model

```sql
ALTER TABLE plans ADD COLUMN deleted_at timestamptz;
```

(For a fresh schema apply, the column is declared inline on `plans`, default NULL.) No other schema change.

---

## 4. API

**New**
- `GET /api/sessions` — the current user's **finished** sessions (`finished_at IS NOT NULL`), newest first. Each row:
  `{ id, finished_at, plan_day_id, day_name, set_count }` (`day_name` via join to `plan_days`; `set_count` = number of `set_logs` rows).
- `DELETE /api/sessions/:id` — **owner-only** (`userOwnsSession`); hard-deletes the session (its `set_logs` cascade). 404 otherwise. Returns 204.
- `DELETE /api/plans/:id` — allowed if the requester **owns** the plan **or** is **admin** (`isAdminUser`); soft-delete (`deleted_at = now()`). 404 if neither owner nor admin. Returns 204.

**Changed**
- `GET /api/sessions/:id` — enrich the response: add top-level `day_name`, and each set gains `exercise_name` (join `day_exercises`). Still owner-only. (Suggestion/trend queries are unaffected.)
- Plan reads filter soft-deleted rows: `listVisiblePlans` and `getPlanTree` add `deleted_at IS NULL`; `forkPlan`'s source select adds `deleted_at IS NULL`.

**Unchanged:** suggestion/trend endpoints and modules.

---

## 5. Access Rules

| Action | Rule |
|--------|------|
| `GET /api/sessions` (history list) | the requester's own sessions only (`user_id = req.userId`) |
| `GET /api/sessions/:id` (detail) | owner-only (unchanged) |
| `DELETE /api/sessions/:id` | owner-only → 404 otherwise |
| `DELETE /api/plans/:id` | owner **or** admin → 404 otherwise |
| Reads of a soft-deleted plan (list/tree/fork) | excluded (treated as not found) |

---

## 6. Web

- **NavBar:** add a **"History"** link (route `/history`).
- **HistoryPage** (`/history`): lists finished sessions via `GET /api/sessions` — each shows the formatted **date**, **day name**, **N sets**, and a **Delete** button (with a confirm, e.g. `window.confirm`). Delete calls `DELETE /api/sessions/:id` and refetches. Tapping a row navigates to the detail.
- **SessionDetailPage** (`/history/:id`): fetches `GET /api/sessions/:id`; shows the day name + date, then the sets grouped by `exercise_name`, each line showing `weight × reps` (effort) and any additional reps/weight segments.
- **Plan editor (`PlanEditorPage`):** a **"Delete plan"** button, shown when `plan.owned` **or** `isAdmin`; on click, confirm, then `DELETE /api/plans/:id` → navigate to `/` (Plans). (The copy-on-edit fork rules do not apply to delete — delete acts directly and is gated by owner/admin on the server.)

---

## 7. Testing

**API (integration):**
- `GET /api/sessions` returns only the user's **finished** sessions, newest first, with `day_name` and `set_count`; excludes unfinished and other users' sessions.
- `GET /api/sessions/:id` detail includes `day_name` and `exercise_name` per set.
- `DELETE /api/sessions/:id`: owner → 204 and it's gone from the list; non-owner → 404.
- `DELETE /api/plans/:id`: owner → 204; admin on someone else's plan → 204; stranger (non-owner, non-admin) → 404. After delete, the plan is absent from `GET /api/plans` but a prior finished session for it still appears in `GET /api/sessions` (history preserved).

**Web (component):**
- HistoryPage renders session rows and Delete triggers `DELETE /api/sessions/:id`.
- SessionDetailPage renders sets grouped by exercise.
- Plan editor shows "Delete plan" (owned/admin) and clicking it (confirmed) calls `DELETE /api/plans/:id`.

---

## 8. Files Touched (anticipated)

- `db/schema.sql` (deleted_at)
- `api/src/sessions/repo.ts` (listUserSessions, deleteSession, getSession enrich), `api/src/sessions/routes.ts` (GET /, DELETE /:id)
- `api/src/plans/repo.ts` (softDeletePlan, deleted_at filters), `api/src/plans/routes.ts` (DELETE /:id)
- `web/src/ui/NavBar.tsx` (History link)
- `web/src/history/HistoryPage.tsx`, `web/src/history/SessionDetailPage.tsx` (new)
- `web/src/App.tsx` (routes), `web/src/plans/PlanEditorPage.tsx` (delete button)
- Tests alongside each.
