import { CalendarClock, AlertTriangle, Lightbulb } from 'lucide-react'
import { DayForecast, useAppStore } from '../store/useAppStore'
import ForecastBasis, { BasisText, StarterNote } from './ForecastBasis'
import { parseDay } from '../lib/deviceStats'
import s from './ForecastStrip.module.css'

interface Props { forecasts: DayForecast[]; ready: boolean; daysLeft: number }

const RISK_COLOR: Record<string, string> = {
  low:      'var(--accent)',
  moderate: 'var(--amber)',
  high:     'var(--red)',
}

export default function ForecastStrip({ forecasts, ready, daysLeft }: Props) {
  const basis = useAppStore(st => st.forecastBasis)
  if (!ready) {
    return (
      <div className={s.notReady}>
        <CalendarClock size={22} color="var(--muted)" />
        <div>
          <div className={s.nrTitle}>3-Day LSTM Forecast</div>
          <div className={s.nrSub}>Available after {daysLeft} more day{daysLeft !== 1 ? 's' : ''} of data + 20 mood check-ins. Connect your calendar to speed this up.</div>
        </div>
        <ForecastBasis compact />
      </div>
    )
  }

  return (
    <div className={s.card}>
      <div className={s.header}>
        <div>
          <div className={s.title}>3-Day LSTM Forecast</div>
          <div className={s.sub}>Calendar-aware prediction · updated every 6 hours</div>
        </div>
        <div className={s.tags}>
          <span className={s.tag}>{basis?.source === 'global' ? 'Starter estimate' : 'Next 3 days'}</span>
          <span className={`${s.tag} ${s.tagBrand}`}><BasisText /></span>
        </div>
      </div>
      <StarterNote compact />
      <div className={s.bars}>
        {forecasts.map((f, i) => {
          const color = RISK_COLOR[f.risk_label] ?? 'var(--brand)'
          const day = parseDay(f.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          return (
            <div key={f.date} className={s.barWrap} style={{ animationDelay: `${i * 80}ms` }}>
              <div className={s.barDay}>{day}</div>
              <div className={s.barTrack}>
                <div className={s.barFill} style={{ width: `${f.risk * 100}%`, background: color }} />
              </div>
              <div className={s.barMeta}>
                <span className={s.barPct} style={{ color }}>{Math.round(f.risk * 100)}%</span>
                <span className={s.barLabel} style={{ background: `${color}22`, color }}>{f.risk_label}</span>
              </div>
              {f.primary_stressor && (
                <div className={s.stressor}><AlertTriangle size={12} style={{ verticalAlign: -2, marginRight: 5 }} />{f.primary_stressor}</div>
              )}
              {f.recommendation && (
                <div className={s.rec}><Lightbulb size={12} style={{ verticalAlign: -2, marginRight: 5 }} />{f.recommendation}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
