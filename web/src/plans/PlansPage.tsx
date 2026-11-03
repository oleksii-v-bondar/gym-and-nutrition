import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';

interface PlanRow { id: string; name: string; is_active: boolean; is_template: boolean; owned: boolean; }
export function PlansPage() {
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiFetch<PlanRow[]>('/api/plans') });
  return (
    <div className="app">
      <NavBar />
      <h1>Your plans</h1>
      {plans.isLoading && <p>Loading…</p>}
      {plans.data?.map((p) => (
        <Link key={p.id} to={`/plan/${p.id}`}>
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{p.name}{p.is_active ? ' • active' : ''}</span>
            {p.is_template && <span style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa' }}>Template</span>}
          </div>
        </Link>
      ))}
      {plans.data?.length === 0 && <p className="card">No plans yet — create one or import.</p>}
    </div>
  );
}
