import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';

interface Exercise { id: string; exercise_name: string; order_index: number; target_sets: number; target_reps: number; rest_seconds: number | null; starting_weight: number | null; }
interface Day { id: string; name: string; order_index: number; exercises: Exercise[]; }
interface PlanTree { id: string; name: string; is_active: boolean; days: Day[]; }

export function PlanEditorPage() {
  const { planId } = useParams();
  const qc = useQueryClient();
  const key = ['plan', planId];
  const plan = useQuery({ queryKey: key, queryFn: () => apiFetch<PlanTree>(`/api/plans/${planId}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const addDay = useMutation({ mutationFn: () => apiFetch(`/api/plans/${planId}/days`, { method: 'POST', body: JSON.stringify({ name: 'New day' }) }), onSuccess: refresh });
  const addExercise = useMutation({ mutationFn: (dayId: string) => apiFetch(`/api/plan-days/${dayId}/exercises`, { method: 'POST', body: JSON.stringify({ exercise_name: 'New exercise', target_sets: 3, target_reps: 8 }) }), onSuccess: refresh });
  const delExercise = useMutation({ mutationFn: (id: string) => apiFetch(`/api/day-exercises/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const patchExercise = useMutation({ mutationFn: (p: { id: string; body: Partial<Exercise> }) => apiFetch(`/api/day-exercises/${p.id}`, { method: 'PUT', body: JSON.stringify(p.body) }), onSuccess: refresh });

  async function exportPlan() {
    const data = await apiFetch(`/api/plans/${planId}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${plan.data?.name ?? 'plan'}.json`; a.click();
  }

  if (plan.isLoading) return <div className="app"><NavBar />Loading…</div>;
  if (!plan.data) return <div className="app"><NavBar />Not found</div>;
  return (
    <div className="app">
      <NavBar />
      <h1>{plan.data.name}</h1>
      <button className="secondary" onClick={exportPlan}>Export JSON</button>
      {plan.data.days.map((day) => (
        <div className="card" key={day.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{day.name}</strong>
            <Link to={`/session/${day.id}`}><button className="big-tap">Start session</button></Link>
          </div>
          {day.exercises.map((ex) => (
            <div key={ex.id} className="row" style={{ alignItems: 'center', marginTop: 8 }}>
              <input defaultValue={ex.exercise_name}
                onBlur={(e) => patchExercise.mutate({ id: ex.id, body: { exercise_name: e.target.value } })} />
              <input type="number" defaultValue={ex.target_sets} style={{ width: 70 }}
                onBlur={(e) => patchExercise.mutate({ id: ex.id, body: { target_sets: Number(e.target.value) } })} />
              <input type="number" defaultValue={ex.target_reps} style={{ width: 70 }}
                onBlur={(e) => patchExercise.mutate({ id: ex.id, body: { target_reps: Number(e.target.value) } })} />
              <Link to={`/progress/${ex.id}`}><button className="secondary">📈</button></Link>
              <button className="secondary" onClick={() => delExercise.mutate(ex.id)}>✕</button>
            </div>
          ))}
          <button className="secondary" style={{ marginTop: 8 }} onClick={() => addExercise.mutate(day.id)}>Add exercise</button>
        </div>
      ))}
      <button onClick={() => addDay.mutate()}>Add day</button>
    </div>
  );
}
