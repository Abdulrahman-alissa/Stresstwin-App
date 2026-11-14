import { parseDay } from './deviceStats'
/**
 * insights.ts — turns raw aggregate signals + score ticks into things a person
 * can act on BEFORE stress peaks: baselines, early-warning level, projected
 * time-to-threshold, and a ranked list of preventive actions with the reason.
 * Everything here is pure and runs locally on numbers only.
 */
import type { SignalSample, ScoreTick, DayForecast } from '../store/useAppStore'

export type SignalKey = 'cps' | 'interKeyMs' | 'errorRate' | 'mouseSpeed' | 'clicks' | 'pauses'

export interface SignalMeta {
  key: SignalKey
  label: string
  unit: string
  color: string
  digits: number
  scale: number          // multiply before display (e.g. errorRate 0..1 → %)
  /** which direction counts as "stress-like" relative to the person's own baseline */
  stressDir: 'up' | 'down' | 'both'
  hint: string
}

export const SIGNALS: SignalMeta[] = [
  { key: 'cps',        label: 'Typing pace',    unit: 'keys/s', color: '#3B5BDB', digits: 1, scale: 1,   stressDir: 'both', hint: 'Sudden bursts or slowdowns vs. your usual pace' },
  { key: 'interKeyMs', label: 'Key rhythm',     unit: 'ms',     color: '#7048E8', digits: 0, scale: 1,   stressDir: 'both', hint: 'Average gap between key presses' },
  { key: 'errorRate',  label: 'Corrections',unit: '%',      color: '#F59F00', digits: 0, scale: 100, stressDir: 'up',   hint: 'Share of backspaces — rises when attention slips' },
  { key: 'mouseSpeed', label: 'Pointer speed',  unit: 'px/s',   color: '#12B886', digits: 0, scale: 1,   stressDir: 'up',   hint: 'Faster, jerkier pointer movement' },
  { key: 'clicks',     label: 'Click rate',     unit: '/5s',    color: '#1C7ED6', digits: 1, scale: 1,   stressDir: 'up',   hint: 'Rapid clicking / restlessness' },
  { key: 'pauses',     label: 'Pauses',         unit: '/5s',    color: '#F03E3E', digits: 1, scale: 1,   stressDir: 'both', hint: 'Breaks in typing flow' },
]

export const metaOf = (k: SignalKey) => SIGNALS.find(s => s.key === k)!

const val = (s: SignalSample, k: SignalKey): number | null => {
  const v = s[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function series(samples: SignalSample[], k: SignalKey): (number | null)[] {
  return samples.map(s => val(s, k))
}

const nums = (a: (number | null)[]) => a.filter((x): x is number => x != null)
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
export const std = (a: number[]) => {
  if (a.length < 2) return NaN
  const m = mean(a)
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1))
}

/** Mean/std over the whole session so far = the person's own baseline for today. */
export function baseline(samples: SignalSample[], k: SignalKey) {
  const v = nums(series(samples, k))
  return { mean: mean(v), std: std(v), n: v.length }
}

/** Average of the last `n` windows (smooths 5-second noise). */
export function recent(samples: SignalSample[], k: SignalKey, n = 6) {
  return mean(nums(series(samples.slice(-n), k)))
}

export interface SignalReading {
  meta: SignalMeta
  current: number        // smoothed latest value (raw units)
  base: number           // session mean (raw units)
  z: number              // deviation from baseline in std devs (signed)
  stressZ: number        // 0 when moving in a calm direction, else |z|
  deltaPct: number | null
  level: 'calm' | 'watch' | 'high'
  spark: number[]
}

export function readSignals(samples: SignalSample[]): SignalReading[] {
  return SIGNALS.map(meta => {
    const b = baseline(samples, meta.key)
    const cur = recent(samples, meta.key, 6)
    const sd = b.std > 1e-9 ? b.std : NaN
    const z = Number.isFinite(sd) && Number.isFinite(cur) ? (cur - b.mean) / sd : 0
    const stressZ =
      meta.stressDir === 'up' ? Math.max(z, 0)
      : meta.stressDir === 'down' ? Math.max(-z, 0)
      : Math.abs(z)
    const deltaPct = Number.isFinite(cur) && Number.isFinite(b.mean) && Math.abs(b.mean) > 1e-9
      ? ((cur - b.mean) / Math.abs(b.mean)) * 100 : null
    return {
      meta,
      current: Number.isFinite(cur) ? cur : 0,
      base: Number.isFinite(b.mean) ? b.mean : 0,
      z, stressZ, deltaPct,
      level: stressZ >= 2 ? 'high' : stressZ >= 1.1 ? 'watch' : 'calm',
      spark: nums(series(samples.slice(-60), meta.key)),
    }
  })
}

