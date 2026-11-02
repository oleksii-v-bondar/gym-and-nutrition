import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseLogger } from './ExerciseLogger';

it('pre-renders planned segments, adds more, and logs them with the set', async () => {
  const onLog = vi.fn();
  render(<ExerciseLogger exerciseName="Bench" targetReps={8} targetSets={3} setNumber={1}
    suggestedWeight={60} suggestionReason="x" extraSegments={1} onLog={onLog} />);

  expect(screen.getAllByPlaceholderText(/segment kg/i)).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: /add segment/i }));
  expect(screen.getAllByPlaceholderText(/segment kg/i)).toHaveLength(2);

  await userEvent.type(screen.getAllByPlaceholderText(/segment kg/i)[0], '40');
  await userEvent.type(screen.getAllByPlaceholderText(/segment reps/i)[0], '10');
  await userEvent.click(screen.getByRole('button', { name: 'easy' }));

  expect(onLog).toHaveBeenCalledWith(60, 8, 'easy', [{ weight: 40, reps: 10 }]);
});
