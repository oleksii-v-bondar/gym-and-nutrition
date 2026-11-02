import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [loginId, setLoginId] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setError('');
    try { await login(loginId, password); nav('/'); } catch { setError('Invalid login or password'); }
  }
  return (
    <div className="app">
      <h1>Gym Tracker</h1>
      <form className="card" onSubmit={onSubmit}>
        <label htmlFor="login">Login</label>
        <input id="login" type="text" autoComplete="username" value={loginId} onChange={(e) => setLoginId(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <button type="submit">Log in</button>
      </form>
      <p>No account? <Link to="/register">Register</Link></p>
    </div>
  );
}
