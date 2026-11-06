import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

interface ActiveSession { id: string; plan_day_id: string; day_name: string | null; set_count: number; started_at: string; }

export function InProgressBanner() {
  const qc = useQueryClient();
  const active = useQuery({ queryKey: ['sessions', 'active'], queryFn: () => apiFetch<ActiveSession[]>('/api/sessions/active') });
  const discard = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions', 'active'] }),
  });
  if (!active.data || active.data.length === 0) return null;
  return (
    <>
      {discard.isError && <p className="card" style={{ color: 'var(--danger)' }}>Couldn't discard — please try again.</p>}
      {active.data.map((s) => (
        <div className="card" key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: '3px solid var(--accent)' }}>
          <div>
            <div>⏳ In progress: {s.day_name ?? 'Workout'}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.set_count} sets logged</div>
          </div>
          <div className="row" style={{ width: 'auto' }}>
            <Link to={`/session/${s.plan_day_id}`}><button className="big-tap" style={{ width: 'auto' }}>Resume</button></Link>
            <button className="secondary" style={{ width: 'auto' }}
              onClick={() => { if (window.confirm('Discard this in-progress workout?')) discard.mutate(s.id); }}>Discard</button>
          </div>
        </div>
      ))}
    </>
  );
}
