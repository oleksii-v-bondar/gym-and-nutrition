import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { hashPassword, verifyPassword } from './password.js';
import { signAccess, signRefresh, verifyToken } from './tokens.js';

const credentials = z.object({ email: z.string().email(), password: z.string().min(8) });
// Login must not enforce the registration password policy (min length): a wrong
// password of any length should yield 401 (invalid credentials), not 400.
const loginCredentials = z.object({ email: z.string().email(), password: z.string().min(1) });
export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid input' }); return; }
  const email = parsed.data.email.toLowerCase();
  const hash = await hashPassword(parsed.data.password);
  try {
    const r = await query<{ id: string; email: string }>(
      'INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id, email', [email, hash]);
    res.status(201).json(r.rows[0]);
  } catch (e: any) {
    if (e?.code === '23505') { res.status(409).json({ error: 'email already registered' }); return; }
    throw e;
  }
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginCredentials.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid input' }); return; }
  const email = parsed.data.email.toLowerCase();
  const r = await query<{ id: string; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE email=$1', [email]);
  const user = r.rows[0];
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    res.status(401).json({ error: 'invalid credentials' }); return;
  }
  res.json({ accessToken: signAccess(user.id), refreshToken: signRefresh(user.id) });
});

authRouter.post('/refresh', (req, res) => {
  const token = z.object({ refreshToken: z.string() }).safeParse(req.body);
  if (!token.success) { res.status(400).json({ error: 'invalid input' }); return; }
  try {
    const payload = verifyToken(token.data.refreshToken);
    if (payload.type !== 'refresh') { res.status(401).json({ error: 'wrong token type' }); return; }
    res.json({ accessToken: signAccess(payload.sub) });
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
});
