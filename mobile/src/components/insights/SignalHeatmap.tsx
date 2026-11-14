import { View, Text, StyleSheet } from 'react-native'
import { Colors, T, shared } from '../../theme'
import { SIGNALS, type MinuteBucket } from '../../lib/insights'

/** green → amber → red by how far a signal strays from the person's own normal. */
function cellColor(z: number | null) {
  if (z == null) return Colors.surface2
  const t = Math.min(Math.max(z / 3, 0), 1)
  const hue = Math.round(155 - 155 * t)
  return `hsla(${hue}, 72%, ${44 - 4 * t}%, ${0.18 + 0.74 * t})`
}

export default function SignalHeatmap({ buckets }: { buckets: MinuteBucket[] }) {
  const fmt = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const rows = [...SIGNALS.map(m => ({ key: m.key as string, label: m.short, color: m.color, get: (b: MinuteBucket) => b.z[m.key] })),
    { key: 'all', label: 'Overall', color: Colors.text, get: (b: MinuteBucket) => (b.strain == null ? null : (b.strain / 100) * 3) }]
  return (
    <View style={shared.card}>
      <Text style={shared.clbl}>Signal heatmap · minute by minute</Text>
      <Text style={s.sub}>Each square is one minute. Warmer = that signal strayed further from <Text style={{ fontStyle: 'italic' }}>your</Text> normal.</Text>
      {buckets.length === 0 ? <Text style={s.empty}>Collecting data…</Text> : (
        <>
          {rows.map(r => (
            <View key={r.key} style={s.row}>
              <View style={s.lblWrap}><View style={[s.dot, { backgroundColor: r.color }]} /><Text style={[s.lbl, r.key === 'all' && { color: Colors.text }]} numberOfLines={1}>{r.label}</Text></View>
              <View style={s.cells}>
                {buckets.map(b => <View key={b.t} style={[s.cell, { backgroundColor: cellColor(r.get(b)) }]} />)}
              </View>
            </View>
          ))}
          <View style={s.row}>
            <View style={s.lblWrap} />
            <View style={s.axis}>
              <Text style={s.axisTxt}>{fmt(buckets[0].t)}</Text>
              <Text style={s.axisTxt}>{fmt(buckets[buckets.length - 1].t)}</Text>
            </View>
          </View>
          <View style={s.legend}>
            <Text style={s.axisTxt}>calm</Text>
            <View style={s.ramp}>
              {[0, 0.25, 0.5, 0.75, 1].map(t => <View key={t} style={{ flex: 1, backgroundColor: cellColor(t * 3) }} />)}
            </View>
            <Text style={s.axisTxt}>strained</Text>
          </View>
        </>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  sub: { fontSize: 12, color: Colors.muted, lineHeight: 18, marginBottom: 12, marginTop: -4 },
  empty: { fontSize: 12, color: Colors.hint, paddingVertical: 20, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  lblWrap: { width: 70, flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  lbl: { fontFamily: T.mono, fontSize: 10, color: Colors.muted, textTransform: 'uppercase', flexShrink: 1 },
  cells: { flex: 1, flexDirection: 'row', gap: 1.5 },
  cell: { flex: 1, height: 20, borderRadius: 2 },
  axis: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  axisTxt: { fontFamily: T.mono, fontSize: 10, color: Colors.hint },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, alignSelf: 'flex-end' },
  ramp: { width: 90, height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
})
