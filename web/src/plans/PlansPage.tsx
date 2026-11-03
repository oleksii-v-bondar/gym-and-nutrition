import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { readPlanFile } from './importPlan';
import { NavBar } from '../ui/NavBar';

interface PlanRow { id: string; name: string; is_active: boolean; is_template: boolean; owned: boolean; }
export function PlansPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiFetch<PlanRow[]>('/api/plans') });
  const importMut = useMutation({
    mutationFn: async (data: unknown) => apiFetch('/api/plans/import', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  });
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { importMut.mutate(await readPlanFile(file)); } catch { alert('Invalid JSON file'); }
  }
  return (
    <div className="app">
      <NavBar />
      <h1>Your plans</h1>
      {isAdmin && (
        <div className="card">
          <input ref={fileRef} type="file" accept="application/json" onChange={onFile} hidden />
          <button className="secondary" onClick={() => fileRef.current?.click()}>Import plan (JSON)</button>
          {importMut.isError && <p style={{ color: 'var(--danger)' }}>Import failed (check the file schema).</p>}
        </div>
      )}
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
