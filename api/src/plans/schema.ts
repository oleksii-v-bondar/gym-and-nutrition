import { z } from 'zod';
export const exerciseImport = z.object({
  exercise_name: z.string().min(1),
  target_sets: z.number().int().positive(),
  target_reps: z.number().int().positive(),
  rest_seconds: z.number().int().nonnegative().nullable().optional(),
  starting_weight: z.number().nullable().optional(),
  extra_segments: z.array(z.object({ reps: z.number().int().positive() })).optional(),
});
export const dayImport = z.object({
  name: z.string().min(1),
  is_superset: z.boolean().optional(),
  exercises: z.array(exerciseImport),
});
export const importSchema = z.object({
  name: z.string().min(1),
  days: z.array(dayImport),
});
export type PlanImport = z.infer<typeof importSchema>;

export const blankPlanCreate = z.object({ name: z.string().min(1) });

export const planUpdate = z.object({
  name: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  is_template: z.boolean().optional(),
});
export const dayCreate = z.object({ name: z.string().min(1) });
export const dayUpdate = z.object({
  name: z.string().min(1).optional(),
  order_index: z.number().int().nonnegative().optional(),
  is_superset: z.boolean().optional(),
});
export const exerciseUpsert = z.object({
  exercise_name: z.string().min(1).optional(),
  order_index: z.number().int().nonnegative().optional(),
  target_sets: z.number().int().positive().optional(),
  target_reps: z.number().int().positive().optional(),
  rest_seconds: z.number().int().nonnegative().nullable().optional(),
  starting_weight: z.number().nullable().optional(),
  extra_segments: z.array(z.object({ reps: z.number().int().positive() })).optional(),
});
