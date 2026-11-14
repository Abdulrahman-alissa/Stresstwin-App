import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, shared, T, ICON, MIN_TOUCH } from '../theme'
import { getKeyboardStatus, openKeyboardSettings, KeyboardStatus } from '../services/keyboardBridge'
import { deviceHeartbeat } from '../api/client'
import { getOrCreateDeviceId } from '../services/deviceId'

export default function KeyboardSettingsSection() {
  const [status, setStatus] = useState<KeyboardStatus>({ installed: false, isActive: false, available: false })
  const [checking, setChecking] = useState(true)

  const refresh = useCallback(async () => {
    setChecking(true)
    const s = await getKeyboardStatus()
    setStatus(s)
    setChecking(false)
    // Let the backend know whether the keyboard is actually active right now,
    // so the device dashboard's indicator reflects real OS state, not a guess.
    if (s.available) {
      const deviceId = await getOrCreateDeviceId()
      deviceHeartbeat(deviceId, { keyboard_active: s.isActive }).catch(() => {})
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const statusLabel = !status.available
    ? 'Not available in this build'
    : status.isActive
      ? 'Enabled'
      : status.installed
        ? 'Installed — not selected'
        : 'Not installed'

  const statusColor = status.isActive ? Colors.accent : status.installed ? Colors.amber : Colors.hint

  return (
    <View>
      <Text style={s.sectionTitle}>Keyboard</Text>
      <View style={shared.card}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>StressTwin Keyboard</Text>
            <View style={s.statusRow}><View style={[s.dot, { backgroundColor: statusColor }]} /><Text style={[s.status, { color: statusColor }]}>{statusLabel}</Text></View>
          </View>
        </View>

        {!status.available && (
          <Text style={s.buildNote}>
            The keyboard extension ships in the full StressTwin build (not this preview). Once installed,
            you'll be able to enable it here.
          </Text>
        )}

        <TouchableOpacity style={s.settingsBtn} onPress={openKeyboardSettings} disabled={!status.available}>
          <Text style={s.settingsBtnTxt}>Open Keyboard Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={refresh} disabled={checking}>
          <Text style={s.refreshTxt}>{checking ? 'Checking…' : 'Refresh status'}</Text>
        </TouchableOpacity>

        <View style={s.divider} />

        <Text style={s.subhead}>Data collection</Text>
        {['Typing behavior', 'Typing rhythm', 'Pause patterns', 'Correction patterns'].map(label => (
          <View key={label} style={s.checkRow}>
            <Ionicons name="checkbox" size={ICON.md} color={Colors.brand} />
            <Text style={s.checkLabel}>{label}</Text>
          </View>
        ))}

        <View style={s.divider} />

        <Text style={s.subhead}>Privacy</Text>
        {[
          'Text content is never stored',
          'Text content is never uploaded',
          'Only behavioral statistics are collected',
        ].map(label => (
          <View key={label} style={s.checkRow}>
            <Ionicons name="shield-checkmark" size={ICON.md} color={Colors.accent} />
            <Text style={s.checkLabel}>{label}</Text>
          </View>
        ))}

        <Text style={s.helpText}>
          {Platform.OS === 'android'
            ? 'Enable StressTwin Keyboard in system settings, then switch to it from any text field\'s keyboard picker.'
            : 'Add StressTwin Keyboard in Settings → General → Keyboard → Keyboards, then enable it. iOS will ask ' +
              'whether to allow "Full Access" — this is only needed for the keyboard to sync in the background; ' +
              'declining still lets you use it, with sync happening whenever you next open the StressTwin app.'}
        </Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  sectionTitle: { fontFamily: T.mono, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', color: Colors.hint, marginBottom: 8, marginTop: 20 },
  row:          { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  name:         { fontSize: 14, fontWeight: '500', color: Colors.text },
  status:       { fontFamily: T.mono, fontSize: 12 },
  statusRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  dot:          { width: 8, height: 8, borderRadius: 4 },
  buildNote:    { fontSize: 12, color: Colors.hint, lineHeight: 18, marginBottom: 12 },
  settingsBtn:  { minHeight: MIN_TOUCH, justifyContent: 'center', borderRadius: 12, backgroundColor: Colors.brand, alignItems: 'center', marginBottom: 8 },
  settingsBtnTxt: { color: '#fff', fontSize: 13, fontWeight: '600' },
  refreshTxt:   { fontFamily: T.mono, fontSize: 12, color: Colors.muted, textAlign: 'center', paddingVertical: 10 },
  divider:      { height: 0.5, backgroundColor: Colors.border, marginVertical: 14 },
  subhead:      { fontSize: 12, fontWeight: '600', color: Colors.muted, marginBottom: 8 },
  checkRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  checkMark:    { fontSize: 13, color: Colors.brand },
  checkLabel:   { flex: 1, fontSize: 13, color: Colors.text },
  helpText:     { fontSize: 12, color: Colors.hint, lineHeight: 18, marginTop: 8 },
})
