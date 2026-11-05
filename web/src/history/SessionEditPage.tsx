import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { NavBar } from '../ui/NavBar';

interface Segment { weight: number; reps: number; }
interface SetLog { id: string; exercise_name: string | null; set_number: number; weight_used: number; reps_done: number; effort: string; extra_segments: Segment[]; }
interface SessionDetail { id: string; day_name: string | null; finished_at: string | null; sets: SetLog[]; }
interface Draft { weight: string; reps: string; effort: string; segments: Array<{ weight: string; reps: string }>; }

const cap: CSSProperties = { fontSize: 11, color: 'var(--muted)', textAlign: 'center', display: 'block', marginTop: 2 };
const efforts = ['easy', 'ok', 'hard', 'failed'];

export function SessionEditPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ['session', id], queryFn: () => apiFetch<SessionDetail>(`/api/sessions/${id}`) });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const seededRef = useRef(false);

  useEffect(() => {
    if (!session.data || seededRef.current) return;
    seededRef.current = true;
    const d: Record<string, Draft> = {};
    for (const s of session.data.sets) {
      d[s.id] = {
        weight: String(s.weight_used), reps: String(s.reps_done), effort: s.effort,
        segments: s.extra_segments.map((x) => ({ weight: String(x.weight), reps: String(x.reps) })),
      };
    }
    setDrafts(d);
  }, [session.data]);

  const byExercise = useMemo(() => {
    const m = new Map<string, SetLog[]>();
    for (const s of session.data?.sets ?? []) {
      const name = s.exercise_name ?? 'Exercise';
      if (!m.has(name)) m.set(name, []);
      m.get(name)!.push(s);
    }
    return m;
  }, [session.data]);

  function upd(setId: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [setId]: { ...prev[setId], ...patch } }));
  }
  function updSeg(setId: string, i: number, field: 'weight' | 'reps', value: string) {
    setDrafts((prev) => ({ ...prev, [setId]: { ...prev[setId],
      segments: prev[setId].segments.map((sg, j) => (j === i ? { ...sg, [field]: value } : sg)) } }));
  }

  async function save() {
    if (!session.data) return;
    const invalid = session.data.sets.some((s) => {
      const d = drafts[s.id];
      return !d || d.weight.trim() === '' || d.reps.trim() === '';
    });
    if (invalid) { setError('Weight and reps are required for every set.'); return; }
    setSaving(true);
    setError('');
    try {
      for (const s of session.data.sets) {
        const d = drafts[s.id];
        if (!d) continue;
        await apiFetch(`/api/sessions/${id}/sets/${s.id}`, { method: 'PATCH', body: JSON.stringify({
          weight_used: Number(d.weight), reps_done: Number(d.reps), effort: d.effort,
          extra_segments: d.segments
            .filter((x) => x.weight !== '' && x.reps !== '')
            .map((x) => ({ weight: Number(x.weight), reps: Number(x.reps) })),
        }) });
      }
      await qc.invalidateQueries({ queryKey: ['session', id] });
      await qc.invalidateQueries({ queryKey: ['sessions'] });
      nav(`/history/${id}`);
    } catch {
      await qc.invalidateQueries({ queryKey: ['session', id] });
      await qc.invalidateQueries({ queryKey: ['sessions'] });
      setError('Some changes may not have been saved. Please review and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (session.isLoading) return <div className="app"><NavBar />Loading…</div>;
  if (!session.data) return <div className="app"><NavBar />Not found</div>;

  return (
    <div className="app">
      <NavBar />
      <h1>Edit — {session.data.day_name ?? 'Workout'}</h1>
      {[...byExercise.entries()].map(([name, sets]) => (
        <div className="card" key={name}>
          <strong>{name}</strong>
          {sets.map((s) => {
            const d = drafts[s.id];
            if (!d) return null;
            return (
              <div key={s.id} style={{ marginTop: 10 }}>
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>Set {s.set_number}</p>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <input type="number" inputMode="numeric" value={d.weight} onChange={(e) => upd(s.id, { weight: e.target.value })} />
                    <span style={cap}>weight (0 = bodyweight)</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <input type="number" inputMode="numeric" value={d.reps} onChange={(e) => upd(s.id, { reps: e.target.value })} />
                    <span style={cap}>reps</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <select value={d.effort} onChange={(e) => upd(s.id, { effort: e.target.value })}>
                      {efforts.map((ef) => <option key={ef} value={ef}>{ef}</option>)}
                    </select>
                    <span style={cap}>effort</span>
                  </div>
                </div>
                {d.segments.map((sg, i) => (
                  <div className="row" key={i} style={{ marginTop: 6 }}>
                    <div style={{ flex: 1 }}><input type="number" inputMode="numeric" placeholder="weight" value={sg.weight} onChange={(e) => updSeg(s.id, i, 'weight', e.target.value)} /></div>
                    <div style={{ flex: 1 }}><input type="number" inputMode="numeric" placeholder="reps" value={sg.reps} onChange={(e) => updSeg(s.id, i, 'reps', e.target.value)} /></div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      <button className="secondary" onClick={() => nav(`/history/${id}`)}>Cancel</button>
    </div>
  );
}
