/** Types + helpers for "this device vs all devices" (GET /api/devices/stats). Numbers only. */
export interface DeviceStat {
  device_id: string
  display_name: string
  platform: 'desktop' | 'android' | 'ios'
  status: 'sending' | 'stale' | 'inactive'
  last_snapshot_at: string | null
  windows: number
  active_minutes: number
  mean_score: number | null
  max_score: number | null
  metrics: Record<string, number | null>
}
export interface AverageStat {
  devices_counted: number
  windows: number
  active_minutes: number
  mean_score: number | null
  metrics: Record<string, number | null>
  devices_reporting: Record<string, number>
}
export interface DeviceStatsResponse {
  hours: number
  generated_at: string
  devices: DeviceStat[]
  average: AverageStat
}

export interface MetricMeta { key: string; label: string; unit: string; kind: 'ms' | 'pct' | 'rate' | 'count' | 'num' }
export const METRIC_META: MetricMeta[] = [
  { key: 'typing_interval_ms',   label: 'Time between keys', unit: 'ms',   kind: 'ms' },
  { key: 'typing_speed_cps',     label: 'Typing speed',      unit: '/s',   kind: 'rate' },
  { key: 'error_rate',           label: 'Error rate',        unit: '',     kind: 'pct' },
  { key: 'backspace_rate',       label: 'Backspace share',   unit: '',     kind: 'pct' },
  { key: 'pause_frequency',      label: 'Pauses',            unit: '',     kind: 'num' },
  { key: 'typing_bursts',        label: 'Typing bursts',     unit: '',     kind: 'num' },
  { key: 'typing_interruptions', label: 'Interruptions',     unit: '',     kind: 'num' },
  { key: 'idle_frequency',       label: 'Idle share',        unit: '',     kind: 'num' },
  { key: 'key_presses',          label: 'Key presses',       unit: '',     kind: 'count' },
  { key: 'mouse_velocity',       label: 'Mouse speed',       unit: 'px/s', kind: 'ms' },
  { key: 'mouse_smoothness',     label: 'Mouse smoothness',  unit: '',     kind: 'num' },
  { key: 'click_hesitation',     label: 'Click hesitation',  unit: '',     kind: 'num' },
  { key: 'app_switch_rate',      label: 'App switching',     unit: '',     kind: 'num' },
  { key: 'gyro_variance',        label: 'Hand motion',       unit: '',     kind: 'num' },
  { key: 'touch_pressure',       label: 'Touch pressure',    unit: '',     kind: 'num' },
]

export function fmtMetric(v: number | null | undefined, m: MetricMeta): string {
  if (v == null || !isFinite(v)) return '—'
  switch (m.kind) {
    case 'pct':   return `${(v * 100).toFixed(1)}%`
    case 'ms':    return `${Math.round(v)}${m.unit ? ' ' + m.unit : ''}`
    case 'rate':  return `${v.toFixed(1)}${m.unit ? ' ' + m.unit : ''}`
    case 'count': return Math.round(v).toLocaleString()
    default:      return Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(2)
  }
}

/** % difference of this device vs the all-device average; null when it isn't meaningful. */
export function deltaPct(mine: number | null | undefined, avg: number | null | undefined): number | null {
  if (mine == null || avg == null || !isFinite(mine) || !isFinite(avg) || avg === 0) return null
  return ((mine - avg) / Math.abs(avg)) * 100
}

export function fmtMinutes(min: number): string {
  if (!min || min < 1) return '<1 min'
  if (min < 60) return `${Math.round(min)} min`
  return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`
}

/** Calendar days arrive as "YYYY-MM-DD". new Date() reads those as UTC and shifts the weekday
 *  backwards for anyone west of UTC, so build a local date instead. */
export function parseDay(d: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d)
}
