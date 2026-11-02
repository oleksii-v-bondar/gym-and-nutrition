# Gym Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first PWA that guides a user through gym workouts, suggests working weights that learn from effort history, and shows per-exercise progress trends.

**Architecture:** Monorepo with three deployables run via Docker Compose on an Oracle Cloud VM: a React+TypeScript PWA (`web/`), a Node+Express+TypeScript REST API (`api/`) that owns all business logic, and PostgreSQL (`db`). The browser talks only to the API; the API is the only thing that touches Postgres. A Caddy reverse proxy terminates TLS, serves the static PWA, and proxies `/api/*` to the API.

**Tech Stack:** React 18, Vite, TypeScript, react-router-dom, @tanstack/react-query, Recharts, vite-plugin-pwa (web). Node 20, Express 4, TypeScript, pg (node-postgres, raw SQL), Zod, bcryptjs, jsonwebtoken, express-rate-limit (api). PostgreSQL 16. Vitest + Supertest (api tests), Vitest + @testing-library/react + jsdom (web tests). Caddy (reverse proxy). Docker Compose (deploy).

## Global Constraints

- **Scope:** Gym tracker only. No nutrition/food features, no rest timer, no offline support, no native apps.
- **Node version floor:** Node 20+.
- **Multi-user isolation:** Every API route that touches user data MUST require a valid JWT access token and MUST scope every query to the authenticated `user_id`. A user can never read or write another user's rows.
- **"Times" means reps.** Exercise targets are `target_sets` × `target_reps`.
- **Weight increment default:** 2.5 (kg). Weight floors at 0.
- **Effort enum (exact values):** `easy`, `ok`, `hard`, `failed`.
- **Trend window:** last `N = 5` sessions (fewer if less history); needs ≥ 2 sessions to classify.
- **Secrets** (JWT signing secret, DB credentials) come from environment variables only; never commit them. `.env` files are gitignored.
- **DB access:** raw SQL via `pg`. No ORM. Money/weight numbers use Postgres `numeric`.
- **IDs:** UUID primary keys (`gen_random_uuid()` from the `pgcrypto` extension).
- **Commit style:** Conventional Commits (`feat:`, `test:`, `chore:`, `docs:`). Commit after each task's tests pass.

---

## File Structure

```
gym-and-food/
  db/
    schema.sql                 # full v1 schema; applied at DB init and in tests
  api/
    package.json
    tsconfig.json
    vitest.config.ts
    .env.example
    src/
      config.ts                # env parsing (PORT, DATABASE_URL, JWT_SECRET, ...)
      db.ts                    # pg Pool + query helper
      app.ts                   # express app factory (no listen) — used by tests
      server.ts                # import app, listen on PORT
      auth/
        password.ts            # hash/verify (bcryptjs)
        tokens.ts              # sign/verify access + refresh JWTs
        middleware.ts          # requireAuth -> sets req.userId
        routes.ts              # POST register/login/refresh
      plans/
        schema.ts              # Zod schemas for plan import/edit DTOs
        repo.ts                # SQL for plans/days/exercises
        routes.ts              # plans + days + exercises + import/export endpoints
      sessions/
        repo.ts                # SQL for sessions + set_logs
        routes.ts              # start/detail/log-set/finish endpoints
      suggestion/
        suggest.ts             # PURE suggestNextWeight()
        routes.ts              # GET /exercises/:id/suggestion
      trend/
        trend.ts               # PURE computeTrend()
        routes.ts              # GET /exercises/:id/trend
      test/
        helpers.ts             # test DB setup/teardown, auth helper
    __tests__/                 # integration tests (supertest)
  web/
    package.json
    tsconfig.json
    vite.config.ts
    vitest.config.ts
    index.html
    src/
      main.tsx
      App.tsx                  # router
      api/client.ts            # fetch wrapper with token handling
      api/hooks.ts             # react-query hooks
      auth/AuthContext.tsx
      auth/LoginPage.tsx
      auth/RegisterPage.tsx
      plans/PlansPage.tsx
      plans/PlanEditorPage.tsx
      plans/importPlan.ts      # client-side JSON file read + POST
      session/SessionPage.tsx  # guided workout screen
      progress/ProgressPage.tsx
      progress/TrendBadge.tsx
      ui/                      # shared mobile-first components + styles
  deploy/
    docker-compose.yml
    Caddyfile
    api.Dockerfile
    web.Dockerfile
    .env.example
  docs/
```

**Responsibilities:** pure logic (`suggestion/suggest.ts`, `trend/trend.ts`) has zero I/O and is unit-tested exhaustively. `repo.ts` files hold all SQL for their domain. `routes.ts` files do validation (Zod) + auth + call repos. The web layer never holds DB logic; it calls the API.

---

### Task 1: API scaffold + database schema

**Files:**
- Create: `api/package.json`, `api/tsconfig.json`, `api/vitest.config.ts`, `api/.env.example`, `api/src/config.ts`, `api/src/db.ts`
- Create: `db/schema.sql`

**Interfaces:**
- Produces: `config` object `{ port:number, databaseUrl:string, jwtSecret:string, accessTtl:string, refreshTtl:string, bcryptRounds:number }` from `api/src/config.ts`; `query(text,params)` and `pool` from `api/src/db.ts`.

- [ ] **Step 1: Scaffold the API package**

Run:
```bash
cd api
npm init -y
npm pkg set type=module
npm i express pg zod bcryptjs jsonwebtoken express-rate-limit cors
npm i -D typescript tsx vitest supertest @types/express @types/pg @types/bcryptjs @types/jsonwebtoken @types/supertest @types/cors @types/node
npx tsc --init
```

- [ ] **Step 2: Configure TypeScript and scripts**

Set `api/tsconfig.json` compilerOptions: `"module":"ESNext","target":"ES2022","moduleResolution":"Bundler","strict":true,"esModuleInterop":true,"skipLibCheck":true,"outDir":"dist","rootDir":"src"`.
Add to `api/package.json` scripts:
```json
{ "dev": "tsx watch src/server.ts", "build": "tsc", "start": "node dist/server.js", "test": "vitest run" }
```

- [ ] **Step 3: Write `api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', globals: true } });
```

- [ ] **Step 4: Write `api/.env.example`**

```
PORT=3000
DATABASE_URL=postgres://gym:gym@localhost:5432/gym
JWT_SECRET=change-me-in-prod
ACCESS_TTL=15m
REFRESH_TTL=30d
BCRYPT_ROUNDS=12
```

- [ ] **Step 5: Write `api/src/config.ts`**

```ts
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  accessTtl: process.env.ACCESS_TTL ?? '15m',
  refreshTtl: process.env.REFRESH_TTL ?? '30d',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
};
```

- [ ] **Step 6: Write `api/src/db.ts`**

```ts
import pg from 'pg';
import { config } from './config.js';
export const pool = new pg.Pool({ connectionString: config.databaseUrl });
export async function query<T extends pg.QueryResultRow = any>(
  text: string, params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as any[]);
}
```

- [ ] **Step 7: Write `db/schema.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS plan_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name text NOT NULL,
  order_index int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS day_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_day_id uuid NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
  exercise_name text NOT NULL,
  order_index int NOT NULL DEFAULT 0,
  target_sets int NOT NULL,
  target_reps int NOT NULL,
  rest_seconds int,
  starting_weight numeric
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_day_id uuid NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TYPE effort_level AS ENUM ('easy','ok','hard','failed');

CREATE TABLE IF NOT EXISTS set_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  day_exercise_id uuid NOT NULL REFERENCES day_exercises(id) ON DELETE CASCADE,
  set_number int NOT NULL,
  weight_used numeric NOT NULL,
  reps_done int NOT NULL,
  effort effort_level NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_set_logs_ex_time ON set_logs(day_exercise_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_day_time ON workout_sessions(user_id, plan_day_id, started_at);
```

Note: `CREATE TYPE` has no `IF NOT EXISTS`; the test harness (Task 2) drops the schema before reapplying, so re-runs are safe.

- [ ] **Step 8: Commit**

```bash
git add api db/schema.sql
git commit -m "chore: scaffold api package and database schema"
```

---

### Task 2: App factory + test harness

**Files:**
- Create: `api/src/app.ts`, `api/src/server.ts`, `api/src/test/helpers.ts`
- Test: `api/__tests__/health.test.ts`

**Interfaces:**
- Consumes: `query`/`pool` (Task 1), `config` (Task 1).
- Produces: `createApp(): Express` from `app.ts` (no `listen`); `setupTestDb()`, `teardownTestDb()`, `resetDb()` from `test/helpers.ts`.

- [ ] **Step 1: Write the failing test `api/__tests__/health.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';
it('GET /api/health returns ok', async () => {
  const res = await request(createApp()).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd api && npx vitest run __tests__/health.test.ts`
Expected: FAIL — cannot find `../src/app.js`.

- [ ] **Step 3: Write `api/src/app.ts`**

```ts
import express, { Express } from 'express';
import cors from 'cors';
export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  return app;
}
```

- [ ] **Step 4: Write `api/src/server.ts`**

```ts
import { createApp } from './app.js';
import { config } from './config.js';
createApp().listen(config.port, () => console.log(`api on :${config.port}`));
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd api && DATABASE_URL=postgres://x JWT_SECRET=x npx vitest run __tests__/health.test.ts`
Expected: PASS. (Env vars are set because `config.ts` loads on import.)

- [ ] **Step 6: Write `api/src/test/helpers.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from '../db.js';
const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/schema.sql');
export async function setupTestDb(): Promise<void> {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await query(sql);
}
export async function resetDb(): Promise<void> {
  await query('TRUNCATE users RESTART IDENTITY CASCADE;');
}
export async function teardownTestDb(): Promise<void> {
  await pool.end();
}
```

- [ ] **Step 7: Document running integration tests**

Integration tests require a running Postgres. Add to `api/package.json` scripts:
```json
{ "test:int": "DATABASE_URL=${TEST_DATABASE_URL:-postgres://gym:gym@localhost:5432/gym_test} JWT_SECRET=test-secret vitest run" }
```
Start a throwaway DB with:
```bash
docker run --rm -d --name gymtest -e POSTGRES_USER=gym -e POSTGRES_PASSWORD=gym -e POSTGRES_DB=gym_test -p 5432:5432 postgres:16
```

- [ ] **Step 8: Commit**

```bash
git add api
git commit -m "feat: add express app factory, server entry, and test harness"
```

---

### Task 3: Auth primitives (password hashing + JWT)

**Files:**
- Create: `api/src/auth/password.ts`, `api/src/auth/tokens.ts`
- Test: `api/__tests__/auth-primitives.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain:string):Promise<string>`, `verifyPassword(plain:string,hash:string):Promise<boolean>` (password.ts); `signAccess(userId:string):string`, `signRefresh(userId:string):string`, `verifyToken(token:string):{ sub:string, type:'access'|'refresh' }` (tokens.ts).

- [ ] **Step 1: Write the failing test `api/__tests__/auth-primitives.test.ts`**

```ts
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { signAccess, signRefresh, verifyToken } from '../src/auth/tokens.js';

it('hashes and verifies a password', async () => {
  const hash = await hashPassword('s3cret');
  expect(hash).not.toBe('s3cret');
  expect(await verifyPassword('s3cret', hash)).toBe(true);
  expect(await verifyPassword('wrong', hash)).toBe(false);
});

it('signs and verifies access and refresh tokens with type', () => {
  const a = signAccess('user-1');
  const r = signRefresh('user-1');
  expect(verifyToken(a)).toMatchObject({ sub: 'user-1', type: 'access' });
  expect(verifyToken(r)).toMatchObject({ sub: 'user-1', type: 'refresh' });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd api && JWT_SECRET=test DATABASE_URL=postgres://x npx vitest run __tests__/auth-primitives.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `api/src/auth/password.ts`**

```ts
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.bcryptRounds);
}
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: Write `api/src/auth/tokens.ts`**

