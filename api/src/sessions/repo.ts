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
  extra_segments?: Array<{ weight: number; reps: number }>;
}) {
  const r = await query<{ id: string }>(
    `INSERT INTO set_logs (session_id, day_exercise_id, set_number, weight_used, reps_done, effort, extra_segments)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
    [sessionId, s.day_exercise_id, s.set_number, s.weight_used, s.reps_done, s.effort, JSON.stringify(s.extra_segments ?? [])]);
  return r.rows[0];
}
export async function finishSession(sessionId: string) {
  const r = await query<{ id: string; finished_at: string }>(
    'UPDATE workout_sessions SET finished_at=now() WHERE id=$1 RETURNING id, finished_at', [sessionId]);
  return r.rows[0];
}
export async function getSession(sessionId: string) {
  const s = await query<any>(
    `SELECT ws.id, ws.plan_day_id, ws.started_at, ws.finished_at, pd.name AS day_name
     FROM workout_sessions ws LEFT JOIN plan_days pd ON pd.id = ws.plan_day_id
     WHERE ws.id=$1`, [sessionId]);
  if (!s.rows[0]) return null;
  const sets = await query(
    `SELECT sl.id, sl.day_exercise_id, de.exercise_name, sl.set_number, sl.weight_used::float8 AS weight_used,
            sl.reps_done, sl.effort, sl.extra_segments, sl.created_at
     FROM set_logs sl LEFT JOIN day_exercises de ON de.id = sl.day_exercise_id
     WHERE sl.session_id=$1 ORDER BY sl.set_number`, [sessionId]);
  return { ...s.rows[0], sets: sets.rows };
}
export async function listUserSessions(userId: string) {
  const r = await query(
    `SELECT ws.id, ws.finished_at, ws.plan_day_id, pd.name AS day_name, COUNT(sl.id)::int AS set_count
     FROM workout_sessions ws
     LEFT JOIN plan_days pd ON pd.id = ws.plan_day_id
     LEFT JOIN set_logs sl ON sl.session_id = ws.id
     WHERE ws.user_id=$1 AND ws.finished_at IS NOT NULL
     GROUP BY ws.id, pd.name
     ORDER BY ws.finished_at DESC`, [userId]);
  return r.rows;
}
export async function deleteSession(sessionId: string): Promise<void> {
  await query('DELETE FROM workout_sessions WHERE id=$1', [sessionId]);
}
export async function latestCompletedSessionSets(userId: string, dayExerciseId: string) {
  const r = await query<{ reps_done: number; effort: string; weight_used: number }>(
    `SELECT sl.reps_done, sl.effort, sl.weight_used::float8 AS weight_used
     FROM set_logs sl JOIN workout_sessions ws ON ws.id = sl.session_id
     WHERE sl.day_exercise_id=$1 AND ws.user_id=$2 AND ws.finished_at IS NOT NULL
       AND ws.id = (
         SELECT ws2.id FROM set_logs sl2 JOIN workout_sessions ws2 ON ws2.id = sl2.session_id
         WHERE sl2.day_exercise_id=$1 AND ws2.user_id=$2 AND ws2.finished_at IS NOT NULL
         ORDER BY ws2.finished_at DESC, ws2.id DESC LIMIT 1)
     ORDER BY sl.set_number`, [dayExerciseId, userId]);
  return r.rows;
}
