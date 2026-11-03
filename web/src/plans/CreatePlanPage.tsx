import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { readPlanFile } from './importPlan';
import { NavBar } from '../ui/NavBar';

export function CreatePlanPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const createMut = useMutation({
    mutationFn: (n: string) =>
      apiFetch<{ id: string }>('/api/plans', { method: 'POST', body: JSON.stringify({ name: n }) }),
    onSuccess: (r) => nav(`/plan/${r.id}/edit`),
  });
  const importMut = useMutation({
    mutationFn: async (data: unknown) => apiFetch('/api/plans/import', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plans'] }); nav('/'); },
  });
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { importMut.mutate(await readPlanFile(file)); } catch { alert('Invalid JSON file'); }
  }
  return (
    <div className="app">
      <NavBar />
      <h1>Create plan</h1>
      <div className="card">
        <input
          placeholder="New plan name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          onClick={() => {
            if (name.trim()) createMut.mutate(name.trim());
          }}
        >
          Create plan
        </button>
        {isAdmin && (
          <>
            <input ref={fileRef} type="file" accept="application/json" onChange={onFile} hidden />
            <button className="secondary" style={{ marginTop: 8 }} onClick={() => fileRef.current?.click()}>Import plan (JSON)</button>
            {importMut.isError && <p style={{ color: 'var(--danger)' }}>Import failed (check the file schema).</p>}
          </>
        )}
      </div>
    </div>
  );
}
