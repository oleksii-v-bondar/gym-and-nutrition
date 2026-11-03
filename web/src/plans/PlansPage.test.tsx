import { render, screen } from '@testing-library/react';
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

it('lists plans and badges templates', async () => {
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string) => {
    if (path === '/api/plans') return [
      { id: 'p1', name: 'Mine', is_active: false, is_template: false, owned: true },
      { id: 't1', name: 'Shared', is_active: false, is_template: true, owned: false },
    ] as any;
    return {} as any;
  });
  renderPage();
  expect(await screen.findByText('Shared')).toBeInTheDocument();
  expect(screen.getByText(/template/i)).toBeInTheDocument();
});
