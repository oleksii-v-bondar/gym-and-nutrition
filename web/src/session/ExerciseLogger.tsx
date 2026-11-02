import { useState } from 'react';
type Effort = 'easy' | 'ok' | 'hard' | 'failed';
interface Props {
  exerciseName: string; targetReps: number; targetSets: number; setNumber: number;
  suggestedWeight: number | null; suggestionReason: string;
  onLog(weight: number, reps: number, effort: Effort): void;
}
export function ExerciseLogger(props: Props) {
  const [weight, setWeight] = useState<string>(props.suggestedWeight != null ? String(props.suggestedWeight) : '');
  const [reps, setReps] = useState<string>(String(props.targetReps));
  const efforts: Effort[] = ['easy', 'ok', 'hard', 'failed'];
  return (
    <div className="card">
      <h2>{props.exerciseName}</h2>
      <p style={{ color: 'var(--muted)' }}>Set {props.setNumber}/{props.targetSets} • target {props.targetReps} reps</p>
      <p>💡 {props.suggestionReason}</p>
      <label htmlFor="weight">Weight (kg)</label>
      <input id="weight" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
      <label htmlFor="reps">Reps done</label>
      <input id="reps" type="number" value={reps} onChange={(e) => setReps(e.target.value)} />
      <p style={{ color: 'var(--muted)' }}>How did it feel? (tap to log the set)</p>
      <div className="row">
        {efforts.map((ef) => (
          <button key={ef} className="big-tap" onClick={() => props.onLog(Number(weight), Number(reps), ef)}>{ef}</button>
        ))}
      </div>
    </div>
  );
}
