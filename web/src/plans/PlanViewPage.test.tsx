import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlanViewPage } from './PlanViewPage';
import { AuthProvider } from '../auth/AuthContext';
import * as client from '../api/client';

function renderAt(id: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}><AuthProvider>
      <MemoryRouter initialEntries={[`/plan/${id}`]}>
        <Routes>
          <Route path="/plan/:planId" element={<PlanViewPage />} />
          <Route path="/plan/:planId/edit" element={<div>EDIT PAGE</div>} />
          <Route path="/session/:dayId" element={<div>SESSION PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider></QueryClientProvider>
  );
}

it('shows read-only exercises, a superset marker and an edit link', async () => {
  vi.spyOn(client, 'apiFetch').mockImplementation(async (path: string) => {
    if (path === '/api/plans/p1') return { id: 'p1', name: 'P', is_active: false, is_template: false, owned: true,
      days: [{ id: 'd1', name: 'Push', order_index: 0, is_superset: true, exercises: [
        { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 3, target_reps: 8, rest_seconds: null, starting_weight: 40, extra_segments: [{ reps: 8 }, { reps: 8 }] },
      ] }] } as any;
    return {} as any;
  });
  renderAt('p1');
  expect(await screen.findByText((t) => t.includes('Bench') && t.includes('3') && t.includes('8'))).toBeInTheDocument();
  expect(screen.getByText(/Superset/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: /edit plan/i }));
  expect(await screen.findByText('EDIT PAGE')).toBeInTheDocument();
});

it('starts a session for an owned plan', async () => {
  vi.spyOn(client, 'apiFetch').mockImplementation(async (path: string) => {
    if (path === '/api/plans/p1') return { id: 'p1', name: 'P', is_active: false, is_template: false, owned: true,
      days: [{ id: 'd1', name: 'Push', order_index: 0, is_superset: false, exercises: [] }] } as any;
    return {} as any;
  });
  renderAt('p1');
  await screen.findByText('Push');
  await userEvent.click(screen.getByRole('button', { name: /start session/i }));
  expect(await screen.findByText('SESSION PAGE')).toBeInTheDocument();
});

it('forks a shared template before starting a session', async () => {
  const spy = vi.spyOn(client, 'apiFetch').mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plans/t1') return { id: 't1', name: 'Shared', is_active: false, is_template: true, owned: false,
      days: [{ id: 'd1', name: 'Push', order_index: 0, is_superset: false, exercises: [] }] } as any;
    if (path === '/api/plans/t1/fork' && init?.method === 'POST') return { id: 'c1', dayIdMap: { d1: 'cd1' }, exerciseIdMap: {} } as any;
    return {} as any;
  });
  renderAt('t1');
  await screen.findByText('Shared');
  await userEvent.click(screen.getByRole('button', { name: /start session/i }));
  expect(spy).toHaveBeenCalledWith('/api/plans/t1/fork', expect.objectContaining({ method: 'POST' }));
  expect(await screen.findByText('SESSION PAGE')).toBeInTheDocument();
});
