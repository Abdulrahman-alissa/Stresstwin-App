import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, T, rs, ICON } from '../../theme'
import type { EarlyWarning, WarningLevel } from '../../lib/insights'

const LEVEL: Record<WarningLevel, { color: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  calm:    { color: Colors.accent, icon: 'shield-checkmark' },
  watch:   { color: Colors.amber,  icon: 'pulse' },
  warning: { color: '#FF8A3D',      icon: 'warning' },
  alert:   { color: Colors.red,    icon: 'notifications' },
}

export default function EarlyWarningCard({ ew, threshold, waiting = false }: { ew: EarlyWarning; threshold: number; waiting?: boolean }) {
  if (waiting) {
    return (
      <View style={[s.card, { borderColor: Colors.border2, backgroundColor: Colors.surface }]}>
        <View style={s.top}>
          <View style={[s.icon, { backgroundColor: Colors.surface2 }]}><Ionicons name="hourglass-outline" size={ICON.lg} color={Colors.hint} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.kicker}>EARLY WARNING</Text>
            <Text style={s.title}>Learning your rhythm</Text>
          </View>
        </View>
        <Text style={s.detail}>Warnings start once a few minutes of your typing and movement have been measured. Until then there is nothing to compare against.</Text>
      </View>
    )
  }
  const L = LEVEL[ew.level]
  const slope = ew.slopePerMin
  return (
    <View style={[s.card, { borderColor: L.color + '66', backgroundColor: L.color + '14' }]} accessibilityLiveRegion="polite">
      <View style={s.top}>
        <View style={[s.icon, { backgroundColor: L.color + '26' }]}><Ionicons name={L.icon} size={ICON.lg} color={L.color} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>EARLY WARNING</Text>
          <Text style={s.title}>{ew.title}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[s.pressure, { color: L.color }]}>{ew.pressure}<Text style={s.pressureOf}>/100</Text></Text>
          <Text style={s.kicker}>PRESSURE</Text>
        </View>
      </View>
      <Text style={s.detail}>{ew.detail}</Text>

      <View style={s.track}>
        <View style={s.trackGrad}>
          <View style={{ flex: 55, backgroundColor: Colors.accent }} />
          <View style={{ flex: 25, backgroundColor: Colors.amber }} />
          <View style={{ flex: 20, backgroundColor: Colors.red }} />
        </View>
        <View style={[s.mask, { width: `${100 - ew.pressure}%` }]} />
        <View style={[s.dot, { left: `${clamp(ew.pressure, 2, 98)}%`, borderColor: L.color }]} />
      </View>
      <View style={s.scale}><Text style={s.scaleTxt}>calm</Text><Text style={s.scaleTxt}>threshold {threshold}</Text><Text style={s.scaleTxt}>tipping</Text></View>

      <View style={s.foot}>
        <Ionicons name={ew.minutesToThreshold != null ? 'time-outline' : slope < -0.1 ? 'trending-down' : 'trending-up'} size={ICON.sm} color={Colors.muted} />
        <Text style={s.eta}>
          {ew.minutesToThreshold != null
            ? <>~<Text style={{ color: L.color, fontWeight: '700' }}>{Math.max(1, Math.round(ew.minutesToThreshold))} min</Text> to threshold at this pace</>
            : `${slope > 0.1 ? 'Rising' : slope < -0.1 ? 'Falling' : 'Flat'} ${slope >= 0 ? '+' : ''}${slope.toFixed(1)} pts/min`}
        </Text>
      </View>
      {ew.drivers.length > 0 && (
        <View style={s.chips}>
          {ew.drivers.map(d => (
            <View key={d.meta.key} style={[s.chip, { borderColor: L.color + '70', backgroundColor: L.color + '18' }]}>
              <Text style={[s.chipTxt, { color: L.color }]}>{d.meta.label}{d.deltaPct != null ? ` ${d.deltaPct >= 0 ? '+' : ''}${Math.round(d.deltaPct)}%` : ''}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b)

const s = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 0.8, padding: 16 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: T.mono, fontSize: 10, fontWeight: '600', letterSpacing: 1, color: Colors.hint },
  title: { fontSize: rs(16), fontWeight: '600', color: Colors.text, marginTop: 2 },
  pressure: { fontFamily: T.mono, fontSize: rs(26), fontWeight: '300' },
  pressureOf: { fontSize: 11, color: Colors.hint },
  detail: { fontSize: 13, color: Colors.muted, lineHeight: 20, marginTop: 12 },
  track: { height: 8, borderRadius: 4, marginTop: 14, overflow: 'visible', justifyContent: 'center' },
  trackGrad: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', borderRadius: 4, overflow: 'hidden', opacity: 0.9 },
  mask: { position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: Colors.surface2, opacity: 0.88, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  dot: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.text, borderWidth: 3, marginLeft: -8 },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  scaleTxt: { fontFamily: T.mono, fontSize: 10, color: Colors.hint },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  eta: { fontFamily: T.mono, fontSize: 12, color: Colors.muted, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chip: { borderWidth: 0.6, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  chipTxt: { fontFamily: T.mono, fontSize: 11, fontWeight: '600' },
})
