# Resume In-Progress Sessions — Design Spec

**Date:** 2026-11-05
**Status:** Approved (design); pending implementation plan
**Builds on:** the existing gym-tracker app (web + api + db), including the workout-logging-improvements branch.

---

## 1. Purpose

Let a user continue an interrupted workout and see which workouts are still in progress.

1. **Resume where you left off** — if the session page is reloaded or the app is reopened mid-workout, continue the same session at the next unlogged set instead of starting over.
2. **See in-progress sessions** — surface unfinished sessions so the user can get back to (or discard) them.

**Success criteria**
- Reloading `/session/:dayId` during a workout keeps the **same** session (no duplicate) and lands on the next unlogged set, with the current exercise's weight pre-filled from what was already used this session.
- The **Plans** page shows a banner for each unfinished session with **Resume** and **Discard**.
- Resuming navigates into the existing session; Discard removes it and it disappears from the banner.

**Non-goals (YAGNI)**
- Persisting a literal step cursor (the step is derived from logged sets).
- Back-navigation / editing earlier sets mid-session (that is the separate edit feature).
- Auto-expiring or time-limiting stale in-progress sessions.
- Resuming across a changed day structure gracefully (rare; out of scope).

---

## 2. Resume-or-start (idempotent `POST /api/sessions`)

Today `POST /api/sessions` always inserts a new `workout_sessions` row, so a reload creates a duplicate unfinished session and the client step resets to 0.

**Change:** `POST /api/sessions` becomes resume-or-start:
- If an **unfinished** session (`finished_at IS NULL`) already exists for `(user_id, plan_day_id)`, return it with **200**.
- Otherwise insert a new row and return **201** (unchanged behavior for a fresh start).
- If more than one unfinished session exists for the day (legacy data), return the **most recent** (`ORDER BY started_at DESC, id DESC LIMIT 1`).

The response body is unchanged (`{ id, started_at }`); only the status code differentiates resume (200) from new (201). Existing callers that read `body.id` are unaffected.

No schema change.

---

## 3. Resume at the right step (client-side derivation)

The session flow flattens the day into an ordered `steps` list (exercise-major for normal days, round-major for supersets) — deterministic from the day's exercises. Each completed step logs exactly one set, in step order.

**On mount, `SessionPage`:**
1. Calls `POST /api/sessions` (resume-or-start) → `sessionId`.
2. Fetches the session once (`GET /api/sessions/:id`, which already returns the logged sets) and derives the **starting step = number of logged sets**. This initialization runs **once** (guarded by a ref); afterwards the in-memory `step` state drives the flow exactly as today.
3. If the logged-set count ≥ total steps, shows the finish screen.
4. **Pre-fills the weight** for the current exercise from that exercise's most-recent logged set **in this session** (so later sets of an exercise keep the weight the user actually used); if the current exercise has no set yet this session, falls back to the existing suggestion endpoint.

Step derivation is count-based, so set ordering within a superset round does not matter. No schema or API change beyond reusing `GET /api/sessions/:id`.

---

## 4. See in-progress sessions (`GET /api/sessions/active` + Plans banner)

**API — new `GET /api/sessions/active`:**
- Returns the requesting user's unfinished sessions (`finished_at IS NULL`), newest first.
- Each row: `{ id, plan_day_id, day_name, set_count, started_at }` (`day_name` via join to `plan_days`; `set_count` = number of `set_logs` rows).
- **Route ordering:** register `GET /active` **before** `GET /:id` so `active` is not captured by the `:id` param.

**Web — `InProgressBanner` on `PlansPage`:**
- Queries `GET /api/sessions/active` (query key `['sessions', 'active']`).
- For each unfinished session, renders a banner card at the top of the Plans page: day name + set count, a **Resume** link to `/session/${plan_day_id}` (which auto-resumes via §2), and a **Discard** button.
- **Discard** calls the existing `DELETE /api/sessions/:id`, then invalidates `['sessions', 'active']` so the entry disappears.
- Renders nothing when there are no in-progress sessions.

---

## 5. Access Rules

| Action | Rule |
|--------|------|
| `POST /api/sessions` (resume-or-start) | requester must own the `plan_day_id` (unchanged); resumes only the requester's own unfinished session |
| `GET /api/sessions/active` | the requester's own sessions only (`user_id = req.userId`) |
| `DELETE /api/sessions/:id` (discard) | owner-only (unchanged) |

---

## 6. Testing

**API (integration, new `session-resume.test.ts`):**
- `POST /api/sessions` twice for the same day returns the **same** `id` — first call 201, second 200 — and only one unfinished row exists.
- After `finish`, a subsequent `POST` for that day starts a **new** session (the finished one is not resumed).
- `GET /api/sessions/active` returns only the user's unfinished sessions with `day_name` and `set_count`, newest first; excludes finished sessions and other users' sessions.
- Discarding (`DELETE /api/sessions/:id`) removes the session from `GET /api/sessions/active`.

**Web (component):**
- `SessionPage`: given a resumed session whose detail reports 2 logged sets for a 3-set day, it starts on set 3 (not set 1) and pre-fills the weight from the exercise's last logged set this session.
- `InProgressBanner`: renders a Resume link to `/session/:plan_day_id` and a Discard button that calls `DELETE /api/sessions/:id` and refetches; renders nothing when the active list is empty.

---

## 7. Files Touched (anticipated)

- `api/src/sessions/repo.ts` — `getActiveSessionForDay(userId, planDayId)`, `listActiveSessions(userId)`.
- `api/src/sessions/routes.ts` — resume-or-start in `POST /`; new `GET /active` (before `GET /:id`).
- `api/__tests__/session-resume.test.ts` — new.
- `web/src/session/SessionPage.tsx` — resume-or-start handling, step derivation, weight pre-fill.
- `web/src/session/SessionPage.test.tsx` — resume test.
- `web/src/plans/InProgressBanner.tsx` — new banner component.
- `web/src/plans/PlansPage.tsx` — render the banner.
- Tests alongside each.
