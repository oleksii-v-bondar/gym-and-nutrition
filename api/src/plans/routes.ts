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