// ── Score trend → early warning ───────────────────────────────────────────────
/** Least-squares slope of score over time, in points per minute. */
export function scoreSlopePerMin(trend: ScoreTick[], lastN = 10): number {
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
  pressure: number            // 0..100 composite "how close to tipping"
  drivers: SignalReading[]    // top signals pushing it
}

export function earlyWarning(
  score: number, trend: ScoreTick[], samples: SignalSample[], threshold: number,
): EarlyWarning {
  const slope = scoreSlopePerMin(trend)
  const readings = readSignals(samples)
  const drivers = [...readings].filter(r => r.stressZ >= 1.1).sort((a, b) => b.stressZ - a.stressZ).slice(0, 3)
  const gap = threshold - score
  const eta = slope > 0.15 && gap > 0 ? gap / slope : null
  const sigLoad = Math.min(mean(readings.map(r => Math.min(r.stressZ, 3))) / 3, 1) // 0..1

  // composite: proximity to threshold + rising slope + behavioral deviation
  const prox = Math.min(Math.max(score / Math.max(threshold, 1), 0), 1.2)
  const rise = Math.min(Math.max(slope, 0) / 2, 1)
  const pressure = Math.round(Math.min(100, (prox * 55 + rise * 25 + sigLoad * 20)))

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
  return {
    level, title: copy[level][0], detail: copy[level][1],
    slopePerMin: slope, minutesToThreshold: eta, pressure, drivers,
  }
}

// ── Score zones ───────────────────────────────────────────────────────────────
export function zoneShare(trend: ScoreTick[], threshold: number) {
  const z = { optimal: 0, elevated: 0, critical: 0 }
  for (const t of trend) {
    if (t.score < 50) z.optimal++
    else if (t.score < threshold) z.elevated++
    else z.critical++
  }
  return z
}

// ── Preventive actions ────────────────────────────────────────────────────────
export type ExerciseKind = 'breathing' | 'eyes' | 'stretch' | 'walk' | 'focus'

export interface Action {
  id: string
  kind: ExerciseKind | 'plan'
  title: string
  why: string                 // links the advice to the user's own numbers
  minutes: number
  priority: number            // higher = shown first
  tag: 'Do now' | 'Next hour' | 'Plan ahead'
}

const fmtMin = (m: number) => (m < 1 ? '<1 min' : `${Math.round(m)} min`)

