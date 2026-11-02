import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';
import { TrendBadge } from './TrendBadge';

interface Point { date: string; topWeight: number; bestE1rm: number; }
interface Trend { series: Point[]; label: 'progressing' | 'steady' | 'regressing' | 'insufficient'; slope: number; }

export function ProgressPage() {
  const { exId } = useParams();
  const trend = useQuery({ queryKey: ['trend', exId], queryFn: () => apiFetch<Trend>(`/api/exercises/${exId}/trend`) });
  if (trend.isLoading) return <div className="app"><NavBar />Loading…</div>;
  const data = (trend.data?.series ?? []).map((p) => ({ ...p, label: new Date(p.date).toLocaleDateString() }));
  return (
    <div className="app">
      <NavBar />
      <h1>Progress</h1>
      <div className="card"><TrendBadge label={trend.data?.label ?? 'insufficient'} /></div>
      <div className="card" style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={11} />
            <Tooltip />
            <Line type="monotone" dataKey="topWeight" stroke="#22c55e" name="Top weight" dot />
            <Line type="monotone" dataKey="bestE1rm" stroke="#60a5fa" name="Est. 1RM" dot />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="card">
        <strong>History</strong>
        {data.map((p, i) => (<div key={i} className="row" style={{ justifyContent: 'space-between' }}>
          <span>{p.label}</span><span>{p.topWeight} kg</span></div>))}
        {data.length === 0 && <p style={{ color: 'var(--muted)' }}>No finished sessions for this exercise yet.</p>}
      </div>
    </div>
  );
}
