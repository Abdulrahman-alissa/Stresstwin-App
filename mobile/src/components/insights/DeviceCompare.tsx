import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, shared, T, ICON, MIN_TOUCH } from '../../theme'
import { getDeviceStats } from '../../api/client'
import { getOrCreateDeviceId } from '../../services/deviceId'
import { METRIC_META, deltaPct, fmtMetric, fmtMinutes, type DeviceStatsResponse } from '../../lib/deviceStats'

const RANGES = [{ h: 1, l: '1 h' }, { h: 24, l: '24 h' }, { h: 168, l: '7 d' }]
const DOT = { sending: Colors.accent, stale: Colors.amber, inactive: Colors.hint } as const

function ago(iso: string | null) {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} d ago`
}

/** This device vs the average of every device that is sending data (counts/timings only). */
export default function DeviceCompare() {
  const [hours, setHours] = useState(24)
  const [data, setData] = useState<DeviceStatsResponse | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { getOrCreateDeviceId().then(setMe).catch(() => {}) }, [])

  const load = useCallback(async () => {
    try { setData(await getDeviceStats(hours)); setErr(false) }
    catch { setErr(true) }
    finally { setLoading(false) }
  }, [hours])

  useEffect(() => {
    setLoading(true); load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const mine = data?.devices.find(d => d.device_id === me)
  const avg = data?.average
  const others = (data?.devices.length ?? 0) - (mine ? 1 : 0)
  const rows = METRIC_META.filter(m => mine?.metrics[m.key] != null || avg?.metrics[m.key] != null)
  const range = RANGES.find(r => r.h === hours)?.l

  return (
    <View style={shared.card}>
      <View style={s.head}>
        <Text style={shared.clbl}>This device vs all devices</Text>
        <View style={s.seg}>
          {RANGES.map(r => (
            <TouchableOpacity key={r.h} onPress={() => setHours(r.h)} style={[s.segBtn, hours === r.h && s.segOn]} accessibilityRole="button" accessibilityLabel={`Last ${r.l}`}>
              <Text style={[s.segTxt, hours === r.h && { color: Colors.brand }]}>{r.l}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <Text style={s.sub}>What this phone collected, next to the average of every device that is sending data. Each device counts once.</Text>

      {loading && !data ? <ActivityIndicator color={Colors.brand} style={{ marginVertical: 24 }} />
      : err && !data ? (
        <View style={s.empty}>
          <Text style={s.emptyTxt}>Couldn't reach the server.</Text>
          <TouchableOpacity onPress={load} style={s.retry}><Text style={s.retryTxt}>Retry</Text></TouchableOpacity>
        </View>
      ) : !data || data.devices.length === 0 ? (
        <Text style={[s.emptyTxt, { paddingVertical: 20 }]}>No device has sent data in this period yet. Type with the StressTwin Keyboard — snapshots sync every ~10 minutes.</Text>
      ) : (
        <>
          {err && <Text style={s.warn}>Showing the last result — refresh failed.</Text>}
          <View style={s.boxes}>
            <View style={[s.box, { borderColor: Colors.brand }]}>
              <Text style={s.who}>This device</Text>
              <Text style={s.big}>{mine?.mean_score != null ? Math.round(mine.mean_score) : '—'}</Text>
              <Text style={s.small}>{mine ? `${mine.windows} windows · ${fmtMinutes(mine.active_minutes)}` : 'no data yet'}</Text>
            </View>
            <View style={s.box}>
              <Text style={s.who}>All devices avg</Text>
              <Text style={s.big}>{avg?.mean_score != null ? Math.round(avg.mean_score) : '—'}</Text>
              <Text style={s.small}>{avg?.devices_counted ?? 0} device{avg?.devices_counted === 1 ? '' : 's'}</Text>
            </View>
          </View>
          <Text style={s.small2}>Average stress index over the last {range}</Text>

          {!mine && <Text style={s.warn}>This device hasn't sent data in the last {range}. Showing other devices only.</Text>}
          {mine && others === 0 && <Text style={s.warn}>Only this device is sending data, so the average equals this device. Sign in on another device to compare.</Text>}

          <View style={s.thead}>
            <Text style={[s.th, { flex: 1.4, textAlign: 'left' }]}>Signal</Text>
            <Text style={s.th}>This</Text><Text style={s.th}>Avg</Text><Text style={s.th}>Diff</Text>
          </View>
          {rows.map(m => {
            const a = avg?.metrics[m.key] ?? null
            const v = mine?.metrics[m.key] ?? null
            const d = m.kind === 'count' ? null : deltaPct(v, a)
            const n = avg?.devices_reporting[m.key] ?? 0
            const hot = d != null && Math.abs(d) >= 25 && (avg?.devices_counted ?? 0) > 1
            return (
              <View key={m.key} style={s.tr}>
                <View style={{ flex: 1.4 }}>
                  <Text style={s.td}>{m.label}</Text>
                  <Text style={s.n}>{n} device{n === 1 ? '' : 's'}</Text>
                </View>
                <Text style={s.num}>{fmtMetric(v, m)}</Text>
                <Text style={s.num}>{fmtMetric(a, m)}</Text>
                <Text style={[s.num, { color: hot ? Colors.amber : Colors.hint }]}>{d == null ? '—' : `${d > 0 ? '+' : ''}${Math.round(d)}%`}</Text>
              </View>
            )
          })}

          <View style={{ marginTop: 12 }}>
            {data.devices.map(d => (
              <View key={d.device_id} style={s.dev}>
                <View style={[s.dot, { backgroundColor: DOT[d.status] }]} />
                <Ionicons name={d.platform === 'desktop' ? 'desktop-outline' : 'phone-portrait-outline'} size={ICON.sm} color={Colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={s.devName}>{d.display_name}{d.device_id === me ? ' · this device' : ''}</Text>
                  <Text style={s.n}>{d.windows} windows · last data {ago(d.last_snapshot_at)}</Text>
                </View>
                <Text style={s.devScore}>{d.mean_score != null ? Math.round(d.mean_score) : '—'}</Text>
              </View>
            ))}
          </View>
          <Text style={s.foot}>Counts and timings only. A signal is averaged over the devices that measure it.</Text>
        </>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  seg: { flexDirection: 'row', borderWidth: 0.5, borderColor: Colors.border2, borderRadius: 8, overflow: 'hidden' },
  segBtn: { minWidth: 40, minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segOn: { backgroundColor: Colors.brandDim },
  segTxt: { fontFamily: T.mono, fontSize: 11, color: Colors.muted },
  sub: { fontSize: 12, color: Colors.muted, lineHeight: 18, marginTop: 6, marginBottom: 12 },
  empty: { alignItems: 'center', paddingVertical: 16, gap: 8 },
  emptyTxt: { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19 },
  retry: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 18 },
  retryTxt: { color: Colors.brand, fontFamily: T.mono, fontSize: 12, fontWeight: '700' },
  warn: { fontSize: 12, color: Colors.amber, backgroundColor: Colors.amberDim, borderRadius: 8, padding: 10, marginTop: 10, lineHeight: 17 },
  boxes: { flexDirection: 'row', gap: 10 },
  box: { flex: 1, backgroundColor: Colors.surface2, borderRadius: 12, borderWidth: 0.5, borderColor: Colors.border, padding: 12 },
  who: { fontFamily: T.mono, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.hint },
  big: { fontFamily: T.mono, fontSize: 28, fontWeight: '300', color: Colors.text, marginTop: 4 },
  small: { fontSize: 11, color: Colors.muted, marginTop: 2 },
  small2: { fontFamily: T.mono, fontSize: 10, color: Colors.hint, marginTop: 8 },
  thead: { flexDirection: 'row', marginTop: 14, paddingBottom: 6 },
  th: { flex: 1, textAlign: 'right', fontFamily: T.mono, fontSize: 10, color: Colors.hint, textTransform: 'uppercase' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: Colors.border },
  td: { fontSize: 12, color: Colors.text },
  n: { fontFamily: T.mono, fontSize: 9, color: Colors.hint, marginTop: 1 },
  num: { flex: 1, textAlign: 'right', fontFamily: T.mono, fontSize: 12, color: Colors.text },
  dev: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderTopWidth: 0.5, borderTopColor: Colors.border },
  dot: { width: 8, height: 8, borderRadius: 4 },
  devName: { fontSize: 13, color: Colors.text },
  devScore: { fontFamily: T.mono, fontSize: 14, color: Colors.text, minWidth: 28, textAlign: 'right' },
  foot: { fontSize: 11, color: Colors.hint, marginTop: 10, lineHeight: 16 },
})