```ts
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
type TokenType = 'access' | 'refresh';
export interface TokenPayload { sub: string; type: TokenType; }
export function signAccess(userId: string): string {
  return jwt.sign({ sub: userId, type: 'access' }, config.jwtSecret, { expiresIn: config.accessTtl } as jwt.SignOptions);
}
export function signRefresh(userId: string): string {
  return jwt.sign({ sub: userId, type: 'refresh' }, config.jwtSecret, { expiresIn: config.refreshTtl } as jwt.SignOptions);
}
export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
  return { sub: String(decoded.sub), type: decoded.type as TokenType };
}
```

- [ ] **Step 5: Run and watch it pass**

Run: `cd api && JWT_SECRET=test DATABASE_URL=postgres://x npx vitest run __tests__/auth-primitives.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/auth __tests__/auth-primitives.test.ts
git commit -m "feat: add password hashing and jwt token helpers"
```

---

### Task 4: Auth routes + requireAuth middleware

**Files:**
- Create: `api/src/auth/middleware.ts`, `api/src/auth/routes.ts`
- Modify: `api/src/app.ts` (mount auth router + rate limiter)
- Test: `api/__tests__/auth-routes.test.ts`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` (Task 3), `signAccess`/`signRefresh`/`verifyToken` (Task 3), `query` (Task 1).
- Produces: `requireAuth` Express middleware that sets `req.userId: string` and 401s otherwise; `authRouter` mounted at `/api/auth`. Endpoints: `POST /api/auth/register` -> 201 `{ id, email }`; `POST /api/auth/login` -> 200 `{ accessToken, refreshToken }`; `POST /api/auth/refresh` -> 200 `{ accessToken }`.

- [ ] **Step 1: Write the failing test `api/__tests__/auth-routes.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb);
beforeEach(resetDb);
afterAll(teardownTestDb);

it('registers, logs in, and rejects bad credentials', async () => {
  const reg = await request(app).post('/api/auth/register').send({ email: 'A@x.com', password: 'pw123456' });
  expect(reg.status).toBe(201);
  expect(reg.body.email).toBe('a@x.com');

  const login = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw123456' });
  expect(login.status).toBe(200);
  expect(login.body.accessToken).toBeTruthy();
  expect(login.body.refreshToken).toBeTruthy();

  const bad = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'nope' });
  expect(bad.status).toBe(401);
});

it('refresh exchanges a refresh token for an access token', async () => {
  await request(app).post('/api/auth/register').send({ email: 'b@x.com', password: 'pw123456' });
  const login = await request(app).post('/api/auth/login').send({ email: 'b@x.com', password: 'pw123456' });
  const res = await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
  expect(res.status).toBe(200);
  expect(res.body.accessToken).toBeTruthy();
});

it('rejects duplicate email', async () => {
  await request(app).post('/api/auth/register').send({ email: 'c@x.com', password: 'pw123456' });
  const dup = await request(app).post('/api/auth/register').send({ email: 'c@x.com', password: 'pw123456' });
  expect(dup.status).toBe(409);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd api && npm run test:int -- __tests__/auth-routes.test.ts` (Postgres must be running — see Task 2 Step 7)
Expected: FAIL — `/api/auth/register` returns 404.

- [ ] **Step 3: Write `api/src/auth/middleware.ts`**

```ts
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './tokens.js';
declare global { namespace Express { interface Request { userId?: string } } }
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const [, token] = header.split(' ');
  if (!token) { res.status(401).json({ error: 'missing token' }); return; }
  try {
    const payload = verifyToken(token);
    if (payload.type !== 'access') { res.status(401).json({ error: 'wrong token type' }); return; }
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}
```

- [ ] **Step 4: Write `api/src/auth/routes.ts`**

```ts
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { hashPassword, verifyPassword } from './password.js';
import { signAccess, signRefresh, verifyToken } from './tokens.js';

const credentials = z.object({ email: z.string().email(), password: z.string().min(8) });
export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid input' }); return; }
  const email = parsed.data.email.toLowerCase();
  const hash = await hashPassword(parsed.data.password);
  try {
    const r = await query<{ id: string; email: string }>(
      'INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id, email', [email, hash]);
    res.status(201).json(r.rows[0]);
  } catch (e: any) {
    if (e?.code === '23505') { res.status(409).json({ error: 'email already registered' }); return; }
    throw e;
  }
});

authRouter.post('/login', async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid input' }); return; }
  const email = parsed.data.email.toLowerCase();
  const r = await query<{ id: string; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE email=$1', [email]);
  const user = r.rows[0];
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    res.status(401).json({ error: 'invalid credentials' }); return;
  }
  res.json({ accessToken: signAccess(user.id), refreshToken: signRefresh(user.id) });
});

authRouter.post('/refresh', (req, res) => {
  const token = z.object({ refreshToken: z.string() }).safeParse(req.body);
  if (!token.success) { res.status(400).json({ error: 'invalid input' }); return; }
  try {
    const payload = verifyToken(token.data.refreshToken);
    if (payload.type !== 'refresh') { res.status(401).json({ error: 'wrong token type' }); return; }
    res.json({ accessToken: signAccess(payload.sub) });
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
});
```

- [ ] **Step 5: Mount the router + rate limiter in `api/src/app.ts`**

Add imports and wiring (inside `createApp`, after `express.json`):
```ts
import rateLimit from 'express-rate-limit';
import { authRouter } from './auth/routes.js';
// ...
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRouter);
```

- [ ] **Step 6: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/auth-routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add api
git commit -m "feat: add auth routes (register/login/refresh) and requireAuth middleware"
```

---

### Task 5: Plans domain (CRUD + import + export)

**Files:**
- Create: `api/src/plans/schema.ts`, `api/src/plans/repo.ts`, `api/src/plans/routes.ts`
- Modify: `api/src/app.ts` (mount `plansRouter` behind `requireAuth`)
- Test: `api/__tests__/plans.test.ts`

**Interfaces:**
- Consumes: `query` (Task 1), `requireAuth` (Task 4).
- Produces: `plansRouter` mounted at `/api/plans` (all routes require auth). `importSchema` Zod shape for a plan file. Repo functions: `createPlanFromImport(userId, data)`, `listPlans(userId)`, `getPlanTree(userId, planId)`, `exportPlan(userId, planId)`. Plan tree shape: `{ id, name, is_active, days: [{ id, name, order_index, exercises: [{ id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight }] }] }`.

- [ ] **Step 1: Write `api/src/plans/schema.ts`**

```ts
import { z } from 'zod';
export const exerciseImport = z.object({
  exercise_name: z.string().min(1),
  target_sets: z.number().int().positive(),
  target_reps: z.number().int().positive(),
  rest_seconds: z.number().int().nonnegative().nullable().optional(),
  starting_weight: z.number().nonnegative().nullable().optional(),
});
export const dayImport = z.object({
  name: z.string().min(1),
  exercises: z.array(exerciseImport),
});
export const importSchema = z.object({
  name: z.string().min(1),
  days: z.array(dayImport),
});
export type PlanImport = z.infer<typeof importSchema>;
```

- [ ] **Step 2: Write the failing test `api/__tests__/plans.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb);
beforeEach(resetDb);
afterAll(teardownTestDb);

async function authFor(email: string) {
  await request(app).post('/api/auth/register').send({ email, password: 'pw123456' });
  const login = await request(app).post('/api/auth/login').send({ email, password: 'pw123456' });
  return login.body.accessToken as string;
}
const samplePlan = {
  name: 'PPL',
  days: [{ name: 'Push A', exercises: [
    { exercise_name: 'Bench', target_sets: 3, target_reps: 8, starting_weight: 40 },
    { exercise_name: 'OHP', target_sets: 3, target_reps: 10 },
  ] }],
};

it('requires auth', async () => {
  const res = await request(app).get('/api/plans');
  expect(res.status).toBe(401);
});

it('imports, lists, reads, and exports a plan', async () => {
  const token = await authFor('a@x.com');
  const imp = await request(app).post('/api/plans/import').set('Authorization', `Bearer ${token}`).send(samplePlan);
  expect(imp.status).toBe(201);
  const planId = imp.body.id;

  const list = await request(app).get('/api/plans').set('Authorization', `Bearer ${token}`);
  expect(list.body).toHaveLength(1);

  const tree = await request(app).get(`/api/plans/${planId}`).set('Authorization', `Bearer ${token}`);
  expect(tree.body.days[0].exercises).toHaveLength(2);
  expect(tree.body.days[0].exercises[0].exercise_name).toBe('Bench');

  const exp = await request(app).get(`/api/plans/${planId}/export`).set('Authorization', `Bearer ${token}`);
  expect(exp.body.name).toBe('PPL');
  expect(exp.body.days[0].exercises).toHaveLength(2);
});

it('rejects a malformed import', async () => {
  const token = await authFor('b@x.com');
  const res = await request(app).post('/api/plans/import').set('Authorization', `Bearer ${token}`)
    .send({ name: 'bad', days: [{ name: 'd', exercises: [{ exercise_name: '', target_sets: -1, target_reps: 0 }] }] });
  expect(res.status).toBe(400);
});

it('does not leak another user plan', async () => {
  const t1 = await authFor('owner@x.com');
  const imp = await request(app).post('/api/plans/import').set('Authorization', `Bearer ${t1}`).send(samplePlan);
  const t2 = await authFor('intruder@x.com');
  const res = await request(app).get(`/api/plans/${imp.body.id}`).set('Authorization', `Bearer ${t2}`);
  expect(res.status).toBe(404);
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `cd api && npm run test:int -- __tests__/plans.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 4: Write `api/src/plans/repo.ts`**

```ts
import { pool, query } from '../db.js';
import type { PlanImport } from './schema.js';

export async function createPlanFromImport(userId: string, data: PlanImport): Promise<{ id: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const plan = await client.query<{ id: string }>(
      'INSERT INTO plans (user_id, name, is_active) VALUES ($1,$2,false) RETURNING id', [userId, data.name]);
    const planId = plan.rows[0].id;
    for (let d = 0; d < data.days.length; d++) {
      const day = data.days[d];
      const dayRow = await client.query<{ id: string }>(
        'INSERT INTO plan_days (plan_id, name, order_index) VALUES ($1,$2,$3) RETURNING id', [planId, day.name, d]);
      const dayId = dayRow.rows[0].id;
      for (let e = 0; e < day.exercises.length; e++) {
        const ex = day.exercises[e];
        await client.query(
          `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [dayId, ex.exercise_name, e, ex.target_sets, ex.target_reps, ex.rest_seconds ?? null, ex.starting_weight ?? null]);
      }
    }
    await client.query('COMMIT');
    return { id: planId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function listPlans(userId: string) {
  const r = await query('SELECT id, name, is_active FROM plans WHERE user_id=$1 ORDER BY name', [userId]);
  return r.rows;
}

export async function getPlanTree(userId: string, planId: string) {
  const plan = await query<{ id: string; name: string; is_active: boolean }>(
    'SELECT id, name, is_active FROM plans WHERE id=$1 AND user_id=$2', [planId, userId]);
  if (!plan.rows[0]) return null;
  const days = await query(
    'SELECT id, name, order_index FROM plan_days WHERE plan_id=$1 ORDER BY order_index', [planId]);
  const exercises = await query(
    `SELECT de.id, de.plan_day_id, de.exercise_name, de.order_index, de.target_sets, de.target_reps, de.rest_seconds, de.starting_weight
     FROM day_exercises de JOIN plan_days pd ON pd.id = de.plan_day_id
     WHERE pd.plan_id=$1 ORDER BY de.order_index`, [planId]);
  return {
    ...plan.rows[0],
    days: days.rows.map((d: any) => ({
      ...d,
      exercises: exercises.rows.filter((x: any) => x.plan_day_id === d.id)
        .map(({ plan_day_id, ...rest }: any) => rest),
    })),
  };
}

export async function exportPlan(userId: string, planId: string) {
  const tree = await getPlanTree(userId, planId);
  if (!tree) return null;
  return {
    name: tree.name,
    days: tree.days.map((d: any) => ({
      name: d.name,
      exercises: d.exercises.map((e: any) => ({
        exercise_name: e.exercise_name, target_sets: e.target_sets, target_reps: e.target_reps,
        rest_seconds: e.rest_seconds, starting_weight: e.starting_weight,
      })),
    })),
  };
}
```

- [ ] **Step 5: Write `api/src/plans/routes.ts`**

```ts
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { importSchema } from './schema.js';
import { createPlanFromImport, listPlans, getPlanTree, exportPlan } from './repo.js';

export const plansRouter = Router();
plansRouter.use(requireAuth);

plansRouter.get('/', async (req, res) => {
  res.json(await listPlans(req.userId!));
});

plansRouter.post('/import', async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid plan', details: parsed.error.issues }); return; }
  const created = await createPlanFromImport(req.userId!, parsed.data);
  res.status(201).json(created);
});

