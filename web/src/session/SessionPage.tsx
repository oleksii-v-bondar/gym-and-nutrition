import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';
import { ExerciseLogger } from './ExerciseLogger';

interface Exercise { id: string; exercise_name: string; target_sets: number; target_reps: number; }
interface Day { id: string; name: string; exercises: Exercise[]; }
interface Suggestion { weight: number | null; reason: string; }
type Effort = 'easy' | 'ok' | 'hard' | 'failed';

export function SessionPage() {
  const { dayId } = useParams();
  const nav = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [setNumber, setSetNumber] = useState(1);
  const [done, setDone] = useState(false);
  const startedRef = useRef(false);

  const day = useQuery({ queryKey: ['day', dayId], queryFn: () => apiFetch<Day>(`/api/plan-days/${dayId}`) });

  useEffect(() => {
    if (!sessionId && !startedRef.current) {
      startedRef.current = true;
      apiFetch<{ id: string }>('/api/sessions', { method: 'POST', body: JSON.stringify({ plan_day_id: dayId }) })
        .then((s) => setSessionId(s.id));
    }
  }, [dayId, sessionId]);

  const exercise = day.data?.exercises[idx];
  const suggestion = useQuery({
    queryKey: ['suggestion', exercise?.id],
    queryFn: () => apiFetch<Suggestion>(`/api/exercises/${exercise!.id}/suggestion`),
    enabled: !!exercise,
  });

  async function onLog(weight: number, reps: number, effort: Effort) {
    if (!sessionId || !exercise) return;
    await apiFetch(`/api/sessions/${sessionId}/sets`, { method: 'POST', body: JSON.stringify({
      day_exercise_id: exercise.id, set_number: setNumber, weight_used: weight, reps_done: reps, effort }) });
    if (setNumber >= exercise.target_sets) {
      if (idx + 1 >= (day.data?.exercises.length ?? 0)) { setDone(true); }
      else { setIdx(idx + 1); setSetNumber(1); }
    } else {
      setSetNumber(setNumber + 1);
    }
  }

  async function finish() {
    if (sessionId) await apiFetch(`/api/sessions/${sessionId}/finish`, { method: 'POST' });
    nav('/');
  }

  if (day.isLoading) return <div className="app"><NavBar />Loading…</div>;
  if (!day.data) return <div className="app"><NavBar />Day not found</div>;

  return (
    <div className="app">
      <NavBar />
      <h1>{day.data.name}</h1>
      {done || !exercise ? (
        <div className="card">
          <p>Session complete 💪</p>
          <button onClick={finish}>Finish & save</button>
        </div>
      ) : (
        <>
          <p style={{ color: 'var(--muted)' }}>Exercise {idx + 1}/{day.data.exercises.length}</p>
          {suggestion.isLoading ? <p>Loading suggestion…</p> : (
            <ExerciseLogger
              key={exercise.id + ':' + setNumber}
              exerciseName={exercise.exercise_name}
              targetReps={exercise.target_reps}
              targetSets={exercise.target_sets}
              setNumber={setNumber}
              suggestedWeight={suggestion.data?.weight ?? null}
              suggestionReason={suggestion.data?.reason ?? ''}
              onLog={onLog}
            />
          )}
          <button className="secondary" onClick={finish}>End session early</button>
        </>
      )}
    </div>
  );
}
