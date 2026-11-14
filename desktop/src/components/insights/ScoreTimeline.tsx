import { Area, ComposedChart, CartesianGrid, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ScoreTick } from '../../store/useAppStore'
import s from './insights.module.css'

interface Props { trend: ScoreTick[]; threshold: number; slopePerMin: number }

export default function ScoreTimeline({ trend, threshold, slopePerMin }: Props) {
  const base = trend.slice(-120).map(t => ({ ts: new Date(t.at).getTime(), score: Math.round(t.score * 10) / 10, proj: null as number | null }))
  const data = [...base]
  // Dashed projection: where the score is heading in the next 10 minutes if nothing changes.
  if (base.length >= 3 && Math.abs(slopePerMin) > 0.1) {
    const last = base[base.length - 1]
    data[data.length - 1] = { ...last, proj: last.score }
    for (let m = 2; m <= 10; m += 2) {
      data.push({ ts: last.ts + m * 60000, score: undefined as unknown as number, proj: Math.min(100, Math.max(0, last.score + slopePerMin * m)) })
    }
  }
  const fmt = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.clbl}>Stress index · last hour</div>
          <div className={s.csub}>Dashed line shows where you are heading if nothing changes.</div>
        </div>
        <div className={s.legend}>
          <span><i style={{ background: 'var(--brand)' }} />Score</span>
          <span><i style={{ background: 'var(--amber)' }} />Projection</span>
          <span><i style={{ background: 'var(--red)' }} />Threshold</span>
        </div>
      </div>
      <div style={{ height: 240 }}>
        {base.length < 2 ? <div className={s.empty}>Collecting data… the first scores appear within a minute.</div> : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="gScore" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B5BDB" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#3B5BDB" stopOpacity={0} />
                </linearGradient>
              </defs>
              <ReferenceArea y1={0} y2={50} fill="#12B886" fillOpacity={0.05} />
              <ReferenceArea y1={50} y2={threshold} fill="#F59F00" fillOpacity={0.05} />
              <ReferenceArea y1={threshold} y2={100} fill="#F03E3E" fillOpacity={0.07} />
              <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
              <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmt} tick={{ fill: '#4B5567', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={50} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fill: '#4B5567', fontSize: 10 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={threshold} stroke="#F03E3E" strokeDasharray="5 4" label={{ value: `threshold ${threshold}`, fill: '#F03E3E', fontSize: 10, position: 'insideTopLeft' }} />
              <Tooltip contentStyle={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 8, fontSize: 12 }} labelFormatter={(v: number) => fmt(v)} formatter={(v: number, n: string) => [`${Math.round(v)}/100`, n === 'proj' ? 'Projected' : 'Score']} />
              <Area type="monotone" dataKey="score" stroke="#3B5BDB" strokeWidth={2} fill="url(#gScore)" connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="proj" stroke="#F59F00" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
