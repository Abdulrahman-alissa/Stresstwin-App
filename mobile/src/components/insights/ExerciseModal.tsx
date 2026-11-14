import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Modal, Animated, Easing, Vibration } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, T, rs, ICON, MIN_TOUCH } from '../../theme'
import type { Action } from '../../lib/insights'

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
        { label: 'Neck rolls',     seconds: 20, hint: 'Drop an ear toward your shoulder, roll slowly side to side.', scale: 1.2 },
        { label: 'Shoulder rolls', seconds: 20, hint: 'Lift, roll back and down. Let the tension fall away.', scale: 1.2 },
        { label: 'Hands & wrists', seconds: 20, hint: 'Shake out your hands, open and close your fingers.', scale: 1.2 },
      ]
    case 'walk':
      return [{ label: 'Walk it off', seconds: 300, hint: 'Leave the phone behind. Water, stairs, or a window with a view.', scale: 1.1 }]
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
  const [paused, setPaused] = useState(false)
  const finished = elapsed >= total
  const doneFired = useRef(false)
  const scale = useRef(new Animated.Value(1)).current

  // current step from elapsed time
  let acc = 0, idx = 0
  for (let i = 0; i < steps.length; i++) { if (elapsed < acc + steps[i].seconds) { idx = i; break } acc += steps[i].seconds; idx = i }
  const step = steps[Math.min(idx, steps.length - 1)]
  const left = Math.max(0, acc + step.seconds - elapsed)

  useEffect(() => {
    if (paused || finished) return
    const iv = setInterval(() => setElapsed(e => Math.min(e + 1, total)), 1000)
    return () => clearInterval(iv)
  }, [paused, finished, total])

  // orb follows the phase: grows on inhale, holds, shrinks on exhale
  useEffect(() => {
    const dur = step.label === 'Hold' ? 250 : step.label === 'Inhale' || step.label === 'Exhale' ? step.seconds * 1000 : 700
    Animated.timing(scale, { toValue: finished ? 1 : step.scale, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start()
    if (action.kind === 'breathing' && !finished) { try { Vibration.vibrate(25) } catch {} }
  }, [idx, finished])

  useEffect(() => {
    if (finished && !doneFired.current) { doneFired.current = true; onDone() }
  }, [finished])

  const pct = total ? (elapsed / total) * 100 : 0
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.scrim}>
        <View style={s.card}>
          <TouchableOpacity style={s.close} onPress={onClose} accessibilityLabel="Close"><Ionicons name="close" size={ICON.lg} color={Colors.hint} /></TouchableOpacity>
          <Text style={s.kind}>{KIND_LABEL[action.kind] ?? 'Reset'}</Text>
          <Text style={s.title}>{action.title}</Text>

          <View style={s.orbWrap}>
            <View style={s.halo} />
            <Animated.View style={[s.orb, { transform: [{ scale }] }]}>
              {finished ? <Ionicons name="checkmark" size={ICON.xl + 8} color="#fff" /> : <Text style={s.orbTime}>{mmss(left)}</Text>}
            </Animated.View>
          </View>

          <Text style={s.phase}>{finished ? 'Well done' : step.label}</Text>
          <Text style={s.hint}>{finished ? 'Your score is measured again in about 5 minutes so you can see the effect.' : step.hint}</Text>

          <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` }]} /></View>
          <View style={s.meta}><Text style={s.metaTxt}>{mmss(elapsed)}</Text><Text style={s.metaTxt}>{mmss(total)}</Text></View>

          <View style={s.btns}>
            {!finished && (
              <TouchableOpacity style={s.btn} onPress={() => setPaused(p => !p)}>
                <Ionicons name={paused ? 'play' : 'pause'} size={ICON.md} color={Colors.muted} />
                <Text style={s.btnTxt}>{paused ? 'Resume' : 'Pause'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={onClose}>
              <Text style={[s.btnTxt, { color: '#fff' }]}>{finished ? 'Done' : 'End early'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(5,6,10,0.8)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 420, backgroundColor: Colors.surface, borderRadius: 24, borderWidth: 0.5, borderColor: Colors.border2, padding: 24, alignItems: 'center' },
  close: { position: 'absolute', top: 6, right: 6, width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  kind: { fontFamily: T.mono, fontSize: 10, fontWeight: '600', letterSpacing: 1.4, color: Colors.brand, textTransform: 'uppercase', marginTop: 4 },
  title: { fontSize: rs(19), fontWeight: '600', color: Colors.text, marginTop: 6, marginBottom: 14, textAlign: 'center' },
  orbWrap: { width: 210, height: 210, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  halo: { position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.border2 },
  orb: { width: 118, height: 118, borderRadius: 59, backgroundColor: Colors.brand, alignItems: 'center', justifyContent: 'center', shadowColor: Colors.brand, shadowOpacity: 0.6, shadowRadius: 28, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  orbTime: { fontFamily: T.mono, fontSize: 26, fontWeight: '300', color: '#fff' },
  phase: { fontSize: 19, fontWeight: '600', color: Colors.text },
  hint: { fontSize: 13, color: Colors.muted, lineHeight: 20, marginTop: 6, textAlign: 'center', minHeight: 42 },
  bar: { height: 4, width: '100%', backgroundColor: Colors.surface2, borderRadius: 2, overflow: 'hidden', marginTop: 16 },
  barFill: { height: '100%', backgroundColor: Colors.brand },
  meta: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 6 },
  metaTxt: { fontFamily: T.mono, fontSize: 10, color: Colors.hint },
  btns: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 18 },
  btn: { flex: 1, minHeight: MIN_TOUCH + 4, borderRadius: 12, borderWidth: 0.5, borderColor: Colors.border2, backgroundColor: Colors.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnPrimary: { backgroundColor: Colors.brand, borderColor: 'transparent' },
  btnTxt: { fontSize: 13, fontWeight: '600', color: Colors.muted },
})
