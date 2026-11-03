import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { CreatePlanPage } from './CreatePlanPage';
import * as client from '../api/client';

it('creates a plan and navigates to it', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/plans' && init?.method === 'POST') return { id: 'new1' } as any;
    return {} as any;
  });
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><AuthProvider><MemoryRouter><CreatePlanPage /></MemoryRouter></AuthProvider></QueryClientProvider>);
  await userEvent.type(screen.getByPlaceholderText(/new plan name/i), 'Legs');
  const pageBtn = screen.getAllByRole('button', { name: /create plan/i }).find((b) => !b.closest('a'))!;
  await userEvent.click(pageBtn);
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/plans',
    expect.objectContaining({ method: 'POST', body: expect.stringContaining('Legs') })));
});
