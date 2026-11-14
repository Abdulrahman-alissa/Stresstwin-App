import { useState, useEffect } from 'react'
import { Wind, Target, Footprints, ShieldCheck } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

const ICONS: Record<string, typeof Wind> = { breathing: Wind, focus: Target, step_away: Footprints, prevention: ShieldCheck }

const CONFIG: Record<string, { title: string; body: string; emoji: string; duration: number }> = {
  breathing: { title: '4-7-8 Breathing Exercise', body: 'Inhale 4s · Hold 7s · Exhale 8s. Repeat 4 times.', emoji: '🫁', duration: 76 },
  focus:     { title: 'Focus Mode', body: 'Non-critical notifications suppressed for 20 minutes.', emoji: '🎯', duration: 1200 },
  step_away: { title: 'Step Away', body: 'You\'ve been elevated for a while. Take a 5-minute break from the screen.', emoji: '🚶', duration: 300 },
  prevention:{ title: 'Tomorrow Looks Stressful', body: 'High-risk day predicted. Consider finishing work early tonight.', emoji: '🛡️', duration: 0 },
}

export default function InterventionOverlay({ type }: { type: string }) {
  const { setScore, currentScore, thresholdCrossed, modelReady } = useAppStore()
  const [visible, setVisible] = useState(true)
  const [secs, setSecs] = useState(CONFIG[type]?.duration ?? 0)
  const cfg = CONFIG[type] ?? CONFIG.breathing

  useEffect(() => {
    if (!cfg.duration) return
    const iv = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(iv)
  }, [type])

  const dismiss = () => {
    setVisible(false)
    useAppStore.setState({ interventionType: null })
  }

  if (!visible) return null

  const pct = cfg.duration > 0 ? ((cfg.duration - secs) / cfg.duration) * 100 : 0

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, width: 320,
      background: 'var(--surface)', border: '0.5px solid var(--brand)',
      borderRadius: 16, padding: 20, zIndex: 9999,
      boxShadow: '0 8px 40px rgba(59,91,219,.25)',
      animation: 'slideUp .35s cubic-bezier(.4,0,.2,1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--brand-dim)', color: 'var(--brand)', display: 'grid', placeItems: 'center' }}>{(() => { const I = ICONS[type] ?? Wind; return <I size={20} /> })()}</span>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--brand)', marginBottom: 2 }}>
            {type.replace(/_/g,' ')}
          </div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{cfg.title}</div>
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 14 }}>{cfg.body}</p>

      {/* Timer arc */}
      {cfg.duration > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ height: 3, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--brand)', borderRadius: 2, transition: 'width 1s linear' }} />
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--hint)', marginTop: 4 }}>
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} remaining
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={dismiss} style={{
          flex: 1, padding: '8px', borderRadius: 8,
          background: 'var(--brand)', color: '#fff', border: 'none',
          fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
          textTransform: 'uppercase', cursor: 'pointer',
        }}>Accept</button>
        <button onClick={dismiss} style={{
          flex: 1, padding: '8px', borderRadius: 8,
          background: 'var(--surface2)', color: 'var(--muted)', border: '0.5px solid var(--border2)',
          fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
          textTransform: 'uppercase', cursor: 'pointer',
        }}>Dismiss</button>
      </div>
    </div>
  )
}
