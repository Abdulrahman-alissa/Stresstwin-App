import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { Wind, Eye, Footprints, Target, CalendarClock, Hand, Play, Check, Clock } from 'lucide-react'
import type { Action } from '../../lib/insights'
import ExerciseModal from './ExerciseModal'
import s from './insights.module.css'

const ICON: Record<Action['kind'], typeof Wind> = {
  breathing: Wind, eyes: Eye, walk: Footprints, focus: Target, plan: CalendarClock, stretch: Hand,
}

export default function Playbook({ actions, limit, title = 'Prevention playbook', sub }: { actions: Action[]; limit?: number; title?: string; sub?: string }) {
  const [active, setActive] = useState<Action | null>(null)
  const resets = useAppStore(st => st.resets)
  const done: Record<string, boolean> = Object.fromEntries(resets.map(r => [r.id, true]))
  const complete = (a: Action) => {
    const st = useAppStore.getState()
    const before = st.trend.length ? st.trend[st.trend.length - 1].score : st.currentScore
    st.addReset({ id: a.id, kind: a.kind, title: a.title, at: Date.now(), scoreBefore: before })
  }
  const list = limit ? actions.slice(0, limit) : actions

  const start = (a: Action) => {
    if (a.kind === 'plan') complete(a)
    else setActive(a)
  }

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.clbl}>{title}</div>
          <div className={s.csub}>{sub ?? 'Ranked by your live signals and forecast. Small actions now prevent a spike later.'}</div>
        </div>
        <span className={s.note}>{Object.values(done).filter(Boolean).length}/{actions.length} done</span>
      </div>
      <div className={s.actions}>
        {list.map(a => {
          const Icon = ICON[a.kind]
          const isDone = !!done[a.id]
          return (
            <div key={a.id} className={s.action} data-done={isDone}>
              <div className={s.aIcon} data-tag={a.tag}><Icon size={20} /></div>
              <div style={{ minWidth: 0 }}>
                <div className={s.aHead}>
                  <span className={s.aTitle}>{a.title}</span>
                  <span className={s.aTag}>{a.tag}</span>
                  <span className={s.note}><Clock size={10} />{a.minutes} min</span>
                </div>
                <div className={s.aWhy}>{a.why}</div>
              </div>
              <button className={s.aBtn} disabled={isDone} onClick={() => start(a)}>
                {isDone ? <><Check size={13} /> Done</> : a.kind === 'plan' ? <><Check size={13} /> Plan it</> : <><Play size={13} /> Start</>}
              </button>
            </div>
          )
        })}
      </div>
      {active && <ExerciseModal action={active} onClose={() => setActive(null)} onDone={() => complete(active)} />}
    </div>
  )
}
