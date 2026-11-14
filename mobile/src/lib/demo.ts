/** Sample data so every chart renders before any real data exists (no keyboard yet, Expo Go, exploring). Labelled in the UI. */
import type { SignalSample } from './insights'
import type { ScoreTick, DayForecast } from '../store/useAppStore'

export function demoSignals(minutes = 40): SignalSample[] {
  const out: SignalSample[] = []
  const n = Math.round((minutes * 60) / 15)
  const now = Date.now()
  for (let i = 0; i < n; i++) {
    const t = now - (n - i) * 15000
    const ramp = Math.max(0, (i - n * 0.6) / (n * 0.4))
    const wave = Math.sin(i / 6) * 0.25
    const typing = Math.sin(i / 4) > -0.6
    if (typing) {
      const cps = 2.6 + wave * 1.5 + ramp * 2.4 + Math.random() * 0.6
      out.push({
        t, dur: 15, keys: Math.round(cps * 15), cps, interKeyMs: 230 - ramp * 80 + Math.random() * 30,
        errorRate: Math.min(0.05 + ramp * 0.12 + Math.random() * 0.02, 1),
        pauses: 2 + (Math.random() < 0.3 + ramp * 0.3 ? 2 : 0), bursts: 2 + Math.round(ramp * 3 + Math.random() * 2),
        motion: null, simulated: true,
      })
    }
    if (i % 2 === 0) {
      out.push({ t, dur: 30, keys: null, cps: null, interKeyMs: null, errorRate: null, pauses: null, bursts: null,
        motion: 20 + wave * 8 + ramp * 38 + Math.random() * 8, simulated: true })
    }
  }
  return out
}

export function demoTrend(minutes = 60): ScoreTick[] {
  const n = minutes * 2
  const now = Date.now()
  return Array.from({ length: n }, (_, i) => {
    const ramp = Math.max(0, (i - n * 0.55) / (n * 0.45))
    const score = 32 + Math.sin(i / 7) * 3 + ramp * 31 + Math.random() * 1.2
    return { score: Math.min(100, Math.max(0, score)), at: new Date(now - (n - i) * 30000).toISOString() }
  })
}

export function demoForecast(): DayForecast[] {
  const d = (k: number) => new Date(Date.now() + k * 86400000).toISOString().slice(0, 10)
  return [
    { date: d(1), risk: 0.34, risk_label: 'low' },
    { date: d(2), risk: 0.78, risk_label: 'high', primary_stressor: '3 meetings + deadline Friday', recommendation: 'Finish the report tonight, move the 2 pm sync, and block 30 minutes of recovery after lunch.' },
    { date: d(3), risk: 0.52, risk_label: 'moderate', primary_stressor: 'Back-to-back calls' },
  ]
}
