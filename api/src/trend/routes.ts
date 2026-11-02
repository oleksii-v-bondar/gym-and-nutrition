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
  for (const r of rows.rows) {
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, { date: r.finished_at, sets: [] });
    bySession.get(r.session_id)!.sets.push({ weight_used: r.weight_used, reps_done: r.reps_done });
  }
  res.json(computeTrend([...bySession.values()]));
});
