import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlanEditorPage } from './PlanEditorPage';
import { AuthProvider } from '../auth/AuthContext';
import * as AuthCtx from '../auth/AuthContext';
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
      return { id: 'p1', name: 'P', is_active: false, is_template: false, owned: true,
        days: [{ id: 'd1', name: 'Push', order_index: 0, exercises: [
          { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 3, target_reps: 8, rest_seconds: null, starting_weight: 40, extra_segments: 2 },
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

it('forks a non-owned template on first edit', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plans/t1') return {
      id: 't1', name: 'Shared', is_active: false, is_template: true, owned: false,
      days: [{ id: 'd1', name: 'Push', order_index: 0, exercises: [] }],
    } as any;
    if (path === '/api/plans/t1/fork' && init?.method === 'POST')
      return { id: 'c1', dayIdMap: { d1: 'cd1' }, exerciseIdMap: {} } as any;
    if (path === '/api/plans/c1') return {
      id: 'c1', name: 'Shared', is_active: false, is_template: false, owned: true,
      days: [{ id: 'cd1', name: 'Push', order_index: 0, exercises: [] }],
    } as any;
    if (path === '/api/plan-days/cd1/exercises' && init?.method === 'POST') return { id: 'e9' } as any;
    return {} as any;
  });
  renderAt('t1');
  await screen.findByText('Shared');
  await userEvent.click(screen.getByRole('button', { name: /add exercise/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/plans/t1/fork', expect.objectContaining({ method: 'POST' })));
});

it('edits an exercise extra_segments count', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plans/p1') return {
      id: 'p1', name: 'P', is_active: false, is_template: false, owned: true,
      days: [{ id: 'd1', name: 'Push', order_index: 0, exercises: [
        { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 3, target_reps: 8, rest_seconds: null, starting_weight: 40, extra_segments: 2 },
      ] }],
    } as any;
    if (path === '/api/day-exercises/e1' && init?.method === 'PUT') return { id: 'e1' } as any;
    return {} as any;
  });
  renderAt('p1');
  const input = await screen.findByTitle(/extra segments/i);
  await userEvent.clear(input);
  await userEvent.type(input, '3');
  input.blur();
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/day-exercises/e1',
    expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"extra_segments":3') })));
});

it('deletes the plan when confirmed', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plans/p1' && init?.method === 'DELETE') return undefined as any;
    if (path === '/api/plans/p1') return {
      id: 'p1', name: 'P', is_active: false, is_template: false, owned: true, days: [],
    } as any;
    return {} as any;
  });
  renderAt('p1');
  await screen.findByText('P');
  await userEvent.click(screen.getByRole('button', { name: /delete plan/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/plans/p1', expect.objectContaining({ method: 'DELETE' })));
});

it('edits a day name', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plans/p1') return {
      id: 'p1', name: 'P', is_active: false, is_template: false, owned: true,
      days: [{ id: 'd1', name: 'Push', order_index: 0, exercises: [] }],
    } as any;
    if (path === '/api/plan-days/d1' && init?.method === 'PUT') return { id: 'd1' } as any;
    return {} as any;
  });
  renderAt('p1');
  const dayInput = await screen.findByDisplayValue('Push');
  await userEvent.clear(dayInput);
  await userEvent.type(dayInput, 'Pull');
  dayInput.blur();
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/plan-days/d1',
    expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"name":"Pull"') })));
});

it('admin can copy a template into a personal plan', async () => {
  vi.spyOn(AuthCtx, 'useAuth').mockReturnValue({ isAuthed: true, isAdmin: true, login: vi.fn(), register: vi.fn(), logout: vi.fn() });
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plans/t1/fork' && init?.method === 'POST') return { id: 'c1', dayIdMap: {}, exerciseIdMap: {} } as any;
    if (path === '/api/plans/t1') return { id: 't1', name: 'PPL', is_active: false, is_template: true, owned: true, days: [] } as any;
    if (path === '/api/plans/c1') return { id: 'c1', name: 'PPL (My Personal)', is_active: false, is_template: false, owned: true, days: [] } as any;
    return {} as any;
  });
  renderAt('t1');
  await screen.findByText('PPL');
  await userEvent.click(screen.getByRole('button', { name: /copy from template/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/plans/t1/fork', expect.objectContaining({ method: 'POST' })));
});
