import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { PlansPage } from './PlansPage';
import * as client from '../api/client';

function renderPage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}><AuthProvider><MemoryRouter><PlansPage /></MemoryRouter></AuthProvider></QueryClientProvider>
  );
}

it('badges templates and creates a plan', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plans' && (!init || init.method === undefined)) return [
      { id: 'p1', name: 'Mine', is_active: false, is_template: false, owned: true },
      { id: 't1', name: 'Shared', is_active: false, is_template: true, owned: false },
    ] as any;
    if (path === '/api/plans' && init?.method === 'POST') return { id: 'new1' } as any;
    return {} as any;
  });
  renderPage();
  expect(await screen.findByText('Shared')).toBeInTheDocument();
  expect(screen.getByText(/template/i)).toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText(/new plan name/i), 'Legs');
  await userEvent.click(screen.getByRole('button', { name: /create plan/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/plans',
    expect.objectContaining({ method: 'POST', body: expect.stringContaining('Legs') })));
});
