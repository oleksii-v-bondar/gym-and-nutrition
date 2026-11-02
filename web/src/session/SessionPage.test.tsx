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
      { id: 'e1', exercise_name: 'Bench', order_index: 0, target_sets: 1, target_reps: 8, rest_seconds: null, starting_weight: 40 },
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
