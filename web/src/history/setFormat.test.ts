import { formatSetLine, formatSegment } from './setFormat';

it('formats a weighted set with kg', () => {
  expect(formatSetLine(40, 8, 'ok')).toBe('40 kg × 8 (ok)');
});

it('formats a weight-0 set as bodyweight with reps as the metric', () => {
  expect(formatSetLine(0, 12, 'hard')).toBe('Bodyweight × 12 reps (hard)');
});

it('formats segments, dropping 0 weight to just reps', () => {
  expect(formatSegment(20, 12)).toBe('20×12');
  expect(formatSegment(0, 8)).toBe('×8');
});
