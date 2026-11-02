const BASE = import.meta.env.VITE_API_BASE ?? '';
const ACCESS = 'gym.access';
const REFRESH = 'gym.refresh';

export function setTokens(access: string, refresh?: string): void {
  localStorage.setItem(ACCESS, access);
  if (refresh) localStorage.setItem(REFRESH, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS);
}

async function raw(path: string, init: RequestInit): Promise<Response> {
  const token = getAccessToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(init.headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  return fetch(BASE + path, { ...init, headers });
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init);
  if (res.status === 401 && localStorage.getItem(REFRESH)) {
    const refresh = await fetch(BASE + '/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: localStorage.getItem(REFRESH) }),
    });
    if (refresh.ok) {
      const { accessToken } = await refresh.json();
      setTokens(accessToken);
      res = await raw(path, init);
    } else {
      clearTokens();
    }
  }
  if (!res.ok) throw new Error(`API ${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
