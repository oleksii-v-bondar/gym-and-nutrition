import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { SessionEditPage } from './SessionEditPage';
import * as client from '../api/client';

it('loads set values, edits reps, and saves via PATCH', async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  vi.spyOn(client, 'apiFetch').mockImplementation(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === '/api/sessions/s1' && (!init || !init.method)) return {
      id: 's1', day_name: 'Push', finished_at: '2026-11-01T10:00:00Z',
      sets: [{ id: 'set1', exercise_name: 'Bench', set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok', extra_segments: [] }],
    } as any;
    return {} as any;
  });
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}><AuthProvider>
      <MemoryRouter initialEntries={['/history/s1/edit']}>
        <Routes><Route path="/history/:id/edit" element={<SessionEditPage />} /></Routes>
      </MemoryRouter>
    </AuthProvider></QueryClientProvider>
  );

  const reps = await screen.findByDisplayValue('8');
  await userEvent.clear(reps);
  await userEvent.type(reps, '10');
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

  await waitFor(() => {
    const patch = calls.find((c) => c.init?.method === 'PATCH');
    expect(patch?.path).toBe('/api/sessions/s1/sets/set1');
    expect(JSON.parse(patch!.init!.body as string)).toMatchObject({ weight_used: 40, reps_done: 10, effort: 'ok', extra_segments: [] });
  });
});

it('shows an error and re-enables Save when a PATCH rejects', async () => {
  vi.spyOn(client, 'apiFetch').mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/sessions/s1' && (!init || !init.method)) return {
      id: 's1', day_name: 'Push', finished_at: '2026-11-01T10:00:00Z',
      sets: [{ id: 'set1', exercise_name: 'Bench', set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok', extra_segments: [] }],
    } as any;
    if (init?.method === 'PATCH') return Promise.reject(new Error('nope'));
    return {} as any;
  });
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}><AuthProvider>
      <MemoryRouter initialEntries={['/history/s1/edit']}>
        <Routes><Route path="/history/:id/edit" element={<SessionEditPage />} /></Routes>
      </MemoryRouter>
    </AuthProvider></QueryClientProvider>
  );

  await screen.findByDisplayValue('8');
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

  await screen.findByText('Some changes may not have been saved. Please review and try again.');
  expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
});

it('blocks Save and shows an error when a set field is left empty', async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  vi.spyOn(client, 'apiFetch').mockImplementation(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === '/api/sessions/s1' && (!init || !init.method)) return {
      id: 's1', day_name: 'Push', finished_at: '2026-11-01T10:00:00Z',
      sets: [{ id: 'set1', exercise_name: 'Bench', set_number: 1, weight_used: 40, reps_done: 8, effort: 'ok', extra_segments: [] }],
    } as any;
    return {} as any;
  });
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}><AuthProvider>
      <MemoryRouter initialEntries={['/history/s1/edit']}>
        <Routes><Route path="/history/:id/edit" element={<SessionEditPage />} /></Routes>
      </MemoryRouter>
    </AuthProvider></QueryClientProvider>
  );

  const reps = await screen.findByDisplayValue('8');
  await userEvent.clear(reps);
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

  await screen.findByText('Weight and reps are required for every set.');
  expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(false);
});