plansRouter.get('/:id', async (req, res) => {
  const tree = await getPlanTree(req.userId!, req.params.id);
  if (!tree) { res.status(404).json({ error: 'not found' }); return; }
  res.json(tree);
});

plansRouter.get('/:id/export', async (req, res) => {
  const data = await exportPlan(req.userId!, req.params.id);
  if (!data) { res.status(404).json({ error: 'not found' }); return; }
  res.json(data);
});
```

- [ ] **Step 6: Mount in `api/src/app.ts`**

```ts
import { plansRouter } from './plans/routes.js';
// after auth mount:
app.use('/api/plans', plansRouter);
```

- [ ] **Step 7: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/plans.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add api
git commit -m "feat: add plans domain with import, read-tree, and export"
```

> In-app editing endpoints (spec §8) are fully specified in **Task 6**.

---

### Task 6: Plan editing endpoints (in-app editor backend)

**Files:**
- Modify: `api/src/plans/repo.ts` (add ownership helper + edit functions), `api/src/plans/routes.ts` (add routes), `api/src/plans/schema.ts` (add edit DTOs)
- Test: `api/__tests__/plan-edit.test.ts`

**Interfaces:**
- Consumes: `query`/`pool` (Task 1), `requireAuth` (Task 4), `getPlanTree` (Task 5).
- Produces (routes, all under `/api/plans` + auth):
  `PUT /api/plans/:id` body `{ name?, is_active? }` -> 200 updated plan row;
  `POST /api/plans/:id/days` body `{ name }` -> 201 `{ id }`;
  `PUT /api/plan-days/:id` body `{ name?, order_index? }` -> 200;
  `DELETE /api/plan-days/:id` -> 204;
  `POST /api/plan-days/:id/exercises` body exercise fields -> 201 `{ id }`;
  `PUT /api/day-exercises/:id` body partial exercise fields -> 200;
  `DELETE /api/day-exercises/:id` -> 204.
  Every route 404s if the target does not belong to `req.userId`.
- Produces repo helpers: `userOwnsPlanDay(userId, dayId):Promise<boolean>`, `userOwnsExercise(userId, exId):Promise<boolean>`.

- [ ] **Step 1: Add edit DTOs to `api/src/plans/schema.ts`**

```ts
export const planUpdate = z.object({
  name: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
});
export const dayCreate = z.object({ name: z.string().min(1) });
export const dayUpdate = z.object({
  name: z.string().min(1).optional(),
  order_index: z.number().int().nonnegative().optional(),
});
export const exerciseUpsert = z.object({
  exercise_name: z.string().min(1).optional(),
  order_index: z.number().int().nonnegative().optional(),
  target_sets: z.number().int().positive().optional(),
  target_reps: z.number().int().positive().optional(),
  rest_seconds: z.number().int().nonnegative().nullable().optional(),
  starting_weight: z.number().nonnegative().nullable().optional(),
});
```

- [ ] **Step 2: Write the failing test `api/__tests__/plan-edit.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(email: string) {
  await request(app).post('/api/auth/register').send({ email, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ email, password: 'pw123456' })).body.accessToken as string;
}
async function seedPlan(token: string) {
  return (await request(app).post('/api/plans/import').set('Authorization', `Bearer ${token}`)
    .send({ name: 'P', days: [{ name: 'Day', exercises: [{ exercise_name: 'Squat', target_sets: 3, target_reps: 5 }] }] })).body.id;
}

it('activates a plan, adds a day and exercise, edits and deletes', async () => {
  const t = await auth('e@x.com');
  const planId = await seedPlan(t);
  const H = { Authorization: `Bearer ${t}` };

  expect((await request(app).put(`/api/plans/${planId}`).set(H).send({ is_active: true })).status).toBe(200);

  const day = await request(app).post(`/api/plans/${planId}/days`).set(H).send({ name: 'Day 2' });
  expect(day.status).toBe(201);

  const ex = await request(app).post(`/api/plan-days/${day.body.id}/exercises`).set(H)
    .send({ exercise_name: 'Deadlift', target_sets: 1, target_reps: 5 });
  expect(ex.status).toBe(201);

  expect((await request(app).put(`/api/day-exercises/${ex.body.id}`).set(H).send({ target_reps: 3 })).status).toBe(200);
  expect((await request(app).delete(`/api/day-exercises/${ex.body.id}`).set(H)).status).toBe(204);
  expect((await request(app).delete(`/api/plan-days/${day.body.id}`).set(H)).status).toBe(204);
});

it('blocks editing another user resource', async () => {
  const owner = await auth('owner@x.com');
  const planId = await seedPlan(owner);
  const tree = await request(app).get(`/api/plans/${planId}`).set({ Authorization: `Bearer ${owner}` });
  const dayId = tree.body.days[0].id;
  const intruder = await auth('intruder@x.com');
  const res = await request(app).put(`/api/plan-days/${dayId}`).set({ Authorization: `Bearer ${intruder}` }).send({ name: 'hack' });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `cd api && npm run test:int -- __tests__/plan-edit.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 4: Add ownership helpers + edit functions to `api/src/plans/repo.ts`**

```ts
export async function userOwnsPlan(userId: string, planId: string): Promise<boolean> {
  const r = await query('SELECT 1 FROM plans WHERE id=$1 AND user_id=$2', [planId, userId]);
  return r.rowCount! > 0;
}
export async function userOwnsPlanDay(userId: string, dayId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM plan_days pd JOIN plans p ON p.id=pd.plan_id WHERE pd.id=$1 AND p.user_id=$2`, [dayId, userId]);
  return r.rowCount! > 0;
}
export async function userOwnsExercise(userId: string, exId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM day_exercises de JOIN plan_days pd ON pd.id=de.plan_day_id JOIN plans p ON p.id=pd.plan_id
     WHERE de.id=$1 AND p.user_id=$2`, [exId, userId]);
  return r.rowCount! > 0;
}
export async function updatePlan(planId: string, fields: { name?: string; is_active?: boolean }) {
  const sets: string[] = []; const vals: unknown[] = [];
  if (fields.name !== undefined) { vals.push(fields.name); sets.push(`name=$${vals.length}`); }
  if (fields.is_active !== undefined) { vals.push(fields.is_active); sets.push(`is_active=$${vals.length}`); }
  if (!sets.length) return;
  vals.push(planId);
  await query(`UPDATE plans SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
}
export async function addDay(planId: string, name: string) {
  const r = await query<{ id: string }>(
    `INSERT INTO plan_days (plan_id, name, order_index)
     VALUES ($1,$2,(SELECT COALESCE(MAX(order_index)+1,0) FROM plan_days WHERE plan_id=$1)) RETURNING id`, [planId, name]);
  return r.rows[0];
}
export async function updateDay(dayId: string, fields: { name?: string; order_index?: number }) {
  const sets: string[] = []; const vals: unknown[] = [];
  if (fields.name !== undefined) { vals.push(fields.name); sets.push(`name=$${vals.length}`); }
  if (fields.order_index !== undefined) { vals.push(fields.order_index); sets.push(`order_index=$${vals.length}`); }
  if (!sets.length) return;
  vals.push(dayId);
  await query(`UPDATE plan_days SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
}
export async function deleteDay(dayId: string) { await query('DELETE FROM plan_days WHERE id=$1', [dayId]); }
export async function addExercise(dayId: string, ex: any) {
  const r = await query<{ id: string }>(
    `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight)
     VALUES ($1,$2,(SELECT COALESCE(MAX(order_index)+1,0) FROM day_exercises WHERE plan_day_id=$1),$3,$4,$5,$6) RETURNING id`,
    [dayId, ex.exercise_name, ex.target_sets, ex.target_reps, ex.rest_seconds ?? null, ex.starting_weight ?? null]);
  return r.rows[0];
}
export async function updateExercise(exId: string, fields: Record<string, unknown>) {
  const cols = ['exercise_name','order_index','target_sets','target_reps','rest_seconds','starting_weight'];
  const sets: string[] = []; const vals: unknown[] = [];
  for (const c of cols) if (fields[c] !== undefined) { vals.push(fields[c]); sets.push(`${c}=$${vals.length}`); }
  if (!sets.length) return;
  vals.push(exId);
  await query(`UPDATE day_exercises SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
}
export async function deleteExercise(exId: string) { await query('DELETE FROM day_exercises WHERE id=$1', [exId]); }
```

- [ ] **Step 5: Add routes to `api/src/plans/routes.ts`**

```ts
import { planUpdate, dayCreate, dayUpdate, exerciseUpsert } from './schema.js';
import {
  userOwnsPlan, userOwnsPlanDay, userOwnsExercise,
  updatePlan, addDay, updateDay, deleteDay, addExercise, updateExercise, deleteExercise,
} from './repo.js';

