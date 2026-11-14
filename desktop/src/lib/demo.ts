/**
 * Sample data so every chart renders before any real monitoring data exists
 * (new install, no backend, or just exploring). Clearly labelled in the UI.
 */
import type { SignalSample, ScoreTick, DayForecast } from '../store/useAppStore'

export function demoSignals(minutes = 28): SignalSample[] {
  const out: SignalSample[] = []
  const n = Math.round((minutes * 60) / 5)
  const now = Date.now()
  for (let i = 0; i < n; i++) {
    const t = now - (n - i) * 5000
    const ramp = Math.max(0, (i - n * 0.6) / (n * 0.4))            // stress rising over the last 40%
    const wave = Math.sin(i / 9) * 0.25
    const typing = Math.sin(i / 5) > -0.7
    const keys = typing ? Math.round(14 + wave * 6 + ramp * 16 + Math.random() * 5) : 0
    out.push({
      t, keys, cps: keys / 5,
      interKeyMs: keys ? 160 - ramp * 60 + Math.random() * 30 : null,
      errorRate: keys ? Math.min(0.04 + ramp * 0.1 + Math.random() * 0.02, 1) : null,
      mouseSpeed: 150 + wave * 40 + ramp * 190 + Math.random() * 40,
      clicks: Math.max(0, Math.round(1 + ramp * 3 + Math.random() * 2)),
      pauses: typing ? (Math.random() < 0.15 + ramp * 0.2 ? 1 : 0) : 1,
      simulated: true,
    })
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
