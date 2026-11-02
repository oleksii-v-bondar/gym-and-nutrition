# Admin Shared Templates + Manual Plan Creation — Design Spec

**Date:** 2026-11-02
**Status:** Approved (design); pending implementation plan
**Builds on:** the existing gym-tracker app (web + api + db). Auth uses a `login` (username), not email.

---

## 1. Purpose

Two related capabilities:

1. **Manual plan creation** — any user can create a blank plan and build it in the existing editor (today plans can only be created via JSON import).
2. **Admin-managed shared templates** — a designated admin user curates workout plans ("templates") visible to every user. A regular user who edits a template silently gets their own private copy (copy-on-edit); their changes never affect the template or other users. The admin also keeps personal (non-shared) plans.

**Success criteria**
- Any user can click "Create plan", get a blank plan, and edit it.
- The admin (login == configured value) can mark a plan as a shared template; it then appears in every user's plan list, badged "Template".
- A regular user editing a template (or starting a session from it) transparently forks it into their own account and continues on the copy.
- Admin edits to a template do **not** change copies users already made.
- A non-admin can never create/modify a template or edit another user's data.

**Non-goals (YAGNI)**
- Admin directly browsing/editing each individual user's private plans ("plans for all users" == the templates, not per-user impersonation).
- A roles/permissions table (admin is a single configured login).
- Propagating admin template edits into existing user copies.
- Deleting plans (not required by this feature).

---

## 2. Admin Identity

- New config value `ADMIN_LOGIN` (env, default `ascererak`), parsed in `api/src/config.ts`.
- A user is admin **iff** `user.login === config.adminLogin`.
- `GET /api/me` (auth required) returns `{ id, login, isAdmin }` so the web app can conditionally render admin controls. The web `AuthContext` fetches `/api/me` after login / on load and exposes `isAdmin` + `login`.

---

## 3. Data Model

One additive migration to `db/schema.sql`:

```sql
ALTER TABLE plans ADD COLUMN is_template boolean NOT NULL DEFAULT false;
```

(For a fresh schema apply, the column is declared inline on `plans`.)

- **Template** = a plan with `is_template = true`, owned by the admin.
- Admin personal plans, every regular user's plans, and all forked copies have `is_template = false`.
- No `template_source_id` / provenance column (not needed by any requirement — YAGNI).

---

## 4. Access Rules

| Action | Rule |
|--------|------|
| Read a plan tree / export / day-detail | Allowed if you **own** it **or** it is a template (`is_template = true`). Templates are world-readable. |
| Create a blank plan | Any authenticated user (owner = you, `is_template = false`). |
| Mutate a plan/day/exercise, set active, start a session | Only on a plan you **own**. Non-owners get **404** (unchanged). The client forks a template first. |
| Set `is_template` (true or false) on a plan | **Admin only.** A non-admin attempt → **403**. |
| Fork a plan | Any authenticated user, on any plan they can **read** (their own or a template). |

Server-side ownership checks remain the source of truth; the fork flow is orchestrated by the client but every resulting write still targets a plan the user owns.

---

## 5. API Endpoints (added / changed)

**Added**
- `GET /api/me` → `200 { id, login, isAdmin }`.
- `POST /api/plans` — create a blank plan. Body `{ name }` → `201 { id }`. Owner = requester, `is_template = false`.
- `POST /api/plans/:id/fork` — deep-copy a readable plan (owned or template) into the requester's account as a non-template plan. Returns `201 { id, dayIdMap, exerciseIdMap }` where the maps are `{ oldId: newId }` for every copied day and exercise. 404 if the source is neither owned nor a template.

