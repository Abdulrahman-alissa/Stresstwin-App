import { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowRight, CheckCircle2, Clock, Play, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { projectScenarios, type Action, type EarlyWarning, type ExerciseKind } from '../../lib/insights'
import ExerciseModal from './ExerciseModal'
import s from './insights.module.css'

interface Props { score: number; threshold: number; ew: EarlyWarning; actions: Action[] }

const HORIZON = 30

export default function PreventionPath({ score, threshold, ew, actions }: Props) {
  const { trend, resets, addReset } = useAppStore()
  const [active, setActive] = useState<Action | null>(null)

  // The best thing to do right now = highest-ranked action that is an exercise (not a plan).
  const best = actions.find(a => a.kind !== 'plan' && !resets.some(r => r.id === a.id)) ?? actions.find(a => a.kind !== 'plan')
  const kind = (best?.kind ?? 'breathing') as ExerciseKind
  const sc = useMemo(() => projectScenarios(score, ew.slopePerMin, threshold, kind, HORIZON), [score, ew.slopePerMin, threshold, kind])

  // chart rows: measured past (last 15 min) + two possible futures
  const now = Date.now()
  const past = trend.slice(-30).map(t => ({ m: (new Date(t.at).getTime() - now) / 60000, score: Math.round(t.score * 10) / 10 }))
    .filter(p => p.m >= -15 && p.m <= 0)
  const data: Record<string, number | null>[] = [
    ...past.map(p => ({ m: p.m, score: p.score, nothing: null, reset: null })),
    ...sc.points.map(p => ({ m: p.m, score: p.m === 0 ? score : null, nothing: Math.round(p.nothing * 10) / 10, reset: Math.round(p.reset * 10) / 10 })),
  ]

  // Measured effect of resets the person already did (score ~5 min later vs. before).
  const effects = resets.filter(r => r.kind !== 'plan').map(r => {
    const later = trend.find(t => new Date(t.at).getTime() >= r.at + 4 * 60000)
    return { r, after: later ? later.score : null }
  })

  const without = sc.crossNothing != null
    ? (sc.crossNothing < 1 ? 'You are already at the threshold' : `Crosses threshold in ~${Math.round(sc.crossNothing)} min`)
    : ew.slopePerMin > 0.15 ? `Peaks near ${Math.round(sc.peakNothing)}` : 'Stays in a steady range'
  const withReset = sc.crossReset == null ? `Stays under threshold (peak ~${Math.round(sc.peakReset)})` : `Delays threshold by ~${Math.max(1, sc.crossReset - Math.round(sc.crossNothing ?? 0))} min`
  const saved = Math.max(0, Math.round(sc.peakNothing - sc.peakReset))

  const finish = (a: Action) => addReset({ id: a.id, kind: a.kind, title: a.title, at: Date.now(), scoreBefore: score })

  return (
    <div className={s.card} data-hero="true">
      <div className={s.cardHead}>
        <div>
          <div className={s.clbl}>Prevention path · the next {HORIZON} minutes</div>
          <div className={s.csub}>Two futures from where you are right now. The earlier you reset, the less it takes.</div>
        </div>
        <div className={s.legend}>
          <span><i style={{ background: 'var(--brand)' }} />Measured</span>
          <span><i style={{ background: 'var(--red)' }} />If nothing changes</span>
          <span><i style={{ background: 'var(--accent)' }} />If you reset now</span>
        </div>
      </div>

      <div className={s.pathGrid}>
        <div style={{ height: 340, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 24, right: 12, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="gPast" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B5BDB" stopOpacity={0.45} /><stop offset="100%" stopColor="#3B5BDB" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gGap" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#12B886" stopOpacity={0.0} /><stop offset="100%" stopColor="#12B886" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <ReferenceArea y1={threshold} y2={100} fill="#F03E3E" fillOpacity={0.07} />
              <ReferenceArea y1={0} y2={50} fill="#12B886" fillOpacity={0.04} />
              <ReferenceArea x1={0} x2={HORIZON} fill="#ffffff" fillOpacity={0.015} />
              <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
              <XAxis dataKey="m" type="number" domain={[-15, HORIZON]} ticks={[-15, -10, -5, 0, 5, 10, 15, 20, 25, 30]}
                tickFormatter={(v: number) => (v === 0 ? 'now' : `${v > 0 ? '+' : ''}${v}m`)} tick={{ fill: '#4B5567', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fill: '#4B5567', fontSize: 10 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={threshold} stroke="#F03E3E" strokeDasharray="5 4" label={{ value: `threshold ${threshold}`, fill: '#F03E3E', fontSize: 10, position: 'insideTopLeft' }} />
              <ReferenceLine x={0} stroke="rgba(255,255,255,.35)" label={{ value: 'now', fill: '#8892A4', fontSize: 10, position: 'insideTopRight' }} />
              {sc.crossNothing != null && sc.crossNothing > 0.5 && sc.crossNothing <= HORIZON && (
                <ReferenceLine x={sc.crossNothing} stroke="#F03E3E" strokeOpacity={0.6}
                  label={{ value: `~${Math.round(sc.crossNothing)} min`, fill: '#FF6B6B', fontSize: 10, position: 'top' }} />
              )}
              {resets.filter(r => r.kind !== 'plan' && (r.at - now) / 60000 >= -15).map(r => (
                <ReferenceLine key={r.id} x={(r.at - now) / 60000} stroke="#12B886" strokeDasharray="2 3" label={{ value: 'reset', fill: '#12B886', fontSize: 10, position: 'insideBottom' }} />
              ))}
              <Tooltip contentStyle={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v: number) => (v === 0 ? 'now' : `${v > 0 ? 'in ' : ''}${Math.abs(Math.round(v))} min${v < 0 ? ' ago' : ''}`)}
                formatter={(v: number, n: string) => [Math.round(v), n === 'score' ? 'Measured' : n === 'nothing' ? 'If nothing changes' : 'If you reset now']} />
              <Area type="monotone" dataKey="score" stroke="#3B5BDB" strokeWidth={2.2} fill="url(#gPast)" connectNulls isAnimationActive={false} dot={false} />
              <Line type="monotone" dataKey="nothing" stroke="#F03E3E" strokeWidth={2.2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="reset" stroke="#12B886" strokeWidth={2.6} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <aside className={s.pathSide}>
          <div className={s.compare}>
            <div className={s.cmp} data-kind="bad">
              <TrendingUp size={15} />
              <div><b>Without a reset</b><span>{without}</span></div>
            </div>
            <div className={s.cmp} data-kind="good">
              <TrendingDown size={15} />
              <div><b>With a {best ? best.minutes : 2}-min reset</b><span>{withReset}</span></div>
            </div>
          </div>

          {best && (
            <div className={s.next}>
              <div className={s.clbl}>Best next step</div>
              <div className={s.nextTitle}>{best.title}</div>
              <div className={s.nextWhy}>{best.why}</div>
              <div className={s.nextRow}>
                <span className={s.note}><Clock size={10} />{best.minutes} min{saved > 0 && <> · est. {saved} pts lower by +{HORIZON} min</>}</span>
                <button className={s.aBtn} onClick={() => setActive(best)}><Play size={13} /> Start now <ArrowRight size={13} /></button>
              </div>
            </div>
          )}

          <div>
            <div className={s.clbl} style={{ marginBottom: 6 }}>Your results (measured)</div>
            {effects.length === 0 ? (
              <div className={s.csub} style={{ marginTop: 0 }}>Finish a reset and we’ll compare your score before and ~5 minutes after.</div>
            ) : effects.map(({ r, after }) => (
              <div key={r.id} className={s.result}>
                <CheckCircle2 size={14} color="var(--accent)" />
                <span className={s.resultName}>{r.title}</span>
                <span className={s.resultVal} data-good={after != null && after < r.scoreBefore}>
                  {Math.round(r.scoreBefore)} → {after != null ? `${Math.round(after)} (${after - r.scoreBefore <= 0 ? '' : '+'}${Math.round(after - r.scoreBefore)})` : 'measuring…'}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className={s.foot}>
        <ShieldCheck size={12} />
        Dashed lines are estimates: they extend your current trend and assume a reset like this typically lowers the index by ~{sc.relief} points and slows the climb for about 15 minutes. Your measured results above replace the guess as you use it.
      </div>
      {active && <ExerciseModal action={active} onClose={() => setActive(null)} onDone={() => finish(active)} />}
    </div>
  )
}
