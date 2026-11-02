import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlanEditorPage } from './PlanEditorPage';
import { AuthProvider } from '../auth/AuthContext';
import * as client from '../api/client';

// PlanEditorPage renders <NavBar/>, which calls useAuth() — wrap with AuthProvider so
// that context is available (AuthProvider only reads localStorage on mount, no API calls).
function renderAt(id: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/plan/${id}`]}>
          <Routes><Route path="/plan/:planId" element={<PlanEditorPage />} /></Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

it('shows days and exercises and can add an exercise', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/plan/p1') || path === '/api/plans/p1') {
      return { id: 'p1', name: 'P', is_active: false,
        days: [{ id: 'd1', name: 'Push', order_index: 0, exercises: [
          { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 3, target_reps: 8, rest_seconds: null, starting_weight: 40 },
        ] }] } as any;
    }
    if (path === '/api/plan-days/d1/exercises' && init?.method === 'POST') return { id: 'e2' } as any;
    return {} as any;
  });
  renderAt('p1');
  // exercise_name is rendered in an editable input (see PlanEditorPage), so assert by display value.
  expect(await screen.findByDisplayValue('Bench')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /add exercise/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/plan-days/d1/exercises',
    expect.objectContaining({ method: 'POST' })));
});
