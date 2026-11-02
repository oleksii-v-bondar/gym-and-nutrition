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
