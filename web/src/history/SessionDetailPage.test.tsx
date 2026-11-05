import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { SessionDetailPage } from './SessionDetailPage';
import * as client from '../api/client';

it('renders sets grouped by exercise, shows bodyweight for weight 0, and links to edit', async () => {
  vi.spyOn(client, 'apiFetch').mockImplementation(async (path: string) => {
    if (path === '/api/sessions/s1') return {
      id: 's1', day_name: 'Push', finished_at: '2026-11-01T10:00:00Z',
      sets: [
        { id: 'x', exercise_name: 'Bench', set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok', extra_segments: [{ weight: 20, reps: 12 }] },
        { id: 'y', exercise_name: 'Pull-up', set_number: 1, weight_used: 0, reps_done: 10, effort: 'hard', extra_segments: [] },
      ],
    } as any;
    return {} as any;
  });
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}><AuthProvider>
      <MemoryRouter initialEntries={['/history/s1']}>
        <Routes><Route path="/history/:id" element={<SessionDetailPage />} /></Routes>
      </MemoryRouter>
    </AuthProvider></QueryClientProvider>
  );
  expect(await screen.findByText('Bench')).toBeInTheDocument();
  expect(screen.getByText(/40 kg × 8 \(ok\)/i)).toBeInTheDocument();
  expect(screen.getByText(/Bodyweight × 10 reps \(hard\)/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute('href', '/history/s1/edit');
});
