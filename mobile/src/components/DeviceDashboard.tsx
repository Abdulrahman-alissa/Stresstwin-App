import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { formatDistanceToNow } from 'date-fns'
import { Colors, shared, T, ICON } from '../theme'
import { getDevices } from '../api/client'

interface Device {
  id: string
  device_id: string
  platform: 'desktop' | 'android' | 'ios'
  display_name: string
  keyboard_active: boolean
  last_snapshot_at: string | null
  last_sync_at: string | null
  status: 'sending' | 'stale' | 'inactive'
}

const PLATFORM_ICON: Record<Device['platform'], React.ComponentProps<typeof Ionicons>['name']> = {
  desktop: 'desktop-outline', android: 'phone-portrait-outline', ios: 'phone-portrait-outline',
}
const STATUS_COLOR: Record<Device['status'], string> = {
  sending: Colors.accent, stale: Colors.amber, inactive: Colors.hint,
}

function ago(iso: string | null) {
  if (!iso) return 'never'
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }) } catch { return iso }
}

export default function DeviceDashboard() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await getDevices()
      const seen = new Set<string>()
      // one row per physical device (a first-launch race can register the same device twice)
      setDevices((data as Device[]).filter(d => { const k = d.device_id || d.id; if (seen.has(k)) return false; seen.add(k); return true }))
    } catch {
      setDevices([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000) // keep dashboard fresh while viewed
    return () => clearInterval(t)
  }, [load])

  if (loading) {
    return (
      <View style={[shared.card, s.centered]}>
        <ActivityIndicator color={Colors.brand} />
      </View>
    )
  }

  const sendingCount = devices?.filter(d => d.status === 'sending').length ?? 0

  return (
    <View>
      <Text style={s.sectionTitle}>My Devices</Text>
      <View style={shared.card}>
        {!devices || devices.length === 0 ? (
          <Text style={s.empty}>No devices have reported data yet. Sign in on another device or enable the StressTwin Keyboard to get started.</Text>
        ) : (
          <>
            {devices.map(d => (
              <View key={d.device_id || d.id} style={s.deviceRow}>
                <View style={s.iconWrap}><Ionicons name={PLATFORM_ICON[d.platform]} size={ICON.lg} color={Colors.brand} /></View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={[s.statusDot, { backgroundColor: STATUS_COLOR[d.status] }]} />
                    <Text style={s.name}>{d.display_name}</Text>
                  </View>
                  {d.platform !== 'desktop' && (
                    <Text style={s.meta}>Keyboard: {d.keyboard_active ? 'Active' : 'Not active'}</Text>
                  )}
                  <Text style={s.meta}>Last snapshot: {ago(d.last_snapshot_at)}</Text>
                  <Text style={s.meta}>Last cloud sync: {ago(d.last_sync_at)}</Text>
                </View>
              </View>
            ))}
            <View style={s.divider} />
            <Text style={s.summary}>
              {devices.length} Total Device{devices.length === 1 ? '' : 's'} · {sendingCount} Currently Sending Data
            </Text>
          </>
        )}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  sectionTitle: { fontFamily: T.mono, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', color: Colors.hint, marginBottom: 8, marginTop: 8 },
  centered:     { alignItems: 'center', justifyContent: 'center', paddingVertical: 24 },
  empty:        { fontSize: 13, color: Colors.hint, lineHeight: 19 },
  deviceRow:    { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  iconWrap:     { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.brandDim, alignItems: 'center', justifyContent: 'center' },
  statusDot:    { width: 8, height: 8, borderRadius: 4 },
  name:         { fontSize: 14, fontWeight: '500', color: Colors.text },
  meta:         { fontFamily: T.mono, fontSize: 11, color: Colors.hint, marginTop: 2 },
  divider:      { height: 0.5, backgroundColor: Colors.border, marginVertical: 10 },
  summary:      { fontFamily: T.mono, fontSize: 11, color: Colors.muted, textAlign: 'center' },
})
