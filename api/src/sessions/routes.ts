import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { userOwnsPlanDay, userOwnsExercise } from '../plans/repo.js';
import { startSession, logSet, finishSession, getSession, userOwnsSession, listUserSessions, deleteSession, updateSet } from './repo.js';

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);

const startBody = z.object({ plan_day_id: z.string().uuid() });
const setBody = z.object({
  day_exercise_id: z.string().uuid(),
  set_number: z.number().int().positive(),
  weight_used: z.number().nonnegative(),
  reps_done: z.number().int().nonnegative(),
  effort: z.enum(['easy', 'ok', 'hard', 'failed']),
  extra_segments: z.array(z.object({ weight: z.number().nonnegative(), reps: z.number().int().nonnegative() })).optional(),
});
const patchSetBody = z.object({
  weight_used: z.number().nonnegative(),
  reps_done: z.number().int().nonnegative(),
  effort: z.enum(['easy', 'ok', 'hard', 'failed']),
  extra_segments: z.array(z.object({ weight: z.number().nonnegative(), reps: z.number().int().nonnegative() })),
});

sessionsRouter.post('/', async (req, res) => {
  const p = startBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  if (!(await userOwnsPlanDay(req.userId!, p.data.plan_day_id))) { res.status(404).json({ error: 'not found' }); return; }
  res.status(201).json(await startSession(req.userId!, p.data.plan_day_id));
});

sessionsRouter.get('/', async (req, res) => {
  res.json(await listUserSessions(req.userId!));
});

sessionsRouter.get('/:id', async (req, res) => {
  if (!(await userOwnsSession(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  res.json(await getSession(req.params.id));
});

sessionsRouter.delete('/:id', async (req, res) => {
  if (!(await userOwnsSession(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  await deleteSession(req.params.id);
  res.status(204).end();
});

sessionsRouter.post('/:id/sets', async (req, res) => {
  if (!(await userOwnsSession(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  const p = setBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  if (!(await userOwnsExercise(req.userId!, p.data.day_exercise_id))) { res.status(404).json({ error: 'not found' }); return; }
  res.status(201).json(await logSet(req.params.id, p.data));
});

sessionsRouter.patch('/:id/sets/:setId', async (req, res) => {
  if (!(await userOwnsSession(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  const p = patchSetBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid' }); return; }
  const updated = await updateSet(req.params.id, req.params.setId, p.data);
  if (!updated) { res.status(404).json({ error: 'not found' }); return; }
  res.json(updated);
});

sessionsRouter.post('/:id/finish', async (req, res) => {
  if (!(await userOwnsSession(req.userId!, req.params.id))) { res.status(404).json({ error: 'not found' }); return; }
  res.json(await finishSession(req.params.id));
});
