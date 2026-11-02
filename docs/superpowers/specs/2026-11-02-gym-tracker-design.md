# Gym Tracker — Design Spec

**Date:** 2026-11-02
**Status:** Approved (design); pending implementation plan
**Scope of this spec:** Gym/training tracker only. A separate nutrition/food helper is explicitly **out of scope** and will be its own project (spec → plan → implementation) later.

---

## 1. Purpose & Success Criteria

A mobile-first, installable web app that helps a user train in the gym. The user loads a
workout program (exercises grouped by day, each with target sets × reps and an optional
weight/rest). During a workout the app guides them exercise-by-exercise, **suggests a
working weight** for each set, records what actually happened, and **learns** from that
history to adjust future suggestions. The user can also see whether they are **progressing
or regressing** per exercise.

**Success criteria**

- A user can create an account (email + password) and sign in.
- A user can load a plan by importing a JSON file **and** by editing it in-app.
- A user can run a guided workout session: for each set the app shows a suggested weight +
  reason, and the user logs actual reps + effort.
- After a session, suggestions for the next session update according to the documented rule.
- A user can view a per-exercise progress chart and a clear ▲/▬/▼ trend badge.
- All data is per-user, cloud-synced, and isolated: a user can only ever read/write their own data.

**Non-goals (YAGNI for v1)**

- Nutrition/food tracking (separate project).
- Rest timer during workouts.
- Offline support / local-first sync (the app is online-first).
- Social features, sharing, coaching, or multi-coach dashboards.
- Mobile native apps (PWA only).

---

## 2. Users & Platform

- **Multi-user.** Each user has an isolated account and data set.
- **Platform:** Progressive Web App (PWA). Primary target is a **mobile phone screen**;
  the layout must also look correct and usable on desktop (responsive).
- **Online-first:** requires connectivity; no offline logging in v1.

---

## 3. Architecture

A single monorepo deployed to an **Oracle Cloud Always-Free ARM VM** via Docker Compose.

