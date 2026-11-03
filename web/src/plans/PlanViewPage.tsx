import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';

interface Exercise { id: string; exercise_name: string; order_index: number; target_sets: number; target_reps: number; rest_seconds: number | null; starting_weight: number | null; extra_segments: number; }
interface Day { id: string; name: string; order_index: number; is_superset: boolean; exercises: Exercise[]; }
interface PlanTree { id: string; name: string; is_active: boolean; is_template: boolean; owned: boolean; days: Day[]; }
interface Fork { id: string; dayIdMap: Record<string, string>; exerciseIdMap: Record<string, string>; }

export function PlanViewPage() {
  const { planId } = useParams();
  const nav = useNavigate();
  const plan = useQuery({ queryKey: ['plan', planId], queryFn: () => apiFetch<PlanTree>(`/api/plans/${planId}`) });
  const owned = plan.data?.owned ?? false;

  // Starting a session on a shared template needs an owned copy, so fork first.
  async function onStartSession(dayId: string) {
    if (owned) { nav(`/session/${dayId}`); return; }
    const f = await apiFetch<Fork>(`/api/plans/${planId}/fork`, { method: 'POST' });
    nav(`/session/${f.dayIdMap[dayId]}`);
  }

  if (plan.isLoading) return <div className="app"><NavBar />Loading…</div>;
  if (!plan.data) return <div className="app"><NavBar />Not found</div>;
  return (
    <div className="app">
      <NavBar />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ flex: 1, minWidth: 0 }}>{plan.data.name}</h1>
        <Link to={`/plan/${planId}/edit`}><button className="secondary" style={{ width: 'auto' }}>Edit plan</button></Link>
      </div>
      {plan.data.is_template && <p className="card" style={{ color: 'var(--muted)' }}>Shared template</p>}
      {plan.data.days.map((day) => (
        <div className="card" key={day.id}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ flex: 1, minWidth: 0 }}>{day.name}{day.is_superset ? ' • Superset' : ''}</h2>
            <button className="big-tap" style={{ width: 'auto', flex: '0 0 auto' }} onClick={() => onStartSession(day.id)}>Start session</button>
          </div>
          {day.exercises.length === 0 && <p style={{ color: 'var(--muted)' }}>No exercises</p>}
          {day.exercises.map((ex) => (
            <div key={ex.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
              <span>{ex.exercise_name} — {ex.target_sets}×{ex.target_reps}{ex.extra_segments > 0 ? ` +${ex.extra_segments} drop/ups` : ''}</span>
              <Link to={`/progress/${ex.id}`}><button className="secondary" style={{ width: 'auto' }}>📈</button></Link>
            </div>
          ))}
        </div>
      ))}
      {plan.data.days.length === 0 && <p className="card">No days yet — tap “Edit plan” to add some.</p>}
    </div>
  );
}