plansRouter.put('/:id', async (req, res) => {
  if (!(await userOwnsPlan(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  const p = planUpdate.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  await updatePlan(req.params.id, p.data);
  res.json({ id: req.params.id, ...p.data });
});

plansRouter.post('/:id/days', async (req, res) => {
  if (!(await userOwnsPlan(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  const p = dayCreate.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  res.status(201).json(await addDay(req.params.id, p.data.name));
});
```

Add a **separate** router for day/exercise resources (mounted at root) in a new export `plansSubRouter`, because their paths are not under `/api/plans/:id`. `Router` and `requireAuth` are already imported at the top of this file (Task 5 / this task) — do **not** re-import them:

```ts
export const plansSubRouter = Router();
plansSubRouter.use(requireAuth);

plansSubRouter.put('/plan-days/:id', async (req, res) => {
  if (!(await userOwnsPlanDay(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  const p = dayUpdate.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  await updateDay(req.params.id, p.data); res.json({ id: req.params.id, ...p.data });
});
plansSubRouter.delete('/plan-days/:id', async (req, res) => {
  if (!(await userOwnsPlanDay(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  await deleteDay(req.params.id); res.status(204).end();
});
plansSubRouter.post('/plan-days/:id/exercises', async (req, res) => {
  if (!(await userOwnsPlanDay(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  const p = exerciseUpsert.safeParse(req.body);
  if (!p.success || p.data.exercise_name === undefined || p.data.target_sets === undefined || p.data.target_reps === undefined) {
    res.status(400).json({ error: 'invalid' }); return;
  }
  res.status(201).json(await addExercise(req.params.id, p.data));
});
plansSubRouter.put('/day-exercises/:id', async (req, res) => {
  if (!(await userOwnsExercise(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  const p = exerciseUpsert.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  await updateExercise(req.params.id, p.data); res.json({ id: req.params.id });
});
plansSubRouter.delete('/day-exercises/:id', async (req, res) => {
  if (!(await userOwnsExercise(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  await deleteExercise(req.params.id); res.status(204).end();
});
```

- [ ] **Step 6: Mount `plansSubRouter` in `api/src/app.ts`**

```ts
import { plansRouter, plansSubRouter } from './plans/routes.js';
app.use('/api/plans', plansRouter);
app.use('/api', plansSubRouter);
```

- [ ] **Step 7: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/plan-edit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add api
git commit -m "feat: add plan editing endpoints (days/exercises CRUD, activate)"
```

---

### Task 7: Workout sessions domain

**Files:**
- Create: `api/src/sessions/repo.ts`, `api/src/sessions/routes.ts`
- Modify: `api/src/app.ts` (mount `sessionsRouter`)
- Test: `api/__tests__/sessions.test.ts`

**Interfaces:**
- Consumes: `query`/`pool` (Task 1), `requireAuth` (Task 4), ownership helpers (Task 6: `userOwnsPlanDay`, `userOwnsExercise`).
- Produces: `sessionsRouter` at `/api/sessions` (auth). Endpoints:
  `POST /api/sessions` body `{ plan_day_id }` -> 201 `{ id, started_at }`;
  `GET /api/sessions/:id` -> 200 `{ id, plan_day_id, started_at, finished_at, sets: SetLog[] }`;
  `POST /api/sessions/:id/sets` body `{ day_exercise_id, set_number, weight_used, reps_done, effort }` -> 201 `{ id }`;
  `POST /api/sessions/:id/finish` -> 200 `{ id, finished_at }`.
  `SetLog = { id, day_exercise_id, set_number, weight_used:number, reps_done, effort, created_at }`.
- Produces repo helpers reused later: `userOwnsSession(userId, sessionId):Promise<boolean>`, `latestCompletedSessionSets(userId, dayExerciseId): Promise<Array<{reps_done:number, effort:string, weight_used:number}>>` (sets from the most recent *finished* session that logged that exercise).

- [ ] **Step 1: Write the failing test `api/__tests__/sessions.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(email: string) {
  await request(app).post('/api/auth/register').send({ email, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ email, password: 'pw123456' })).body.accessToken as string;
}
async function seed(token: string) {
  const plan = await request(app).post('/api/plans/import').set('Authorization', `Bearer ${token}`)
    .send({ name: 'P', days: [{ name: 'D', exercises: [{ exercise_name: 'Bench', target_sets: 3, target_reps: 8, starting_weight: 40 }] }] });
  const tree = await request(app).get(`/api/plans/${plan.body.id}`).set('Authorization', `Bearer ${token}`);
  return { dayId: tree.body.days[0].id, exId: tree.body.days[0].exercises[0].id };
}

it('runs a full session: start, log sets, finish, read back', async () => {
  const t = await auth('s@x.com'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await seed(t);
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  expect(sess.status).toBe(201);
  for (let n = 1; n <= 3; n++) {
    const r = await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
      .send({ day_exercise_id: exId, set_number: n, weight_used: 40, reps_done: 8, effort: 'easy' });
    expect(r.status).toBe(201);
  }
  const fin = await request(app).post(`/api/sessions/${sess.body.id}/finish`).set(H);
  expect(fin.status).toBe(200);
  expect(fin.body.finished_at).toBeTruthy();
  const read = await request(app).get(`/api/sessions/${sess.body.id}`).set(H);
  expect(read.body.sets).toHaveLength(3);
  expect(read.body.sets[0].weight_used).toBe(40);
});

it('rejects an invalid effort value', async () => {
  const t = await auth('s2@x.com'); const H = { Authorization: `Bearer ${t}` };
  const { dayId, exId } = await seed(t);
  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  const r = await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
    .send({ day_exercise_id: exId, set_number: 1, weight_used: 40, reps_done: 8, effort: 'nope' });
  expect(r.status).toBe(400);
});

it('blocks logging into another user session', async () => {
  const owner = await auth('o@x.com'); const Ho = { Authorization: `Bearer ${owner}` };
  const { dayId, exId } = await seed(owner);
  const sess = await request(app).post('/api/sessions').set(Ho).send({ plan_day_id: dayId });
  const intruder = await auth('i@x.com');
  const r = await request(app).post(`/api/sessions/${sess.body.id}/sets`).set({ Authorization: `Bearer ${intruder}` })
    .send({ day_exercise_id: exId, set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok' });
  expect(r.status).toBe(404);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd api && npm run test:int -- __tests__/sessions.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Write `api/src/sessions/repo.ts`**

```ts
import { query } from '../db.js';
export async function userOwnsSession(userId: string, sessionId: string): Promise<boolean> {
  const r = await query('SELECT 1 FROM workout_sessions WHERE id=$1 AND user_id=$2', [sessionId, userId]);
  return r.rowCount! > 0;
}
export async function startSession(userId: string, planDayId: string) {
  const r = await query<{ id: string; started_at: string }>(
    'INSERT INTO workout_sessions (user_id, plan_day_id) VALUES ($1,$2) RETURNING id, started_at', [userId, planDayId]);
  return r.rows[0];
}
export async function logSet(sessionId: string, s: {
  day_exercise_id: string; set_number: number; weight_used: number; reps_done: number; effort: string;
}) {
  const r = await query<{ id: string }>(
    `INSERT INTO set_logs (session_id, day_exercise_id, set_number, weight_used, reps_done, effort)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [sessionId, s.day_exercise_id, s.set_number, s.weight_used, s.reps_done, s.effort]);
  return r.rows[0];
}
export async function finishSession(sessionId: string) {
  const r = await query<{ id: string; finished_at: string }>(
    'UPDATE workout_sessions SET finished_at=now() WHERE id=$1 RETURNING id, finished_at', [sessionId]);
  return r.rows[0];
}
export async function getSession(sessionId: string) {
  const s = await query('SELECT id, plan_day_id, started_at, finished_at FROM workout_sessions WHERE id=$1', [sessionId]);
  if (!s.rows[0]) return null;
  const sets = await query(
    `SELECT id, day_exercise_id, set_number, weight_used::float8 AS weight_used, reps_done, effort, created_at
     FROM set_logs WHERE session_id=$1 ORDER BY set_number`, [sessionId]);
  return { ...s.rows[0], sets: sets.rows };
}
export async function latestCompletedSessionSets(userId: string, dayExerciseId: string) {
  const r = await query<{ reps_done: number; effort: string; weight_used: number }>(
    `SELECT sl.reps_done, sl.effort, sl.weight_used::float8 AS weight_used
     FROM set_logs sl JOIN workout_sessions ws ON ws.id = sl.session_id
     WHERE sl.day_exercise_id=$1 AND ws.user_id=$2 AND ws.finished_at IS NOT NULL
       AND ws.id = (
         SELECT ws2.id FROM set_logs sl2 JOIN workout_sessions ws2 ON ws2.id = sl2.session_id
         WHERE sl2.day_exercise_id=$1 AND ws2.user_id=$2 AND ws2.finished_at IS NOT NULL
         ORDER BY ws2.finished_at DESC LIMIT 1)
     ORDER BY sl.set_number`, [dayExerciseId, userId]);
  return r.rows;
}
```

- [ ] **Step 4: Write `api/src/sessions/routes.ts`**

```ts
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { userOwnsPlanDay } from '../plans/repo.js';
import { startSession, logSet, finishSession, getSession, userOwnsSession } from './repo.js';

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);

const startBody = z.object({ plan_day_id: z.string().uuid() });
const setBody = z.object({
  day_exercise_id: z.string().uuid(),
  set_number: z.number().int().positive(),
  weight_used: z.number().nonnegative(),
  reps_done: z.number().int().nonnegative(),
  effort: z.enum(['easy', 'ok', 'hard', 'failed']),
});

sessionsRouter.post('/', async (req, res) => {
  const p = startBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  if (!(await userOwnsPlanDay(req.userId!, p.data.plan_day_id))) { res.status(404).json({ error: 'not found' }); return; }
  res.status(201).json(await startSession(req.userId!, p.data.plan_day_id));
});

sessionsRouter.get('/:id', async (req, res) => {
  if (!(await userOwnsSession(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  res.json(await getSession(req.params.id));
});

sessionsRouter.post('/:id/sets', async (req, res) => {
  if (!(await userOwnsSession(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  const p = setBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  res.status(201).json(await logSet(req.params.id, p.data));
});

sessionsRouter.post('/:id/finish', async (req, res) => {
  if (!(await userOwnsSession(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  res.json(await finishSession(req.params.id));
});
```

- [ ] **Step 5: Mount in `api/src/app.ts`**

```ts
import { sessionsRouter } from './sessions/routes.js';
app.use('/api/sessions', sessionsRouter);
```

- [ ] **Step 6: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/sessions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add api
git commit -m "feat: add workout sessions domain (start/log-set/finish/read)"
```

---

### Task 8: Weight-suggestion module (PURE)

**Files:**
- Create: `api/src/suggestion/suggest.ts`
- Test: `api/src/suggestion/suggest.test.ts`

**Interfaces:**
- Consumes: nothing (pure — no I/O).
- Produces:
```ts
export type Effort = 'easy' | 'ok' | 'hard' | 'failed';
export interface PastSet { reps_done: number; effort: Effort; weight_used: number; }
export interface SuggestInput {
  lastSets: PastSet[] | null;   // sets from the most recent completed session for this exercise
  targetReps: number;
  increment: number;            // default 2.5
  startingWeight: number | null;
}
export interface Suggestion { weight: number | null; reason: string; }
export function suggestNextWeight(input: SuggestInput): Suggestion;
```
Rule (from spec §5): no history -> startingWeight (or null+prompt); all sets hit targetReps AND all `easy` -> lastWeight+increment; all hit reps, no `failed` -> hold; any `failed` OR any set below targetReps -> max(0, lastWeight-increment). `lastWeight` = the max `weight_used` across the last session's sets.

- [ ] **Step 1: Write the failing test `api/src/suggestion/suggest.test.ts`**

```ts
import { suggestNextWeight } from './suggest.js';

const base = { targetReps: 8, increment: 2.5, startingWeight: null };

it('no history with a starting weight -> starting weight', () => {
  expect(suggestNextWeight({ ...base, lastSets: null, startingWeight: 40 }))
    .toEqual({ weight: 40, reason: expect.stringContaining('Starting') });
});

it('no history and no starting weight -> prompt (null)', () => {
  expect(suggestNextWeight({ ...base, lastSets: null }))
    .toEqual({ weight: null, reason: expect.stringContaining('Enter') });
});

it('all sets hit reps and all easy -> +increment', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 8, effort: 'easy', weight_used: 40 },
    { reps_done: 8, effort: 'easy', weight_used: 40 },
  ] });
  expect(r.weight).toBe(42.5);
  expect(r.reason).toMatch(/easy/i);
});

it('hit reps but some ok/hard -> hold', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 8, effort: 'easy', weight_used: 40 },
    { reps_done: 8, effort: 'hard', weight_used: 40 },
  ] });
  expect(r.weight).toBe(40);
});

it('a failed set -> deload by increment', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 8, effort: 'ok', weight_used: 40 },
    { reps_done: 4, effort: 'failed', weight_used: 40 },
  ] });
  expect(r.weight).toBe(37.5);
});

it('missed target reps (no failed flag) -> deload', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 6, effort: 'hard', weight_used: 40 },
  ] });
  expect(r.weight).toBe(37.5);
});

it('deload floors at 0', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 2, effort: 'failed', weight_used: 2 },
  ] });
  expect(r.weight).toBe(0);
});

it('uses the heaviest set as the reference weight', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 8, effort: 'easy', weight_used: 40 },
    { reps_done: 8, effort: 'easy', weight_used: 42.5 },
  ] });
  expect(r.weight).toBe(45);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd api && npx vitest run src/suggestion/suggest.test.ts`
Expected: FAIL — `./suggest.js` not found.

- [ ] **Step 3: Write `api/src/suggestion/suggest.ts`**

```ts
export type Effort = 'easy' | 'ok' | 'hard' | 'failed';
export interface PastSet { reps_done: number; effort: Effort; weight_used: number; }
export interface SuggestInput {
  lastSets: PastSet[] | null;
  targetReps: number;
  increment: number;
  startingWeight: number | null;
}
export interface Suggestion { weight: number | null; reason: string; }

