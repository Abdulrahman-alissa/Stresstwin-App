import { useAppStore } from '../store/useAppStore'

function Bar({ label, have, need }: { label: string; have: number; need: number }) {
  const pct = Math.max(0, Math.min(100, (have / Math.max(1, need)) * 100))
  const done = have >= need
  return (
    <div style={{ flex: 1, minWidth: 180 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 5 }}>
        <span>{label}</span><span style={{ color: done ? 'var(--accent)' : 'var(--text)' }}>{Math.min(have, need)} / {need}{done ? ' ✓' : ''}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: done ? 'var(--accent)' : 'var(--brand)', borderRadius: 3, transition: 'width .4s' }} />
      </div>
    </div>
  )
}

/** Real progress toward the forecast model (days of data + mood check-ins). No made-up confidence number. */
export default function ForecastBasis({ compact = false }: { compact?: boolean }) {
  const b = useAppStore(s => s.forecastBasis)
  if (!b) return null
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: compact ? 10 : 16, width: '100%' }}>
      <Bar label="Days of data" have={b.days_of_data} need={b.days_needed} />
      <Bar label="Mood check-ins" have={b.checkins_count} need={b.checkins_needed} />
    </div>
  )
}

export function BasisText() {
  const b = useAppStore(s => s.forecastBasis)
  if (!b) return null
  return <>Based on {b.days_of_data} day{b.days_of_data === 1 ? '' : 's'} of data · {b.checkins_count} check-in{b.checkins_count === 1 ? '' : 's'}</>
}

/** Shown when the forecast is the starter estimate (everyone's weekday pattern + your level + calendar). */
export function StarterNote({ compact = false }: { compact?: boolean }) {
  const b = useAppStore(s => s.forecastBasis)
  if (!b || b.source !== 'global') return null
  return (
    <div style={{ background: 'var(--brand-dim)', border: '0.5px solid var(--border2)', borderRadius: 10, padding: compact ? '8px 12px' : '12px 14px', margin: compact ? '10px 0 0' : '0 0 14px' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand)' }}>Starter forecast</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.55, marginTop: 4 }}>
        Built from the weekday patterns of {b.cohort_size && b.cohort_size > 0 ? `${b.cohort_size}+ people` : 'everyone using StressTwin'}, your own recent level and your calendar. It is an estimate, not your personal model — that unlocks after {b.days_needed} days of data and {b.checkins_needed} check-ins.
      </div>
      {!compact && <ForecastBasis compact />}
    </div>
  )
}
