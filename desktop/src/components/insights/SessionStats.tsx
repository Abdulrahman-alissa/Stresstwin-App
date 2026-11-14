import { Keyboard, Timer, Gauge, MousePointerClick, PauseCircle, Coffee } from 'lucide-react'
import type { SessionStats as Stats } from '../../lib/insights'
import s from './insights.module.css'

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className={s.kpiSpark} />
  const max = Math.max(...values, 1)
  const W = 100, H = 28
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - 2 - (v / max) * (H - 5)}`).join(' ')
  return (
    <svg className={s.kpiSpark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={`0,${H} ${pts} ${W},${H}`} fill={color} fillOpacity=".14" stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const fmtN = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString('en-US'))
const fmtDur = (sec: number) => (sec >= 90 ? `${Math.round(sec / 60)} min` : `${Math.round(sec)} s`)

export default function SessionStats({ st }: { st: Stats }) {
  const longNoBreak = st.sinceBreakMin >= 50
  const items = [
    { Icon: Keyboard, label: 'Key presses', value: fmtN(st.keys), sub: 'count only, never which keys', color: '#3B5BDB', spark: st.sparks.keys },
    { Icon: Timer, label: 'Active typing', value: fmtDur(st.typingSec), sub: `${st.activePct}% of the time active`, color: '#7048E8', spark: st.sparks.cps },
    { Icon: Gauge, label: 'Typing pace', value: st.avgCps ? st.avgCps.toFixed(1) : '—', unit: 'keys/s', sub: `peak ${st.peakCps.toFixed(1)} keys/s`, color: '#12B886', spark: st.sparks.cps },
    { Icon: MousePointerClick, label: 'Clicks', value: fmtN(st.clicks), sub: `${st.minutes ? (st.clicks / st.minutes).toFixed(0) : 0} per minute`, color: '#1C7ED6', spark: st.sparks.clicks },
    { Icon: PauseCircle, label: 'Typing pauses', value: fmtN(st.pauses), sub: `${st.minutes ? (st.pauses / st.minutes).toFixed(1) : 0} per minute`, color: '#F59F00', spark: st.sparks.pauses },
    {
      Icon: Coffee, label: 'Since last break',
      value: st.noBreakInSpan ? `${Math.floor(st.minutes)}+` : `${Math.round(st.sinceBreakMin)}`, unit: 'min',
      sub: longNoBreak ? 'overdue — take a short break' : st.breaks ? `${st.breaks} break${st.breaks > 1 ? 's' : ''} taken` : 'no break yet',
      color: longNoBreak ? '#F03E3E' : '#12B886', spark: [], hot: longNoBreak,
    },
  ]
  return (
    <div>
      <div className={s.sectionTitle}>What was collected · last {Math.max(1, Math.round(st.minutes))} min on this device</div>
      <div className={s.kpis}>
        {items.map((k, i) => (
          <div key={k.label} className={s.kpi} data-hot={k.hot ? 'true' : undefined} style={{ animationDelay: `${i * 35}ms` }}>
            <div className={s.kpiTop}>
              <span className={s.kpiIcon} style={{ color: k.color, background: `color-mix(in srgb, ${k.color} 14%, transparent)` }}><k.Icon size={14} /></span>
              <span className={s.kpiLbl}>{k.label}</span>
            </div>
            <div className={s.kpiVal}>{k.value}{k.unit && <small>{k.unit}</small>}</div>
            <div className={s.kpiSub}>{k.sub}</div>
            {k.spark.length > 1 && <Spark values={k.spark} color={k.color} />}
          </div>
        ))}
      </div>
    </div>
  )
}
