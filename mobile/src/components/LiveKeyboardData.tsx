/**
 * LiveKeyboardData
 * ─────────────────
 * Live view of what the StressTwin keyboard has measured on this device.
 * Shows AGGREGATE numbers only (speed, rhythm, pauses, correction rate) taken
 * from the 15-second snapshots in the local store. The keyboard never records
 * which keys were pressed, so there is no text to show here — by design.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TextInput } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, shared, T, rs, ICON, MIN_TOUCH } from '../theme'
import { getKeyboardStatus, pullNativeSnapshots, KeyboardStatus } from '../services/keyboardBridge'
import { getRecentSnapshots, subscribeSnapshots, countPending, FeatureSnapshot } from '../services/localFeatureStore'

const POLL_MS = 5_000       // how often we ask the native layer for finished snapshots
const LIVE_WINDOW_MS = 45_000 // a snapshot newer than this counts as "live"

type IconName = React.ComponentProps<typeof Ionicons>['name']

function fmt(n: number | null | undefined, digits = 1) {
  return n == null || Number.isNaN(n) ? '—' : n.toFixed(digits)
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return null
  const max = Math.max(...values, 0.1)
  return (
    <View style={s.spark}>
      {values.map((v, i) => (
        <View
          key={i}
          style={[
            s.sparkBar,
            { height: (Math.max((v / max) * 100, 6) + '%') as `${number}%`, opacity: 0.35 + (0.65 * (i + 1)) / values.length },
          ]}
        />
      ))}
    </View>
  )
}

function Tile({ icon, label, value, unit }: { icon: IconName; label: string; value: string; unit?: string }) {
  return (
    <View style={s.tile}>
      <View style={s.tileHead}>
        <Ionicons name={icon} size={ICON.sm} color={Colors.brand} />
        <Text style={s.tileLbl} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={s.tileVal} numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {unit ? <Text style={s.tileUnit}> {unit}</Text> : null}
      </Text>
    </View>
  )
}

export default function LiveKeyboardData() {
  const [snaps, setSnaps] = useState<FeatureSnapshot[]>([])
  const [pending, setPending] = useState(0)
  const [status, setStatus] = useState<KeyboardStatus | null>(null)
  const [now, setNow] = useState(Date.now())
  const [testText, setTestText] = useState('') // local-only scratch field, never stored or sent
  const mounted = useRef(true)

  const reload = useCallback(async () => {
    try {
      const [rows, n] = await Promise.all([getRecentSnapshots(20), countPending()])
      if (!mounted.current) return
      setSnaps(rows)
      setPending(n)
    } catch { /* store not ready yet */ }
  }, [])

  useEffect(() => {
    mounted.current = true
    getKeyboardStatus().then(st => mounted.current && setStatus(st))
    reload()
    const unsub = subscribeSnapshots(reload)
    const poll = setInterval(() => { pullNativeSnapshots().then(reload) }, POLL_MS)
    const tick = setInterval(() => setNow(Date.now()), 1000) // keeps "x s ago" moving
    return () => { mounted.current = false; unsub(); clearInterval(poll); clearInterval(tick) }
  }, [reload])

  const latest = snaps[0]
  const ageMs = latest ? now - new Date(latest.window_start).getTime() - (latest.session_duration ?? 15) * 1000 : null
  const isLive = ageMs != null && ageMs < LIVE_WINDOW_MS
  const ageSec = ageMs != null ? Math.max(0, Math.round(ageMs / 1000)) : null

  const chip = isLive
    ? { txt: 'Receiving', color: Colors.accent, bg: Colors.accentDim }
    : latest
      ? { txt: 'Idle', color: Colors.amber, bg: Colors.amberDim }
      : { txt: 'Waiting', color: Colors.hint, bg: Colors.surface2 }

  return (
    <View>
      <Text style={s.sectionTitle}>Live typing data</Text>
      <View style={shared.card}>
        <View style={s.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.headTitle}>StressTwin Keyboard</Text>
            <Text style={s.headSub} numberOfLines={2}>
              {status && !status.available
                ? 'Native keyboard not in this build'
                : status && !status.installed
                  ? 'Keyboard not enabled yet — turn it on in Settings'
                  : ageSec != null
                    ? `Last window ${ageSec}s ago · ${snaps.length} recent`
                    : 'Type with the StressTwin Keyboard to see data'}
            </Text>
          </View>
          <View style={[s.chip, { backgroundColor: chip.bg }]}>
            <View style={[s.chipDot, { backgroundColor: chip.color }]} />
            <Text style={[s.chipTxt, { color: chip.color }]}>{chip.txt}</Text>
          </View>
        </View>

        {latest ? (
          <>
            <View style={s.grid}>
              <Tile icon="speedometer-outline"  label="Speed"       value={fmt(latest.typing_speed_cps)}        unit="keys/s" />
              <Tile icon="timer-outline"        label="Key interval" value={fmt(latest.inter_key_interval_ms, 0)} unit="ms" />
              <Tile icon="backspace-outline"    label="Backspace"   value={fmt((latest.backspace_rate ?? NaN) * 100, 0)} unit="%" />
              <Tile icon="create-outline"       label="Corrections" value={fmt((latest.correction_rate ?? NaN) * 100, 0)} unit="%" />
              <Tile icon="pause-circle-outline" label="Pauses"      value={fmt(latest.pause_frequency)}         unit="/min" />
              <Tile icon="flash-outline"        label="Bursts"      value={fmt(latest.typing_bursts, 0)} />
              <Tile icon="hand-left-outline"    label="Interruptions" value={fmt(latest.typing_interruptions, 0)} />
              <Tile icon="keypad-outline"       label="Key presses" value={fmt(latest.char_count, 0)}           unit="count" />
            </View>

            <Text style={s.subhead}>Typing speed · last {Math.min(snaps.length, 20)} windows</Text>
            <Sparkline values={[...snaps].reverse().map(x => x.typing_speed_cps ?? 0)} />
          </>
        ) : (
          <Text style={s.empty}>
            No windows yet. Every 15 seconds of typing with the StressTwin Keyboard produces one set of numbers here.
          </Text>
        )}

        <View style={s.footRow}>
          <Ionicons name="cloud-upload-outline" size={ICON.sm} color={Colors.muted} />
          <Text style={s.footTxt}>
            {pending} window{pending === 1 ? '' : 's'} waiting to sync · uploads every 10 min
          </Text>
        </View>

        <Text style={s.subhead}>Try it</Text>
        <TextInput
          style={s.input}
          value={testText}
          onChangeText={setTestText}
          placeholder="Switch to StressTwin Keyboard and type here…"
          placeholderTextColor={Colors.hint}
          multiline
        />

        <View style={s.privacyRow}>
          <Ionicons name="lock-closed-outline" size={ICON.sm} color={Colors.accent} />
          <Text style={s.privacyTxt}>Only counts and timings are shown — never the characters you type.</Text>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  sectionTitle: { fontFamily: T.mono, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', color: Colors.hint, marginBottom: 8, marginTop: 8 },
  headRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  headTitle: { fontSize: rs(14), fontWeight: '600', color: Colors.text },
  headSub:   { fontFamily: T.mono, fontSize: 11, color: Colors.muted, marginTop: 3 },
  chip:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  chipDot:   { width: 7, height: 7, borderRadius: 4 },
  chipTxt:   { fontFamily: T.mono, fontSize: 11, fontWeight: '700' },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile:      { flexBasis: '48%', flexGrow: 1, backgroundColor: Colors.surface2, borderRadius: 12, borderWidth: 0.5, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  tileHead:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  tileLbl:   { flex: 1, fontFamily: T.mono, fontSize: 10, color: Colors.hint, textTransform: 'uppercase', letterSpacing: 0.6 },
  tileVal:   { fontSize: rs(22), fontWeight: '300', color: Colors.text },
  tileUnit:  { fontSize: 11, color: Colors.muted, fontWeight: '400' },
  subhead:   { fontSize: 12, fontWeight: '600', color: Colors.muted, marginTop: 16, marginBottom: 8 },
  spark:     { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 48 },
  sparkBar:  { flex: 1, backgroundColor: Colors.brand, borderRadius: 2 },
  empty:     { fontSize: 13, color: Colors.hint, lineHeight: 19 },
  footRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  footTxt:   { flex: 1, fontFamily: T.mono, fontSize: 11, color: Colors.muted },
  input:     { minHeight: MIN_TOUCH * 1.4, maxHeight: 120, backgroundColor: Colors.surface2, borderRadius: 10, borderWidth: 0.5, borderColor: Colors.border2, color: Colors.text, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: 'top' },
  privacyRow:{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  privacyTxt:{ flex: 1, fontSize: 12, color: Colors.muted, lineHeight: 17 },
})
