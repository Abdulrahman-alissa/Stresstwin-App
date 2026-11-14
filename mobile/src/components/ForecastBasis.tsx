import { View, Text, StyleSheet } from 'react-native'
import { useAppStore } from '../store/useAppStore'
import { Colors, T } from '../theme'

function Bar({ label, have, need }: { label: string; have: number; need: number }) {
  const pct = Math.max(0, Math.min(100, (have / Math.max(1, need)) * 100))
  const done = have >= need
  return (
    <View style={{ marginTop: 10 }}>
      <View style={s.row}>
        <Text style={s.lbl}>{label}</Text>
        <Text style={[s.val, done && { color: Colors.accent }]}>{Math.min(have, need)} / {need}{done ? ' ✓' : ''}</Text>
      </View>
      <View style={s.track}><View style={[s.fill, { width: `${pct}%` as `${number}%`, backgroundColor: done ? Colors.accent : Colors.brand }]} /></View>
    </View>
  )
}

/** Real progress toward the forecast model (days of data + mood check-ins). No made-up confidence number. */
export default function ForecastBasis() {
  const b = useAppStore(st => st.forecastBasis)
  if (!b) return null
  return (
    <View>
      <Bar label="Days of data" have={b.days_of_data} need={b.days_needed} />
      <Bar label="Mood check-ins" have={b.checkins_count} need={b.checkins_needed} />
    </View>
  )
}

/** Shown when the forecast is the starter estimate (everyone's weekday pattern + your level + calendar). */
export function StarterNote({ compact = false }: { compact?: boolean }) {
  const b = useAppStore(st => st.forecastBasis)
  if (!b || b.source !== 'global') return null
  return (
    <View style={s.note}>
      <Text style={s.noteHead}>Starter forecast</Text>
      <Text style={s.noteBody}>
        Built from the weekday patterns of {b.cohort_size && b.cohort_size > 0 ? `${b.cohort_size}+ people` : 'everyone using StressTwin'}, your own recent level and your calendar. It is an estimate, not your personal model — that unlocks after {b.days_needed} days of data and {b.checkins_needed} check-ins.
      </Text>
      {!compact && <ForecastBasis />}
    </View>
  )
}

export function basisText(b: { days_of_data: number; checkins_count: number } | null) {
  if (!b) return ''
  return `Based on ${b.days_of_data} day${b.days_of_data === 1 ? '' : 's'} of data · ${b.checkins_count} check-in${b.checkins_count === 1 ? '' : 's'}`
}

const s = StyleSheet.create({
  note:  { backgroundColor: Colors.brandDim, borderRadius: 10, padding: 12, marginBottom: 12 },
  noteHead: { fontFamily: T.mono, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: Colors.brand },
  noteBody: { fontSize: 12, color: Colors.muted, lineHeight: 18, marginTop: 4 },
  row:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  lbl:   { fontFamily: T.mono, fontSize: 11, color: Colors.muted },
  val:   { fontFamily: T.mono, fontSize: 11, color: Colors.text, fontWeight: '600' },
  track: { height: 5, borderRadius: 3, backgroundColor: Colors.surface2, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: 3 },
})
