import { parseDay } from './/deviceStats'
/**
 * insights.ts (mobile)
 * ─────────────────────
 * Turns the phone's aggregate signals (keyboard timing windows + hand motion)
 * and the stress-score ticks into things a person can act on BEFORE stress
 * peaks: personal baselines, an early-warning level, a "do nothing vs. reset
 * now" projection, and a ranked list of preventive actions with the reason.
 * Pure functions, numbers only — there is no text anywhere in this data.
 */
import type { ScoreTick, DayForecast } from '../store/useAppStore'

/** One aggregate window. Keyboard windows are ~15 s; motion windows ~30 s. Fields a source doesn't produce are null. */
export interface SignalSample {
  t: number                    // epoch ms (window end)
  dur: number                  // window length in seconds
  keys: number | null          // key presses (a COUNT — never which keys)
  cps: number | null           // keys per second
  interKeyMs: number | null    // mean gap between keys
  errorRate: number | null     // backspace share 0..1
  pauses: number | null        // pauses per minute
  bursts: number | null        // typing bursts in the window
  motion: number | null        // hand restlessness index (from gyroscope)
  simulated?: boolean
}

export type SignalKey = 'cps' | 'interKeyMs' | 'errorRate' | 'pauses' | 'bursts' | 'motion'

export interface SignalMeta {
  key: SignalKey
  label: string
  short: string
  unit: string
  color: string
  digits: number
  scale: number
  stressDir: 'up' | 'down' | 'both'
  icon: string                 // Ionicons name
}

export const SIGNALS: SignalMeta[] = [
  { key: 'cps',        label: 'Typing pace',  short: 'Pace',    unit: 'keys/s', color: '#3B5BDB', digits: 1, scale: 1,   stressDir: 'both', icon: 'speedometer-outline' },
  { key: 'interKeyMs', label: 'Key rhythm',   short: 'Rhythm',  unit: 'ms',     color: '#7048E8', digits: 0, scale: 1,   stressDir: 'both', icon: 'timer-outline' },
  { key: 'errorRate',  label: 'Corrections',  short: 'Fixes',   unit: '%',      color: '#F59F00', digits: 0, scale: 100, stressDir: 'up',   icon: 'backspace-outline' },
  { key: 'pauses',     label: 'Pauses',       short: 'Pauses',  unit: '/min',   color: '#F03E3E', digits: 1, scale: 1,   stressDir: 'both', icon: 'pause-circle-outline' },
  { key: 'bursts',     label: 'Typing bursts',short: 'Bursts',  unit: '/15s',   color: '#1C7ED6', digits: 1, scale: 1,   stressDir: 'up',   icon: 'flash-outline' },
  { key: 'motion',     label: 'Hand motion',  short: 'Motion',  unit: 'idx',    color: '#12B886', digits: 0, scale: 1,   stressDir: 'up',   icon: 'hand-left-outline' },
]

const nums = (a: (number | null)[]) => a.filter((x): x is number => x != null && Number.isFinite(x))
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
export const std = (a: number[]) => {
  if (a.length < 2) return NaN
  const m = mean(a)
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1))
}
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b)

export const series = (samples: SignalSample[], k: SignalKey) => samples.map(s => s[k] as number | null)
export const baseline = (samples: SignalSample[], k: SignalKey) => {
  const v = nums(series(samples, k)); return { mean: mean(v), std: std(v), n: v.length }
}
/** Average of the last n values of a signal (smooths the noise). */
export const recent = (samples: SignalSample[], k: SignalKey, n = 4) => mean(nums(series(samples, k)).slice(-n))

export interface SignalReading {
  meta: SignalMeta
  current: number
  base: number
  z: number
  stressZ: number
  deltaPct: number | null
  level: 'calm' | 'watch' | 'high'
  spark: number[]
  hasData: boolean
}

export function readSignals(samples: SignalSample[]): SignalReading[] {
  return SIGNALS.map(meta => {
    const b = baseline(samples, meta.key)
    const cur = recent(samples, meta.key, 4)
    const sd = b.std > 1e-9 ? b.std : NaN
    const z = Number.isFinite(sd) && Number.isFinite(cur) ? (cur - b.mean) / sd : 0
    const stressZ = meta.stressDir === 'up' ? Math.max(z, 0) : meta.stressDir === 'down' ? Math.max(-z, 0) : Math.abs(z)
    const deltaPct = Number.isFinite(cur) && Number.isFinite(b.mean) && Math.abs(b.mean) > 1e-9
      ? ((cur - b.mean) / Math.abs(b.mean)) * 100 : null
    return {
      meta, current: Number.isFinite(cur) ? cur : 0, base: Number.isFinite(b.mean) ? b.mean : 0,
      z, stressZ, deltaPct, hasData: b.n > 0,
      level: stressZ >= 2 ? 'high' : stressZ >= 1.1 ? 'watch' : 'calm',
      spark: nums(series(samples, meta.key)).slice(-40),
    }
  })
}

