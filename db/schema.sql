CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login text UNIQUE NOT NULL,
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
