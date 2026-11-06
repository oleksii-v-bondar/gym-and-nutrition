-- One-time migration: convert day_exercises.extra_segments from an int count to a
-- jsonb array of {reps}. Each old count N becomes N segments defaulting to the
-- exercise's main target_reps; 0/null becomes an empty array.
BEGIN;
ALTER TABLE day_exercises
  ALTER COLUMN extra_segments DROP DEFAULT,
  ALTER COLUMN extra_segments TYPE jsonb USING (
    CASE
      WHEN extra_segments IS NULL OR extra_segments <= 0 THEN '[]'::jsonb
      ELSE (SELECT jsonb_agg(jsonb_build_object('reps', target_reps))
            FROM generate_series(1, extra_segments))
    END),
  ALTER COLUMN extra_segments SET DEFAULT '[]'::jsonb;
COMMIT;
