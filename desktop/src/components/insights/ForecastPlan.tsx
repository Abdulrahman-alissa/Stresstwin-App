import { CalendarClock, Lightbulb } from 'lucide-react'
import type { DayForecast } from '../../store/useAppStore'
import s from './insights.module.css'

const COLOR = { low: 'var(--accent)', moderate: 'var(--amber)', high: 'var(--red)' } as const
const FALLBACK = {
  low: 'Light day. Keep your normal routine and one short break in the afternoon.',
  moderate: 'Add a 10-minute buffer between tasks and protect a lunch break.',
  high: 'Move one non-urgent task, finish key work the evening before, and block a recovery slot.',
} as const

function Ring({ pct, color }: { pct: number; color: string }) {
  const R = 26, C = 2 * Math.PI * R
  return (
    <div className={s.dayRing}>
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={R} fill="none" stroke="var(--surface3)" strokeWidth="6" />
        <circle cx="32" cy="32" r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * C} ${C}`} transform="rotate(-90 32 32)" />
      </svg>
      <span style={{ color }}>{pct}%</span>
    </div>
  )
}

import { StarterNote } from '../ForecastBasis'
import { parseDay } from '../../lib/deviceStats'

export default function ForecastPlan({ forecasts, ready, daysLeft }: { forecasts: DayForecast[]; ready: boolean; daysLeft: number }) {
  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.clbl}>Next 3 days · plan before it happens</div>
          <div className={s.csub}>The forecast looks at your history and calendar. Each day comes with a concrete way to lower its load.</div>
        </div>
      </div>
      <StarterNote compact />
      {!ready || forecasts.length === 0 ? (
        <div className={s.empty}>
          <div><CalendarClock size={22} style={{ marginBottom: 8 }} /><br />
            Forecast unlocks after {daysLeft} more day{daysLeft !== 1 ? 's' : ''} of data and 20 mood check-ins.<br />Connect your calendar in Settings to speed it up.</div>
        </div>
      ) : (
        <div className={s.days}>
          {forecasts.map(f => {
            const color = COLOR[f.risk_label] ?? 'var(--brand)'
            const day = parseDay(f.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
            return (
              <div key={f.date} className={s.day}>
                <Ring pct={Math.round(f.risk * 100)} color={color} />
                <div style={{ minWidth: 0 }}>
                  <div className={s.dayName}>{day}</div>
                  {f.primary_stressor && <div className={s.dayDriver}>{f.primary_stressor}</div>}
                  <div className={s.dayPlan}><Lightbulb size={11} style={{ verticalAlign: -1, marginRight: 5, color }} />{f.recommendation ?? FALLBACK[f.risk_label]}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