// ── Score trend → early warning ───────────────────────────────────────────────
export function scoreSlopePerMin(trend: ScoreTick[], lastN = 8): number {
  const pts = trend.slice(-lastN).map(t => ({ x: new Date(t.at).getTime() / 60000, y: t.score }))
  if (pts.length < 3) return 0
  const mx = mean(pts.map(p => p.x)), my = mean(pts.map(p => p.y))
  let num = 0, den = 0
  for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2 }
  return den > 1e-9 ? num / den : 0
}

export type WarningLevel = 'calm' | 'watch' | 'warning' | 'alert'

export interface EarlyWarning {
  level: WarningLevel
  title: string
  detail: string
  slopePerMin: number
  minutesToThreshold: number | null
  pressure: number
  drivers: SignalReading[]
}

export function earlyWarning(score: number, trend: ScoreTick[], samples: SignalSample[], threshold: number): EarlyWarning {
  const slope = scoreSlopePerMin(trend)
  const readings = readSignals(samples).filter(r => r.hasData)
  const drivers = [...readings].filter(r => r.stressZ >= 1.1).sort((a, b) => b.stressZ - a.stressZ).slice(0, 3)
  const gap = threshold - score
  const eta = slope > 0.15 && gap > 0 ? gap / slope : null
  const sigLoad = readings.length ? Math.min(mean(readings.map(r => Math.min(r.stressZ, 3))) / 3, 1) : 0
  const prox = clamp(score / Math.max(threshold, 1), 0, 1.2)
  const rise = clamp(Math.max(slope, 0) / 2, 0, 1)
  const pressure = Math.round(Math.min(100, prox * 55 + rise * 25 + sigLoad * 20))

  let level: WarningLevel = 'calm'
  if (score >= threshold) level = 'alert'
  else if ((eta != null && eta <= 15) || gap <= 8 || (rise > 0.5 && drivers.length >= 2)) level = 'warning'
  else if (slope > 0.3 || drivers.length >= 1 || pressure >= 45) level = 'watch'

  const names = drivers.map(d => d.meta.label.toLowerCase()).join(' and ')
  const copy: Record<WarningLevel, [string, string]> = {
    calm:    ['You’re in a steady zone', 'Your signals match your usual rhythm. A small break now keeps it that way.'],
    watch:   ['Early signs of rising tension', names ? `Your ${names} ${drivers.length > 1 ? 'are' : 'is'} drifting from your normal. A 2-minute reset now is the cheapest fix.` : 'Your score is creeping up. A 2-minute reset now is the cheapest fix.'],
    warning: ['Stress is building — act now', eta != null ? `At this pace you’ll cross your threshold in about ${Math.max(1, Math.round(eta))} min. Start a reset before it does.` : 'You’re close to your threshold. Start a reset before you cross it.'],
    alert:   ['Threshold crossed', 'Pause what you’re doing. Run the breathing reset, then take a short break away from the screen.'],
  }
  return { level, title: copy[level][0], detail: copy[level][1], slopePerMin: slope, minutesToThreshold: eta, pressure, drivers }
}

// ── Session statistics (what was collected) ───────────────────────────────────
export interface SessionStats {
  minutes: number
  keys: number
  typingSec: number
  avgCps: number
  peakCps: number
  bursts: number
  pauses: number
  windows: number
  sinceBreakMin: number
  noBreakInSpan: boolean
  breaks: number
  sparks: { keys: number[]; cps: number[]; bursts: number[]; pauses: number[] }
}

const BREAK_GAP_MS = 3 * 60_000 // no typing for 3 min = a break

