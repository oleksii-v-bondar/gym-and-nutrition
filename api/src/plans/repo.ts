import { pool, query } from '../db.js';
import { config } from '../config.js';
import type { PlanImport } from './schema.js';

export async function createPlanFromImport(userId: string, data: PlanImport): Promise<{ id: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const plan = await client.query<{ id: string }>(
      'INSERT INTO plans (user_id, name, is_active) VALUES ($1,$2,false) RETURNING id', [userId, data.name]);
    const planId = plan.rows[0].id;
    for (let d = 0; d < data.days.length; d++) {
      const day = data.days[d];
      const dayRow = await client.query<{ id: string }>(
        'INSERT INTO plan_days (plan_id, name, order_index, is_superset) VALUES ($1,$2,$3,$4) RETURNING id', [planId, day.name, d, day.is_superset ?? false]);
      const dayId = dayRow.rows[0].id;
      for (let e = 0; e < day.exercises.length; e++) {
        const ex = day.exercises[e];
        await client.query(
          `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight, extra_segments)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [dayId, ex.exercise_name, e, ex.target_sets, ex.target_reps, ex.rest_seconds ?? null, ex.starting_weight ?? null, ex.extra_segments ?? 0]);
      }
    }
    await client.query('COMMIT');
    return { id: planId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function listPlans(userId: string) {
  const r = await query('SELECT id, name, is_active FROM plans WHERE user_id=$1 ORDER BY name', [userId]);
  return r.rows;
}

export async function createBlankPlan(userId: string, name: string): Promise<{ id: string }> {
  const r = await query<{ id: string }>(
    'INSERT INTO plans (user_id, name, is_active, is_template) VALUES ($1,$2,false,false) RETURNING id', [userId, name]);
  return r.rows[0];
}

export async function listVisiblePlans(userId: string) {
  const r = await query(
    `SELECT id, name, is_active, is_template, (user_id = $1) AS owned
     FROM plans WHERE (user_id = $1 OR is_template = true) AND deleted_at IS NULL ORDER BY is_template, name`, [userId]);
  return r.rows;
}

export async function softDeletePlan(planId: string): Promise<boolean> {
  const r = await query('UPDATE plans SET deleted_at=now() WHERE id=$1 RETURNING id', [planId]);
  return r.rowCount! > 0;
}

export async function getPlanTree(userId: string, planId: string) {
  const plan = await query<{ id: string; name: string; is_active: boolean; is_template: boolean; owned: boolean }>(
    `SELECT id, name, is_active, is_template, (user_id = $2) AS owned
     FROM plans WHERE id=$1 AND (user_id=$2 OR is_template=true) AND deleted_at IS NULL`, [planId, userId]);
  if (!plan.rows[0]) return null;
  const days = await query(
    'SELECT id, name, order_index, is_superset FROM plan_days WHERE plan_id=$1 ORDER BY order_index', [planId]);
  const exercises = await query(
    `SELECT de.id, de.plan_day_id, de.exercise_name, de.order_index, de.target_sets, de.target_reps, de.rest_seconds, de.starting_weight, de.extra_segments
     FROM day_exercises de JOIN plan_days pd ON pd.id = de.plan_day_id
     WHERE pd.plan_id=$1 ORDER BY de.order_index`, [planId]);
  return {
    ...plan.rows[0],
    days: days.rows.map((d: any) => ({
      ...d,
      exercises: exercises.rows.filter((x: any) => x.plan_day_id === d.id)
        .map(({ plan_day_id, ...rest }: any) => rest),
    })),
  };
}

export async function userOwnsPlan(userId: string, planId: string): Promise<boolean> {
  const r = await query('SELECT 1 FROM plans WHERE id=$1 AND user_id=$2', [planId, userId]);
  return r.rowCount! > 0;
}
export async function userOwnsPlanDay(userId: string, dayId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM plan_days pd JOIN plans p ON p.id=pd.plan_id WHERE pd.id=$1 AND p.user_id=$2`, [dayId, userId]);
  return r.rowCount! > 0;
}
export async function userOwnsExercise(userId: string, exId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM day_exercises de JOIN plan_days pd ON pd.id=de.plan_day_id JOIN plans p ON p.id=pd.plan_id
     WHERE de.id=$1 AND p.user_id=$2`, [exId, userId]);
  return r.rowCount! > 0;
}
export async function isAdminUser(userId: string): Promise<boolean> {
  const r = await query<{ login: string }>('SELECT login FROM users WHERE id=$1', [userId]);
  return r.rows[0]?.login === config.adminLogin;
}
export async function userCanReadPlanDay(userId: string, dayId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM plan_days pd JOIN plans p ON p.id=pd.plan_id
     WHERE pd.id=$1 AND (p.user_id=$2 OR p.is_template=true)`, [dayId, userId]);
  return r.rowCount! > 0;
}
export async function updatePlan(planId: string, fields: { name?: string; is_active?: boolean; is_template?: boolean }) {
  const sets: string[] = []; const vals: unknown[] = [];
  if (fields.name !== undefined) { vals.push(fields.name); sets.push(`name=$${vals.length}`); }
  if (fields.is_active !== undefined) { vals.push(fields.is_active); sets.push(`is_active=$${vals.length}`); }
  if (fields.is_template !== undefined) { vals.push(fields.is_template); sets.push(`is_template=$${vals.length}`); }
  if (!sets.length) return;
  vals.push(planId);
  await query(`UPDATE plans SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
}
export async function addDay(planId: string, name: string) {
  const r = await query<{ id: string }>(
    `INSERT INTO plan_days (plan_id, name, order_index)
     VALUES ($1,$2,(SELECT COALESCE(MAX(order_index)+1,0) FROM plan_days WHERE plan_id=$1)) RETURNING id`, [planId, name]);
  return r.rows[0];
}
export async function updateDay(dayId: string, fields: { name?: string; order_index?: number; is_superset?: boolean }) {
  const sets: string[] = []; const vals: unknown[] = [];
  if (fields.name !== undefined) { vals.push(fields.name); sets.push(`name=$${vals.length}`); }
  if (fields.order_index !== undefined) { vals.push(fields.order_index); sets.push(`order_index=$${vals.length}`); }
  if (fields.is_superset !== undefined) { vals.push(fields.is_superset); sets.push(`is_superset=$${vals.length}`); }
  if (!sets.length) return;
  vals.push(dayId);
  await query(`UPDATE plan_days SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
}
export async function deleteDay(dayId: string) { await query('DELETE FROM plan_days WHERE id=$1', [dayId]); }
export async function addExercise(dayId: string, ex: any) {
  const r = await query<{ id: string }>(
    `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight, extra_segments)
     VALUES ($1,$2,(SELECT COALESCE(MAX(order_index)+1,0) FROM day_exercises WHERE plan_day_id=$1),$3,$4,$5,$6,$7) RETURNING id`,
    [dayId, ex.exercise_name, ex.target_sets, ex.target_reps, ex.rest_seconds ?? null, ex.starting_weight ?? null, ex.extra_segments ?? 0]);
  return r.rows[0];
}
export async function updateExercise(exId: string, fields: Record<string, unknown>) {
  const cols = ['exercise_name','order_index','target_sets','target_reps','rest_seconds','starting_weight','extra_segments'];
  const sets: string[] = []; const vals: unknown[] = [];
  for (const c of cols) if (fields[c] !== undefined) { vals.push(fields[c]); sets.push(`${c}=$${vals.length}`); }
  if (!sets.length) return;
  vals.push(exId);
  await query(`UPDATE day_exercises SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
}
export async function deleteExercise(exId: string) { await query('DELETE FROM day_exercises WHERE id=$1', [exId]); }

export async function forkPlan(userId: string, planId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const src = await client.query<{ name: string }>(
      'SELECT name FROM plans WHERE id=$1 AND (user_id=$2 OR is_template=true) AND deleted_at IS NULL', [planId, userId]);
    if (!src.rows[0]) { await client.query('ROLLBACK'); return null; }
    const newPlan = await client.query<{ id: string }>(
      'INSERT INTO plans (user_id, name, is_active, is_template) VALUES ($1,$2,false,false) RETURNING id',
      [userId, `${src.rows[0].name} (My Personal)`]);
    const newPlanId = newPlan.rows[0].id;
    const dayIdMap: Record<string, string> = {};
    const exerciseIdMap: Record<string, string> = {};
    const days = await client.query<{ id: string; name: string; order_index: number; is_superset: boolean }>(
      'SELECT id, name, order_index, is_superset FROM plan_days WHERE plan_id=$1 ORDER BY order_index', [planId]);
    for (const d of days.rows) {
      const nd = await client.query<{ id: string }>(
        'INSERT INTO plan_days (plan_id, name, order_index, is_superset) VALUES ($1,$2,$3,$4) RETURNING id',
        [newPlanId, d.name, d.order_index, d.is_superset]);
      dayIdMap[d.id] = nd.rows[0].id;
    }
    const exs = await client.query<any>(
      `SELECT de.id, de.plan_day_id, de.exercise_name, de.order_index, de.target_sets, de.target_reps, de.rest_seconds, de.starting_weight, de.extra_segments
       FROM day_exercises de JOIN plan_days pd ON pd.id=de.plan_day_id
       WHERE pd.plan_id=$1 ORDER BY de.order_index`, [planId]);
    for (const e of exs.rows) {
      const ne = await client.query<{ id: string }>(
        `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight, extra_segments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [dayIdMap[e.plan_day_id], e.exercise_name, e.order_index, e.target_sets, e.target_reps, e.rest_seconds, e.starting_weight, e.extra_segments]);
      exerciseIdMap[e.id] = ne.rows[0].id;
    }
    await client.query('COMMIT');
    return { id: newPlanId, dayIdMap, exerciseIdMap };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getDayWithExercises(dayId: string) {
  const day = await query<{ id: string; name: string; is_superset: boolean }>('SELECT id, name, is_superset FROM plan_days WHERE id=$1', [dayId]);
  if (!day.rows[0]) return null;
  const exercises = await query(
    `SELECT id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight::float8 AS starting_weight, extra_segments
     FROM day_exercises WHERE plan_day_id=$1 ORDER BY order_index`, [dayId]);
  return { ...day.rows[0], exercises: exercises.rows };
}

export async function exportPlan(userId: string, planId: string) {
  const tree = await getPlanTree(userId, planId);
  if (!tree) return null;
  return {
    name: tree.name,
    days: tree.days.map((d: any) => ({
      name: d.name,
      is_superset: d.is_superset,
      exercises: d.exercises.map((e: any) => ({
        exercise_name: e.exercise_name, target_sets: e.target_sets, target_reps: e.target_reps,
        rest_seconds: e.rest_seconds, starting_weight: e.starting_weight, extra_segments: e.extra_segments,
      })),
    })),
  };
}
