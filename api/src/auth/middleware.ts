import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './tokens.js';
declare global { namespace Express { interface Request { userId?: string } } }
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const [, token] = header.split(' ');
  if (!token) { res.status(401).json({ error: 'missing token' }); return; }
  try {
    const payload = verifyToken(token);
    if (payload.type !== 'access') { res.status(401).json({ error: 'wrong token type' }); return; }
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}
