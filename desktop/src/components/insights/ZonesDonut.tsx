import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { ScoreTick } from '../../store/useAppStore'
import { zoneShare } from '../../lib/insights'
import s from './insights.module.css'

export default function ZonesDonut({ trend, threshold }: { trend: ScoreTick[]; threshold: number }) {
  const z = zoneShare(trend, threshold)
  const total = z.optimal + z.elevated + z.critical
  const rows = [
    { name: 'Optimal',  value: z.optimal,  color: 'var(--accent)' },
    { name: 'Elevated', value: z.elevated, color: 'var(--amber)' },
    { name: 'Critical', value: z.critical, color: 'var(--red)' },
  ]
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0)
  return (
    <div className={s.card}>
      <div className={s.cardHead}><div><div className={s.clbl}>Time in zones</div><div className={s.csub}>Last hour</div></div></div>
      {total === 0 ? <div className={s.empty}>Collecting data…</div> : (
        <>
          <div style={{ height: 170, position: 'relative' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rows} dataKey="value" innerRadius={54} outerRadius={76} paddingAngle={3} stroke="none" startAngle={90} endAngle={-270}>
                  {rows.map(r => <Cell key={r.name} fill={r.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 8, fontSize: 12 }} formatter={(v: number, n: string) => [`${pct(v)}%`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 300 }}>{pct(z.optimal)}%</div>
                <div className={s.clbl} style={{ marginTop: 2 }}>optimal</div>
              </div>
            </div>
          </div>
          <div className={s.legend} style={{ justifyContent: 'center', marginTop: 8 }}>
            {rows.map(r => <span key={r.name}><i style={{ background: r.color }} />{r.name} {pct(r.value)}%</span>)}
          </div>
        </>
      )}
    </div>
  )
}
