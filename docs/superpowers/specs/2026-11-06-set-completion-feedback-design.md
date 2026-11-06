# Set-Completion Feedback — Design Spec

**Date:** 2026-11-06
**Status:** Approved (design); pending implementation plan
**Builds on:** the existing gym-tracker session/logging UI.

---

## 1. Purpose

During a workout, logging a set only nudges the "Set X/Y" counter — there's no distinct, satisfying "that set is done" signal. Add two display-only indicators:

1. **Per-exercise set dots** — a row of dots showing completed / current / remaining sets for the current exercise.
2. **"✓ Set logged" confirmation flash** — a brief confirmation after each effort tap.

**Success criteria**
- While logging, the current exercise shows a dot row (e.g. on set 2 of 3: `● ◉ ○`) that advances as sets are logged.
- After each effort tap (once the set is saved), a brief "✓ Set logged" pill appears (~1.2s) and fades.
- No backend or data-model change.

**Non-goals (YAGNI)**
- Overall-session progress bar, a running completed-sets list, per-rep (sub-set) tracking (not how logging works).
- Sound/haptics.

---

## 2. Per-exercise set dots (`ExerciseLogger`)

Rendered next to the existing `Set {setNumber}/{targetSets}` header.

- Render exactly `targetSets` dots.
- `completed = Math.min(Math.max(setNumber - 1, 0), targetSets)` sets are **filled** (●); the dot at index `setNumber - 1` (when within range) is the **current** set, highlighted in the accent colour (◉); the rest are **remaining** (○, muted).
- The clamp handles the superset edge case where the round number (`setNumber`) can exceed an exercise's `target_sets`.
- The dot container carries `aria-label={`${completed} of ${targetSets} sets completed`}` — accessible and testable.
- Dots update via the `setNumber` prop as `SessionPage` advances the step (the logger stays mounted across sets of the same exercise, and remounts per exercise via its `key`, so the row always reflects the current exercise).

---

## 3. "✓ Set logged" flash (`SessionPage`)

`SessionPage` owns the log action (`onLog`), so the flash lives there and shows reliably even when the next set moves to a new exercise.

- Add `flash` state. In `onLog`, **after** the set `POST` resolves (and before/around advancing the step), set `flash = true` and clear it after ~1.2s via a timeout; the timeout handle is tracked in a ref and cleared on unmount.
- Render a fixed-position pill (e.g. bottom-center) reading **"✓ Set logged"** when `flash` is true, with a short CSS fade. Fixed positioning avoids layout shift.
- The pill shows for both mid-exercise sets and the final set (which also triggers the completion screen).

---

## 4. Styles (`ui/styles.css`)

- Dot styles: a filled dot, an accent "current" dot, and a muted hollow dot (small, inline, with a little spacing). Reuse existing CSS variables (`--accent`, `--muted`, `--fg`).
- Flash pill: fixed near the bottom, centered, accent background, rounded, subtle fade-in/out; above normal content (`z-index`), non-interactive (`pointer-events: none`).

---

## 5. Testing

**Web (component):**
- `ExerciseLogger`: given `setNumber=3, targetSets=3`, the dot row reports `2 of 3 sets completed` (via its `aria-label`); given `setNumber=1`, it reports `0 of N`.
- `SessionPage`: after clicking an effort button and the set is logged, **"✓ Set logged"** appears (`findByText`).

---

## 6. Files Touched (anticipated)

- `web/src/session/ExerciseLogger.tsx` — set-dots row + its test (`ExerciseLogger.test.tsx`).
- `web/src/session/SessionPage.tsx` — flash state + pill + its test (`SessionPage.test.tsx`).
- `web/src/ui/styles.css` — dot + pill styles.