export function sessionStats(samples: SignalSample[], now = Date.now()): SessionStats {
  const kb = samples.filter(s => s.keys != null)
  let keys = 0, typingSec = 0, bursts = 0, pauses = 0, peak = 0
  for (const s of kb) {
    keys += s.keys ?? 0
    typingSec += (s.keys ?? 0) > 0 ? s.dur : 0
    bursts += s.bursts ?? 0
    pauses += ((s.pauses ?? 0) * s.dur) / 60
    peak = Math.max(peak, s.cps ?? 0)
  }
  let breaks = 0, lastBreakEnd = -1
  for (let i = 1; i < kb.length; i++) {
    if (kb[i].t - kb[i].dur * 1000 - kb[i - 1].t >= BREAK_GAP_MS) { breaks++; lastBreakEnd = kb[i].t - kb[i].dur * 1000 }
  }
  const first = kb.length ? kb[0].t - kb[0].dur * 1000 : now
  const since = lastBreakEnd >= 0 ? now - lastBreakEnd : now - first
  const last = (f: (s: SignalSample) => number | null) => nums(kb.slice(-40).map(f))
  return {
    minutes: kb.length ? (now - first) / 60000 : 0,
    keys, typingSec, avgCps: typingSec ? keys / typingSec : 0, peakCps: peak,
    bursts, pauses: Math.round(pauses), windows: kb.length,
    sinceBreakMin: Math.max(0, since / 60000), noBreakInSpan: lastBreakEnd < 0, breaks,
    sparks: { keys: last(s => s.keys), cps: last(s => s.cps), bursts: last(s => s.bursts), pauses: last(s => s.pauses) },
  }
}

// ── Per-minute buckets → workload chart + heatmap ─────────────────────────────
export interface MinuteBucket {
  t: number
  keys: number
  strain: number | null
  z: Record<SignalKey, number | null>
}

export function minuteBuckets(samples: SignalSample[], minutes = 30): MinuteBucket[] {
  if (samples.length === 0) return []
  const base = Object.fromEntries(SIGNALS.map(m => [m.key, baseline(samples, m.key)])) as Record<SignalKey, ReturnType<typeof baseline>>
  const endMin = Math.floor(samples[samples.length - 1].t / 60000)
  const byMin = new Map<number, SignalSample[]>()
  for (const s of samples) {
    const k = Math.floor(s.t / 60000)
    if (!byMin.has(k)) byMin.set(k, [])
    byMin.get(k)!.push(s)
  }
  const out: MinuteBucket[] = []
  for (let m = endMin - minutes + 1; m <= endMin; m++) {
    const win = byMin.get(m) ?? []
    const z = {} as Record<SignalKey, number | null>
    const zs: number[] = []
    for (const meta of SIGNALS) {
      const v = nums(series(win, meta.key)); const b = base[meta.key]
      if (!v.length || !(b.std > 1e-9)) { z[meta.key] = null; continue }
      const raw = (mean(v) - b.mean) / b.std
      const sz = meta.stressDir === 'up' ? Math.max(raw, 0) : meta.stressDir === 'down' ? Math.max(-raw, 0) : Math.abs(raw)
      z[meta.key] = sz; zs.push(Math.min(sz, 3) / 3)
    }
    out.push({ t: m * 60000, keys: win.reduce((a, s) => a + (s.keys ?? 0), 0), strain: zs.length ? Math.round(mean(zs) * 100) : null, z })
  }
  while (out.length > 1 && out[0].keys === 0 && out[0].strain == null) out.shift()
  return out
}

// ── "What if" projection: do nothing vs. do the best reset now ────────────────
export type ExerciseKind = 'breathing' | 'eyes' | 'stretch' | 'walk' | 'focus'
/** Typical score relief (points) from a reset, by exercise. An ASSUMPTION — the UI says so. */
export const RELIEF: Record<ExerciseKind, number> = { breathing: 10, stretch: 6, eyes: 4, walk: 12, focus: 6 }

export interface Scenario {
  points: { m: number; nothing: number; reset: number }[]
  crossNothing: number | null
  crossReset: number | null
  peakNothing: number
  peakReset: number
  relief: number
}

export function projectScenarios(score: number, slopePerMin: number, threshold: number, kind: ExerciseKind, horizon = 30): Scenario {
  const slope = clamp(slopePerMin, -1.5, 2.5)
  const relief = RELIEF[kind]
  const points: Scenario['points'] = []
  let crossNothing: number | null = null, crossReset: number | null = null
  let peakNothing = score, peakReset = score
  for (let m = 0; m <= horizon; m++) {
    const nothing = clamp(score + slope * m, 0, 100)
    const ramp = Math.min(m / 2, 1)
    const climb = m <= 2 ? 0 : (slope > 0 ? slope * 0.4 : slope * 0.8) * (m - 2)
    const reset = clamp(score - relief * ramp + climb, 0, 100)
    points.push({ m, nothing, reset })
    peakNothing = Math.max(peakNothing, nothing); peakReset = Math.max(peakReset, reset)
    if (crossNothing == null && nothing >= threshold) crossNothing = score >= threshold ? 0 : (threshold - score) / slope
    if (crossReset == null && reset >= threshold) crossReset = m
  }
  return { points, crossNothing, crossReset, peakNothing, peakReset, relief }
}

