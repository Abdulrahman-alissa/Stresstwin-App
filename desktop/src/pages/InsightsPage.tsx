import { Database, Radio } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useInsights } from '../hooks/useInsights'
import { demoForecast, demoSignals, demoTrend } from '../lib/demo'
import { minuteBuckets, sessionStats } from '../lib/insights'
import { useMemo } from 'react'
import EarlyWarning from '../components/insights/EarlyWarning'
import ScoreTimeline from '../components/insights/ScoreTimeline'
import ZonesDonut from '../components/insights/ZonesDonut'
import SignalTile from '../components/insights/SignalTile'
import DriversRadar from '../components/insights/DriversRadar'
import Playbook from '../components/insights/Playbook'
import ForecastPlan from '../components/insights/ForecastPlan'
import SessionStats from '../components/insights/SessionStats'
import PreventionPath from '../components/insights/PreventionPath'
import SignalHeatmap from '../components/insights/SignalHeatmap'
import DeviceCompare from '../components/insights/DeviceCompare'
import ActivityStrain from '../components/insights/ActivityStrain'
import p from './Page.module.css'
import s from '../components/insights/insights.module.css'

export default function InsightsPage() {
  const { trend, signals, forecasts, forecastReady, daysUntilReady, setSignals, setForecasts, setScore } = useAppStore()
  const { threshold, score, readings, ew, actions, hasSignals } = useInsights()
  const stats = useMemo(() => sessionStats(signals), [signals])
  const buckets = useMemo(() => minuteBuckets(signals, 30), [signals])
  const sample = signals.some(x => x.simulated)

  const loadSample = () => {
    const t = demoTrend()
    setSignals(demoSignals(), t)
    setScore(t[t.length - 1].score, false, null, true)
    if (forecasts.length === 0) setForecasts(demoForecast(), true, 0)
  }

  return (
    <div className={p.page}>
      <div className={p.pageHeader}>
        <div>
          <h1 className={p.pageTitle}>Insights</h1>
          <p className={p.pageSub}>What your devices are measuring right now, and what to do about it before stress builds.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasSignals && (
            <span className={s.chip} style={{ color: sample ? 'var(--amber)' : 'var(--accent)' }}>
              <Radio size={11} /> {sample ? 'Sample data' : 'Live · 5s windows'}
            </span>
          )}
          {!hasSignals && (
            <button className={p.refreshBtn} onClick={loadSample}><Database size={12} style={{ verticalAlign: -1, marginRight: 6 }} />Load sample data</button>
          )}
        </div>
      </div>

      <EarlyWarning ew={ew} threshold={threshold} />

      {hasSignals && <SessionStats st={stats} />}

      {!sample && <DeviceCompare />}

      <PreventionPath score={score} threshold={threshold} ew={ew} actions={actions} />

      <div className={s.grid2}>
        <ScoreTimeline trend={trend} threshold={threshold} slopePerMin={ew.slopePerMin} />
        <ZonesDonut trend={trend} threshold={threshold} />
      </div>

      <div className={s.sectionTitle}>Collected signals · vs. your own baseline</div>
      <div className={s.tiles}>
        {readings.map((r, i) => <SignalTile key={r.meta.key} r={r} delay={i * 40} />)}
      </div>
      <div className={s.note}>Only counts and timings are measured. Which keys you press, and what you type, is never recorded.</div>

      <div className={s.grid12}>
        <DriversRadar readings={readings} />
        <ActivityStrain buckets={buckets} />
      </div>

      <SignalHeatmap buckets={buckets} />

      <Playbook actions={actions} />

      <ForecastPlan forecasts={forecasts} ready={forecastReady} daysLeft={daysUntilReady} />
    </div>
  )
}
