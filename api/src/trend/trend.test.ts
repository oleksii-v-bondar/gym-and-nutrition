import { epley, computeTrend } from './trend.js';

it('epley computes estimated 1RM', () => {
  expect(epley(100, 0)).toBe(100);
  expect(epley(30, 30)).toBeCloseTo(60);
});

it('insufficient data for fewer than two sessions', () => {
  expect(computeTrend([{ date: '2026-01-01', sets: [{ weight_used: 40, reps_done: 8 }] }]).label).toBe('insufficient');
  expect(computeTrend([]).label).toBe('insufficient');
});

it('rising weights -> progressing', () => {
  const r = computeTrend([
    { date: '2026-01-01', sets: [{ weight_used: 40, reps_done: 8 }] },
    { date: '2026-01-03', sets: [{ weight_used: 42.5, reps_done: 8 }] },
    { date: '2026-01-05', sets: [{ weight_used: 45, reps_done: 8 }] },
  ]);
  expect(r.label).toBe('progressing');
  expect(r.slope).toBeGreaterThan(0);
  expect(r.series).toHaveLength(3);
  expect(r.series[0].bestE1rm).toBeCloseTo(epley(40, 8));
});

it('falling weights -> regressing', () => {
  const r = computeTrend([
    { date: '2026-01-01', sets: [{ weight_used: 50, reps_done: 8 }] },
    { date: '2026-01-03', sets: [{ weight_used: 45, reps_done: 8 }] },
    { date: '2026-01-05', sets: [{ weight_used: 40, reps_done: 8 }] },
  ]);
  expect(r.label).toBe('regressing');
});

it('flat weights -> steady', () => {
  const r = computeTrend([
    { date: '2026-01-01', sets: [{ weight_used: 40, reps_done: 8 }] },
    { date: '2026-01-03', sets: [{ weight_used: 40, reps_done: 8 }] },
    { date: '2026-01-05', sets: [{ weight_used: 40, reps_done: 8 }] },
  ]);
  expect(r.label).toBe('steady');
});

it('respects the window (only the last N points)', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    sets: [{ weight_used: 40 + i, reps_done: 8 }],
  }));
  const r = computeTrend(many, 5);
  expect(r.series).toHaveLength(5);
  expect(r.series[0].topWeight).toBe(43); // points 4..8 -> weights 43..47
});
