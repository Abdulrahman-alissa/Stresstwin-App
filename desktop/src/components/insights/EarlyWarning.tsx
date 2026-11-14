import { ShieldCheck, Activity, AlertTriangle, BellRing, Clock, TrendingUp } from 'lucide-react'
import type { EarlyWarning as EW } from '../../lib/insights'
import s from './insights.module.css'

const ICON = { calm: ShieldCheck, watch: Activity, warning: AlertTriangle, alert: BellRing }

export default function EarlyWarning({ ew, threshold }: { ew: EW; threshold: number }) {
  const Icon = ICON[ew.level]
  const slope = ew.slopePerMin
  return (
    <section className={s.ew} data-level={ew.level} aria-live="polite">
      <div className={s.ewIcon}><Icon size={24} /></div>

      <div>
        <div className={s.clbl} style={{ marginBottom: 4 }}>Early warning</div>
        <div className={s.ewTitle}>{ew.title}</div>
        <p className={s.ewDetail}>{ew.detail}</p>
        {ew.drivers.length > 0 && (
          <div className={s.chips}>
            {ew.drivers.map(d => (
              <span key={d.meta.key} className={`${s.chip} ${s.chipHot}`}>
                {d.meta.label}
                {d.deltaPct != null && ` ${d.deltaPct >= 0 ? '+' : ''}${Math.round(d.deltaPct)}%`}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={s.meter}>
        <div className={s.meterTop}>
          <span className={s.clbl}>Pressure</span>
          <span className={s.meterVal}>{ew.pressure}<small>/100</small></span>
        </div>
        <div className={s.meterTrack} role="meter" aria-valuenow={ew.pressure} aria-valuemin={0} aria-valuemax={100}>
          <div className={s.meterMask} style={{ width: `${100 - ew.pressure}%` }} />
          <div className={s.meterDot} style={{ left: `${Math.min(Math.max(ew.pressure, 2), 98)}%` }} />
        </div>
        <div className={s.meterScale}><span>calm</span><span>threshold {threshold}</span><span>tipping</span></div>
        <div className={s.eta}>
          {ew.minutesToThreshold != null
            ? <><Clock size={12} /> ~<b>{Math.max(1, Math.round(ew.minutesToThreshold))} min</b> to threshold at this pace</>
            : <><TrendingUp size={12} /> {slope > 0.1 ? 'Rising' : slope < -0.1 ? 'Falling' : 'Flat'} {slope >= 0 ? '+' : ''}{slope.toFixed(1)} pts/min</>}
        </div>
      </div>
    </section>
  )
}
