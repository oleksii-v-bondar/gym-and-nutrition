import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { NavBar } from '../ui/NavBar';

interface Exercise { id: string; exercise_name: string; order_index: number; target_sets: number; target_reps: number; rest_seconds: number | null; starting_weight: number | null; extra_segments: Array<{ reps: number }>; }
interface Day { id: string; name: string; order_index: number; is_superset: boolean; exercises: Exercise[]; }
interface PlanTree { id: string; name: string; is_active: boolean; is_template: boolean; owned: boolean; days: Day[]; }
interface Fork { id: string; dayIdMap: Record<string, string>; exerciseIdMap: Record<string, string>; }

export function PlanEditorPage() {
  const { planId } = useParams();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const key = ['plan', planId];
  const plan = useQuery({ queryKey: key, queryFn: () => apiFetch<PlanTree>(`/api/plans/${planId}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const owned = plan.data?.owned ?? false;

  const fork = () => apiFetch<Fork>(`/api/plans/${planId}/fork`, { method: 'POST' });

  const addDay = useMutation({ mutationFn: () => apiFetch(`/api/plans/${planId}/days`, { method: 'POST', body: JSON.stringify({ name: 'New day' }) }), onSuccess: refresh });
  const addExercise = useMutation({ mutationFn: (dayId: string) => apiFetch(`/api/plan-days/${dayId}/exercises`, { method: 'POST', body: JSON.stringify({ exercise_name: 'New exercise', target_sets: 3, target_reps: 8 }) }), onSuccess: refresh });
  const delExercise = useMutation({ mutationFn: (id: string) => apiFetch(`/api/day-exercises/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const patchExercise = useMutation({ mutationFn: (p: { id: string; body: Partial<Exercise> }) => apiFetch(`/api/day-exercises/${p.id}`, { method: 'PUT', body: JSON.stringify(p.body) }), onSuccess: refresh });
  const patchDay = useMutation({ mutationFn: (p: { id: string; body: Partial<Day> }) => apiFetch(`/api/plan-days/${p.id}`, { method: 'PUT', body: JSON.stringify(p.body) }), onSuccess: refresh });
  const setTemplate = useMutation({ mutationFn: (v: boolean) => apiFetch(`/api/plans/${planId}`, { method: 'PUT', body: JSON.stringify({ is_template: v }) }), onSuccess: refresh });
  const deletePlan = useMutation({ mutationFn: () => apiFetch(`/api/plans/${planId}`, { method: 'DELETE' }), onSuccess: () => nav('/') });
  const copyFromTemplate = useMutation({ mutationFn: () => fork(), onSuccess: (f) => nav(`/plan/${f.id}/edit`) });

  // Copy-on-edit: for a non-owned template, apply the action to a fresh fork then navigate to it.
  async function onAddDay() {
    if (owned) { addDay.mutate(); return; }
    const f = await fork();
    await apiFetch(`/api/plans/${f.id}/days`, { method: 'POST', body: JSON.stringify({ name: 'New day' }) });
    nav(`/plan/${f.id}/edit`);
  }
  async function onPatchDay(dayId: string, body: Partial<Day>) {
    if (owned) { patchDay.mutate({ id: dayId, body }); return; }
    const f = await fork();
    await apiFetch(`/api/plan-days/${f.dayIdMap[dayId]}`, { method: 'PUT', body: JSON.stringify(body) });
    nav(`/plan/${f.id}/edit`);
  }
  async function onAddExercise(dayId: string) {
    if (owned) { addExercise.mutate(dayId); return; }
    const f = await fork();
    await apiFetch(`/api/plan-days/${f.dayIdMap[dayId]}/exercises`, { method: 'POST', body: JSON.stringify({ exercise_name: 'New exercise', target_sets: 3, target_reps: 8 }) });
    nav(`/plan/${f.id}/edit`);
  }
  async function onDelExercise(exId: string) {
    if (owned) { delExercise.mutate(exId); return; }
    const f = await fork();
    await apiFetch(`/api/day-exercises/${f.exerciseIdMap[exId]}`, { method: 'DELETE' });
    nav(`/plan/${f.id}/edit`);
  }
  async function onPatchExercise(exId: string, body: Partial<Exercise>) {
    if (owned) { patchExercise.mutate({ id: exId, body }); return; }
    const f = await fork();
    await apiFetch(`/api/day-exercises/${f.exerciseIdMap[exId]}`, { method: 'PUT', body: JSON.stringify(body) });
    nav(`/plan/${f.id}/edit`);
  }

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
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ flex: 1, minWidth: 0 }}>{plan.data.name}</h1>
        <Link to={`/plan/${planId}`}><button className="secondary" style={{ width: 'auto' }}>View plan</button></Link>
      </div>
      {!owned && <p className="card" style={{ color: 'var(--muted)' }}>This is a shared template — editing will make your own copy.</p>}
      {isAdmin && owned && (
        <label className="card" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={plan.data.is_template}
            onChange={(e) => setTemplate.mutate(e.target.checked)} />
          Shared template (visible to all users)
        </label>
      )}
      {isAdmin && plan.data.is_template && (
        <button className="secondary" onClick={() => copyFromTemplate.mutate()}>Copy from template</button>
      )}
      {isAdmin && <button className="secondary" onClick={exportPlan}>Export JSON</button>}
      {(owned || isAdmin) && (
        <button className="secondary" style={{ color: 'var(--danger)' }}
          onClick={() => { if (window.confirm('Delete this plan?')) deletePlan.mutate(); }}>Delete plan</button>
      )}
      {plan.data.days.map((day) => (
        <div className="card" key={day.id}>
          <input defaultValue={day.name} style={{ fontWeight: 700, width: '100%' }}
            onBlur={(e) => { if (e.target.value !== day.name) onPatchDay(day.id, { name: e.target.value }); }} />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={day.is_superset}
              onChange={(e) => onPatchDay(day.id, { is_superset: e.target.checked })} />
            Superset (one set of each exercise per round)
          </label>
          {day.exercises.map((ex) => (
            <div key={ex.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: 10, color: 'var(--muted)', flex: 1, minWidth: 120 }}>exercise
                <input defaultValue={ex.exercise_name}
                  onBlur={(e) => { if (e.target.value !== ex.exercise_name) onPatchExercise(ex.id, { exercise_name: e.target.value }); }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: 10, color: 'var(--muted)', width: 56 }}>sets
                <input type="number" defaultValue={ex.target_sets}
                  onBlur={(e) => { if (Number(e.target.value) !== ex.target_sets) onPatchExercise(ex.id, { target_sets: Number(e.target.value) }); }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: 10, color: 'var(--muted)', width: 56 }}>reps
                <input type="number" defaultValue={ex.target_reps}
                  onBlur={(e) => { if (Number(e.target.value) !== ex.target_reps) onPatchExercise(ex.id, { target_reps: Number(e.target.value) }); }} />
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', fontSize: 10, color: 'var(--muted)', width: '100%' }}>drops/ups (target reps)
                <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                  {ex.extra_segments.map((seg, i) => (
                    <div key={`${i}:${seg.reps}`} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <input type="number" inputMode="numeric" style={{ width: 56 }} defaultValue={seg.reps} aria-label={`drop/up ${i + 1} reps`}
                        onBlur={(e) => { const reps = Number(e.target.value); if (reps !== seg.reps) onPatchExercise(ex.id, { extra_segments: ex.extra_segments.map((s, j) => (j === i ? { reps } : s)) }); }} />
                      <button className="secondary" style={{ width: 'auto' }} aria-label={`remove drop/up ${i + 1}`}
                        onClick={() => onPatchExercise(ex.id, { extra_segments: ex.extra_segments.filter((_, j) => j !== i) })}>✕</button>
                    </div>
                  ))}
                  <button className="secondary" style={{ width: 'auto' }}
                    onClick={() => onPatchExercise(ex.id, { extra_segments: [...ex.extra_segments, { reps: ex.target_reps }] })}>+ drop/up</button>
                </div>
              </div>
              <Link to={`/progress/${ex.id}`}><button className="secondary">📈</button></Link>
              <button className="secondary" onClick={() => onDelExercise(ex.id)}>✕</button>
            </div>
          ))}
          <button className="secondary" style={{ marginTop: 8 }} onClick={() => onAddExercise(day.id)}>Add exercise</button>
        </div>
      ))}
      <button onClick={onAddDay}>Add day</button>
    </div>
  );
}
