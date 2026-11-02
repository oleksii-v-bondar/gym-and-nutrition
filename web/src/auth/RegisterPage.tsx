import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [loginId, setLoginId] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setError('');
    try { await register(loginId, password); nav('/'); } catch { setError('Could not register (login may be taken, password min 8 chars)'); }
  }
  return (
    <div className="app">
      <h1>Create account</h1>
      <form className="card" onSubmit={onSubmit}>
        <label htmlFor="login">Login</label>
        <input id="login" type="text" autoComplete="username" value={loginId} onChange={(e) => setLoginId(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <button type="submit">Register</button>
      </form>
      <p>Have an account? <Link to="/login">Log in</Link></p>
    </div>
  );
}
