import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { InProgressBanner } from './InProgressBanner';
import * as client from '../api/client';

function renderBanner() {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><MemoryRouter><InProgressBanner /></MemoryRouter></QueryClientProvider>);
}

it('shows a resume link and discards an in-progress session', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const spy = vi.spyOn(client, 'apiFetch');
  spy.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/sessions/active' && (!init || !init.method)) return [
      { id: 's1', plan_day_id: 'd1', day_name: 'Push', set_count: 2, started_at: 'now' },
    ] as any;
    return {} as any;
  });
  renderBanner();
  const link = await screen.findByRole('link', { name: /resume/i });
  expect(link).toHaveAttribute('href', '/session/d1');
  await userEvent.click(screen.getByRole('button', { name: /discard/i }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/sessions/s1', expect.objectContaining({ method: 'DELETE' })));
});

it('renders nothing when there are no in-progress sessions', async () => {
  vi.spyOn(client, 'apiFetch').mockResolvedValue([] as any);
  const { container } = renderBanner();
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});
