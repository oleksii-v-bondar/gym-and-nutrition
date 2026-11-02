import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch, setTokens, clearTokens, getAccessToken } from '../api/client';

interface AuthCtx {
  isAuthed: boolean;
  login(e: string, p: string): Promise<void>;
  register(e: string, p: string): Promise<void>;
  logout(): void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthed, setAuthed] = useState<boolean>(!!getAccessToken());

  async function login(email: string, password: string) {
    const { accessToken, refreshToken } = await apiFetch<{ accessToken: string; refreshToken: string }>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    );
    setTokens(accessToken, refreshToken);
    setAuthed(true);
  }

  async function register(email: string, password: string) {
    await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
    await login(email, password);
  }

  function logout() {
    clearTokens();
    setAuthed(false);
  }

  return <Ctx.Provider value={{ isAuthed, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
