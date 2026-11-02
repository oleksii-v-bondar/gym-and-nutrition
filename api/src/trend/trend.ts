export interface SessionPoint { date: string; topWeight: number; bestE1rm: number; }
export type TrendLabel = 'progressing' | 'steady' | 'regressing' | 'insufficient';
export interface TrendResult { series: SessionPoint[]; label: TrendLabel; slope: number; }

export function epley(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

function leastSquaresSlope(ys: number[]): number {
  const n = ys.length;
  const xs = ys.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) ** 2; }
  return den === 0 ? 0 : num / den;
}

export function computeTrend(
  sessions: Array<{ date: string; sets: Array<{ weight_used: number; reps_done: number }> }>,
  window = 5,
): TrendResult {
  const points: SessionPoint[] = sessions
    .filter((s) => s.sets.length > 0)
    .map((s) => ({
      date: s.date,
      topWeight: Math.max(...s.sets.map((x) => x.weight_used)),
      bestE1rm: Math.max(...s.sets.map((x) => epley(x.weight_used, x.reps_done))),
    }));
  const series = points.slice(-window);
  if (series.length < 2) return { series, label: 'insufficient', slope: 0 };
  const slope = leastSquaresSlope(series.map((p) => p.bestE1rm));
  const label: TrendLabel = slope > 0.1 ? 'progressing' : slope < -0.1 ? 'regressing' : 'steady';
  return { series, label, slope };
}
