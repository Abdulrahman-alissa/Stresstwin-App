// TrendChart.tsx
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis } from 'recharts'
import { ScoreTick } from '../store/useAppStore'

export function TrendChart({ ticks }: { ticks: ScoreTick[] }) {
  const data = ticks.map(t => ({ score: t.score, at: t.at }))
  return (
    <div style={{ height: 120, marginTop: 8 }}>
      {data.length < 2 ? (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--hint)', fontSize: 12 }}>
          Collecting data…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <YAxis domain={[0, 100]} hide />
            <Tooltip
              contentStyle={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
              formatter={(v: any) => [`${Math.round(v)}/100`, 'Score']}
              labelFormatter={() => ''}
            />
            <Line type="monotone" dataKey="score" stroke="var(--brand)" strokeWidth={2}
                  dot={false} activeDot={{ r: 4, fill: 'var(--brand)' }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

export default TrendChart