export function recommend(
  ew: EarlyWarning, samples: SignalSample[], forecasts: DayForecast[], sessionStart: number,
): Action[] {
  const out: Action[] = []
  const by = Object.fromEntries(readSignals(samples).map(r => [r.meta.key, r])) as Record<SignalKey, SignalReading>
  const workedMin = (Date.now() - sessionStart) / 60000
  const hot = ew.level === 'warning' || ew.level === 'alert'

  if (hot || ew.level === 'watch') {
    out.push({
      id: 'breathing', kind: 'breathing', minutes: 2, tag: 'Do now',
      title: '4-7-8 breathing reset',
      why: hot
        ? `Your index is ${Math.round(ew.pressure)}% of the way to tipping${ew.minutesToThreshold ? `, ~${fmtMin(ew.minutesToThreshold)} out` : ''}. Slow exhales lower arousal fastest.`
        : 'Score is trending up. Four slow cycles interrupt the climb early.',
      priority: hot ? 100 : 70,
    })
  }
  if (by.errorRate.stressZ >= 1.1) {
    out.push({
      id: 'slowdown', kind: 'stretch', minutes: 1, tag: 'Do now',
      title: 'Slow down and re-read',
      why: `Corrections are ${by.errorRate.deltaPct != null ? Math.round(by.errorRate.deltaPct) + '% above' : 'above'} your baseline — a sign attention is fragmenting. Shake out your hands and re-read the last paragraph.`,
      priority: 80,
    })
  }
  if (by.cps.stressZ >= 1.3 || by.interKeyMs.stressZ >= 1.3) {
    out.push({
      id: 'burst', kind: 'stretch', minutes: 2, tag: 'Do now',
      title: 'Release the rush',
      why: 'Your typing pace has shifted sharply from your own norm. Roll shoulders, unclench your jaw, relax your wrists.',
      priority: 72,
    })
  }
  if (by.mouseSpeed.stressZ >= 1.3 || by.clicks.stressZ >= 1.3) {
    out.push({
      id: 'eyes', kind: 'eyes', minutes: 1, tag: 'Do now',
      title: '20-20-20 eye break',
      why: 'Pointer movement is faster and jerkier than usual. Look at something 20 ft away for 20 seconds to reset visual focus.',
      priority: 65,
    })
  }
  if (workedMin >= 50) {
    out.push({
      id: 'walk', kind: 'walk', minutes: 5, tag: 'Next hour',
      title: '5-minute walk away from the screen',
      why: `${Math.round(workedMin)} minutes without a real break. Movement clears stress hormones better than more screen time.`,
      priority: hot ? 75 : 60,
    })
  }
  const risky = forecasts.filter(f => f.risk_label !== 'low').sort((a, b) => b.risk - a.risk)[0]
  if (risky) {
    const day = parseDay(risky.date).toLocaleDateString('en-US', { weekday: 'long' })
    out.push({
      id: 'plan', kind: 'plan', minutes: 10, tag: 'Plan ahead',
      title: `Prepare for ${day} (${Math.round(risky.risk * 100)}% risk)`,
      why: risky.recommendation ?? (risky.primary_stressor ? `Main driver: ${risky.primary_stressor}. Move one task off that day and block a 30-minute recovery slot.` : 'Block a recovery slot and move one non-urgent task.'),
      priority: risky.risk_label === 'high' ? 78 : 55,
    })
  }
  out.push({
    id: 'focus', kind: 'focus', minutes: 20, tag: 'Next hour',
    title: '20-minute protected focus block',
    why: 'Silence notifications for one block. Fewer interruptions keeps pause and click rates near baseline.',
    priority: 40,
  })
  if (out.length < 3) {
    out.push({
      id: 'maintain', kind: 'breathing', minutes: 2, tag: 'Next hour',
      title: 'Maintenance breath',
      why: 'You’re calm — a 2-minute reset every hour is what keeps you there.',
      priority: 30,
    })
  }
  return out.sort((a, b) => b.priority - a.priority)
}

// ── Collected statistics (session totals) ─────────────────────────────────────
export interface SessionStats {
  minutes: number            // span of data covered
  keys: number               // total key presses (a COUNT — never which keys)
  typingSec: number          // seconds with at least one key press
  avgCps: number             // keys/s while typing
  peakCps: number
  clicks: number
  pauses: number
  activePct: number          // share of windows with any keys/clicks
  breaks: number             // idle stretches ≥ 30 s
  sinceBreakMin: number      // minutes since the last real break (or whole span if none)
  noBreakInSpan: boolean
  sparks: { keys: number[]; cps: number[]; clicks: number[]; pauses: number[] }
}

const WINDOW_S = 5
const BREAK_WINDOWS = 6 // 6 × 5 s = 30 s of nothing = a break

const isIdle = (s: SignalSample) => s.keys === 0 && s.clicks === 0 && (s.mouseSpeed ?? 0) < 40

