import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SessionPage } from './SessionPage';
import { AuthProvider } from '../auth/AuthContext';
import * as client from '../api/client';

// SessionPage renders <NavBar/>, which calls useAuth() — wrap with AuthProvider so
// that context is available (AuthProvider only reads localStorage on mount, no API calls).
function renderAt(dayId: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/session/${dayId}`]}>
          <Routes><Route path="/session/:dayId" element={<SessionPage />} /></Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

it('starts a session and logs a set with the chosen effort', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plan-days/d1') return { id: 'd1', name: 'Push', exercises: [
      { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 1, target_reps: 8, rest_seconds: null, starting_weight: 40, extra_segments: 0 },
    ] } as any;
    if (path === '/api/sessions' && init?.method === 'POST') return { id: 's1', started_at: 'now' } as any;
    if (path === '/api/exercises/e1/suggestion') return { weight: 40, reason: 'Starting weight 40 kg' } as any;
    if (path === '/api/sessions/s1/sets' && init?.method === 'POST') return { id: 'set1' } as any;
    if (path === '/api/sessions/s1/finish') return { id: 's1', finished_at: 'now' } as any;
    return {} as any;
  });
  renderAt('d1');
  expect(await screen.findByText('Bench')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'easy' }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/sessions/s1/sets',
    expect.objectContaining({ method: 'POST', body: expect.stringContaining('"effort":"easy"') })));
});

it('runs a superset day round-major: one set of each exercise per round', async () => {
  const setLogs: Array<{ day_exercise_id: string; set_number: number }> = [];
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plan-days/sd') return { id: 'sd', name: 'Circuit', is_superset: true, exercises: [
      { id: 'e1', exercise_name: 'A', order_index: 0, target_sets: 2, target_reps: 8, rest_seconds: null, starting_weight: 20, extra_segments: 0 },
      { id: 'e2', exercise_name: 'B', order_index: 1, target_sets: 2, target_reps: 10, rest_seconds: null, starting_weight: 30, extra_segments: 0 },
    ] } as any;
    if (path === '/api/sessions' && init?.method === 'POST') return { id: 's1' } as any;
    if (path === '/api/exercises/e1/suggestion') return { weight: 20, reason: 'x' } as any;
    if (path === '/api/exercises/e2/suggestion') return { weight: 30, reason: 'y' } as any;
    if (path === '/api/sessions/s1/sets' && init?.method === 'POST') { setLogs.push(JSON.parse(init.body as string)); return { id: 'set' } as any; }
    return {} as any;
  });
  renderAt('sd');
  // round 1: A then B; round 2: A then B
  await screen.findByRole('heading', { name: 'A' });
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  await screen.findByRole('heading', { name: 'B' });
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  await screen.findByRole('heading', { name: 'A' });
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  await screen.findByRole('heading', { name: 'B' });
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));

  await waitFor(() => expect(setLogs).toHaveLength(4));
  expect(setLogs.map((l) => [l.day_exercise_id, l.set_number])).toEqual([
    ['e1', 1], ['e2', 1], ['e1', 2], ['e2', 2],
  ]);
});

it('keeps the entered weight/reps for the next set of the same exercise', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plan-days/d1') return { id: 'd1', name: 'Push', exercises: [
      { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 2, target_reps: 8, rest_seconds: null, starting_weight: 40, extra_segments: 0 },
    ] } as any;
    if (path === '/api/sessions' && init?.method === 'POST') return { id: 's1', started_at: 'now' } as any;
    if (path === '/api/exercises/e1/suggestion') return { weight: 60, reason: 'x' } as any;
    if (path === '/api/sessions/s1/sets' && init?.method === 'POST') return { id: 'set1' } as any;
    return {} as any;
  });
  renderAt('d1');
  await screen.findByText('Bench');
  // set 1: change the weight to 55, then log
  const inputs = screen.getAllByRole('spinbutton'); // [weight, reps]
  await userEvent.clear(inputs[0]);
  await userEvent.type(inputs[0], '55');
  await userEvent.click(screen.getByRole('button', { name: 'ok' }));
  // set 2 of the same exercise should retain 55 (not reset to the suggested 60)
  await waitFor(() => expect(screen.getByText(/set 2\/2/i)).toBeInTheDocument());
  expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(55);
});
