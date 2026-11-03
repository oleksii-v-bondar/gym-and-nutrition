import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Express } from 'express';
import { pool, query } from '../db.js';
const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/schema.sql');
export async function setupTestDb(): Promise<void> {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await query(sql);
}
export async function resetDb(): Promise<void> {
  await query('TRUNCATE users RESTART IDENTITY CASCADE;');
}
export async function teardownTestDb(): Promise<void> {
  await pool.end();
}

// Build a plan via the always-open create+add endpoints (import is admin-only), so any
// user can seed a plan in tests. Returns the created plan/day/exercise ids.
export async function buildPlan(
  app: Express,
  token: string,
  opts: { name?: string; dayName?: string; exercises?: Array<Record<string, unknown>> } = {},
): Promise<{ planId: string; dayId: string; exId: string; exIds: string[] }> {
  const H = { Authorization: `Bearer ${token}` };
  const planId = (await request(app).post('/api/plans').set(H).send({ name: opts.name ?? 'P' })).body.id;
  const dayId = (await request(app).post(`/api/plans/${planId}/days`).set(H).send({ name: opts.dayName ?? 'D' })).body.id;
  const exIds: string[] = [];
  for (const ex of opts.exercises ?? []) {
    const e = await request(app).post(`/api/plan-days/${dayId}/exercises`).set(H).send(ex);
    exIds.push(e.body.id);
  }
  return { planId, dayId, exId: exIds[0], exIds };
}

