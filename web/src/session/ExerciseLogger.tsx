import { useState } from 'react';
type Effort = 'easy' | 'ok' | 'hard' | 'failed';
interface Segment { weight: string; reps: string; }
interface Props {
  exerciseName: string; targetReps: number; targetSets: number; setNumber: number;
  suggestedWeight: number | null; suggestionReason: string; extraSegments: number;
  onLog(weight: number, reps: number, effort: Effort, segments: Array<{ weight: number; reps: number }>): void;
}
export function ExerciseLogger(props: Props) {
  const [weight, setWeight] = useState<string>(props.suggestedWeight != null ? String(props.suggestedWeight) : '');
  const [reps, setReps] = useState<string>(String(props.targetReps));
  const [segments, setSegments] = useState<Segment[]>(
    () => Array.from({ length: props.extraSegments }, () => ({ weight: '', reps: '' })));
  const efforts: Effort[] = ['easy', 'ok', 'hard', 'failed'];

  function setSegment(i: number, field: keyof Segment, value: string) {
    setSegments((prev) => prev.map((s, j) => (j === i ? { ...s, [field]: value } : s)));
  }
  function log(ef: Effort) {
    const filled = segments
      .filter((s) => s.weight !== '' && s.reps !== '')
      .map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) }));
    props.onLog(Number(weight), Number(reps), ef, filled);
  }

  return (
    <div className="card">
      <h2>{props.exerciseName}</h2>
      <p style={{ color: 'var(--muted)' }}>Set {props.setNumber}/{props.targetSets} • target {props.targetReps} reps</p>
      <p>💡 {props.suggestionReason}</p>
      <label htmlFor="weight">Weight (kg)</label>
      <input id="weight" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
      <label htmlFor="reps">Reps done</label>
      <input id="reps" type="number" value={reps} onChange={(e) => setReps(e.target.value)} />

      {segments.map((s, i) => (
        <div key={i} className="row" style={{ alignItems: 'center', marginTop: 6 }}>
          <input type="number" placeholder="segment kg" value={s.weight} onChange={(e) => setSegment(i, 'weight', e.target.value)} />
          <input type="number" placeholder="segment reps" value={s.reps} onChange={(e) => setSegment(i, 'reps', e.target.value)} />
          <button className="secondary" onClick={() => setSegments((prev) => prev.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="secondary" style={{ marginTop: 6 }}
        onClick={() => setSegments((prev) => [...prev, { weight: '', reps: '' }])}>+ add segment</button>

      <p style={{ color: 'var(--muted)' }}>How did it feel? (tap to log the set)</p>
      <div className="row">
        {efforts.map((ef) => (
          <button key={ef} className="big-tap" onClick={() => log(ef)}>{ef}</button>
        ))}
      </div>
    </div>
  );
}
