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
