import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch, setTokens, clearTokens, getAccessToken } from '../api/client';

interface AuthCtx {
  isAuthed: boolean;
  isAdmin: boolean;
  login(e: string, p: string): Promise<void>;
  register(e: string, p: string): Promise<void>;
  logout(): void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthed, setAuthed] = useState<boolean>(!!getAccessToken());
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  async function refreshMe() {
    try { const me = await apiFetch<{ isAdmin: boolean }>('/api/me'); setIsAdmin(!!me.isAdmin); }
    catch { setIsAdmin(false); }
  }
  useEffect(() => { if (getAccessToken()) refreshMe(); }, []);

  async function login(loginId: string, password: string) {
    const { accessToken, refreshToken } = await apiFetch<{ accessToken: string; refreshToken: string }>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ login: loginId, password }) },
    );
    setTokens(accessToken, refreshToken);
    setAuthed(true);
    await refreshMe();
  }

  async function register(loginId: string, password: string) {
    await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ login: loginId, password }) });
    await login(loginId, password);
  }

  function logout() {
    clearTokens();
    setAuthed(false);
    setIsAdmin(false);
  }

  return <Ctx.Provider value={{ isAuthed, isAdmin, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
