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