export function suggestNextWeight(input: SuggestInput): Suggestion {
  const { lastSets, targetReps, increment, startingWeight } = input;
  if (!lastSets || lastSets.length === 0) {
    if (startingWeight != null) return { weight: startingWeight, reason: `Starting weight ${startingWeight} kg` };
    return { weight: null, reason: 'Enter a starting weight for this exercise' };
  }
  const lastWeight = Math.max(...lastSets.map((s) => s.weight_used));
  const anyFailed = lastSets.some((s) => s.effort === 'failed');
  const missedReps = lastSets.some((s) => s.reps_done < targetReps);
  if (anyFailed || missedReps) {
    return { weight: Math.max(0, lastWeight - increment), reason: `Deload \u2212${increment} kg (missed reps / failed a set)` };
  }
  const allEasy = lastSets.every((s) => s.effort === 'easy');
  if (allEasy) {
    return { weight: lastWeight + increment, reason: `Last time felt easy \u2192 +${increment} kg` };
  }
  return { weight: lastWeight, reason: 'Hold \u2014 you hit your reps but it was tough' };
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd api && npx vitest run src/suggestion/suggest.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/suggestion
git commit -m "feat: add pure weight-suggestion module with full rule coverage"
```

---

### Task 9: Suggestion endpoint

**Files:**
- Create: `api/src/suggestion/routes.ts`
- Modify: `api/src/app.ts` (mount), `api/src/sessions/repo.ts` already provides `latestCompletedSessionSets`
- Test: `api/__tests__/suggestion-route.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (Task 4), `userOwnsExercise` (Task 6), `latestCompletedSessionSets` (Task 7), `suggestNextWeight` (Task 8), `query` (Task 1).
- Produces: `GET /api/exercises/:dayExerciseId/suggestion` -> 200 `{ weight:number|null, reason:string }`; 404 if the exercise is not the user's.

- [ ] **Step 1: Write the failing test `api/__tests__/suggestion-route.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(email: string) {
  await request(app).post('/api/auth/register').send({ email, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ email, password: 'pw123456' })).body.accessToken as string;
}

it('suggests starting weight when there is no history, then bumps after an easy session', async () => {
  const t = await auth('sg@x.com'); const H = { Authorization: `Bearer ${t}` };
  const plan = await request(app).post('/api/plans/import').set(H)
    .send({ name: 'P', days: [{ name: 'D', exercises: [{ exercise_name: 'Bench', target_sets: 2, target_reps: 8, starting_weight: 40 }] }] });
  const tree = await request(app).get(`/api/plans/${plan.body.id}`).set(H);
  const exId = tree.body.days[0].exercises[0].id;
  const dayId = tree.body.days[0].id;

  const first = await request(app).get(`/api/exercises/${exId}/suggestion`).set(H);
  expect(first.body).toEqual({ weight: 40, reason: expect.stringContaining('Starting') });

  const sess = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
  for (let n = 1; n <= 2; n++)
    await request(app).post(`/api/sessions/${sess.body.id}/sets`).set(H)
      .send({ day_exercise_id: exId, set_number: n, weight_used: 40, reps_done: 8, effort: 'easy' });
  await request(app).post(`/api/sessions/${sess.body.id}/finish`).set(H);

  const next = await request(app).get(`/api/exercises/${exId}/suggestion`).set(H);
  expect(next.body.weight).toBe(42.5);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd api && npm run test:int -- __tests__/suggestion-route.test.ts`
Expected: FAIL — route 404.

- [ ] **Step 3: Write `api/src/suggestion/routes.ts`**

```ts
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { userOwnsExercise } from '../plans/repo.js';
import { latestCompletedSessionSets } from '../sessions/repo.js';
import { suggestNextWeight, Effort } from './suggest.js';

export const suggestionRouter = Router();
suggestionRouter.use(requireAuth);

suggestionRouter.get('/:dayExerciseId/suggestion', async (req, res) => {
  const exId = req.params.dayExerciseId;
  if (!(await userOwnsExercise(req.userId!, exId))) { res.status(404).json({ error: 'not found' }); return; }
  const meta = await query<{ target_reps: number; starting_weight: number | null }>(
    'SELECT target_reps, starting_weight::float8 AS starting_weight FROM day_exercises WHERE id=$1', [exId]);
  const lastRows = await latestCompletedSessionSets(req.userId!, exId);
  const lastSets = lastRows.length
    ? lastRows.map((r) => ({ reps_done: r.reps_done, effort: r.effort as Effort, weight_used: r.weight_used }))
    : null;
  res.json(suggestNextWeight({
    lastSets,
    targetReps: meta.rows[0].target_reps,
    increment: 2.5,
    startingWeight: meta.rows[0].starting_weight,
  }));
});
```

- [ ] **Step 4: Mount in `api/src/app.ts`**

```ts
import { suggestionRouter } from './suggestion/routes.js';
app.use('/api/exercises', suggestionRouter);
```

- [ ] **Step 5: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/suggestion-route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api
git commit -m "feat: add suggestion endpoint wiring history to the pure module"
```

---

### Task 10: Trend module (PURE)

**Files:**
- Create: `api/src/trend/trend.ts`
- Test: `api/src/trend/trend.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
```ts
export interface SessionPoint { date: string; topWeight: number; bestE1rm: number; }
export type TrendLabel = 'progressing' | 'steady' | 'regressing' | 'insufficient';
export interface TrendResult { series: SessionPoint[]; label: TrendLabel; slope: number; }
export function epley(weight: number, reps: number): number;    // weight * (1 + reps/30)
export function computeTrend(
  sessions: Array<{ date: string; sets: Array<{ weight_used: number; reps_done: number }> }>,
  window?: number   // default 5
): TrendResult;
```
Classification: < 2 session points -> `insufficient`; else least-squares slope of `bestE1rm` over the last `window` points. slope > +0.1 -> `progressing`; slope < -0.1 -> `regressing`; otherwise `steady`.

- [ ] **Step 1: Write the failing test `api/src/trend/trend.test.ts`**

```ts
import { epley, computeTrend } from './trend.js';

it('epley computes estimated 1RM', () => {
  expect(epley(100, 0)).toBe(100);
  expect(epley(30, 30)).toBeCloseTo(60);
});

it('insufficient data for fewer than two sessions', () => {
  expect(computeTrend([{ date: '2026-01-01', sets: [{ weight_used: 40, reps_done: 8 }] }]).label).toBe('insufficient');
  expect(computeTrend([]).label).toBe('insufficient');
});

it('rising weights -> progressing', () => {
  const r = computeTrend([
    { date: '2026-01-01', sets: [{ weight_used: 40, reps_done: 8 }] },
    { date: '2026-01-03', sets: [{ weight_used: 42.5, reps_done: 8 }] },
    { date: '2026-01-05', sets: [{ weight_used: 45, reps_done: 8 }] },
  ]);
  expect(r.label).toBe('progressing');
  expect(r.slope).toBeGreaterThan(0);
  expect(r.series).toHaveLength(3);
  expect(r.series[0].bestE1rm).toBeCloseTo(epley(40, 8));
});

it('falling weights -> regressing', () => {
  const r = computeTrend([
    { date: '2026-01-01', sets: [{ weight_used: 50, reps_done: 8 }] },
    { date: '2026-01-03', sets: [{ weight_used: 45, reps_done: 8 }] },
    { date: '2026-01-05', sets: [{ weight_used: 40, reps_done: 8 }] },
  ]);
  expect(r.label).toBe('regressing');
});

it('flat weights -> steady', () => {
  const r = computeTrend([
    { date: '2026-01-01', sets: [{ weight_used: 40, reps_done: 8 }] },
    { date: '2026-01-03', sets: [{ weight_used: 40, reps_done: 8 }] },
    { date: '2026-01-05', sets: [{ weight_used: 40, reps_done: 8 }] },
  ]);
  expect(r.label).toBe('steady');
});

it('respects the window (only the last N points)', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    sets: [{ weight_used: 40 + i, reps_done: 8 }],
  }));
  const r = computeTrend(many, 5);
  expect(r.series).toHaveLength(5);
  expect(r.series[0].topWeight).toBe(43); // points 4..8 -> weights 43..47
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd api && npx vitest run src/trend/trend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `api/src/trend/trend.ts`**

```ts
export interface SessionPoint { date: string; topWeight: number; bestE1rm: number; }
export type TrendLabel = 'progressing' | 'steady' | 'regressing' | 'insufficient';
export interface TrendResult { series: SessionPoint[]; label: TrendLabel; slope: number; }

export function epley(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

function leastSquaresSlope(ys: number[]): number {
  const n = ys.length;
  const xs = ys.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) ** 2; }
  return den === 0 ? 0 : num / den;
}

export function computeTrend(
  sessions: Array<{ date: string; sets: Array<{ weight_used: number; reps_done: number }> }>,
  window = 5,
): TrendResult {
  const points: SessionPoint[] = sessions
    .filter((s) => s.sets.length > 0)
    .map((s) => ({
      date: s.date,
      topWeight: Math.max(...s.sets.map((x) => x.weight_used)),
      bestE1rm: Math.max(...s.sets.map((x) => epley(x.weight_used, x.reps_done))),
    }));
  const series = points.slice(-window);
  if (series.length < 2) return { series, label: 'insufficient', slope: 0 };
  const slope = leastSquaresSlope(series.map((p) => p.bestE1rm));
  const label: TrendLabel = slope > 0.1 ? 'progressing' : slope < -0.1 ? 'regressing' : 'steady';
  return { series, label, slope };
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd api && npx vitest run src/trend/trend.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/trend
git commit -m "feat: add pure trend module (epley e1rm + slope classification)"
```

---

### Task 11: Trend endpoint

**Files:**
- Create: `api/src/trend/routes.ts`
- Modify: `api/src/app.ts` (mount on existing `/api/exercises`)
- Test: `api/__tests__/trend-route.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (Task 4), `userOwnsExercise` (Task 6), `query` (Task 1), `computeTrend` (Task 10).
- Produces: `GET /api/exercises/:dayExerciseId/trend` -> 200 `TrendResult`; 404 if not the user's exercise. The route gathers, per **finished** session that logged this exercise, that session's sets, ordered by `finished_at`.

- [ ] **Step 1: Write the failing test `api/__tests__/trend-route.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(email: string) {
  await request(app).post('/api/auth/register').send({ email, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ email, password: 'pw123456' })).body.accessToken as string;
}

it('reports progressing across three rising sessions', async () => {
  const t = await auth('tr@x.com'); const H = { Authorization: `Bearer ${t}` };
  const plan = await request(app).post('/api/plans/import').set(H)
    .send({ name: 'P', days: [{ name: 'D', exercises: [{ exercise_name: 'Bench', target_sets: 1, target_reps: 8 }] }] });
  const tree = await request(app).get(`/api/plans/${plan.body.id}`).set(H);
  const dayId = tree.body.days[0].id; const exId = tree.body.days[0].exercises[0].id;
  for (const w of [40, 42.5, 45]) {
    const s = await request(app).post('/api/sessions').set(H).send({ plan_day_id: dayId });
    await request(app).post(`/api/sessions/${s.body.id}/sets`).set(H)
      .send({ day_exercise_id: exId, set_number: 1, weight_used: w, reps_done: 8, effort: 'ok' });
    await request(app).post(`/api/sessions/${s.body.id}/finish`).set(H);
  }
  const res = await request(app).get(`/api/exercises/${exId}/trend`).set(H);
  expect(res.status).toBe(200);
  expect(res.body.label).toBe('progressing');
  expect(res.body.series).toHaveLength(3);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd api && npm run test:int -- __tests__/trend-route.test.ts`
Expected: FAIL — route 404.

- [ ] **Step 3: Write `api/src/trend/routes.ts`**

```ts
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { userOwnsExercise } from '../plans/repo.js';
import { computeTrend } from './trend.js';

export const trendRouter = Router();
trendRouter.use(requireAuth);

trendRouter.get('/:dayExerciseId/trend', async (req, res) => {
  const exId = req.params.dayExerciseId;
  if (!(await userOwnsExercise(req.userId!, exId))) { res.status(404).json({ error: 'not found' }); return; }
  const rows = await query<{ session_id: string; finished_at: string; weight_used: number; reps_done: number }>(
    `SELECT ws.id AS session_id, ws.finished_at, sl.weight_used::float8 AS weight_used, sl.reps_done
     FROM set_logs sl JOIN workout_sessions ws ON ws.id = sl.session_id
     WHERE sl.day_exercise_id=$1 AND ws.user_id=$2 AND ws.finished_at IS NOT NULL
     ORDER BY ws.finished_at ASC, sl.set_number ASC`, [exId, req.userId]);
  const bySession = new Map<string, { date: string; sets: Array<{ weight_used: number; reps_done: number }> }>();
  for (const r of rows) {
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, { date: r.finished_at, sets: [] });
    bySession.get(r.session_id)!.sets.push({ weight_used: r.weight_used, reps_done: r.reps_done });
  }
  res.json(computeTrend([...bySession.values()]));
});
```

- [ ] **Step 4: Mount in `api/src/app.ts`**

```ts
import { trendRouter } from './trend/routes.js';
app.use('/api/exercises', trendRouter);
```

- [ ] **Step 5: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/trend-route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api
git commit -m "feat: add trend endpoint aggregating finished-session history"
```

---

## Web (PWA) Tasks

### Task 12: Web scaffold + API client + auth context

**Files:**
- Create via scaffold: `web/` (Vite React-TS). Then create/modify: `web/vite.config.ts`, `web/vitest.config.ts`, `web/src/api/client.ts`, `web/src/auth/AuthContext.tsx`, `web/src/ui/styles.css`, `web/.env.example`
- Test: `web/src/api/client.test.ts`

**Interfaces:**
- Produces:
  - `web/src/api/client.ts`: `setTokens(a,r)`, `clearTokens()`, `getAccessToken()`, and `apiFetch<T>(path, init?): Promise<T>` which attaches the access token, and on a 401 tries `POST /api/auth/refresh` once with the stored refresh token, then retries. Tokens persist in `localStorage` under `gym.access` / `gym.refresh`.
  - `web/src/auth/AuthContext.tsx`: `AuthProvider`, `useAuth(): { isAuthed, login(email,pw), register(email,pw), logout }`.
- Base URL comes from `import.meta.env.VITE_API_BASE ?? ''` (empty -> same origin, correct behind the Caddy proxy).

- [ ] **Step 1: Scaffold the web app**

Run:
```bash
npm create vite@latest web -- --template react-ts
cd web
npm i react-router-dom @tanstack/react-query recharts
npm i -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom vite-plugin-pwa
```

- [ ] **Step 2: Configure Vite + PWA in `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Gym Tracker', short_name: 'Gym', theme_color: '#111827', background_color: '#111827',
        display: 'standalone', start_url: '/',
        icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
```
(Provide `web/public/icon-192.png` and `icon-512.png` — any square PNGs for now.)

- [ ] **Step 3: Configure `web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test-setup.ts' },
});
```
Create `web/src/test-setup.ts`:
```ts
import '@testing-library/jest-dom';
```
Add to `web/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 4: Write the failing test `web/src/api/client.test.ts`**