**Changed**
- `GET /api/plans` — returns the requester's own plans **plus** all templates. Each row: `{ id, name, is_active, is_template, owned }` where `owned = (plan.user_id === requester)`. Implemented as a single `WHERE user_id = $me OR is_template = true`, so the admin's own templates appear exactly once (never double-counted).
- `PUT /api/plans/:id` — may now set `is_template` in addition to `name` / `is_active`. If the body includes `is_template` and the requester is **not** admin → **403** (the whole request is rejected). Ownership still required (admin edits their own template rows).
- `GET /api/plans/:id` (tree), `GET /api/plans/:id/export`, `GET /api/plan-days/:id` — read access widened to allow templates (owned-or-template), so a user can preview a template before forking.

Mutation endpoints (`PUT /api/plans/:id` for name/active, add/edit/delete day & exercise, sessions) keep their existing **owner-only** checks.

---

## 6. Copy-on-Edit Fork Flow (regular user on a template)

The editor (`PlanEditorPage`) knows, from `GET /api/plans/:id`, whether the plan is a template the user does **not** own (`is_template && !owned`). In that state:

- The plan renders in **preview** (a visible hint: "Editing will make your own copy").
- The **first** mutating action — editing an exercise field, add/delete day or exercise, toggling active, or **Start session** — triggers:
  1. `POST /api/plans/:id/fork` → `{ id: copyId, dayIdMap, exerciseIdMap }`.
  2. Translate the action's target id through the maps (e.g. the edited `day_exercise_id` → its copy's id; the session's `dayId` → mapped day id).
  3. Apply the action to the copy, then navigate to `/plan/<copyId>` (or `/session/<mappedDayId>`).
- After the fork the plan is a normal owned plan; subsequent edits are ordinary owner writes.

Because forks are independent snapshots, later admin edits to the template never touch existing copies.

Admin and users who **own** the plan skip all of this — they edit in place as today.

---

## 7. Web UI

- **Plans list (`PlansPage`):**
  - A **"+ Create plan"** button → prompts for a name → `POST /api/plans` → navigates to `/plan/<id>`.
  - Rows for templates show a **"Template"** badge; owned plans are unbadged. (Keeps the existing import button.)
- **Editor (`PlanEditorPage`):**
  - If the current user **is admin** and owns the plan: a **"Shared template (visible to all users)"** toggle bound to `is_template` via `PUT /api/plans/:id`.
  - If the plan is a template the user does **not** own: preview hint + automatic fork-on-edit (§6).
- **Auth context:** exposes `isAdmin` / `login` from `GET /api/me`.

---

## 8. Testing

**API (integration):**
- `POST /api/plans` creates an empty owned plan; appears in `GET /api/plans`.
- `GET /api/me` → `isAdmin: true` for the admin login, `false` otherwise.
- Admin can `PUT is_template=true`; a non-admin `PUT is_template=true` → 403.
- `GET /api/plans` for a regular user includes the admin's templates with `owned:false, is_template:true`, and the user's own plans with `owned:true`.
- A template is readable (`GET /api/plans/:id`) by a non-owner; a **mutation** by that non-owner → 404.
- `POST /api/plans/:id/fork` by a regular user on a template: creates an owned, non-template deep copy (days + exercises), returns id maps covering every element; the fork is isolated (editing it leaves the template unchanged).

**Web (component):**
- "Create plan" button calls `POST /api/plans` and navigates.
- Template rows render the "Template" badge; owned rows do not.
- Editing a non-owned template triggers `POST /api/plans/:id/fork` (fork-on-edit).

---

## 9. Files Touched (anticipated)

- `api/src/config.ts` (adminLogin), `db/schema.sql` (is_template)
- `api/src/plans/repo.ts` (create blank, list-with-templates, fork, read widened, is_template update), `api/src/plans/routes.ts` (POST /plans, fork, /me or a new me route, PUT is_template admin gate, widened reads)
- `api/src/auth/...` or a small `me` route for `GET /api/me`
- `web/src/api/*`, `web/src/auth/AuthContext.tsx` (isAdmin), `web/src/plans/PlansPage.tsx` (create + badges), `web/src/plans/PlanEditorPage.tsx` (template toggle + fork-on-edit)
- Tests alongside each.
