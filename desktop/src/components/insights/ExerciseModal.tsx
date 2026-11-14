import { useEffect, useMemo, useState } from 'react'
import { X, Pause, Play } from 'lucide-react'
import type { Action } from '../../lib/insights'
import s from './insights.module.css'

interface Step { label: string; seconds: number; hint: string; scale: number }

function buildSteps(kind: Action['kind']): Step[] {
  switch (kind) {
    case 'breathing':
      return Array.from({ length: 4 }, () => [
        { label: 'Inhale', seconds: 4, hint: 'Breathe in slowly through your nose.', scale: 1.45 },
        { label: 'Hold',   seconds: 7, hint: 'Hold gently. Keep your shoulders soft.', scale: 1.45 },
        { label: 'Exhale', seconds: 8, hint: 'Breathe out through your mouth, slow and long.', scale: 1 },
      ]).flat()
    case 'eyes':
      return [{ label: 'Look far away', seconds: 20, hint: 'Find something about 20 feet (6 m) away and let your eyes relax.', scale: 1.15 }]
    case 'stretch':
      return [
        { label: 'Neck rolls',      seconds: 20, hint: 'Drop your ear toward your shoulder, roll slowly side to side.', scale: 1.2 },
        { label: 'Shoulder rolls',  seconds: 20, hint: 'Lift, roll back and down. Let the tension fall away.', scale: 1.2 },
        { label: 'Hands & wrists',  seconds: 20, hint: 'Shake out your hands, open and close your fingers.', scale: 1.2 },
      ]
    case 'walk':
      return [{ label: 'Walk it off', seconds: 300, hint: 'Leave the screen behind. Water, stairs, or a window with a view.', scale: 1.1 }]
    case 'focus':
      return [{ label: 'Protected focus', seconds: 1200, hint: 'One task, notifications off. Breathe if you feel the urge to switch.', scale: 1.1 }]
    default:
      return [{ label: 'Take a moment', seconds: 60, hint: '', scale: 1.1 }]
  }
}

const KIND_LABEL: Record<string, string> = {
  breathing: 'Guided breathing', eyes: 'Eye reset', stretch: 'Body release', walk: 'Movement break', focus: 'Focus block',
}

export default function ExerciseModal({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: () => void }) {
  const steps = useMemo(() => buildSteps(action.kind), [action.kind])
  const total = steps.reduce((a, b) => a + b.seconds, 0)
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(true)
  const finished = elapsed >= total

  useEffect(() => {
    if (!running || finished) return
    const iv = setInterval(() => setElapsed(e => Math.min(total, e + 1)), 1000)
    return () => clearInterval(iv)
  }, [running, finished, total])

  useEffect(() => { if (finished) onDone() }, [finished])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  let acc = 0, idx = 0
  for (let i = 0; i < steps.length; i++) { if (elapsed < acc + steps[i].seconds) { idx = i; break } acc += steps[i].seconds; idx = i }
  const step = steps[idx]
  const inStep = Math.min(elapsed - acc, step.seconds)
  const left = Math.max(0, step.seconds - inStep)
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
  const scale = finished ? 1 : running ? step.scale : 1.05

  return (
    <div className={s.scrim} onClick={onClose} role="dialog" aria-modal="true">
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <button className={s.mClose} onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className={s.mKind}>{KIND_LABEL[action.kind] ?? 'Reset'}</div>
        <div className={s.mTitle}>{action.title}</div>

        <div className={s.orb}>
          <div className={s.orbHalo} />
          <div className={s.orbCore} style={{ transform: `scale(${scale})`, transitionDuration: `${running ? step.seconds : 0.6}s` }}>
            <span className={s.orbTime}>{finished ? '✓' : step.seconds >= 60 ? mmss(total - elapsed) : left}</span>
          </div>
        </div>

        <div className={s.mPhase}>{finished ? 'Well done' : step.label}</div>
        <div className={s.mHint}>
          {finished ? 'Notice how your body feels. Your signals will settle over the next few minutes.' : step.hint}
        </div>

        <div className={s.mBar}><div className={s.mBarFill} style={{ width: `${(elapsed / total) * 100}%` }} /></div>
        <div className={s.mMeta}><span>{mmss(elapsed)}</span><span>{mmss(total)}</span></div>

        <div className={s.mBtns}>
          {!finished && (
            <button className={s.mBtn} onClick={() => setRunning(r => !r)}>
              {running ? <><Pause size={12} style={{ verticalAlign: -1 }} /> Pause</> : <><Play size={12} style={{ verticalAlign: -1 }} /> Resume</>}
            </button>
          )}
          <button className={`${s.mBtn} ${s.mBtnPrimary}`} onClick={onClose}>{finished ? 'Done' : 'End early'}</button>
        </div>
      </div>
    </div>
  )
}
