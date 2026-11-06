import { suggestNextWeight } from './suggest.js';

const base = { targetReps: 8, increment: 2.5, startingWeight: null };

it('no history with a starting weight -> starting weight', () => {
  expect(suggestNextWeight({ ...base, lastSets: null, startingWeight: 40 }))
    .toEqual({ weight: 40, reason: expect.stringContaining('Starting') });
});

it('no history and no starting weight -> prompt (null)', () => {
  expect(suggestNextWeight({ ...base, lastSets: null }))
    .toEqual({ weight: null, reason: expect.stringContaining('Enter') });
});

it('all sets hit reps and all easy -> +increment', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 8, effort: 'easy', weight_used: 40 },
    { reps_done: 8, effort: 'easy', weight_used: 40 },
  ] });
  expect(r.weight).toBe(42.5);
  expect(r.reason).toMatch(/easy/i);
});

it('hit reps but some ok/hard -> hold', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 8, effort: 'easy', weight_used: 40 },
    { reps_done: 8, effort: 'hard', weight_used: 40 },
  ] });
  expect(r.weight).toBe(40);
});

it('a failed set -> deload by increment', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 8, effort: 'ok', weight_used: 40 },
    { reps_done: 4, effort: 'failed', weight_used: 40 },
  ] });
  expect(r.weight).toBe(37.5);
});

it('missed target reps (no failed flag) -> deload', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 6, effort: 'hard', weight_used: 40 },
  ] });
  expect(r.weight).toBe(37.5);
});

it('deload reduces weight without flooring at 0', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 2, effort: 'failed', weight_used: 2 },
  ] });
  expect(r.weight).toBe(-0.5);
});

it('uses the heaviest set as the reference weight', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 8, effort: 'easy', weight_used: 40 },
    { reps_done: 8, effort: 'easy', weight_used: 42.5 },
  ] });
  expect(r.weight).toBe(45);
});

it('assisted (negative) weight deloads further instead of clamping at 0', () => {
  const r = suggestNextWeight({ ...base, lastSets: [
    { reps_done: 5, effort: 'failed', weight_used: -20 },
  ] });
  expect(r.weight).toBe(-22.5);
});