```ts
import { apiFetch, setTokens, getAccessToken } from './client';
beforeEach(() => { localStorage.clear(); });

it('attaches the access token and returns json', async () => {
  setTokens('acc', 'ref');
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await apiFetch<{ ok: boolean }>('/api/plans');
  expect(res.ok).toBe(true);
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer acc');
});

it('refreshes once on 401 then retries', async () => {
  setTokens('old', 'ref');
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'new' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await apiFetch<{ ok: boolean }>('/api/plans');
  expect(res.ok).toBe(true);
  expect(getAccessToken()).toBe('new');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 5: Run and watch it fail**

Run: `cd web && npx vitest run src/api/client.test.ts`
Expected: FAIL — `./client` not found.

- [ ] **Step 6: Write `web/src/api/client.ts`**

```ts
const BASE = import.meta.env.VITE_API_BASE ?? '';
const ACCESS = 'gym.access';
const REFRESH = 'gym.refresh';
export function setTokens(access: string, refresh?: string): void {
  localStorage.setItem(ACCESS, access);
  if (refresh) localStorage.setItem(REFRESH, refresh);
}
export function clearTokens(): void { localStorage.removeItem(ACCESS); localStorage.removeItem(REFRESH); }
export function getAccessToken(): string | null { return localStorage.getItem(ACCESS); }

async function raw(path: string, init: RequestInit): Promise<Response> {
  const token = getAccessToken();
  const headers = { 'Content-Type': 'application/json', ...(init.headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return fetch(BASE + path, { ...init, headers });
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init);
  if (res.status === 401 && localStorage.getItem(REFRESH)) {
    const refresh = await fetch(BASE + '/api/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: localStorage.getItem(REFRESH) }),
    });
    if (refresh.ok) {
      const { accessToken } = await refresh.json();
      setTokens(accessToken);
      res = await raw(path, init);
    } else {
      clearTokens();
    }
  }
  if (!res.ok) throw new Error(`API ${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
```

- [ ] **Step 7: Run and watch it pass**

Run: `cd web && npx vitest run src/api/client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Write `web/src/auth/AuthContext.tsx`**

```tsx
import { createContext, useContext, useState, ReactNode } from 'react';
import { apiFetch, setTokens, clearTokens, getAccessToken } from '../api/client';

interface AuthCtx { isAuthed: boolean; login(e: string, p: string): Promise<void>; register(e: string, p: string): Promise<void>; logout(): void; }
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthed, setAuthed] = useState<boolean>(!!getAccessToken());
  async function login(email: string, password: string) {
    const { accessToken, refreshToken } = await apiFetch<{ accessToken: string; refreshToken: string }>(
      '/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setTokens(accessToken, refreshToken); setAuthed(true);
  }
  async function register(email: string, password: string) {
    await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
    await login(email, password);
  }
  function logout() { clearTokens(); setAuthed(false); }
  return <Ctx.Provider value={{ isAuthed, login, register, logout }}>{children}</Ctx.Provider>;
}
export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
```

- [ ] **Step 9: Write mobile-first base styles `web/src/ui/styles.css`**

```css
:root { --bg:#0b1220; --card:#111827; --fg:#f3f4f6; --muted:#9ca3af; --accent:#22c55e; --danger:#ef4444; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font-family: system-ui, sans-serif; }
.app { max-width: 480px; margin: 0 auto; padding: 16px; min-height: 100vh; }
.card { background:var(--card); border-radius:14px; padding:16px; margin-bottom:12px; }
button { width:100%; padding:14px; font-size:16px; border:0; border-radius:12px; background:var(--accent); color:#06240f; font-weight:700; }
button.secondary { background:#1f2937; color:var(--fg); }
input, select { width:100%; padding:12px; font-size:16px; border-radius:10px; border:1px solid #374151; background:#0b1220; color:var(--fg); margin:6px 0; }
.row { display:flex; gap:8px; }
.big-tap { min-height:56px; }
@media (min-width: 640px) { .app { max-width: 720px; } }
```
Import it in `web/src/main.tsx`: `import './ui/styles.css';`.

- [ ] **Step 10: Write `web/.env.example`**

```
VITE_API_BASE=
```

- [ ] **Step 11: Commit**

```bash
git add web
git commit -m "feat: scaffold PWA with api client (token refresh) and auth context"
```

---

### Task 13: Router, auth pages, protected routes

**Files:**
- Create: `web/src/auth/LoginPage.tsx`, `web/src/auth/RegisterPage.tsx`, `web/src/ui/RequireAuth.tsx`, `web/src/ui/NavBar.tsx`
- Modify: `web/src/App.tsx`, `web/src/main.tsx`
- Test: `web/src/auth/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 12).
- Produces: routes `/login`, `/register`, `/` (plans), `/session/:dayId`, `/progress/:exId`, all app routes except login/register wrapped by `RequireAuth` (redirects to `/login` when `!isAuthed`).

- [ ] **Step 1: Write the failing test `web/src/auth/LoginPage.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import * as AuthCtx from './AuthContext';

it('submits email and password to login', async () => {
  const login = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(AuthCtx, 'useAuth').mockReturnValue({ isAuthed: false, login, register: vi.fn(), logout: vi.fn() });
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText(/email/i), 'a@x.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'pw123456');
  await userEvent.click(screen.getByRole('button', { name: /log in/i }));
  expect(login).toHaveBeenCalledWith('a@x.com', 'pw123456');
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd web && npx vitest run src/auth/LoginPage.test.tsx`
Expected: FAIL — `./LoginPage` not found.

- [ ] **Step 3: Write `web/src/auth/LoginPage.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setError('');
    try { await login(email, password); nav('/'); } catch { setError('Invalid email or password'); }
  }
  return (
    <div className="app">
      <h1>Gym Tracker</h1>
      <form className="card" onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <button type="submit">Log in</button>
      </form>
      <p>No account? <Link to="/register">Register</Link></p>
    </div>
  );
}
```

- [ ] **Step 4: Write `web/src/auth/RegisterPage.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setError('');
    try { await register(email, password); nav('/'); } catch { setError('Could not register (email may be taken, password min 8 chars)'); }
  }
  return (
    <div className="app">
      <h1>Create account</h1>
      <form className="card" onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <button type="submit">Register</button>
      </form>
      <p>Have an account? <Link to="/login">Log in</Link></p>
    </div>
  );
}
```

- [ ] **Step 5: Write `web/src/ui/RequireAuth.tsx`**

```tsx
import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthed } = useAuth();
  return isAuthed ? <>{children}</> : <Navigate to="/login" replace />;
}
```

- [ ] **Step 6: Write `web/src/ui/NavBar.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
export function NavBar() {
  const { logout } = useAuth();
  return (
    <div className="row" style={{ marginBottom: 12 }}>
      <Link to="/"><button className="secondary">Plans</button></Link>
      <button className="secondary" onClick={logout}>Log out</button>
    </div>
  );
}
```

- [ ] **Step 7: Write `web/src/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';
import { RequireAuth } from './ui/RequireAuth';
import { PlansPage } from './plans/PlansPage';
import { PlanEditorPage } from './plans/PlanEditorPage';
import { SessionPage } from './session/SessionPage';
import { ProgressPage } from './progress/ProgressPage';

const qc = new QueryClient();
export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/" element={<RequireAuth><PlansPage /></RequireAuth>} />
            <Route path="/plan/:planId" element={<RequireAuth><PlanEditorPage /></RequireAuth>} />
            <Route path="/session/:dayId" element={<RequireAuth><SessionPage /></RequireAuth>} />
            <Route path="/progress/:exId" element={<RequireAuth><ProgressPage /></RequireAuth>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 8: Replace `web/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './ui/styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 9: Run and watch the test pass**

Run: `cd web && npx vitest run src/auth/LoginPage.test.tsx`
Expected: PASS.
(Tasks 14–16 create `PlansPage`, `PlanEditorPage`, `SessionPage`, `ProgressPage`; until then, add temporary one-line stub components exporting a `<div/>` so `App.tsx` compiles, and replace them in their tasks.)

- [ ] **Step 10: Commit**

```bash
git add web
git commit -m "feat: add routing, login/register pages, and protected routes"
```

---

### Task 14: Plans list, JSON import, in-app editor

**Files:**
- Create: `web/src/plans/PlansPage.tsx`, `web/src/plans/importPlan.ts`, `web/src/plans/PlanEditorPage.tsx`
- Test: `web/src/plans/PlanEditorPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 12). API: `GET /api/plans`, `POST /api/plans/import`, `GET /api/plans/:id`, `POST /api/plans/:id/days`, `POST /api/plan-days/:id/exercises`, `PUT /api/day-exercises/:id`, `DELETE /api/day-exercises/:id`, `GET /api/plans/:id/export`.
- Produces: `PlansPage` (lists plans, upload JSON to import, link to each plan editor); `PlanEditorPage` (lists days + exercises, add day, add/edit/delete exercise, "Start session" link per day, export button); `readPlanFile(file): Promise<unknown>` JSON parse helper.

- [ ] **Step 1: Write `web/src/plans/importPlan.ts`**

```ts
export async function readPlanFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}
```

- [ ] **Step 2: Write `web/src/plans/PlansPage.tsx`**

```tsx
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { readPlanFile } from './importPlan';
import { NavBar } from '../ui/NavBar';

interface PlanRow { id: string; name: string; is_active: boolean; }
export function PlansPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiFetch<PlanRow[]>('/api/plans') });
  const importMut = useMutation({
    mutationFn: async (data: unknown) => apiFetch('/api/plans/import', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  });
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { importMut.mutate(await readPlanFile(file)); } catch { alert('Invalid JSON file'); }
  }
  return (
    <div className="app">
      <NavBar />
      <h1>Your plans</h1>
      <div className="card">
        <input ref={fileRef} type="file" accept="application/json" onChange={onFile} hidden />
        <button onClick={() => fileRef.current?.click()}>Import plan (JSON)</button>
        {importMut.isError && <p style={{ color: 'var(--danger)' }}>Import failed (check the file schema).</p>}
      </div>
      {plans.isLoading && <p>Loading…</p>}
      {plans.data?.map((p) => (
        <Link key={p.id} to={`/plan/${p.id}`}>
          <div className="card">{p.name}{p.is_active ? ' • active' : ''}</div>
        </Link>
      ))}
      {plans.data?.length === 0 && <p className="card">No plans yet — import one to get started.</p>}
    </div>
  );
}
```

- [ ] **Step 3: Write the failing test `web/src/plans/PlanEditorPage.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlanEditorPage } from './PlanEditorPage';
import * as client from '../api/client';

