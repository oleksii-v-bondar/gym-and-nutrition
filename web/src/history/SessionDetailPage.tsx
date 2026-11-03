import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';

interface Segment { weight: number; reps: number; }
interface SetLog { id: string; exercise_name: string | null; set_number: number; weight_used: number; reps_done: number; effort: string; extra_segments: Segment[]; }
interface SessionDetail { id: string; day_name: string | null; finished_at: string | null; sets: SetLog[]; }

export function SessionDetailPage() {
  const { id } = useParams();
  const session = useQuery({ queryKey: ['session', id], queryFn: () => apiFetch<SessionDetail>(`/api/sessions/${id}`) });
  if (session.isLoading) return <div className="app"><NavBar />Loading…</div>;
  if (!session.data) return <div className="app"><NavBar />Not found</div>;
  const byExercise = new Map<string, SetLog[]>();
  for (const s of session.data.sets) {
    const name = s.exercise_name ?? 'Exercise';
    if (!byExercise.has(name)) byExercise.set(name, []);
    byExercise.get(name)!.push(s);
  }
  return (
    <div className="app">
      <NavBar />
      <h1>{session.data.day_name ?? 'Workout'}</h1>
      {session.data.finished_at && <p style={{ color: 'var(--muted)' }}>{new Date(session.data.finished_at).toLocaleString()}</p>}
      {[...byExercise.entries()].map(([name, sets]) => (
        <div className="card" key={name}>
          <strong>{name}</strong>
          {sets.map((s) => (
            <div key={s.id} style={{ marginTop: 6 }}>
              <div>Set {s.set_number}: {s.weight_used} kg × {s.reps_done} ({s.effort})</div>
              {s.extra_segments.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  + {s.extra_segments.map((x) => `${x.weight}×${x.reps}`).join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
