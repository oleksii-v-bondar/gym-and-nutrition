import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { importSchema, planUpdate, dayCreate, dayUpdate, exerciseUpsert } from './schema.js';
import {
  createPlanFromImport, listPlans, getPlanTree, exportPlan,
  userOwnsPlan, userOwnsPlanDay, userOwnsExercise,
  updatePlan, addDay, updateDay, deleteDay, addExercise, updateExercise, deleteExercise,
} from './repo.js';

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
