import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';
import { ExerciseLogger } from './ExerciseLogger';

interface Exercise { id: string; exercise_name: string; target_sets: number; target_reps: number; extra_segments: Array<{ reps: number }>; }
interface Day { id: string; name: string; is_superset: boolean; exercises: Exercise[]; }
interface Suggestion { weight: number | null; reason: string; }
type Effort = 'easy' | 'ok' | 'hard' | 'failed';

export function SessionPage() {
  const { dayId } = useParams();
  const nav = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
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

  const sessionDetail = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => apiFetch<{ sets: Array<{ day_exercise_id: string; set_number: number; weight_used: number }> }>(`/api/sessions/${sessionId}`),
    enabled: !!sessionId,
  });
  const resumedRef = useRef(false);
  const [resumed, setResumed] = useState(false);

  const exercises = day.data?.exercises ?? [];
  const isSuperset = day.data?.is_superset ?? false;
  // Flatten the session into an ordered list of (exercise, setNumber) steps.
  // Normal days are exercise-major (all sets of A, then B); supersets are round-major
  // (one set of each exercise per round, repeated for the exercises' set count).
  const steps = useMemo(() => {
    const s: Array<{ exIdx: number; setNumber: number }> = [];
    if (isSuperset) {
      const rounds = exercises.length ? Math.max(...exercises.map((e) => e.target_sets)) : 0;
      for (let r = 1; r <= rounds; r++) for (let i = 0; i < exercises.length; i++) s.push({ exIdx: i, setNumber: r });
    } else {
      for (let i = 0; i < exercises.length; i++) for (let n = 1; n <= exercises[i].target_sets; n++) s.push({ exIdx: i, setNumber: n });
    }
    return s;
  }, [exercises, isSuperset]);
  const totalRounds = isSuperset && exercises.length ? Math.max(...exercises.map((e) => e.target_sets)) : 0;
  const current = steps[step];
  const exercise = current ? exercises[current.exIdx] : undefined;
  const setNumber = current?.setNumber ?? 1;

  // Derive the resume point once: start at the first unlogged set (= number of sets
  // already logged this session). resumedRef keeps a background refetch from resetting it.
  useEffect(() => {
    if (resumedRef.current || !day.data || !sessionDetail.data) return;
    resumedRef.current = true;
    const logged = sessionDetail.data.sets.length;
    if (logged >= steps.length) setDone(true);
    else setStep(logged);
    setResumed(true);
  }, [day.data, sessionDetail.data, steps.length]);

  const resumeWeight = useMemo(() => {
    if (!exercise || !sessionDetail.data) return null;
    const mine = sessionDetail.data.sets.filter((s) => s.day_exercise_id === exercise.id);
    if (!mine.length) return null;
    return mine.reduce((a, b) => (b.set_number > a.set_number ? b : a)).weight_used;
  }, [exercise, sessionDetail.data]);

  const suggestion = useQuery({
    queryKey: ['suggestion', exercise?.id],
    queryFn: () => apiFetch<Suggestion>(`/api/exercises/${exercise!.id}/suggestion`),
    enabled: !!exercise,
  });

  async function onLog(weight: number, reps: number, effort: Effort, segments: Array<{ weight: number; reps: number }>) {
    if (!sessionId || !exercise) return;
    await apiFetch(`/api/sessions/${sessionId}/sets`, { method: 'POST', body: JSON.stringify({
      day_exercise_id: exercise.id, set_number: setNumber, weight_used: weight, reps_done: reps, effort,
      extra_segments: segments }) });
    if (step + 1 >= steps.length) setDone(true);
    else setStep(step + 1);
  }

  async function finish() {
    if (sessionId) await apiFetch(`/api/sessions/${sessionId}/finish`, { method: 'POST' });
    nav('/');
  }

  if (day.isLoading) return <div className="app"><NavBar />Loading…</div>;
  if (!day.data) return <div className="app"><NavBar />Day not found</div>;
  if (!sessionId || !sessionDetail.isSuccess || !resumed) return <div className="app"><NavBar />Loading…</div>;

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
          <p style={{ color: 'var(--muted)' }}>
            {isSuperset
              ? `Round ${setNumber}/${totalRounds} — Exercise ${current!.exIdx + 1}/${exercises.length}`
              : `Exercise ${current!.exIdx + 1}/${exercises.length}`}
          </p>
          {suggestion.isLoading ? <p>Loading suggestion…</p> : (
            <ExerciseLogger
              key={exercise.id}
              exerciseName={exercise.exercise_name}
              targetReps={exercise.target_reps}
              targetSets={exercise.target_sets}
              setNumber={setNumber}
              suggestedWeight={resumeWeight ?? suggestion.data?.weight ?? null}
              suggestionReason={suggestion.data?.reason ?? ''}
              extraSegmentTargets={exercise.extra_segments ?? []}
              onLog={onLog}
            />
          )}
          <button className="secondary" onClick={finish}>End session early</button>
        </>
      )}
    </div>
  );
}