function renderAt(id: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/plan/${id}`]}>
        <Routes><Route path="/plan/:planId" element={<PlanEditorPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

it('shows days and exercises and can add an exercise', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/plan/p1') || path === '/api/plans/p1') {
      return { id: 'p1', name: 'P', is_active: false,
        days: [{ id: 'd1', name: 'Push', order_index: 0, exercises: [
          { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 3, target_reps: 8, rest_seconds: null, starting_weight: 40 },
        ] }] } as any;
    }
    if (path === '/api/plan-days/d1/exercises' && init?.method === 'POST') return { id: 'e2' } as any;
    return {} as any;
  });
  renderAt('p1');
  expect(await screen.findByText('Bench')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /add exercise/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/plan-days/d1/exercises',
    expect.objectContaining({ method: 'POST' })));
});
```

- [ ] **Step 4: Run and watch it fail**

Run: `cd web && npx vitest run src/plans/PlanEditorPage.test.tsx`
Expected: FAIL — `./PlanEditorPage` not found.

- [ ] **Step 5: Write `web/src/plans/PlanEditorPage.tsx`**

```tsx
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';

interface Exercise { id: string; exercise_name: string; order_index: number; target_sets: number; target_reps: number; rest_seconds: number | null; starting_weight: number | null; }
interface Day { id: string; name: string; order_index: number; exercises: Exercise[]; }
interface PlanTree { id: string; name: string; is_active: boolean; days: Day[]; }

export function PlanEditorPage() {
  const { planId } = useParams();
  const qc = useQueryClient();
  const key = ['plan', planId];
  const plan = useQuery({ queryKey: key, queryFn: () => apiFetch<PlanTree>(`/api/plans/${planId}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const addDay = useMutation({ mutationFn: () => apiFetch(`/api/plans/${planId}/days`, { method: 'POST', body: JSON.stringify({ name: 'New day' }) }), onSuccess: refresh });
  const addExercise = useMutation({ mutationFn: (dayId: string) => apiFetch(`/api/plan-days/${dayId}/exercises`, { method: 'POST', body: JSON.stringify({ exercise_name: 'New exercise', target_sets: 3, target_reps: 8 }) }), onSuccess: refresh });
  const delExercise = useMutation({ mutationFn: (id: string) => apiFetch(`/api/day-exercises/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const patchExercise = useMutation({ mutationFn: (p: { id: string; body: Partial<Exercise> }) => apiFetch(`/api/day-exercises/${p.id}`, { method: 'PUT', body: JSON.stringify(p.body) }), onSuccess: refresh });

  async function exportPlan() {
    const data = await apiFetch(`/api/plans/${planId}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${plan.data?.name ?? 'plan'}.json`; a.click();
  }

  if (plan.isLoading) return <div className="app"><NavBar />Loading…</div>;
  if (!plan.data) return <div className="app"><NavBar />Not found</div>;
  return (
    <div className="app">
      <NavBar />
      <h1>{plan.data.name}</h1>
      <button className="secondary" onClick={exportPlan}>Export JSON</button>
      {plan.data.days.map((day) => (
        <div className="card" key={day.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{day.name}</strong>
            <Link to={`/session/${day.id}`}><button className="big-tap">Start session</button></Link>
          </div>
          {day.exercises.map((ex) => (
            <div key={ex.id} className="row" style={{ alignItems: 'center', marginTop: 8 }}>
              <input defaultValue={ex.exercise_name}
                onBlur={(e) => patchExercise.mutate({ id: ex.id, body: { exercise_name: e.target.value } })} />
              <input type="number" defaultValue={ex.target_sets} style={{ width: 70 }}
                onBlur={(e) => patchExercise.mutate({ id: ex.id, body: { target_sets: Number(e.target.value) } })} />
              <input type="number" defaultValue={ex.target_reps} style={{ width: 70 }}
                onBlur={(e) => patchExercise.mutate({ id: ex.id, body: { target_reps: Number(e.target.value) } })} />
              <Link to={`/progress/${ex.id}`}><button className="secondary">📈</button></Link>
              <button className="secondary" onClick={() => delExercise.mutate(ex.id)}>✕</button>
            </div>
          ))}
          <button className="secondary" style={{ marginTop: 8 }} onClick={() => addExercise.mutate(day.id)}>Add exercise</button>
        </div>
      ))}
      <button onClick={() => addDay.mutate()}>Add day</button>
    </div>
  );
}
```

- [ ] **Step 6: Run and watch the test pass**

Run: `cd web && npx vitest run src/plans/PlanEditorPage.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat: add plans list, JSON import, and in-app plan editor"
```

---

### Task 15: Day-detail endpoint (for the session screen)

**Files:**
- Modify: `api/src/plans/repo.ts` (add `getDayWithExercises`), `api/src/plans/routes.ts` (add route to `plansSubRouter`)
- Test: `api/__tests__/day-detail.test.ts`

**Interfaces:**
- Consumes: `query` (Task 1), `requireAuth` (Task 4), `userOwnsPlanDay` (Task 6).
- Produces: `GET /api/plan-days/:id` -> 200 `{ id, name, exercises: Array<{ id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight }> }`; 404 if not the user's. Repo: `getDayWithExercises(dayId)`.

- [ ] **Step 1: Write the failing test `api/__tests__/day-detail.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDb, resetDb, teardownTestDb } from '../src/test/helpers.js';
const app = createApp();
beforeAll(setupTestDb); beforeEach(resetDb); afterAll(teardownTestDb);
async function auth(email: string) {
  await request(app).post('/api/auth/register').send({ email, password: 'pw123456' });
  return (await request(app).post('/api/auth/login').send({ email, password: 'pw123456' })).body.accessToken as string;
}

it('returns a day with its exercises for the owner only', async () => {
  const t = await auth('d@x.com'); const H = { Authorization: `Bearer ${t}` };
  const plan = await request(app).post('/api/plans/import').set(H)
    .send({ name: 'P', days: [{ name: 'Push', exercises: [{ exercise_name: 'Bench', target_sets: 3, target_reps: 8 }] }] });
  const tree = await request(app).get(`/api/plans/${plan.body.id}`).set(H);
  const dayId = tree.body.days[0].id;

  const res = await request(app).get(`/api/plan-days/${dayId}`).set(H);
  expect(res.status).toBe(200);
  expect(res.body.name).toBe('Push');
  expect(res.body.exercises).toHaveLength(1);

  const intruder = await auth('x@x.com');
  const blocked = await request(app).get(`/api/plan-days/${dayId}`).set({ Authorization: `Bearer ${intruder}` });
  expect(blocked.status).toBe(404);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd api && npm run test:int -- __tests__/day-detail.test.ts`
Expected: FAIL — route 404.

- [ ] **Step 3: Add `getDayWithExercises` to `api/src/plans/repo.ts`**

```ts
export async function getDayWithExercises(dayId: string) {
  const day = await query<{ id: string; name: string }>('SELECT id, name FROM plan_days WHERE id=$1', [dayId]);
  if (!day.rows[0]) return null;
  const exercises = await query(
    `SELECT id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight::float8 AS starting_weight
     FROM day_exercises WHERE plan_day_id=$1 ORDER BY order_index`, [dayId]);
  return { ...day.rows[0], exercises: exercises.rows };
}
```

- [ ] **Step 4: Add the route to `plansSubRouter` in `api/src/plans/routes.ts`**

```ts
import { getDayWithExercises } from './repo.js';
plansSubRouter.get('/plan-days/:id', async (req, res) => {
  if (!(await userOwnsPlanDay(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  res.json(await getDayWithExercises(req.params.id));
});
```

- [ ] **Step 5: Run and watch it pass**

Run: `cd api && npm run test:int -- __tests__/day-detail.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api
git commit -m "feat: add day-detail endpoint for the session screen"
```

---

### Task 16: Guided workout session screen

**Files:**
- Create: `web/src/session/SessionPage.tsx`, `web/src/session/ExerciseLogger.tsx`
- Test: `web/src/session/SessionPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 12). API: `GET /api/plan-days/:dayId` (Task 15), `POST /api/sessions` (Task 7), `GET /api/exercises/:exId/suggestion` (Task 9), `POST /api/sessions/:id/sets` (Task 7), `POST /api/sessions/:id/finish` (Task 7).
- Produces: `SessionPage` guiding the user exercise-by-exercise; `ExerciseLogger` (keyed per exercise) with weight/reps inputs pre-filled from the suggestion and four effort buttons (`easy`/`ok`/`hard`/`failed`) where tapping one logs the current set. Progress shown as "Exercise X/Y • Set N/M".

- [ ] **Step 1: Write `web/src/session/ExerciseLogger.tsx`**

```tsx
import { useState } from 'react';
type Effort = 'easy' | 'ok' | 'hard' | 'failed';
interface Props {
  exerciseName: string; targetReps: number; targetSets: number; setNumber: number;
  suggestedWeight: number | null; suggestionReason: string;
  onLog(weight: number, reps: number, effort: Effort): void;
}
export function ExerciseLogger(props: Props) {
  const [weight, setWeight] = useState<string>(props.suggestedWeight != null ? String(props.suggestedWeight) : '');
  const [reps, setReps] = useState<string>(String(props.targetReps));
  const efforts: Effort[] = ['easy', 'ok', 'hard', 'failed'];
  return (
    <div className="card">
      <h2>{props.exerciseName}</h2>
      <p style={{ color: 'var(--muted)' }}>Set {props.setNumber}/{props.targetSets} • target {props.targetReps} reps</p>
      <p>💡 {props.suggestionReason}</p>
      <label htmlFor="weight">Weight (kg)</label>
      <input id="weight" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
      <label htmlFor="reps">Reps done</label>
      <input id="reps" type="number" value={reps} onChange={(e) => setReps(e.target.value)} />
      <p style={{ color: 'var(--muted)' }}>How did it feel? (tap to log the set)</p>
      <div className="row">
        {efforts.map((ef) => (
          <button key={ef} className="big-tap" onClick={() => props.onLog(Number(weight), Number(reps), ef)}>{ef}</button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the failing test `web/src/session/SessionPage.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SessionPage } from './SessionPage';
import * as client from '../api/client';

function renderAt(dayId: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/session/${dayId}`]}>
        <Routes><Route path="/session/:dayId" element={<SessionPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

it('starts a session and logs a set with the chosen effort', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plan-days/d1') return { id: 'd1', name: 'Push', exercises: [
      { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 1, target_reps: 8, rest_seconds: null, starting_weight: 40 },
    ] } as any;
    if (path === '/api/sessions' && init?.method === 'POST') return { id: 's1', started_at: 'now' } as any;
    if (path === '/api/exercises/e1/suggestion') return { weight: 40, reason: 'Starting weight 40 kg' } as any;
    if (path === '/api/sessions/s1/sets' && init?.method === 'POST') return { id: 'set1' } as any;
    if (path === '/api/sessions/s1/finish') return { id: 's1', finished_at: 'now' } as any;
    return {} as any;
  });
  renderAt('d1');
  expect(await screen.findByText('Bench')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'easy' }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/sessions/s1/sets',
    expect.objectContaining({ method: 'POST', body: expect.stringContaining('"effort":"easy"') })));
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `cd web && npx vitest run src/session/SessionPage.test.tsx`
Expected: FAIL — `./SessionPage` not found.

- [ ] **Step 4: Write `web/src/session/SessionPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';
import { ExerciseLogger } from './ExerciseLogger';

interface Exercise { id: string; exercise_name: string; target_sets: number; target_reps: number; }
interface Day { id: string; name: string; exercises: Exercise[]; }
interface Suggestion { weight: number | null; reason: string; }
type Effort = 'easy' | 'ok' | 'hard' | 'failed';

export function SessionPage() {
  const { dayId } = useParams();
  const nav = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [setNumber, setSetNumber] = useState(1);
  const [done, setDone] = useState(false);

  const day = useQuery({ queryKey: ['day', dayId], queryFn: () => apiFetch<Day>(`/api/plan-days/${dayId}`) });

  useEffect(() => {
    if (!sessionId) {
      apiFetch<{ id: string }>('/api/sessions', { method: 'POST', body: JSON.stringify({ plan_day_id: dayId }) })
        .then((s) => setSessionId(s.id));
    }
  }, [dayId, sessionId]);

  const exercise = day.data?.exercises[idx];
  const suggestion = useQuery({
    queryKey: ['suggestion', exercise?.id],
    queryFn: () => apiFetch<Suggestion>(`/api/exercises/${exercise!.id}/suggestion`),
    enabled: !!exercise,
  });

  async function onLog(weight: number, reps: number, effort: Effort) {
    if (!sessionId || !exercise) return;
    await apiFetch(`/api/sessions/${sessionId}/sets`, { method: 'POST', body: JSON.stringify({
      day_exercise_id: exercise.id, set_number: setNumber, weight_used: weight, reps_done: reps, effort }) });
    if (setNumber >= exercise.target_sets) {
      if (idx + 1 >= (day.data?.exercises.length ?? 0)) { setDone(true); }
      else { setIdx(idx + 1); setSetNumber(1); }
    } else {
      setSetNumber(setNumber + 1);
    }
  }

  async function finish() {
    if (sessionId) await apiFetch(`/api/sessions/${sessionId}/finish`, { method: 'POST' });
    nav('/');
  }

  if (day.isLoading) return <div className="app"><NavBar />Loading…</div>;
  if (!day.data) return <div className="app"><NavBar />Day not found</div>;

  return (
    <div className="app">
      <NavBar />
      <h1>{day.data.name}</h1>
      {done || !exercise ? (
        <div className="card">
          <p>Session complete 💪</p>
          <button onClick={finish}>Finish & save</button>
        </div>
      ) : (
        <>
          <p style={{ color: 'var(--muted)' }}>Exercise {idx + 1}/{day.data.exercises.length}</p>
          {suggestion.isLoading ? <p>Loading suggestion…</p> : (
            <ExerciseLogger
              key={exercise.id + ':' + setNumber}
              exerciseName={exercise.exercise_name}
              targetReps={exercise.target_reps}
              targetSets={exercise.target_sets}
              setNumber={setNumber}
              suggestedWeight={suggestion.data?.weight ?? null}
              suggestionReason={suggestion.data?.reason ?? ''}
              onLog={onLog}
            />
          )}
          <button className="secondary" onClick={finish}>End session early</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run and watch the test pass**

Run: `cd web && npx vitest run src/session/SessionPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: add guided workout session screen with per-set logging"
```

---

### Task 17: Progress / trend screen

**Files:**
- Create: `web/src/progress/TrendBadge.tsx`, `web/src/progress/ProgressPage.tsx`
- Test: `web/src/progress/TrendBadge.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 12), Recharts. API: `GET /api/exercises/:exId/trend` (Task 11) -> `{ series: Array<{ date, topWeight, bestE1rm }>, label, slope }`.
- Produces: `TrendBadge({ label })` rendering ▲ Progressing / ▬ Steady / ▼ Regressing / "Not enough data yet"; `ProgressPage` showing the badge, a line chart (topWeight + bestE1rm), and a session list.

- [ ] **Step 1: Write the failing test `web/src/progress/TrendBadge.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { TrendBadge } from './TrendBadge';

it('renders progressing with an up arrow', () => {
  render(<TrendBadge label="progressing" />);
  expect(screen.getByText(/progressing/i)).toBeInTheDocument();
  expect(screen.getByText(/▲/)).toBeInTheDocument();
});
it('renders insufficient as a friendly message', () => {
  render(<TrendBadge label="insufficient" />);
  expect(screen.getByText(/not enough data/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd web && npx vitest run src/progress/TrendBadge.test.tsx`
Expected: FAIL — `./TrendBadge` not found.

- [ ] **Step 3: Write `web/src/progress/TrendBadge.tsx`**

```tsx
type TrendLabel = 'progressing' | 'steady' | 'regressing' | 'insufficient';
const MAP: Record<TrendLabel, { icon: string; text: string; color: string }> = {
  progressing: { icon: '▲', text: 'Progressing', color: '#22c55e' },
  steady:      { icon: '▬', text: 'Steady',      color: '#9ca3af' },
  regressing:  { icon: '▼', text: 'Regressing',  color: '#ef4444' },
  insufficient:{ icon: '•', text: 'Not enough data yet', color: '#9ca3af' },
};
export function TrendBadge({ label }: { label: TrendLabel }) {
  const m = MAP[label];
  return <span style={{ color: m.color, fontWeight: 700 }}>{m.icon} {m.text}</span>;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd web && npx vitest run src/progress/TrendBadge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `web/src/progress/ProgressPage.tsx`**

```tsx
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';
import { TrendBadge } from './TrendBadge';

interface Point { date: string; topWeight: number; bestE1rm: number; }
interface Trend { series: Point[]; label: 'progressing' | 'steady' | 'regressing' | 'insufficient'; slope: number; }

export function ProgressPage() {
  const { exId } = useParams();
  const trend = useQuery({ queryKey: ['trend', exId], queryFn: () => apiFetch<Trend>(`/api/exercises/${exId}/trend`) });
  if (trend.isLoading) return <div className="app"><NavBar />Loading…</div>;
  const data = (trend.data?.series ?? []).map((p) => ({ ...p, label: new Date(p.date).toLocaleDateString() }));
  return (
    <div className="app">
      <NavBar />
      <h1>Progress</h1>
      <div className="card"><TrendBadge label={trend.data?.label ?? 'insufficient'} /></div>
      <div className="card" style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={11} />
            <Tooltip />
            <Line type="monotone" dataKey="topWeight" stroke="#22c55e" name="Top weight" dot />
            <Line type="monotone" dataKey="bestE1rm" stroke="#60a5fa" name="Est. 1RM" dot />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="card">
        <strong>History</strong>
        {data.map((p, i) => (<div key={i} className="row" style={{ justifyContent: 'space-between' }}>
          <span>{p.label}</span><span>{p.topWeight} kg</span></div>))}
        {data.length === 0 && <p style={{ color: 'var(--muted)' }}>No finished sessions for this exercise yet.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: add progress screen with trend badge and weight/e1rm chart"
```

---

## Deployment Task

### Task 18: Docker Compose + Caddy for Oracle Cloud

**Files:**
- Create: `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/api.Dockerfile`, `deploy/web.Dockerfile`, `deploy/.env.example`
- Modify: `web/vite.config.ts` is unchanged; ensure `web` build output is `dist/`.

**Interfaces:**
- Produces a runnable stack: `db` (Postgres, schema auto-applied), `api` (Node), `web-build` (produces static files), `caddy` (TLS + serves PWA + proxies `/api`).

- [ ] **Step 1: Write `deploy/api.Dockerfile`**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY api/package*.json ./
RUN npm ci
COPY api/ ./
RUN npm run build
FROM node:20-alpine
WORKDIR /app
COPY api/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY db/ ./db/
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

- [ ] **Step 2: Write `deploy/web.Dockerfile`**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
FROM alpine:3
WORKDIR /out
COPY --from=build /app/dist ./dist
CMD ["sh", "-c", "cp -r /out/dist/* /srv/ && echo done && sleep infinity"]
```

- [ ] **Step 3: Write `deploy/Caddyfile`**

```
{$SITE_ADDRESS} {
	encode gzip
	handle /api/* {
		reverse_proxy api:3000
	}
	handle {
		root * /srv
		try_files {path} /index.html
		file_server
	}
}
```
(For a local test without a domain, set `SITE_ADDRESS=:80` so Caddy serves over HTTP.)

- [ ] **Step 4: Write `deploy/docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - dbdata:/var/lib/postgresql/data
      - ../db/schema.sql:/docker-entrypoint-initdb.d/schema.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 3s
      retries: 10

  api:
    build:
      context: ..
      dockerfile: deploy/api.Dockerfile
    environment:
      PORT: 3000
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      JWT_SECRET: ${JWT_SECRET}
    depends_on:
      db:
        condition: service_healthy

  web-build:
    build:
      context: ..
      dockerfile: deploy/web.Dockerfile
    volumes:
      - webroot:/srv

  caddy:
    image: caddy:2
    environment:
      SITE_ADDRESS: ${SITE_ADDRESS}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - webroot:/srv
      - caddydata:/data
    depends_on:
      - api
      - web-build

volumes:
  dbdata:
  webroot:
  caddydata:
```

- [ ] **Step 5: Write `deploy/.env.example`**

```
POSTGRES_USER=gym
POSTGRES_PASSWORD=change-me
POSTGRES_DB=gym
JWT_SECRET=change-me-long-random
SITE_ADDRESS=:80
```

- [ ] **Step 6: Bring the stack up and smoke-test**

Run:
```bash
cd deploy
cp .env.example .env   # edit secrets
docker compose up -d --build
sleep 20
curl -s localhost/api/health
```
Expected: `{"status":"ok"}`.
Then open `http://localhost/`, register a user, import a plan, start a session, log sets, finish, and view progress.

- [ ] **Step 7: Oracle Cloud notes**

- Open ingress for ports 80/443 in the VCN security list and the instance firewall (`sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload`).
- Point your domain's A record at the VM's public IP and set `SITE_ADDRESS=your.domain` in `.env`; Caddy will auto-provision TLS.
- Re-deploy with `docker compose up -d --build` after pulling changes.

- [ ] **Step 8: Commit**

```bash
git add deploy
git commit -m "chore: add docker-compose deploy with caddy tls for oracle cloud"
```

---

## Appendix: Spec Coverage Map

- §1 Purpose / success criteria → Tasks 2–18 collectively; account+plan+session+suggestion+trend flows all covered.
- §2 Multi-user / PWA / online-first → Task 12 (PWA, auth), Global Constraints (isolation enforced per task).
- §3 Architecture (web/api/db + proxy) → Tasks 1–2 (api/db), 12 (web), 18 (compose + Caddy).
- §4 Data model → Task 1 `db/schema.sql`.
- §5 Weight-suggestion rule → Task 8 (pure) + Task 9 (endpoint).
- §6 Trend / Epley / ▲▬▼ badge → Task 10 (pure) + Task 11 (endpoint) + Task 17 (UI).
- §7 Guided session → Task 15 (day endpoint) + Task 16 (UI) + Task 7 (session API).
- §8 Plan import / edit / export → Task 5 (import/export) + Task 6 (edit endpoints) + Task 14 (UI).
- §9 Auth & security (bcrypt, JWT, rate-limit, isolation) → Tasks 3–4; ownership checks in Tasks 5–7,15.
- §10 REST surface → Tasks 4–7, 9, 11, 15.
- §11 Testing strategy → pure-module unit tests (Tasks 8,10), API integration tests (Tasks 4–7,9,11,15), web component tests (Tasks 12–14,16,17).
- §12 Deployment → Task 18.
- §13 Open items (reverse proxy, chart lib, migration tooling) → resolved: Caddy (Task 18), Recharts (Task 17), schema.sql at init (Tasks 1,18).
