import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { HistoryPage } from './HistoryPage';
import * as client from '../api/client';

function renderPage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}><AuthProvider><MemoryRouter><HistoryPage /></MemoryRouter></AuthProvider></QueryClientProvider>
  );
}

it('lists finished sessions and deletes one', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/sessions' && (!init || init.method === undefined)) return [
      { id: 's1', finished_at: '2026-11-01T10:00:00Z', plan_day_id: 'd1', day_name: 'Push', set_count: 3 },
    ] as any;
    if (path === '/api/sessions/s1' && init?.method === 'DELETE') return undefined as any;
    return {} as any;
  });
  renderPage();
  expect(await screen.findByText('Push')).toBeInTheDocument();
  expect(screen.getByText(/3 sets/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /delete/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/sessions/s1', expect.objectContaining({ method: 'DELETE' })));
});
