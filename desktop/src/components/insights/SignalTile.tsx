import { Area, AreaChart, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts'
import { Keyboard, Timer, Delete, MousePointer2, MousePointerClick, PauseCircle, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import type { SignalReading, SignalKey } from '../../lib/insights'
import s from './insights.module.css'

const ICONS: Record<SignalKey, typeof Keyboard> = {
  cps: Keyboard, interKeyMs: Timer, errorRate: Delete, mouseSpeed: MousePointer2, clicks: MousePointerClick, pauses: PauseCircle,
}

export default function SignalTile({ r, delay = 0 }: { r: SignalReading; delay?: number }) {
  const { meta } = r
  const Icon = ICONS[meta.key]
  const fmt = (v: number) => (v * meta.scale).toFixed(meta.digits)
  const data = r.spark.map((v, i) => ({ i, v: v * meta.scale }))
  const hasData = data.length >= 3
  const dp = r.deltaPct
  const tone = r.level === 'high' ? 'var(--red)' : r.level === 'watch' ? 'var(--amber)' : 'var(--accent)'
  const Arrow = dp == null || Math.abs(dp) < 2 ? Minus : dp > 0 ? ArrowUpRight : ArrowDownRight
  const gid = `g-${meta.key}`

  return (
    <div className={s.tile} data-level={r.level} style={{ animationDelay: `${delay}ms` }} title={meta.hint}>
      <div className={s.tileTop}>
        <div className={s.tileIcon} style={{ background: `${meta.color}22`, color: meta.color }}><Icon size={14} /></div>
        <span className={s.tileLbl}>{meta.label}</span>
        {hasData && (
          <span className={s.delta} style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
            <Arrow size={11} />{dp == null ? '—' : `${Math.abs(Math.round(dp))}%`}
          </span>
        )}
      </div>
      <div className={s.tileVal}>
        <span className={s.tileNum}>{hasData ? fmt(r.current) : '—'}</span>
        <span className={s.tileUnit}>{meta.unit}</span>
      </div>
      <div className={s.tileBase}>{hasData ? `your avg ${fmt(r.base)} ${meta.unit}` : 'collecting…'}</div>
      <div className={s.spark}>
        {hasData && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={meta.color} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={meta.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={['auto', 'auto']} />
              <ReferenceLine y={r.base * meta.scale} stroke="var(--hint)" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="v" stroke={meta.color} strokeWidth={1.6} fill={`url(#${gid})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
