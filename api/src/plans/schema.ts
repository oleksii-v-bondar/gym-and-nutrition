import { z } from 'zod';
export const exerciseImport = z.object({
  exercise_name: z.string().min(1),
  target_sets: z.number().int().positive(),
  target_reps: z.number().int().positive(),
  rest_seconds: z.number().int().nonnegative().nullable().optional(),
  starting_weight: z.number().nonnegative().nullable().optional(),
});
export const dayImport = z.object({
  name: z.string().min(1),
  exercises: z.array(exerciseImport),
});
export const importSchema = z.object({
  name: z.string().min(1),
  days: z.array(dayImport),
});
export type PlanImport = z.infer<typeof importSchema>;
