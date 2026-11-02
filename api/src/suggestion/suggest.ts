export type Effort = 'easy' | 'ok' | 'hard' | 'failed';
export interface PastSet { reps_done: number; effort: Effort; weight_used: number; }
export interface SuggestInput {
  lastSets: PastSet[] | null;
  targetReps: number;
  increment: number;
  startingWeight: number | null;
}
export interface Suggestion { weight: number | null; reason: string; }

export function suggestNextWeight(input: SuggestInput): Suggestion {
  const { lastSets, targetReps, increment, startingWeight } = input;
  if (!lastSets || lastSets.length === 0) {
    if (startingWeight != null) return { weight: startingWeight, reason: `Starting weight ${startingWeight} kg` };
    return { weight: null, reason: 'Enter a starting weight for this exercise' };
  }
  const lastWeight = Math.max(...lastSets.map((s) => s.weight_used));
  const anyFailed = lastSets.some((s) => s.effort === 'failed');
  const missedReps = lastSets.some((s) => s.reps_done < targetReps);
  if (anyFailed || missedReps) {
    return { weight: Math.max(0, lastWeight - increment), reason: `Deload −${increment} kg (missed reps / failed a set)` };
  }
  const allEasy = lastSets.every((s) => s.effort === 'easy');
  if (allEasy) {
    return { weight: lastWeight + increment, reason: `Last time felt easy → +${increment} kg` };
  }
  return { weight: lastWeight, reason: 'Hold — you hit your reps but it was tough' };
}
