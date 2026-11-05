import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseLogger } from './ExerciseLogger';

it('pre-renders planned additional rows, adds more, and logs them with the set', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Bench" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={60} suggestionReason="x" extraSegments={1} onLog={onLog} />);

  expect(screen.getAllByPlaceholderText('weight')).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: /add additional reps/i }));
  expect(screen.getAllByPlaceholderText('weight')).toHaveLength(2);

  await userEvent.type(screen.getAllByPlaceholderText('weight')[0], '40');
  await userEvent.type(screen.getAllByPlaceholderText('reps')[0], '10');
  await userEvent.click(screen.getByRole('button', { name: 'easy' }));

  expect(onLog).toHaveBeenCalledWith(60, 8, 'easy', [{ weight: 40, reps: 10 }]);
});

it('failed shows a completed-reps prompt pre-filled with current reps, then logs with that number', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Pull-up" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={0} suggestionReason="x" extraSegments={0} onLog={onLog} />);

  await userEvent.click(screen.getByRole('button', { name: 'failed' }));
  expect(onLog).not.toHaveBeenCalled();

  const input = screen.getByPlaceholderText('reps completed');
  expect(input).toHaveValue(8); // pre-filled with current reps (targetReps default)
  await userEvent.clear(input);
  await userEvent.type(input, '5');
  await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

  expect(onLog).toHaveBeenCalledWith(0, 5, 'failed', []);
});

it('ok logs immediately without a completed-reps prompt', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Bench" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={60} suggestionReason="x" extraSegments={0} onLog={onLog} />);
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  expect(onLog).toHaveBeenCalledWith(60, 8, 'ok', []);
  expect(screen.queryByPlaceholderText('reps completed')).toBeNull();
});
