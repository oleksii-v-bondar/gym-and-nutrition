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
