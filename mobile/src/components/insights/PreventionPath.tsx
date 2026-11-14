import { useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Polyline, Line, Text as SvgText } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { Colors, T, rs, ICON, MIN_TOUCH } from '../../theme'
import { useAppStore } from '../../store/useAppStore'
import { projectScenarios, type Action, type EarlyWarning, type ExerciseKind } from '../../lib/insights'
import ExerciseModal from './ExerciseModal'
import { completeAction } from './Playbook'

const H = 230, PL = 6, PR = 8, PT = 22, PB = 22
const X0 = -15, X1 = 30, HORIZON = 30

export default function PreventionPath({ score, threshold, ew, actions }: { score: number; threshold: number; ew: EarlyWarning; actions: Action[] }) {
  const trend = useAppStore(st => st.trend)
  const resets = useAppStore(st => st.resets)
  const [w, setW] = useState(0)
  const [active, setActive] = useState<Action | null>(null)

  const best = actions.find(a => a.kind !== 'plan' && !resets.some(r => r.id === a.id)) ?? actions.find(a => a.kind !== 'plan')
  const kind = (best?.kind ?? 'breathing') as ExerciseKind
  const sc = useMemo(() => projectScenarios(score, ew.slopePerMin, threshold, kind, HORIZON), [score, ew.slopePerMin, threshold, kind])

  const now = Date.now()
  const past = trend.slice(-30).map(t => ({ m: (new Date(t.at).getTime() - now) / 60000, v: t.score })).filter(p => p.m >= X0 && p.m <= 0)
  const iw = Math.max(w - PL - PR, 0), ih = H - PT - PB
  const x = (m: number) => PL + ((m - X0) / (X1 - X0)) * iw
  const y = (v: number) => PT + ih * (1 - v / 100)
  const line = (pts: { m: number; v: number }[]) => pts.map(p => `${x(p.m)},${y(p.v)}`).join(' ')

  const effects = resets.filter(r => r.kind !== 'plan').map(r => {
    const later = trend.find(t => new Date(t.at).getTime() >= r.at + 4 * 60000)
    return { r, after: later ? later.score : null }
  })

  const without = sc.crossNothing != null
    ? (sc.crossNothing < 1 ? 'You are already at the threshold' : `Crosses threshold in ~${Math.round(sc.crossNothing)} min`)
    : ew.slopePerMin > 0.15 ? `Peaks near ${Math.round(sc.peakNothing)}` : 'Stays in a steady range'
  const withReset = sc.crossReset == null
    ? `Stays under threshold (peak ~${Math.round(sc.peakReset)})`
    : `Delays threshold by ~${Math.max(1, sc.crossReset - Math.round(sc.crossNothing ?? 0))} min`
  const saved = Math.max(0, Math.round(sc.peakNothing - sc.peakReset))
  const showEta = sc.crossNothing != null && sc.crossNothing > 0.5 && sc.crossNothing <= HORIZON

  return (
    <View style={s.card}>
      <Text style={s.kicker}>PREVENTION PATH · NEXT {HORIZON} MIN</Text>
      <Text style={s.sub}>Two futures from where you are right now. The earlier you reset, the less it takes.</Text>
      <View style={s.legend}>
        <View style={s.lg}><View style={[s.sw, { backgroundColor: Colors.brand }]} /><Text style={s.lgTxt}>Measured</Text></View>
        <View style={s.lg}><View style={[s.sw, { backgroundColor: Colors.red }]} /><Text style={s.lgTxt}>If nothing changes</Text></View>
        <View style={s.lg}><View style={[s.sw, { backgroundColor: Colors.accent }]} /><Text style={s.lgTxt}>If you reset now</Text></View>
      </View>

      <View style={{ height: H }} onLayout={e => setW(e.nativeEvent.layout.width)}>
        {w > 0 && (
          <Svg width={w} height={H}>
            <Defs>
              <LinearGradient id="gp" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={Colors.brand} stopOpacity={0.45} /><Stop offset="1" stopColor={Colors.brand} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x={PL} y={y(100)} width={iw} height={y(threshold) - y(100)} fill={Colors.red} fillOpacity={0.08} />
            <Rect x={PL} y={y(50)} width={iw} height={y(0) - y(50)} fill={Colors.accent} fillOpacity={0.05} />
            {[0, 25, 50, 75, 100].map(v => <Line key={v} x1={PL} x2={PL + iw} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />)}
            {past.length > 1 && <Path d={`M ${x(past[0].m)} ${y(0)} L ${line(past).replace(/ /g, ' L ')} L ${x(past[past.length - 1].m)} ${y(0)} Z`} fill="url(#gp)" />}
            {past.length > 1 && <Polyline points={line(past)} fill="none" stroke={Colors.brand} strokeWidth={2.4} strokeLinejoin="round" />}

            <Line x1={PL} x2={PL + iw} y1={y(threshold)} y2={y(threshold)} stroke={Colors.red} strokeWidth={1.2} strokeDasharray="5 4" />
            <SvgText x={PL + 4} y={y(threshold) - 4} fill={Colors.red} fontSize={10}>threshold {threshold}</SvgText>
            <Line x1={x(0)} x2={x(0)} y1={PT} y2={PT + ih} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
            <SvgText x={x(0) + 4} y={PT + 10} fill={Colors.muted} fontSize={10}>now</SvgText>
            {showEta && (
              <>
                <Line x1={x(sc.crossNothing!)} x2={x(sc.crossNothing!)} y1={PT} y2={PT + ih} stroke={Colors.red} strokeOpacity={0.55} strokeWidth={1} />
                <SvgText x={x(sc.crossNothing!)} y={PT - 6} fill="#FF6B6B" fontSize={10} textAnchor="middle">~{Math.round(sc.crossNothing!)} min</SvgText>
              </>
            )}
            {resets.filter(r => r.kind !== 'plan' && (r.at - now) / 60000 >= X0).map(r => (
              <Line key={r.id} x1={x((r.at - now) / 60000)} x2={x((r.at - now) / 60000)} y1={PT} y2={PT + ih} stroke={Colors.accent} strokeDasharray="2 3" strokeWidth={1} />
            ))}
            <Polyline points={line(sc.points.map(p => ({ m: p.m, v: p.nothing })))} fill="none" stroke={Colors.red} strokeWidth={2.2} strokeDasharray="6 4" strokeLinejoin="round" />
            <Polyline points={line(sc.points.map(p => ({ m: p.m, v: p.reset })))} fill="none" stroke={Colors.accent} strokeWidth={2.6} strokeLinejoin="round" />
            {[-15, -10, -5, 0, 10, 20, 30].map(m => (
              <SvgText key={m} x={x(m)} y={H - 6} fill={Colors.hint} fontSize={10} textAnchor={m === X0 ? 'start' : m === X1 ? 'end' : 'middle'}>{m === 0 ? 'now' : `${m > 0 ? '+' : ''}${m}m`}</SvgText>
            ))}
          </Svg>
        )}
      </View>

      <View style={s.compare}>
        <View style={[s.cmp, { borderColor: Colors.red + '59' }]}>
          <Ionicons name="trending-up" size={ICON.md} color="#FF6B6B" />
          <View style={{ flex: 1 }}><Text style={s.cmpT}>Without a reset</Text><Text style={s.cmpS}>{without}</Text></View>
        </View>
        <View style={[s.cmp, { borderColor: Colors.accent + '59' }]}>
          <Ionicons name="trending-down" size={ICON.md} color={Colors.accent} />
          <View style={{ flex: 1 }}><Text style={s.cmpT}>With a {best ? best.minutes : 2}-min reset</Text><Text style={s.cmpS}>{withReset}</Text></View>
        </View>
      </View>

      {best && (
        <View style={s.next}>
          <Text style={s.kicker}>BEST NEXT STEP</Text>
          <Text style={s.nextT}>{best.title}</Text>
          <Text style={s.nextW}>{best.why}</Text>
          <Text style={s.nextM}>{best.minutes} min{saved > 0 ? ` · est. ${saved} pts lower by +${HORIZON} min` : ''}</Text>
          <TouchableOpacity style={s.start} onPress={() => setActive(best)}>
            <Ionicons name="play" size={ICON.md} color="#fff" /><Text style={s.startTxt}>Start now</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={[s.kicker, { marginTop: 16 }]}>YOUR RESULTS (MEASURED)</Text>
      {effects.length === 0 ? (
        <Text style={s.none}>Finish a reset and we’ll compare your score before and ~5 minutes after.</Text>
      ) : effects.map(({ r, after }) => (
        <View key={r.id} style={s.result}>
          <Ionicons name="checkmark-circle" size={ICON.md} color={Colors.accent} />
          <Text style={s.resName} numberOfLines={1}>{r.title}</Text>
          <Text style={[s.resVal, after != null && after < r.scoreBefore && { color: Colors.accent }]}>
            {Math.round(r.scoreBefore)} → {after != null ? `${Math.round(after)} (${after - r.scoreBefore <= 0 ? '' : '+'}${Math.round(after - r.scoreBefore)})` : 'measuring…'}
          </Text>
        </View>
      ))}

      <View style={s.foot}>
        <Ionicons name="information-circle-outline" size={ICON.sm} color={Colors.hint} />
        <Text style={s.footTxt}>Dashed lines are estimates: they extend your current trend and assume a reset like this lowers the index by ~{sc.relief} points and slows the climb for ~15 minutes. Your measured results replace the guess as you use it.</Text>
      </View>

      {active && <ExerciseModal action={active} onClose={() => setActive(null)} onDone={() => completeAction(active)} />}
    </View>
  )
}

const s = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: 18, borderWidth: 0.8, borderColor: Colors.brandMid, padding: 16 },
  kicker: { fontFamily: T.mono, fontSize: 10, fontWeight: '600', letterSpacing: 1.1, color: Colors.hint },
  sub: { fontSize: 12.5, color: Colors.muted, lineHeight: 19, marginTop: 6 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: 10, marginBottom: 4 },
  lg: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sw: { width: 8, height: 8, borderRadius: 4 },
  lgTxt: { fontFamily: T.mono, fontSize: 10, color: Colors.muted },
  compare: { gap: 8, marginTop: 12 },
  cmp: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12, borderWidth: 0.7, backgroundColor: Colors.surface2 },
  cmpT: { fontSize: 13, fontWeight: '600', color: Colors.text },
  cmpS: { fontSize: 12, color: Colors.muted, marginTop: 2, lineHeight: 17 },
  next: { marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: Colors.surface2, borderWidth: 0.7, borderColor: Colors.brandMid },
  nextT: { fontSize: rs(16), fontWeight: '600', color: Colors.text, marginTop: 6 },
  nextW: { fontSize: 12.5, color: Colors.muted, lineHeight: 19, marginTop: 4 },
  nextM: { fontFamily: T.mono, fontSize: 11, color: Colors.hint, marginTop: 8 },
  start: { marginTop: 12, minHeight: MIN_TOUCH + 4, borderRadius: 12, backgroundColor: Colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  startTxt: { color: '#fff', fontSize: 15, fontWeight: '600' },
  none: { fontSize: 12, color: Colors.muted, lineHeight: 18, marginTop: 6 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: Colors.border, marginTop: 4 },
  resName: { flex: 1, fontSize: 12.5, color: Colors.muted },
  resVal: { fontFamily: T.mono, fontSize: 11, color: Colors.muted },
  foot: { flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'flex-start' },
  footTxt: { flex: 1, fontSize: 11, color: Colors.hint, lineHeight: 17 },
})
