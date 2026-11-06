# Negative Weight (Assisted / Gravitron) — Design Spec

**Date:** 2026-11-06
**Status:** Approved (design); pending implementation plan
**Builds on:** the existing gym-tracker app, including the workout-logging-improvements bodyweight display.

---

## 1. Purpose

Allow a weight to be **negative**, representing an **assisted** exercise (e.g. a Gravitron/assisted pull-up machine) where the effective load is the user's bodyweight minus the machine's assistance.

**Success criteria**
- Weight inputs accept negative values when logging a set, editing a set, and in a logged set's extra segments.
- A set with negative weight renders as **"Assisted |W| kg × reps"** in history and the session detail (three-way with the existing bodyweight rule).
- The weight suggestion no longer clamps at 0, so an assisted exercise can progress/deload within assistance.

**Non-goals (YAGNI)**
- A per-exercise "assisted machine" flag — negative weight is a per-set value the user types.
- Any new column or data-model change (`weight_used`/`starting_weight` are already `numeric`, which stores negatives).
- Special assisted-specific progression math beyond removing the 0 floor.

---

## 2. Weight semantics (three-way)

`weight_used` is interpreted as:

| Value | Meaning | Display |
|-------|---------|---------|
| `> 0` | added weight | `"{w} kg × {reps} ({effort})"` |
| `= 0` | bodyweight | `"Bodyweight × {reps} reps ({effort})"` |
| `< 0` | assisted (Gravitron) | `"Assisted {|w|} kg × {reps} ({effort})"` |

Reps remain the primary metric for the non-positive cases.

---

## 3. Validation (allow negatives)

Remove the `nonnegative()` constraint from **weight** fields only (reps stay `int` `nonnegative`/`positive`):

- `api/src/sessions/routes.ts`: `setBody.weight_used` and `patchSetBody.weight_used` → `z.number()`; the `extra_segments[].weight` in both → `z.number()`.
- `api/src/plans/schema.ts`: `starting_weight` in `exerciseImport` and `exerciseUpsert` → drop `nonnegative()` (stays `.nullable().optional()`).

No endpoint/route shape changes.

---

## 4. Display (`setFormat` three-way)

- `formatSetLine(weight, reps, effort)` gains the `weight < 0` branch → `"Assisted {Math.abs(weight)} kg × {reps} ({effort})"`. The `=== 0` and `> 0` branches are unchanged.
- `formatSegment(weight, reps)` needs **no change**: a negative weight already prints its sign via the existing `"{weight}×{reps}"` branch (e.g. `-20×10`); `0` stays `"×{reps}"`. (Kept terse for the segment line.)

The edit page (`SessionEditPage`) shows raw editable inputs, so negative values display as typed — no formatter involved there.

---

## 5. Input affordance (mobile minus key)

The workout-logging change set `inputMode="numeric"` on number inputs, whose mobile keypad lacks a minus sign. To allow entering negatives, **remove `inputMode="numeric"` from weight inputs** (reverting to the `type="number"` default keypad, which includes `-`), while **keeping `inputMode="numeric"` on reps inputs**. Affected weight inputs: `ExerciseLogger` main weight + segment weight; `SessionEditPage` weight + segment weight. The spinner-hiding CSS stays (still improves reps visibility).

---

## 6. Suggestion engine

In `api/src/suggestion/suggest.ts`, the deload branch currently returns `Math.max(0, lastWeight - increment)`. Remove the `0` floor → `lastWeight - increment`, so an assisted (negative) exercise can deload further into assistance and a normal one is unaffected in the common case. The "all easy → +increment" and "hold" branches are unchanged.

---

## 7. Testing

**API:**
- Logging a set with `weight_used: -20` succeeds and reads back `-20`; a negative `extra_segments[].weight` is accepted.
- `starting_weight: -30` imports/updates successfully.
- `suggest.ts` unit: a last session at negative weight with missed reps/failed yields `lastWeight - increment` (more negative), not clamped to 0.

**Web:**
- `formatSetLine(-20, 10, 'ok')` → `"Assisted 20 kg × 10 (ok)"`; `0` and positive cases unchanged.
- `ExerciseLogger`/`SessionEditPage` weight inputs do not set `inputMode="numeric"` (reps inputs still do).

---

## 8. Files Touched (anticipated)

- `api/src/sessions/routes.ts` (weight Zod), `api/src/plans/schema.ts` (`starting_weight`), `api/src/suggestion/suggest.ts` (floor).
- `web/src/history/setFormat.ts` (assisted branch) + its test.
- `web/src/session/ExerciseLogger.tsx`, `web/src/history/SessionEditPage.tsx` (weight inputs drop `inputMode`).
- Tests alongside each (`api/__tests__/…`, `*.test.ts(x)`).
