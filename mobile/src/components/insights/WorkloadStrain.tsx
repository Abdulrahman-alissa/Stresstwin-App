import { useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Svg, { Rect, Polyline, Line, Text as SvgText } from 'react-native-svg'
import { Colors, T, shared } from '../../theme'
import type { MinuteBucket } from '../../lib/insights'

const H = 170, PAD_L = 4, PAD_B = 18, PAD_T = 8

export default function WorkloadStrain({ buckets }: { buckets: MinuteBucket[] }) {
  const [w, setW] = useState(0)
  const fmt = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const maxKeys = Math.max(...buckets.map(b => b.keys), 10)
  const innerW = Math.max(w - PAD_L, 0), innerH = H - PAD_B - PAD_T
  const bw = buckets.length ? innerW / buckets.length : 0
  const strainPts = buckets.map((b, i) => b.strain == null ? null : `${PAD_L + i * bw + bw / 2},${PAD_T + innerH - (b.strain / 100) * innerH}`).filter(Boolean).join(' ')
  return (
    <View style={shared.card}>
      <Text style={shared.clbl}>Workload vs. strain</Text>
      <Text style={s.sub}>Bars: key presses per minute. Line: how strained your signals were. Strain rising while workload stays flat is the early sign.</Text>
      <View style={s.legend}>
        <View style={s.lg}><View style={[s.sw, { backgroundColor: Colors.brand }]} /><Text style={s.lgTxt}>Keys</Text></View>
        <View style={s.lg}><View style={[s.sw, { backgroundColor: Colors.amber }]} /><Text style={s.lgTxt}>Strain</Text></View>
      </View>
      <View style={{ height: H }} onLayout={e => setW(e.nativeEvent.layout.width)}>
        {buckets.length === 0 ? <Text style={s.empty}>Collecting data…</Text> : w > 0 && (
          <Svg width={w} height={H}>
            {[0.25, 0.5, 0.75].map(f => <Line key={f} x1={0} x2={w} y1={PAD_T + innerH * f} y2={PAD_T + innerH * f} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />)}
            {buckets.map((b, i) => {
              const h = (b.keys / maxKeys) * innerH
              return <Rect key={b.t} x={PAD_L + i * bw + 1} y={PAD_T + innerH - h} width={Math.max(bw - 2, 1)} height={Math.max(h, b.keys ? 1 : 0)} rx={2} fill={Colors.brand} />
            })}
            {strainPts.length > 0 && <Polyline points={strainPts} fill="none" stroke={Colors.amber} strokeWidth={2.2} strokeLinejoin="round" />}
            <SvgText x={PAD_L} y={H - 4} fill={Colors.hint} fontSize={10}>{fmt(buckets[0].t)}</SvgText>
            <SvgText x={w} y={H - 4} fill={Colors.hint} fontSize={10} textAnchor="end">{fmt(buckets[buckets.length - 1].t)}</SvgText>
          </Svg>
        )}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  sub: { fontSize: 12, color: Colors.muted, lineHeight: 18, marginTop: -4, marginBottom: 8 },
  legend: { flexDirection: 'row', gap: 16, marginBottom: 6 },
  lg: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sw: { width: 8, height: 8, borderRadius: 4 },
  lgTxt: { fontFamily: T.mono, fontSize: 10, color: Colors.muted },
  empty: { fontSize: 12, color: Colors.hint, textAlign: 'center', paddingTop: 60 },
})
