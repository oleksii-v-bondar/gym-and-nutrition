import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseLogger } from './ExerciseLogger';

it('pre-renders target segments with reps pre-filled, and logs them with the set', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Bench" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={60} suggestionReason="x" extraSegmentTargets={[{ reps: 12 }]} onLog={onLog} />);

  expect(screen.getAllByPlaceholderText('weight')).toHaveLength(1);
  expect(screen.getByPlaceholderText('reps')).toHaveValue(12);

  await userEvent.type(screen.getByPlaceholderText('weight'), '40');
  await userEvent.click(screen.getByRole('button', { name: 'easy' }));

  expect(onLog).toHaveBeenCalledWith(60, 8, 'easy', [{ weight: 40, reps: 12 }]);
});

it('failed shows a completed-reps prompt pre-filled with current reps, then logs with that number', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Pull-up" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={0} suggestionReason="x" extraSegmentTargets={[]} onLog={onLog} />);
  await userEvent.click(screen.getByRole('button', { name: 'failed' }));
  expect(onLog).not.toHaveBeenCalled();
  const input = screen.getByPlaceholderText('reps completed');
  expect(input).toHaveValue(8);
  await userEvent.clear(input);
  await userEvent.type(input, '5');
  await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
  expect(onLog).toHaveBeenCalledWith(0, 5, 'failed', []);
});

it('disables the failed Confirm button until a completed-reps value is entered', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Pull-up" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={0} suggestionReason="x" extraSegmentTargets={[]} onLog={onLog} />);
  await userEvent.click(screen.getByRole('button', { name: 'failed' }));
  const input = screen.getByPlaceholderText('reps completed');
  await userEvent.clear(input);
  expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
  await userEvent.type(input, '5');
  expect(screen.getByRole('button', { name: /confirm/i })).not.toBeDisabled();
});

it('ok logs immediately without a completed-reps prompt', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Bench" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={60} suggestionReason="x" extraSegmentTargets={[]} onLog={onLog} />);
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  expect(onLog).toHaveBeenCalledWith(60, 8, 'ok', []);
  expect(screen.queryByPlaceholderText('reps completed')).toBeNull();
});
