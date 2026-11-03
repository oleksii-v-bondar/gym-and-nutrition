import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';

export function CreatePlanPage() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const createMut = useMutation({
    mutationFn: (n: string) =>
      apiFetch<{ id: string }>('/api/plans', { method: 'POST', body: JSON.stringify({ name: n }) }),
    onSuccess: (r) => nav(`/plan/${r.id}`),
  });
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
      </div>
    </div>
  );
}
