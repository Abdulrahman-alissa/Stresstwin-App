import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MinuteBucket } from '../../lib/insights'
import s from './insights.module.css'

export default function ActivityStrain({ buckets }: { buckets: MinuteBucket[] }) {
  const data = buckets.map(b => ({ ...b }))
  const fmt = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.clbl}>Workload vs. strain</div>
          <div className={s.csub}>Bars: keys and clicks per minute. Line: how strained your signals were. Strain climbing while workload stays flat is the early sign.</div>
        </div>
        <div className={s.legend}>
          <span><i style={{ background: 'var(--brand)' }} />Keys</span>
          <span><i style={{ background: '#1C7ED6' }} />Clicks</span>
          <span><i style={{ background: 'var(--amber)' }} />Strain</span>
        </div>
      </div>
      <div style={{ height: 230 }}>
        {data.length === 0 ? <div className={s.empty}>Collecting data…</div> : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
              <XAxis dataKey="t" tickFormatter={fmt} tick={{ fill: '#4B5567', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={48} />
              <YAxis yAxisId="a" tick={{ fill: '#4B5567', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="s" orientation="right" domain={[0, 100]} hide />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,.04)' }} contentStyle={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v: number) => fmt(v)} />
              <Bar yAxisId="a" dataKey="keys" name="Keys" stackId="w" fill="#3B5BDB" radius={[0, 0, 0, 0]} isAnimationActive={false} />
              <Bar yAxisId="a" dataKey="clicks" name="Clicks" stackId="w" fill="#1C7ED6" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line yAxisId="s" type="monotone" dataKey="strain" name="Strain" stroke="#F59F00" strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
