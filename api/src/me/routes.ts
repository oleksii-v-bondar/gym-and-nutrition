import { Router } from 'express';
import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get('/', async (req, res) => {
  const r = await query<{ id: string; login: string }>('SELECT id, login FROM users WHERE id=$1', [req.userId]);
  const u = r.rows[0];
  if (!u) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ id: u.id, login: u.login, isAdmin: u.login === config.adminLogin });
});
