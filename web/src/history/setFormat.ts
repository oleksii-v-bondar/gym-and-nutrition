export function formatSetLine(weight: number, reps: number, effort: string): string {
  return weight === 0
    ? `Bodyweight × ${reps} reps (${effort})`
    : `${weight} kg × ${reps} (${effort})`;
}

export function formatSegment(weight: number, reps: number): string {
  return weight === 0 ? `×${reps}` : `${weight}×${reps}`;
}