export function sessionStats(samples: SignalSample[]): SessionStats {
  const n = samples.length
  let keys = 0, typingWins = 0, clicks = 0, pauses = 0, active = 0, peak = 0
  for (const s of samples) {
    keys += s.keys; clicks += s.clicks; pauses += s.pauses
    if (s.keys > 0) { typingWins++; peak = Math.max(peak, s.cps) }
    if (s.keys > 0 || s.clicks > 0) active++
  }
  // breaks = runs of idle windows ≥ 30 s; remember where the last one ended
  let breaks = 0, run = 0, lastBreakEnd = -1
  samples.forEach((s, i) => {
    if (isIdle(s)) run++
    else { if (run >= BREAK_WINDOWS) { breaks++; lastBreakEnd = i } run = 0 }
  })
  if (run >= BREAK_WINDOWS) { breaks++; lastBreakEnd = n } // currently on a break
  const sinceWins = lastBreakEnd < 0 ? n : n - lastBreakEnd
  const last = (f: (s: SignalSample) => number) => samples.slice(-60).map(f)
  return {
    minutes: (n * WINDOW_S) / 60,
    keys, typingSec: typingWins * WINDOW_S,
    avgCps: typingWins ? keys / (typingWins * WINDOW_S) : 0,
    peakCps: peak, clicks, pauses,
    activePct: n ? Math.round((active / n) * 100) : 0,
    breaks,
    sinceBreakMin: (sinceWins * WINDOW_S) / 60,
    noBreakInSpan: lastBreakEnd < 0,
    sparks: { keys: last(s => s.keys), cps: last(s => s.cps), clicks: last(s => s.clicks), pauses: last(s => s.pauses) },
  }
}

// ── Per-minute buckets → activity chart + signal heatmap ──────────────────────
export interface MinuteBucket {
  t: number
  keys: number
  clicks: number
  strain: number | null                       // 0..100 composite of the signals that minute
  z: Record<SignalKey, number | null>         // stress-direction deviation per signal (σ)
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
      const v = nums(series(win, meta.key))
      const b = base[meta.key]
      if (!v.length || !(b.std > 1e-9)) { z[meta.key] = null; continue }
      const raw = (mean(v) - b.mean) / b.std
      const sz = meta.stressDir === 'up' ? Math.max(raw, 0) : meta.stressDir === 'down' ? Math.max(-raw, 0) : Math.abs(raw)
      z[meta.key] = sz
      zs.push(Math.min(sz, 3) / 3)
    }
    out.push({
      t: m * 60000,
      keys: win.reduce((a, s) => a + s.keys, 0),
      clicks: win.reduce((a, s) => a + s.clicks, 0),
      strain: zs.length ? Math.round(mean(zs) * 100) : null,
      z,
    })
  }
  // drop leading minutes that have no data yet (partial window at session start)
  while (out.length > 1 && out[0].keys === 0 && out[0].clicks === 0 && out[0].strain == null) out.shift()
  return out
}

// ── "What if" projection: do nothing vs. do the best reset now ────────────────
/** Typical score relief (points) from a reset, by exercise. An ASSUMPTION, shown as such in the UI. */
export const RELIEF: Record<ExerciseKind, number> = { breathing: 10, stretch: 6, eyes: 4, walk: 12, focus: 6 }

export interface Scenario {
  points: { m: number; nothing: number; reset: number }[]
  crossNothing: number | null   // minutes until threshold if nothing changes
  crossReset: number | null     // … or null if the reset keeps you under it for the horizon
  peakNothing: number
  peakReset: number
  relief: number
}

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b)

export function projectScenarios(score: number, slopePerMin: number, threshold: number, kind: ExerciseKind, horizon = 30): Scenario {
  const slope = clamp(slopePerMin, -1.5, 2.5)
  const relief = RELIEF[kind]
  const points: Scenario['points'] = []
  let crossNothing: number | null = null, crossReset: number | null = null
  let peakNothing = score, peakReset = score
  for (let m = 0; m <= horizon; m++) {
    const nothing = clamp(score + slope * m, 0, 100)
    const ramp = Math.min(m / 2, 1)                                   // relief lands over a ~2 min exercise
    const climb = m <= 2 ? 0 : (slope > 0 ? slope * 0.4 : slope * 0.8) * (m - 2) // climb slows after a reset
    const reset = clamp(score - relief * ramp + climb, 0, 100)
    points.push({ m, nothing, reset })
    peakNothing = Math.max(peakNothing, nothing); peakReset = Math.max(peakReset, reset)
    if (crossNothing == null && nothing >= threshold) crossNothing = score >= threshold ? 0 : (threshold - score) / slope
    if (crossReset == null && reset >= threshold) crossReset = m
  }
  return { points, crossNothing, crossReset, peakNothing, peakReset, relief }
}
