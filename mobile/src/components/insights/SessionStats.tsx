import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, T, rs, ICON } from '../../theme'
import type { SessionStats as Stats } from '../../lib/insights'
import Spark from './Spark'

const fmtN = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString('en-US'))
const fmtDur = (sec: number) => (sec >= 90 ? `${Math.round(sec / 60)}` : `${Math.round(sec)}`)
const durUnit = (sec: number) => (sec >= 90 ? 'min' : 's')

export default function SessionStats({ st }: { st: Stats }) {
  const longNoBreak = st.sinceBreakMin >= 50
  const items: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string; unit?: string; sub: string; color: string; spark: number[]; hot?: boolean }[] = [
    { icon: 'keypad-outline', label: 'Key presses', value: fmtN(st.keys), sub: 'count only, never which keys', color: '#3B5BDB', spark: st.sparks.keys },
    { icon: 'timer-outline', label: 'Active typing', value: fmtDur(st.typingSec), unit: durUnit(st.typingSec), sub: `${st.windows} windows of 15 s`, color: '#7048E8', spark: st.sparks.cps },
    { icon: 'speedometer-outline', label: 'Typing pace', value: st.avgCps ? st.avgCps.toFixed(1) : '—', unit: 'keys/s', sub: `peak ${st.peakCps.toFixed(1)} keys/s`, color: '#12B886', spark: st.sparks.cps },
    { icon: 'flash-outline', label: 'Typing bursts', value: fmtN(st.bursts), sub: `${st.minutes ? (st.bursts / st.minutes).toFixed(1) : 0} per minute`, color: '#1C7ED6', spark: st.sparks.bursts },
    { icon: 'pause-circle-outline', label: 'Pauses', value: fmtN(st.pauses), sub: `${st.minutes ? (st.pauses / st.minutes).toFixed(1) : 0} per minute`, color: '#F59F00', spark: st.sparks.pauses },
    {
      icon: 'cafe-outline', label: 'Since last break',
      value: st.noBreakInSpan ? `${Math.floor(st.minutes)}+` : `${Math.round(st.sinceBreakMin)}`, unit: 'min',
      sub: longNoBreak ? 'overdue — take a short break' : st.breaks ? `${st.breaks} break${st.breaks > 1 ? 's' : ''} taken` : 'no typing gap ≥ 3 min',
      color: longNoBreak ? Colors.red : Colors.accent, spark: [], hot: longNoBreak,
    },
  ]
  return (
    <View>
      <Text style={s.section}>WHAT WAS COLLECTED · LAST {Math.max(1, Math.round(st.minutes))} MIN</Text>
      <View style={s.grid}>
        {items.map(k => (
          <View key={k.label} style={[s.kpi, k.hot ? { borderColor: Colors.red + '88', backgroundColor: Colors.redDim } : null]}>
            <View style={s.top}>
              <View style={[s.ico, { backgroundColor: k.color + '24' }]}><Ionicons name={k.icon} size={ICON.sm} color={k.color} /></View>
              <Text style={s.lbl} numberOfLines={1}>{k.label}</Text>
            </View>
            <Text style={s.val} numberOfLines={1} adjustsFontSizeToFit>{k.value}{k.unit ? <Text style={s.unit}> {k.unit}</Text> : null}</Text>
            <Text style={s.sub} numberOfLines={2}>{k.sub}</Text>
            {k.spark.length > 1 ? <Spark values={k.spark} color={k.color} height={24} /> : <View style={{ height: 24 }} />}
          </View>
        ))}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  section: { fontFamily: T.mono, fontSize: 11, fontWeight: '600', letterSpacing: 1, color: Colors.hint, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi: { flexBasis: '48%', flexGrow: 1, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 0.5, borderColor: Colors.border, padding: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ico: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  lbl: { flex: 1, fontFamily: T.mono, fontSize: 10, fontWeight: '600', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  val: { fontFamily: T.mono, fontSize: rs(24), fontWeight: '300', color: Colors.text, marginTop: 8 },
  unit: { fontSize: 11, color: Colors.hint },
  sub: { fontSize: 11, color: Colors.muted, marginTop: 2, marginBottom: 6, minHeight: 28, lineHeight: 14 },
})
