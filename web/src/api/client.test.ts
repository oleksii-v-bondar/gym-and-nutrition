import { apiFetch, setTokens, getAccessToken } from './client';

beforeEach(() => {
  localStorage.clear();
});

it('attaches the access token and returns json', async () => {
  setTokens('acc', 'ref');
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await apiFetch<{ ok: boolean }>('/api/plans');
  expect(res.ok).toBe(true);
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer acc');
});

it('refreshes once on 401 then retries', async () => {
  setTokens('old', 'ref');
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'new' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const res = await apiFetch<{ ok: boolean }>('/api/plans');
  expect(res.ok).toBe(true);
  expect(getAccessToken()).toBe('new');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
