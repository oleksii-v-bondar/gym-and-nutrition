import { useState } from 'react';
import type { CSSProperties } from 'react';
type Effort = 'easy' | 'ok' | 'hard' | 'failed';
interface Segment { weight: string; reps: string; }
interface Props {
  exerciseName: string; targetReps: number; targetSets: number; setNumber: number;
  suggestedWeight: number | null; suggestionReason: string; extraSegments: number;
  onLog(weight: number, reps: number, effort: Effort, segments: Array<{ weight: number; reps: number }>): void;
}
const cap: CSSProperties = { fontSize: 11, color: 'var(--muted)', textAlign: 'center', display: 'block', marginTop: 2 };
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

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <span style={cap}>weight</span>
        </div>
        <div style={{ flex: 1 }}>
          <input type="number" value={reps} onChange={(e) => setReps(e.target.value)} />
          <span style={cap}>reps done</span>
        </div>
      </div>

      {segments.map((s, i) => (
        <div key={i} style={{ marginTop: 8 }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1 }}><input type="number" placeholder="weight" value={s.weight} onChange={(e) => setSegment(i, 'weight', e.target.value)} /></div>
            <div style={{ flex: 1 }}><input type="number" placeholder="reps" value={s.reps} onChange={(e) => setSegment(i, 'reps', e.target.value)} /></div>
            <button className="secondary" style={{ width: 'auto' }} onClick={() => setSegments((prev) => prev.filter((_, j) => j !== i))}>✕</button>
          </div>
          <span style={cap}>additional reps and weight</span>
        </div>
      ))}
      <button className="secondary" style={{ marginTop: 8 }}
        onClick={() => setSegments((prev) => [...prev, { weight: '', reps: '' }])}>+ add additional reps &amp; weight</button>

      <p style={{ color: 'var(--muted)' }}>How did it feel? (tap to log the set)</p>
      <div className="row">
        {efforts.map((ef) => (
          <button key={ef} className="big-tap" onClick={() => log(ef)}>{ef}</button>
        ))}
      </div>
    </div>
  );
}
