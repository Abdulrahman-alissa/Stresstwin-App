import { useEffect, useRef, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TextInput,
  TouchableOpacity, Switch, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { useAppStore } from '../../src/store/useAppStore'
import {
  updateProfile, authLogout, deleteAllData,
  getCalendarAuthUrl, syncCalendar, disconnectCalendar, getProfile, registerDevice,
} from '../../src/api/client'
import { getOrCreateDeviceId, getDeviceName, setDeviceName } from '../../src/services/deviceId'
import { Colors, shared, T, rs, ICON, MIN_TOUCH } from '../../src/theme'
import KeyboardSettingsSection from '../../src/components/KeyboardSettingsSection'

WebBrowser.maybeCompleteAuthSession()

export default function SettingsScreen() {
  const { user, setUser, setToken } = useAppStore()
  const [devName, setDevName] = useState('')
  const [fullName, setFullName]   = useState(user?.full_name ?? '')
  const [threshold, setThreshold] = useState(user?.if_threshold ?? 70)
  const [saving, setSaving]       = useState(false)
  const [calLoading, setCalLoading] = useState<string | null>(null)
  const [msg, setMsg]             = useState('')

  const timer = useRef<ReturnType<typeof setTimeout>>()
  const flash = (m: string) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(''), 3500) }
  useEffect(() => { getDeviceName(Platform.OS).then(setDevName); return () => clearTimeout(timer.current) }, [])

  const saveDevice = async () => {
    const name = devName.trim()
    if (!name) return flash('❌ Device name can’t be empty')
    try {
      await registerDevice({ device_id: await getOrCreateDeviceId(), platform: Platform.OS === 'ios' ? 'ios' : 'android', display_name: name })
      await setDeviceName(name)
      flash('✅ Device name saved')
    } catch { flash('❌ Couldn’t save the device name') }
  }

  const saveProfile = async () => {
    setSaving(true)
    try {
      const updated = await updateProfile({ full_name: fullName, if_threshold: threshold })
      setUser(updated)
      flash('✅ Settings saved')
    } catch { flash('❌ Save failed') }
    finally { setSaving(false) }
  }

  const connectCalendar = async (provider: 'google' | 'outlook') => {
    setCalLoading(provider)
    try {
      const { auth_url } = await getCalendarAuthUrl(provider)
      const result = await WebBrowser.openAuthSessionAsync(
        auth_url,
        Linking.createURL(`/calendar?provider=${provider}`)
      )
      if (result.type === 'success') {
        const profile = await getProfile()
        setUser(profile)
        flash(`✅ ${provider === 'google' ? 'Google' : 'Outlook'} Calendar connected`)
      }
    } catch { flash('❌ Connection failed') }
    finally { setCalLoading(null) }
  }

  const disconnectCal = async (provider: 'google' | 'outlook') => {
    Alert.alert(
      'Disconnect Calendar',
      `Remove ${provider === 'google' ? 'Google' : 'Outlook'} Calendar?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect', style: 'destructive',
          onPress: async () => {
            setCalLoading(provider)
            try {
              await disconnectCalendar(provider)
              const profile = await getProfile()
              setUser(profile)
              flash(`Disconnected ${provider}`)
            } catch { flash('❌ Failed') }
            finally { setCalLoading(null) }
          },
        },
      ]
    )
  }

  const syncCal = async (provider: 'google' | 'outlook') => {
    setCalLoading(provider)
    try {
      await syncCalendar(provider)
      flash(`✅ ${provider} synced`)
    } catch { flash('❌ Sync failed') }
    finally { setCalLoading(null) }
  }

  const signOut = async () => {
    await authLogout().catch(() => {})
    await SecureStore.deleteItemAsync('st_token').catch(() => {})
    setToken(null)
    setUser(null)
  }

  const handleDeleteData = () => {
    Alert.alert(
      'Delete All Data',
      'This will permanently delete all your behavioral data, scores, forecasts, and account. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything', style: 'destructive',
          onPress: async () => {
            try {
              await deleteAllData()
            } catch {
              return flash('❌ Couldn’t delete your data — nothing was changed. Try again.')
            }
            signOut()
          },
        },
      ]
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>Settings</Text>

        {msg ? <View style={s.flash}><Text style={s.flashTxt}>{msg}</Text></View> : null}

        {/* ── Profile ── */}
        <Text style={s.sectionTitle}>Profile</Text>
        <View style={shared.card}>
          <View style={s.field}>
            <Text style={s.label}>Full name</Text>
            <TextInput
              style={shared.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Your name"
              placeholderTextColor={Colors.hint}
            />
          </View>
          <View style={s.field}>
            <Text style={s.label}>Email</Text>
            <TextInput style={[shared.input, { opacity: 0.5 }]} value={user?.email ?? ''} editable={false} />
          </View>

          {/* Threshold slider */}
          <View style={s.field}>
            <Text style={s.label}>Stress Threshold — {threshold}/100</Text>
            <View style={s.sliderRow}>
              <TouchableOpacity onPress={() => setThreshold(t => Math.max(30, t - 5))} style={s.sliderBtn}>
                <Text style={s.sliderBtnTxt}>−</Text>
              </TouchableOpacity>
              <View style={s.sliderTrack}>
                <View style={[s.sliderFill, { width: `${((threshold - 30) / 65) * 100}%` as any }]} />
                <View style={[s.sliderThumb, { left: `${((threshold - 30) / 65) * 100}%` as any }]} />
              </View>
              <TouchableOpacity onPress={() => setThreshold(t => Math.min(95, t + 5))} style={s.sliderBtn}>
                <Text style={s.sliderBtnTxt}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.sliderHint}>Lower = more sensitive · Higher = fewer alerts</Text>
          </View>

          <TouchableOpacity style={shared.btn} onPress={saveProfile} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={shared.btnText}>Save changes</Text>}
          </TouchableOpacity>
        </View>

        {/* ── This device ── */}
        <Text style={s.sectionTitle}>This device</Text>
        <View style={shared.card}>
          <View style={s.field}>
            <Text style={s.label}>Device name (shown next to your other devices)</Text>
            <TextInput style={shared.input} value={devName} onChangeText={setDevName} maxLength={40} placeholderTextColor={Colors.hint} />
          </View>
          <TouchableOpacity style={shared.btn} onPress={saveDevice}><Text style={shared.btnText}>Save name</Text></TouchableOpacity>
          <Text style={[s.sliderHint, { marginTop: 10 }]}>Your numbers vs. all your devices are in the Insights tab.</Text>
        </View>

        {/* ── Calendar ── */}
        <Text style={s.sectionTitle}>Calendar Integration</Text>
        <View style={shared.card}>
          {(['google', 'outlook'] as const).map(provider => {
            const connected = provider === 'google' ? user?.google_connected : user?.outlook_connected
            const name      = provider === 'google' ? 'Google Calendar' : 'Outlook Calendar'
            const icon      = provider === 'google' ? 'logo-google' : 'mail-outline'
            return (
              <View key={provider} style={s.calRow}>
                <View style={s.calIconWrap}><Ionicons name={icon as any} size={ICON.md} color={Colors.brand} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.calName}>{name}</Text>
                  <Text style={[s.calStatus, { color: connected ? Colors.accent : Colors.hint }]}>
                    {connected ? 'Connected' : 'Not connected'}
                  </Text>
                </View>
                {calLoading === provider ? (
                  <ActivityIndicator color={Colors.brand} size="small" />
                ) : connected ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity style={s.calBtnSm} onPress={() => syncCal(provider)}>
                      <Ionicons name="sync" size={ICON.sm} color={Colors.muted} /><Text style={s.calBtnSmTxt}>Sync</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.calBtnSm, { borderColor: Colors.red }]} onPress={() => disconnectCal(provider)}>
                      <Text style={[s.calBtnSmTxt, { color: Colors.red }]}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={s.calBtnPrimary} onPress={() => connectCalendar(provider)}>
                    <Text style={{ color: '#fff', fontFamily: T.mono, fontSize: 11, fontWeight: '700' }}>Connect</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          })}
        </View>

        {/* ── Data status ── */}
        <Text style={s.sectionTitle}>Model Status</Text>
        <View style={shared.card}>
          {[
            { label: 'Days of behavioral data', val: user?.days_of_data ?? 0, total: 28 },
            { label: 'Mood check-ins',            val: user?.mood_checkins_count ?? 0, total: 20 },
          ].map(row => (
            <View key={row.label} style={{ marginBottom: 14 }}>
              <View style={s.modelRow}>
                <Text style={s.modelLabel}>{row.label}</Text>
                <Text style={s.modelVal}>{row.val}/{row.total}</Text>
              </View>
              <View style={s.modelTrack}>
                <View style={[s.modelFill, { width: `${Math.min((row.val / row.total) * 100, 100)}%` as any }]} />
              </View>
            </View>
          ))}
          <View style={s.modelStatRow}>
            {[
              { label: 'IF Model',   ready: user?.if_model_ready },
              { label: 'LSTM Model', ready: user?.lstm_model_ready },
            ].map(m => (
              <View key={m.label} style={s.modelStatCard}>
                <Text style={[s.modelStatIcon, { color: m.ready ? Colors.accent : Colors.hint }]}>
                  {m.ready ? '✓' : '○'}
                </Text>
                <Text style={s.modelStatLbl}>{m.label}</Text>
                <Text style={[s.modelStatStatus, { color: m.ready ? Colors.accent : Colors.hint }]}>
                  {m.ready ? 'Active' : 'Training'}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Keyboard ── */}
        <KeyboardSettingsSection />

        {/* ── Privacy ── */}
        <Text style={s.sectionTitle}>Privacy</Text>
        <View style={shared.card}>
          <Text style={s.privacyNote}>
            StressTwin records only counts and timings: time between keys, how often Backspace is used, pauses, and touch and motion statistics on your phone (mouse speed on desktop).
            {'\n\n'}
            It never records which keys you press, what you type, where you tap, what is on screen, or any audio or camera data. Calendar event titles are scanned for workload keywords and then discarded.
          </Text>
        </View>

        {/* ── Account ── */}
        <Text style={s.sectionTitle}>Account</Text>
        <View style={shared.card}>
          <TouchableOpacity style={s.signOutBtn} onPress={signOut}>
            <Text style={s.signOutTxt}>Sign out</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.deleteBtn} onPress={handleDeleteData}>
            <Text style={s.deleteTxt}>Delete all my data (GDPR)</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  scroll:        { padding: 16 },
  title:         { fontSize: rs(22), fontWeight: '500', color: Colors.text, letterSpacing: -0.3, marginBottom: 20, marginTop: 4 },
  sectionTitle:  { fontFamily: T.mono, fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', color: Colors.hint, marginBottom: 8, marginTop: 20 },
  flash:         { backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 0.5, borderColor: Colors.brand, padding: 12, marginBottom: 14 },
  flashTxt:      { fontSize: 13, color: Colors.text },
  field:         { marginBottom: 16 },
  label:         { fontFamily: T.mono, fontSize: 10, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', color: Colors.hint, marginBottom: 6 },
  sliderRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  sliderBtn:     { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: 8, backgroundColor: Colors.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: Colors.border2 },
  sliderBtnTxt:  { color: Colors.text, fontSize: 22, fontWeight: '300' },
  sliderTrack:   { flex: 1, height: 4, backgroundColor: Colors.surface2, borderRadius: 2, position: 'relative', overflow: 'visible' },
  sliderFill:    { height: '100%', backgroundColor: Colors.brand, borderRadius: 2 },
  sliderThumb:   { position: 'absolute', top: -8, width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.brand, marginLeft: -8 },
  sliderHint:    { fontFamily: T.mono, fontSize: 11, color: Colors.hint },
  calRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  calIconWrap:   { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.brandDim, alignItems: 'center', justifyContent: 'center' },
  calName:       { fontSize: 13, fontWeight: '500', color: Colors.text },
  calStatus:     { fontSize: 11, fontFamily: T.mono, marginTop: 2 },
  calBtnSm:      { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 8, borderWidth: 0.5, borderColor: Colors.border2 },
  calBtnSmTxt:   { fontFamily: T.mono, fontSize: 11, fontWeight: '600', color: Colors.muted },
  calBtnPrimary: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, backgroundColor: Colors.brand },
  modelRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  modelLabel:    { fontSize: 12, color: Colors.muted },
  modelVal:      { fontFamily: T.mono, fontSize: 12, fontWeight: '600', color: Colors.brand },
  modelTrack:    { height: 3, backgroundColor: Colors.surface2, borderRadius: 2, overflow: 'hidden' },
  modelFill:     { height: '100%', backgroundColor: Colors.brand, borderRadius: 2 },
  modelStatRow:  { flexDirection: 'row', gap: 10 },
  modelStatCard: { flex: 1, backgroundColor: Colors.surface2, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 0.5, borderColor: Colors.border },
  modelStatIcon: { fontSize: rs(20), marginBottom: 4 },
  modelStatLbl:  { fontFamily: T.mono, fontSize: 11, color: Colors.hint, textTransform: 'uppercase', letterSpacing: 0.8 },
  modelStatStatus:{ fontFamily: T.mono, fontSize: 11, fontWeight: '600', marginTop: 2 },
  privacyNote:   { fontSize: 13, color: Colors.muted, lineHeight: 20 },
  signOutBtn:    { minHeight: MIN_TOUCH, justifyContent: 'center', borderRadius: 12, backgroundColor: Colors.surface2, alignItems: 'center', marginBottom: 10, borderWidth: 0.5, borderColor: Colors.border2 },
  signOutTxt:    { fontSize: 14, fontWeight: '500', color: Colors.muted },
  deleteBtn:     { minHeight: MIN_TOUCH, justifyContent: 'center', borderRadius: 12, backgroundColor: Colors.redDim, alignItems: 'center', borderWidth: 0.5, borderColor: 'rgba(240,62,62,0.25)' },
  deleteTxt:     { fontSize: 14, fontWeight: '500', color: Colors.red },
})
