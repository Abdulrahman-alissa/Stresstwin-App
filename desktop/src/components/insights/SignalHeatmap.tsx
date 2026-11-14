import type { MinuteBucket } from '../../lib/insights'
import { SIGNALS } from '../../lib/insights'
import s from './insights.module.css'

/** green → amber → red by how far a signal strays from the person's own normal. */
function cellColor(z: number | null) {
  if (z == null) return 'var(--surface2)'
  const t = Math.min(Math.max(z / 3, 0), 1)
  const hue = 155 - 155 * t
  return `hsl(${hue} 72% ${40 + 6 * (1 - t)}% / ${0.16 + 0.74 * t})`
}
const label = (z: number | null) =>
  z == null ? 'no data' : z < 0.8 ? 'normal for you' : z < 1.5 ? 'drifting' : z < 2.2 ? 'well above your normal' : 'far from your normal'

export default function SignalHeatmap({ buckets }: { buckets: MinuteBucket[] }) {
  const fmt = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const ticks = buckets.length
    ? [0, Math.floor(buckets.length / 3), Math.floor((2 * buckets.length) / 3), buckets.length - 1]
    : []
  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.clbl}>Signal heatmap · minute by minute</div>
          <div className={s.csub}>Each square is one minute. The warmer it is, the further that signal strayed from <i>your</i> normal.</div>
        </div>
        <div className={s.heatLegend}>
          calm
          <span className={s.heatRamp} />
          strained
        </div>
      </div>
      {buckets.length === 0 ? <div className={s.empty}>Collecting data…</div> : (
        <div className={s.heat} style={{ gridTemplateColumns: `112px repeat(${buckets.length}, minmax(0, 1fr))` }}>
          {SIGNALS.map(m => (
            <div key={m.key} className={s.heatRow}>
              <div className={s.heatLbl}><i style={{ background: m.color }} />{m.label}</div>
              {buckets.map(b => (
                <div key={b.t} className={s.heatCell} style={{ background: cellColor(b.z[m.key]) }}
                  title={`${m.label} · ${fmt(b.t)} — ${label(b.z[m.key])}`} />
              ))}
            </div>
          ))}
          <div className={s.heatRow}>
            <div className={s.heatLbl} style={{ color: 'var(--text)' }}><i style={{ background: 'var(--text)' }} />Overall strain</div>
            {buckets.map(b => (
              <div key={b.t} className={s.heatCell} style={{ background: cellColor(b.strain == null ? null : (b.strain / 100) * 3), outline: '0.5px solid var(--border2)' }}
                title={`Overall strain · ${fmt(b.t)} — ${b.strain ?? '—'}/100`} />
            ))}
          </div>
          <div className={s.heatAxis} style={{ gridColumn: `2 / span ${buckets.length}`, gridTemplateColumns: `repeat(${buckets.length}, minmax(0,1fr))` }}>
            {buckets.map((b, i) => <span key={b.t}>{ticks.includes(i) ? fmt(b.t) : ''}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}
