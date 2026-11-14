// ForecastPage.tsx
import { useEffect, useState } from 'react'
import { CalendarClock, AlertTriangle, Lightbulb } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { loadForecast } from '../lib/loadForecast'
import { parseDay } from '../lib/deviceStats'
import ForecastBasis, { BasisText, StarterNote } from '../components/ForecastBasis'
import s from './Page.module.css'

export function ForecastPage() {
  const { forecasts, forecastReady, daysUntilReady, forecastError } = useAppStore()
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try { await loadForecast() } finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  const riskColor = (r: string) =>
    r === 'high' ? 'var(--red)' : r === 'moderate' ? 'var(--amber)' : 'var(--accent)'

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <div>
          <h1 className={s.pageTitle}>3-Day Forecast</h1>
          <p className={s.pageSub}>Calendar-aware stress prediction · starts from everyone's patterns, becomes personal as your data grows</p>
        </div>
        <button className={s.refreshBtn} onClick={refresh} disabled={loading}>
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {forecastError && (
        <div className={s.flash} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>Couldn't reach the server{forecasts.length ? ' — showing the last forecast.' : '.'}</span>
          <button className={s.refreshBtn} onClick={refresh} disabled={loading}>Retry</button>
        </div>
      )}

      {!forecastReady ? (
        <div className={s.emptyCard}>
          <CalendarClock size={44} color="var(--hint)" style={{ marginBottom: 16 }} />
          <h3 className={s.emptyTitle}>Forecast not yet available</h3>
          <p className={s.emptySub}>
            The LSTM model activates after {daysUntilReady} more day{daysUntilReady !== 1 ? 's' : ''} of behavioral data
            and 20 mood check-ins.
            <br /><br />
            Connect your Google or Outlook calendar in Settings to get the full calendar-aware forecast.
          </p>
          <div style={{ width: '100%', maxWidth: 460, marginTop: 18 }}><ForecastBasis /></div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <StarterNote />
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--hint)' }}><BasisText /> · refreshed every 6 hours</div>
          {forecasts.map((f, i) => {
            const color = riskColor(f.risk_label)
            const date = parseDay(f.date).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })
            return (
              <div key={f.date} className={s.card} style={{ animationDelay: `${i*80}ms`, padding: '14px 18px' }}>
                <div className={s.fcRow}>
                  <div className={s.fcLeft}>
                    <div className={s.fcDate}>{date}</div>
                    <div className={s.fcRiskRow}>
                      <span className={s.fcRiskPct} style={{ color }}>{Math.round(f.risk*100)}%</span>
                      <span className={s.fcRiskBadge} style={{ background:`${color}22`, color }}>{f.risk_label} risk</span>
                    </div>
                  </div>
                  <div className={s.fcRight}>
                    <div className={s.fcBar}>
                      <div className={s.fcFill} style={{ width:`${f.risk*100}%`, background:color }} />
                    </div>
                  </div>
                </div>
                {f.primary_stressor && (
                  <div className={s.fcStressor}><AlertTriangle size={12} style={{ verticalAlign: -2, marginRight: 6 }} />{f.primary_stressor}</div>
                )}
                {f.recommendation && (
                  <div className={s.fcRec}><Lightbulb size={12} style={{ verticalAlign: -2, marginRight: 6 }} />{f.recommendation}</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ForecastPage
