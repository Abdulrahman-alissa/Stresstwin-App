import { useAppStore } from '../store/useAppStore'
import { submitCheckin } from '../api/client'
import ScoreGauge from '../components/ScoreGauge'
import ForecastStrip from '../components/ForecastStrip'
import TrendChart from '../components/TrendChart'
import InterventionOverlay from '../components/InterventionOverlay'
import DeviceStrip from '../components/DeviceStrip'
import EarlyWarning from '../components/insights/EarlyWarning'
import SignalTile from '../components/insights/SignalTile'
import Playbook from '../components/insights/Playbook'
import { useInsights } from '../hooks/useInsights'
import SessionStats from '../components/insights/SessionStats'
import { sessionStats } from '../lib/insights'
import { Star, CheckCircle2, ArrowRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import s from './Dashboard.module.css'

export default function Dashboard() {
  const { signals, currentScore, trend, modelReady, user, interventionType, forecasts, forecastReady, daysUntilReady, setPage } = useAppStore()
  const { threshold, readings, ew, actions } = useInsights()
  const stats = useMemo(() => sessionStats(signals), [signals])
  const [checkinSent, setCheckinSent] = useState(false)
  const [checkinVal, setCheckinVal] = useState(0)

  const scoreLabel = currentScore < 50 ? 'Optimal' : currentScore < 75 ? 'Elevated' : 'Critical'
  const scoreColor = currentScore < 50 ? 'var(--accent)' : currentScore < 75 ? 'var(--amber)' : 'var(--red)'

  const sendCheckin = async (rating: number) => {
    setCheckinVal(rating)
    setCheckinSent(true)
    try { await submitCheckin(rating) } catch {}
  }

  return (
    <div className={s.root}>
      {/* Header */}
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Dashboard</h1>
          <p className={s.sub}>
            {new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })}
            {' · '}
            {modelReady ? 'Personalized model active' : `Building baseline (Day ${user?.days_of_data ?? 0}/7)`}
          </p>
        </div>
        <div className={s.headerRight}>
          <div className={s.pill} style={{ background:'var(--brand-dim)', color:'var(--brand)' }}>
            Day {user?.days_of_data ?? 0}
          </div>
          <div className={s.pill} style={{ background:'var(--accent-dim)', color:'var(--accent)' }}>
            <span className={s.liveDot} />  Live
          </div>
        </div>
      </div>

      {/* Early warning — the "before it happens" banner */}
      <EarlyWarning ew={ew} threshold={threshold} />

      {/* Row 1 — Score + Metric cards */}
      <DeviceStrip />
      <div className={s.row3}>
        {/* Score gauge */}
        <div className={`${s.card} ${s.scoreCard}`}>
          <div className={s.clbl}>Current Stress Index</div>
          <ScoreGauge score={currentScore} color={scoreColor} />
          <div className={s.scoreLabel} style={{ color: scoreColor }}>{scoreLabel}</div>
          {!modelReady && (
            <div className={s.coldStart}>
              Learning your baseline…  Day {user?.days_of_data ?? 0} of 7
              <div className={s.coldBar}>
                <div className={s.coldFill} style={{ width: `${((user?.days_of_data ?? 0)/7)*100}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Trend card */}
        <div className={s.card}>
          <div className={s.clbl}>60-min Trend</div>
          <TrendChart ticks={trend} />
        </div>

        {/* Mood check-in */}
        <div className={s.card}>
          <div className={s.clbl}>Mood Check-in</div>
          {checkinSent ? (
            <div className={s.checkinDone}>
              <span style={{ display: 'flex', gap: 4 }}>
                {Array.from({ length: checkinVal }, (_, i) => <Star key={i} size={22} fill="var(--amber)" color="var(--amber)" />)}
              </span>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>Thanks! Logged.</div>
            </div>
          ) : (
            <>
              <p className={s.checkinPrompt}>How stressed do you feel right now?</p>
              <div className={s.stars}>
                {[1,2,3,4,5].map(n => (
                  <button key={n} className={s.star} onClick={() => sendCheckin(n)} aria-label={`Stress level ${n} of 5`}>
                    <Star size={24} color="var(--amber)" />
                  </button>
                ))}
              </div>
              <p className={s.checkinHint}>1 = very calm · 5 = very stressed</p>
              <div className={s.checkinProgress}>
                <div className={s.clbl} style={{margin:0}}>Check-ins: {user?.mood_checkins_count ?? 0}/20 for LSTM</div>
                <div className={s.coldBar} style={{marginTop:6}}>
                  <div className={s.coldFill} style={{ width:`${Math.min(((user?.mood_checkins_count??0)/20)*100,100)}%`, background:'var(--accent)' }} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Row 2 — Forecast strip */}
      <ForecastStrip forecasts={forecasts} ready={forecastReady} daysLeft={daysUntilReady} />

      {/* Row 3 — Live collected signals */}
      <div className={s.rowHead}>
        <div className={s.clbl} style={{ margin: 0 }}>Live signals · vs. your baseline</div>
        <button className={s.link} onClick={() => setPage('insights')}>All insights <ArrowRight size={12} /></button>
      </div>
      <div className={s.tiles}>
        {readings.slice(0, 4).map((r, i) => <SignalTile key={r.meta.key} r={r} delay={i * 40} />)}
      </div>

      {/* Row 3b — Totals of what was collected */}
      {signals.length >= 6 && <SessionStats st={stats} />}

      {/* Row 4 — What to do before stress builds */}
      <Playbook actions={actions} limit={3} title="Do this before stress builds" />

      {/* Intervention overlay (when triggered) */}
      {interventionType && <InterventionOverlay type={interventionType} />}
    </div>
  )
}
