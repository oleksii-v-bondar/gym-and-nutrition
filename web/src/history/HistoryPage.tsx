import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';

interface SessionRow { id: string; finished_at: string; plan_day_id: string; day_name: string | null; set_count: number; }
export function HistoryPage() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => apiFetch<SessionRow[]>('/api/sessions') });
  const del = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <div className="app">
      <NavBar />
      <h1>History</h1>
      {sessions.isLoading && <p>Loading…</p>}
      {sessions.data?.map((s) => (
        <div className="card" key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link to={`/history/${s.id}`} style={{ flex: 1 }}>
            <div>{s.day_name ?? 'Workout'}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(s.finished_at).toLocaleString()} • {s.set_count} sets</div>
          </Link>
          <button className="secondary" style={{ width: 'auto' }}
            onClick={() => { if (window.confirm('Delete this session?')) del.mutate(s.id); }}>Delete</button>
        </div>
      ))}
      {sessions.data?.length === 0 && <p className="card">No finished sessions yet.</p>}
    </div>
  );
}
