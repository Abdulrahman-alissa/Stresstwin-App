import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, T, rs, ICON } from '../../theme'
import type { SignalReading } from '../../lib/insights'
import Spark from './Spark'

export default function SignalTiles({ readings }: { readings: SignalReading[] }) {
  return (
    <View>
      <Text style={s.section}>COLLECTED SIGNALS · VS. YOUR BASELINE</Text>
      <View style={s.grid}>
        {readings.map(r => {
          const hot = r.level === 'high' ? Colors.red : r.level === 'watch' ? Colors.amber : null
          const up = (r.deltaPct ?? 0) >= 0
          const m = r.meta
          const fmt = (v: number) => (v * m.scale).toFixed(m.digits)
          return (
            <View key={m.key} style={[s.tile, hot ? { borderColor: hot + '99' } : null]}>
              <View style={s.top}>
                <View style={[s.ico, { backgroundColor: m.color + '24' }]}><Ionicons name={m.icon as any} size={ICON.sm} color={m.color} /></View>
                <Text style={s.lbl} numberOfLines={1}>{m.label}</Text>
              </View>
              {r.hasData ? (
                <>
                  <View style={s.valRow}>
                    <Text style={s.val}>{fmt(r.current)}</Text>
                    <Text style={s.unit}>{m.unit}</Text>
                    {r.deltaPct != null && (
                      <View style={[s.delta, { backgroundColor: (hot ?? Colors.accent) + '22' }]}>
                        <Ionicons name={up ? 'arrow-up' : 'arrow-down'} size={10} color={hot ?? Colors.accent} />
                        <Text style={[s.deltaTxt, { color: hot ?? Colors.accent }]}>{Math.abs(Math.round(r.deltaPct))}%</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.base}>your avg {fmt(r.base)} {m.unit}</Text>
                  <Spark values={r.spark} color={m.color} height={30} base={r.base} />
                </>
              ) : (
                <Text style={s.none}>No data yet</Text>
              )}
            </View>
          )
        })}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  section: { fontFamily: T.mono, fontSize: 11, fontWeight: '600', letterSpacing: 1, color: Colors.hint, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexBasis: '48%', flexGrow: 1, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 0.6, borderColor: Colors.border, padding: 12, minHeight: 124 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ico: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  lbl: { flex: 1, fontFamily: T.mono, fontSize: 10, fontWeight: '600', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  valRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 8, flexWrap: 'wrap' },
  val: { fontFamily: T.mono, fontSize: rs(24), fontWeight: '300', color: Colors.text },
  unit: { fontFamily: T.mono, fontSize: 11, color: Colors.hint },
  delta: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, marginLeft: 'auto' },
  deltaTxt: { fontFamily: T.mono, fontSize: 10, fontWeight: '700' },
  base: { fontFamily: T.mono, fontSize: 10, color: Colors.hint, marginTop: 2, marginBottom: 6 },
  none: { fontSize: 12, color: Colors.hint, marginTop: 14 },
})