// ── Preventive actions ────────────────────────────────────────────────────────
export interface Action {
  id: string
  kind: ExerciseKind | 'plan'
  title: string
  why: string
  minutes: number
  priority: number
  tag: 'Do now' | 'Next hour' | 'Plan ahead'
}

const fmtMin = (m: number) => (m < 1 ? '<1 min' : `${Math.round(m)} min`)

export function recommend(ew: EarlyWarning, samples: SignalSample[], forecasts: DayForecast[], sessionStart: number): Action[] {
  const out: Action[] = []
  const by = Object.fromEntries(readSignals(samples).map(r => [r.meta.key, r])) as Record<SignalKey, SignalReading>
  const workedMin = (Date.now() - sessionStart) / 60000
  const hot = ew.level === 'warning' || ew.level === 'alert'

  if (hot || ew.level === 'watch') {
    out.push({
      id: 'breathing', kind: 'breathing', minutes: 2, tag: 'Do now', title: '4-7-8 breathing reset',
      why: hot
        ? `Your index is ${Math.round(ew.pressure)}% of the way to tipping${ew.minutesToThreshold ? `, ~${fmtMin(ew.minutesToThreshold)} out` : ''}. Slow exhales lower arousal fastest.`
        : 'Score is trending up. Four slow cycles interrupt the climb early.',
      priority: hot ? 100 : 70,
    })
  }
  if (by.errorRate.stressZ >= 1.1) {
    out.push({
      id: 'slowdown', kind: 'stretch', minutes: 1, tag: 'Do now', title: 'Slow down and re-read',
      why: `Corrections are ${by.errorRate.deltaPct != null ? Math.round(by.errorRate.deltaPct) + '% above' : 'above'} your baseline — a sign attention is fragmenting. Shake out your hands and re-read what you wrote.`,
      priority: 80,
    })
  }
  if (by.cps.stressZ >= 1.3 || by.interKeyMs.stressZ >= 1.3 || by.bursts.stressZ >= 1.3) {
    out.push({
      id: 'burst', kind: 'stretch', minutes: 2, tag: 'Do now', title: 'Release the rush',
      why: 'Your typing has shifted sharply from your own norm. Roll your shoulders, unclench your jaw, relax your thumbs.',
      priority: 72,
    })
  }
  if (by.motion.stressZ >= 1.3) {
    out.push({
      id: 'eyes', kind: 'eyes', minutes: 1, tag: 'Do now', title: '20-20-20 eye break',
      why: 'Your hands are more restless than usual. Look at something 20 ft away for 20 seconds and let your grip soften.',
      priority: 65,
    })
  }
  if (workedMin >= 50) {
    out.push({
      id: 'walk', kind: 'walk', minutes: 5, tag: 'Next hour', title: '5-minute walk, phone down',
      why: `${Math.round(workedMin)} minutes without a real break. Movement clears stress hormones better than more screen time.`,
      priority: hot ? 75 : 60,
    })
  }
  const risky = forecasts.filter(f => f.risk_label !== 'low').sort((a, b) => b.risk - a.risk)[0]
  if (risky) {
    const day = parseDay(risky.date).toLocaleDateString('en-US', { weekday: 'long' })
    out.push({
      id: 'plan', kind: 'plan', minutes: 10, tag: 'Plan ahead', title: `Prepare for ${day} (${Math.round(risky.risk * 100)}% risk)`,
      why: risky.recommendation ?? (risky.primary_stressor ? `Main driver: ${risky.primary_stressor}. Move one task off that day and block a 30-minute recovery slot.` : 'Block a recovery slot and move one non-urgent task.'),
      priority: risky.risk_label === 'high' ? 78 : 55,
    })
  }
  out.push({
    id: 'focus', kind: 'focus', minutes: 20, tag: 'Next hour', title: '20-minute protected focus block',
    why: 'Silence notifications for one block. Fewer interruptions keeps pauses and bursts near your baseline.',
    priority: 40,
  })
  if (out.length < 3) {
    out.push({ id: 'maintain', kind: 'breathing', minutes: 2, tag: 'Next hour', title: 'Maintenance breath', why: 'You’re calm — a 2-minute reset every hour is what keeps you there.', priority: 30 })
  }
  return out.sort((a, b) => b.priority - a.priority)
}
