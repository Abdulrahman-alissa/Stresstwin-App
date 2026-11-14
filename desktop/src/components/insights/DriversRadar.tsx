import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import type { SignalReading } from '../../lib/insights'
import s from './insights.module.css'

/** Outward = further from YOUR normal in a stress-like direction. Centre = right on baseline. */
export default function DriversRadar({ readings }: { readings: SignalReading[] }) {
  const data = readings.map(r => ({
    axis: r.meta.label.replace(' rate', '').replace('Typing pace', 'Pace'),
    value: Math.min(100, Math.round(r.stressZ * 30)),
    watch: 33,
  }))
  const top = [...readings].sort((a, b) => b.stressZ - a.stressZ)[0]
  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.clbl}>Stress drivers</div>
          <div className={s.csub}>
            {top && top.stressZ >= 1.1
              ? <>Biggest shift: <b style={{ color: 'var(--text)' }}>{top.meta.label}</b>. Outside the dashed ring means it needs attention.</>
              : 'Every signal is near your own baseline.'}
          </div>
        </div>
      </div>
      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="rgba(255,255,255,.08)" />
            <PolarAngleAxis dataKey="axis" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar dataKey="watch" stroke="var(--amber)" strokeDasharray="4 4" fill="none" strokeWidth={1} isAnimationActive={false} />
            <Radar dataKey="value" stroke="var(--brand)" fill="var(--brand)" fillOpacity={0.3} strokeWidth={2} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
