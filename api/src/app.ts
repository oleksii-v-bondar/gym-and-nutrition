import express, { Express } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { authRouter } from './auth/routes.js';
import { plansRouter, plansSubRouter } from './plans/routes.js';
import { sessionsRouter } from './sessions/routes.js';
import { suggestionRouter } from './suggestion/routes.js';
import { trendRouter } from './trend/routes.js';
import { meRouter } from './me/routes.js';
export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });
  app.use('/api/auth/login', loginLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/plans', plansRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/exercises', suggestionRouter);
  app.use('/api/exercises', trendRouter);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/me', meRouter);
  app.use('/api', plansSubRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  });
  return app;
}