```
┌─────────────────────────────────────────────────────────────┐
│ Oracle Cloud VM (Docker Compose)                             │
│                                                              │
│  ┌────────────┐   /            ┌──────────────┐              │
│  │  Reverse   │ ───────────────▶│  web (static │  React+TS   │
│  │  proxy     │                 │  PWA build)  │  (Vite)     │
│  │ (Caddy/    │   /api/*        └──────────────┘              │
│  │  nginx,    │ ──────────────┐                               │
│  │  TLS)      │               ▼                               │
│  └────────────┘        ┌──────────────┐    ┌──────────────┐  │
│                        │  api (Node + │ ──▶│  PostgreSQL  │  │
│                        │  Express+TS) │    │              │  │
│                        └──────────────┘    └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Components**

- **`web/`** — React + TypeScript PWA (Vite). Mobile-first, responsive. Installable
  (web app manifest + service worker for install/caching of static assets only — not
  offline data). Talks **only** to the API over HTTPS. Holds no DB credentials.
- **`api/`** — Node + Express + TypeScript REST API. Owns **all** business logic: auth,
  the weight-suggestion module, and trend computation. Verifies a JWT on every protected
  route and scopes every query to the authenticated `user_id`.
- **`db`** — PostgreSQL, reachable **only** from the API container (never from the browser).
- **Reverse proxy** (Caddy or nginx) — terminates TLS, serves the static PWA, proxies
  `/api/*` to the Node service.

**Repository layout (proposed)**

```
gym-and-food/
  web/            # React PWA
  api/            # Node/Express API
  db/             # SQL migrations / seed
  deploy/         # docker-compose.yml, reverse-proxy config, env templates
  docs/
```

---

## 4. Data Model (PostgreSQL)

All domain tables carry (directly or transitively) a `user_id`. The API enforces ownership
on every request.

**users**
| column        | type        | notes                          |
|---------------|-------------|--------------------------------|
| id            | uuid PK     |                                |
| email         | text unique | lowercased                     |
| password_hash | text        | bcrypt                         |
| created_at    | timestamptz | default now()                  |

**plans**
| column    | type    | notes                                  |
|-----------|---------|----------------------------------------|
| id        | uuid PK |                                        |
| user_id   | uuid FK | → users.id                             |
| name      | text    | e.g. "Push/Pull/Legs"                  |
| is_active | boolean | the plan currently used in sessions    |

**plan_days**
| column      | type    | notes                      |
|-------------|---------|----------------------------|
| id          | uuid PK |                            |
| plan_id     | uuid FK | → plans.id                 |
| name        | text    | e.g. "Push A"              |
| order_index | int     | ordering within the plan   |

**day_exercises**
| column          | type    | notes                                   |
|-----------------|---------|-----------------------------------------|
| id              | uuid PK |                                         |
| plan_day_id     | uuid FK | → plan_days.id                          |
| exercise_name   | text    | free text (v1); normalized later        |
| order_index     | int     | ordering within the day                 |
| target_sets     | int     |                                         |
| target_reps     | int     | "times" = reps                          |
| rest_seconds    | int?    | optional                                |
| starting_weight | numeric?| optional; seed for first suggestion     |

**workout_sessions**
| column      | type        | notes                    |
|-------------|-------------|--------------------------|
| id          | uuid PK     |                          |
| user_id     | uuid FK     | → users.id               |
| plan_day_id | uuid FK     | → plan_days.id           |
| started_at  | timestamptz |                          |
| finished_at | timestamptz?| null while in progress   |

**set_logs**
| column          | type        | notes                                       |
|-----------------|-------------|---------------------------------------------|
| id              | uuid PK     |                                             |
| session_id      | uuid FK     | → workout_sessions.id                       |
| day_exercise_id | uuid FK     | → day_exercises.id                          |
| set_number      | int         | 1-based                                     |
| weight_used     | numeric     | actual working weight                       |
| reps_done       | int         | actual reps completed                       |
| effort          | enum        | `easy` \| `ok` \| `hard` \| `failed`        |
| created_at      | timestamptz | default now()                               |

Indexes: `set_logs(day_exercise_id, created_at)` and
`workout_sessions(user_id, plan_day_id, started_at)` to support suggestion and trend queries.

---

## 5. Weight-Suggestion Module

An **isolated, pure, fully unit-tested** module in the API.

**Signature**

```
suggestNextWeight(input: {
  lastSession: { sets: Array<{ reps_done, effort, weight_used }> } | null,
  targetReps: number,
  targetSets: number,
  increment: number,        // 2.5 by default
  startingWeight: number | null
}): { weight: number, reason: string }
```

**Rule (based on the most recent completed session for that exercise)**

1. **No history** → return `startingWeight` if present; otherwise signal the UI to ask the
   user to enter a starting weight (`weight: null`, reason: "Enter a starting weight").
2. **All sets hit `target_reps` AND every set effort = `easy`** → `lastWeight + increment`
   (reason: "Last time felt easy → +2.5 kg").
3. **All sets hit `target_reps`, effort `ok`/`hard` (no `failed`)** → `lastWeight`
   (reason: "Hold — hit your reps but it was tough").
4. **Any set `failed` OR any set missed `target_reps`** → `max(0, lastWeight - increment)`
   (reason: "Deload — missed reps / failed a set").

The returned `reason` is always surfaced in the UI so suggestions are transparent.
Increment is configurable (default **2.5 kg**). Weight floors at 0.

**Why isolated:** this is the core "smart" behavior and the most likely thing to evolve
(e.g., toward requiring two easy sessions before a bump). Keeping it pure makes it trivial
to test and swap.

---

## 6. Trend / Progress Module

An **isolated, pure, unit-tested** module in the API.

- **Estimated 1RM** per set via **Epley**: `e1rm = weight_used * (1 + reps_done / 30)`.
  Per session, take the best set's e1rm (and the top working `weight_used`).
- **Series:** for a given exercise, produce a time-ordered series of
  `{ date, topWeight, bestE1rm }` across sessions.
- **Trend badge:** fit a simple slope (e.g., least-squares on `bestE1rm` over the last
  **N = 5** sessions, or fewer if less history). Classify:
  - slope clearly positive → **▲ Progressing**
  - slope near zero (within a small threshold) → **▬ Steady**
  - slope clearly negative → **▼ Regressing**
  - insufficient data (< 2 sessions) → **"Not enough data yet"**

The UI renders a line chart (working weight + est-1RM lines), the trend badge, and a session
history list. A simple dashboard summarizes trend badges across the active plan's exercises.

---

## 7. Guided Workout Session (primary mobile screen)

1. User picks a plan day → a `workout_session` is created (`started_at` set).
2. The app steps through the day's exercises **in order**, one in focus at a time.
3. For each set it shows the **suggested weight + reason**. The user enters **actual reps**
   and taps an **effort** value (easy/ok/hard/failed). Each entry writes a `set_log`.
4. Large touch targets, a visible progress indicator (exercise X of Y, set N of M).
5. On finish, `finished_at` is set; suggestions for next time are implicitly updated because
   they are derived from the latest completed session.

Explicit v1 exclusions: no rest timer; online-only (a lost connection surfaces an error and
retry, it does not queue offline).

---

## 8. Plan Management

- **Import (JSON):** upload a file matching a documented schema. Example:

```json
{
  "name": "Push/Pull/Legs",
  "days": [
    {
      "name": "Push A",
      "exercises": [
        { "exercise_name": "Bench Press", "target_sets": 3, "target_reps": 8,
          "rest_seconds": 120, "starting_weight": 40 },
        { "exercise_name": "Overhead Press", "target_sets": 3, "target_reps": 10 }
      ]
    }
  ]
}
```

  The API validates the payload (shape, types, non-negative numbers) and rejects malformed
  files with a clear error.
- **Edit in-app:** form UI to add/remove/reorder days and exercises and edit targets
  (`target_sets`, `target_reps`, `rest_seconds`, `starting_weight`).
- **Export:** download the active plan as JSON (same schema) as a backup.

---

## 9. Auth & Security

- **Email + password.** Email stored lowercased and unique. Passwords hashed with **bcrypt**.
- **JWT:** short-lived **access token** + longer-lived **refresh token**; refresh endpoint to
  mint new access tokens. Tokens carry `user_id`.
- Every workout/plan route requires a valid access token; all queries are scoped to the
  token's `user_id`. A user can never reference another user's rows (ownership checks on
  every nested resource).
- **Rate-limit** the login endpoint to slow brute force. Standard input validation on all
  endpoints. Secrets (JWT signing key, DB creds) injected via environment variables, never
  committed.

---

## 10. REST API Surface (initial)

```
POST   /api/auth/register         { email, password }
POST   /api/auth/login            { email, password } -> { accessToken, refreshToken }
POST   /api/auth/refresh          { refreshToken }    -> { accessToken }

GET    /api/plans                 list my plans
POST   /api/plans                 create (empty or from import payload)
POST   /api/plans/import          import JSON plan
GET    /api/plans/:id             get plan with days + exercises
PUT    /api/plans/:id             rename / set active
DELETE /api/plans/:id
GET    /api/plans/:id/export      download JSON

POST   /api/plan-days             add day
PUT    /api/plan-days/:id         rename / reorder
DELETE /api/plan-days/:id
POST   /api/day-exercises         add exercise to a day
PUT    /api/day-exercises/:id     edit targets / reorder
DELETE /api/day-exercises/:id

POST   /api/sessions              start a session for a plan_day
GET    /api/sessions/:id          session detail
POST   /api/sessions/:id/sets     log a set { day_exercise_id, set_number, weight_used, reps_done, effort }
POST   /api/sessions/:id/finish   finish a session
GET    /api/exercises/:dayExerciseId/suggestion   -> { weight, reason }
GET    /api/exercises/:dayExerciseId/trend        -> series + trend badge
```

(Exact shapes to be finalized in the implementation plan.)

---

## 11. Testing Strategy

- **API unit tests (highest priority):** the weight-suggestion module and the trend module —
  all branches of the suggestion rule and trend classification (progress / steady / regress /
  insufficient data), including edge cases (no history, failed sets, floor at 0).
- **API integration tests:** auth (register/login/refresh, ownership isolation) and plan/
  session CRUD against a disposable test PostgreSQL.
- **Web component tests:** the guided session logging flow and the plan editor.
- Tests cover only this app's new behavior; no trivial/constant-only tests.

---

## 12. Deployment

- **Docker Compose** services: `db` (Postgres), `api` (Node), `web` (static build served by
  the reverse proxy), `proxy` (Caddy/nginx with TLS).
- Target: **Oracle Cloud Always-Free ARM VM**. Compose file + env templates live in `deploy/`.
- DB schema managed via migrations run on deploy. No secrets committed; provided via env.

---

## 13. Open Items for the Implementation Plan

- Choose reverse proxy (Caddy for automatic TLS vs. nginx) — leaning **Caddy**.
- Choose charting lib for the web trend view (e.g., Recharts/Chart.js) — decide in plan.
- Finalize exact request/response DTOs and validation schemas.
- Migration tooling choice (e.g., node-pg-migrate / Prisma Migrate / raw SQL).
