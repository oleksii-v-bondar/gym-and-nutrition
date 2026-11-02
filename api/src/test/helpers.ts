import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
