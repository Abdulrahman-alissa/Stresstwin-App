import { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, T, shared, ICON, MIN_TOUCH } from '../../theme'
import { useAppStore } from '../../store/useAppStore'
import type { Action } from '../../lib/insights'
import ExerciseModal from './ExerciseModal'

type IconName = React.ComponentProps<typeof Ionicons>['name']
export const KIND_ICON: Record<Action['kind'], IconName> = {
  breathing: 'leaf-outline', eyes: 'eye-outline', walk: 'walk-outline', focus: 'notifications-off-outline', plan: 'calendar-outline', stretch: 'body-outline',
}
const TAG_COLOR: Record<Action['tag'], string> = { 'Do now': Colors.red, 'Next hour': Colors.brand, 'Plan ahead': Colors.amber }

/** Records a finished action with the score at that moment, so its effect can be measured later. */
export function completeAction(a: Action) {
  const st = useAppStore.getState()
  const before = st.trend.length ? st.trend[st.trend.length - 1].score : st.currentScore
  st.addReset({ id: a.id, kind: a.kind, title: a.title, at: Date.now(), scoreBefore: before })
}

export default function Playbook({ actions, limit, title = 'Prevention playbook', sub }: { actions: Action[]; limit?: number; title?: string; sub?: string }) {
  const [active, setActive] = useState<Action | null>(null)
  const resets = useAppStore(st => st.resets)
  const doneIds = new Set(resets.map(r => r.id))
  const list = limit ? actions.slice(0, limit) : actions

  const start = (a: Action) => { if (a.kind === 'plan') completeAction(a); else setActive(a) }

  return (
    <View style={shared.card}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text style={shared.clbl}>{title}</Text>
          <Text style={s.sub}>{sub ?? 'Ranked by your live signals and forecast. Small actions now prevent a spike later.'}</Text>
        </View>
        <Text style={s.count}>{actions.filter(a => doneIds.has(a.id)).length}/{actions.length}</Text>
      </View>
      {list.map(a => {
        const done = doneIds.has(a.id)
        const c = TAG_COLOR[a.tag]
        return (
          <View key={a.id} style={[s.action, done && { opacity: 0.5 }]}>
            <View style={[s.ico, { backgroundColor: c + '22' }]}><Ionicons name={KIND_ICON[a.kind]} size={ICON.lg} color={c} /></View>
            <View style={{ flex: 1 }}>
              <View style={s.tagRow}>
                <Text style={[s.tag, { color: c, backgroundColor: c + '1f' }]}>{a.tag.toUpperCase()}</Text>
                <Ionicons name="time-outline" size={11} color={Colors.hint} /><Text style={s.min}>{a.minutes} min</Text>
              </View>
              <Text style={s.aTitle}>{a.title}</Text>
              <Text style={s.why}>{a.why}</Text>
              <TouchableOpacity style={[s.btn, done && s.btnDone]} disabled={done} onPress={() => start(a)}>
                {done
                  ? <><Ionicons name="checkmark" size={ICON.md} color={Colors.accent} /><Text style={[s.btnTxt, { color: Colors.accent }]}>Done</Text></>
                  : <><Ionicons name={a.kind === 'plan' ? 'checkmark' : 'play'} size={ICON.md} color="#fff" /><Text style={s.btnTxt}>{a.kind === 'plan' ? 'Plan it' : 'Start'}</Text></>}
              </TouchableOpacity>
            </View>
          </View>
        )
      })}
      {active && <ExerciseModal action={active} onClose={() => setActive(null)} onDone={() => completeAction(active)} />}
    </View>
  )
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  sub: { fontSize: 12, color: Colors.muted, lineHeight: 18, marginTop: -4 },
  count: { fontFamily: T.mono, fontSize: 11, color: Colors.hint },
  action: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 14, backgroundColor: Colors.surface2, borderWidth: 0.5, borderColor: Colors.border, marginTop: 10 },
  ico: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  tag: { fontFamily: T.mono, fontSize: 9, fontWeight: '700', letterSpacing: 0.6, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  min: { fontFamily: T.mono, fontSize: 10, color: Colors.hint },
  aTitle: { fontSize: 15, fontWeight: '600', color: Colors.text },
  why: { fontSize: 12.5, color: Colors.muted, lineHeight: 19, marginTop: 4 },
  btn: { marginTop: 10, minHeight: MIN_TOUCH, borderRadius: 12, backgroundColor: Colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnDone: { backgroundColor: Colors.accentDim },
  btnTxt: { color: '#fff', fontSize: 14, fontWeight: '600' },
})
