-- One-time migration: convert day_exercises.extra_segments from an int count to a
-- jsonb array of {reps}. Each old count N becomes N segments defaulting to the
-- exercise's main target_reps; 0/null becomes an empty array.
--
-- An ALTER COLUMN ... TYPE ... USING expression cannot contain a subquery, so we
-- add a new jsonb column, populate it with a grouped subquery (generate_series to
-- repeat each exercise's target_reps N times), then swap it in.
BEGIN;
ALTER TABLE day_exercises ADD COLUMN extra_segments_new jsonb NOT NULL DEFAULT '[]';

UPDATE day_exercises d
SET extra_segments_new = sub.arr
FROM (
  SELECT d2.id, jsonb_agg(jsonb_build_object('reps', d2.target_reps)) AS arr
  FROM day_exercises d2, generate_series(1, d2.extra_segments)
  WHERE d2.extra_segments > 0
  GROUP BY d2.id
) sub
WHERE d.id = sub.id;

ALTER TABLE day_exercises DROP COLUMN extra_segments;
ALTER TABLE day_exercises RENAME COLUMN extra_segments_new TO extra_segments;
COMMIT;
