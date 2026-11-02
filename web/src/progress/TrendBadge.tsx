type TrendLabel = 'progressing' | 'steady' | 'regressing' | 'insufficient';
const MAP: Record<TrendLabel, { icon: string; text: string; color: string }> = {
  progressing: { icon: '▲', text: 'Progressing', color: '#22c55e' },
  steady:      { icon: '▬', text: 'Steady',      color: '#9ca3af' },
  regressing:  { icon: '▼', text: 'Regressing',  color: '#ef4444' },
  insufficient:{ icon: '•', text: 'Not enough data yet', color: '#9ca3af' },
};
export function TrendBadge({ label }: { label: TrendLabel }) {
  const m = MAP[label];
  return <span style={{ color: m.color, fontWeight: 700 }}>{m.icon} {m.text}</span>;
}
