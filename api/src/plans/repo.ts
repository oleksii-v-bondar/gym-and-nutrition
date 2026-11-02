import { pool, query } from '../db.js';
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
        'INSERT INTO plan_days (plan_id, name, order_index) VALUES ($1,$2,$3) RETURNING id', [planId, day.name, d]);
      const dayId = dayRow.rows[0].id;
      for (let e = 0; e < day.exercises.length; e++) {
        const ex = day.exercises[e];
        await client.query(
          `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [dayId, ex.exercise_name, e, ex.target_sets, ex.target_reps, ex.rest_seconds ?? null, ex.starting_weight ?? null]);
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

export async function getPlanTree(userId: string, planId: string) {
  const plan = await query<{ id: string; name: string; is_active: boolean }>(
    'SELECT id, name, is_active FROM plans WHERE id=$1 AND user_id=$2', [planId, userId]);
  if (!plan.rows[0]) return null;
  const days = await query(
    'SELECT id, name, order_index FROM plan_days WHERE plan_id=$1 ORDER BY order_index', [planId]);
  const exercises = await query(
    `SELECT de.id, de.plan_day_id, de.exercise_name, de.order_index, de.target_sets, de.target_reps, de.rest_seconds, de.starting_weight
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
export async function updatePlan(planId: string, fields: { name?: string; is_active?: boolean }) {
  const sets: string[] = []; const vals: unknown[] = [];
  if (fields.name !== undefined) { vals.push(fields.name); sets.push(`name=$${vals.length}`); }
  if (fields.is_active !== undefined) { vals.push(fields.is_active); sets.push(`is_active=$${vals.length}`); }
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
export async function updateDay(dayId: string, fields: { name?: string; order_index?: number }) {
  const sets: string[] = []; const vals: unknown[] = [];
  if (fields.name !== undefined) { vals.push(fields.name); sets.push(`name=$${vals.length}`); }
  if (fields.order_index !== undefined) { vals.push(fields.order_index); sets.push(`order_index=$${vals.length}`); }
  if (!sets.length) return;
  vals.push(dayId);
  await query(`UPDATE plan_days SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
}
export async function deleteDay(dayId: string) { await query('DELETE FROM plan_days WHERE id=$1', [dayId]); }
export async function addExercise(dayId: string, ex: any) {
  const r = await query<{ id: string }>(
    `INSERT INTO day_exercises (plan_day_id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight)
     VALUES ($1,$2,(SELECT COALESCE(MAX(order_index)+1,0) FROM day_exercises WHERE plan_day_id=$1),$3,$4,$5,$6) RETURNING id`,
    [dayId, ex.exercise_name, ex.target_sets, ex.target_reps, ex.rest_seconds ?? null, ex.starting_weight ?? null]);
  return r.rows[0];
}
export async function updateExercise(exId: string, fields: Record<string, unknown>) {
  const cols = ['exercise_name','order_index','target_sets','target_reps','rest_seconds','starting_weight'];
  const sets: string[] = []; const vals: unknown[] = [];
  for (const c of cols) if (fields[c] !== undefined) { vals.push(fields[c]); sets.push(`${c}=$${vals.length}`); }
  if (!sets.length) return;
  vals.push(exId);
  await query(`UPDATE day_exercises SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
}
export async function deleteExercise(exId: string) { await query('DELETE FROM day_exercises WHERE id=$1', [exId]); }

export async function getDayWithExercises(dayId: string) {
  const day = await query<{ id: string; name: string }>('SELECT id, name FROM plan_days WHERE id=$1', [dayId]);
  if (!day.rows[0]) return null;
  const exercises = await query(
    `SELECT id, exercise_name, order_index, target_sets, target_reps, rest_seconds, starting_weight::float8 AS starting_weight
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
      exercises: d.exercises.map((e: any) => ({
        exercise_name: e.exercise_name, target_sets: e.target_sets, target_reps: e.target_reps,
        rest_seconds: e.rest_seconds, starting_weight: e.starting_weight,
      })),
    })),
  };
}
