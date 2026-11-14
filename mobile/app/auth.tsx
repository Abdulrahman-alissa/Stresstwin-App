import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAppStore } from '../src/store/useAppStore'
import { authLogin, authRegister, getProfile } from '../src/api/client'
import { Colors, T, rs, MIN_TOUCH } from '../src/theme'
import { AuthBackground, GradientFill, HeadPulse, Lotus } from '../src/components/AuthArt'

type Mode = 'login' | 'register'
const BLUE = '#3B82F6'
const FIELD_BG = 'rgba(20,24,48,0.85)'
const FIELD_BORDER = 'rgba(99,102,241,0.35)'

export default function AuthScreen() {
  const { setToken, setUser } = useAppStore()
  const insets = useSafeAreaInsets()
  const [mode, setMode]         = useState<Mode>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [show, setShow]         = useState(false)
  const [loading, setLoading]   = useState(false)
  const login = mode === 'login'

  const submit = async () => {
    if (!email.trim() || !password) { Alert.alert('Missing fields', 'Enter your email and password.'); return }
    if (!login && password.length < 8) { Alert.alert('Password too short', 'Use at least 8 characters.'); return }
    setLoading(true)
    try {
      const data = login
        ? await authLogin(email.trim(), password)
        : await authRegister(email.trim(), password, fullName.trim() || undefined)
      await SecureStore.setItemAsync('st_token', data.access_token)
      setToken(data.access_token)
      setUser(await getProfile())
    } catch (err: any) {
      const msg = err?.response?.data?.detail
      Alert.alert('Error', Array.isArray(msg) ? msg.map((m: any) => m.msg).join('\n') : (msg ?? 'Something went wrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#060A1A' }}>
      <AuthBackground />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 20 }]}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        >
          {/* Brand */}
          <View style={s.brand}>
            <View style={s.logoGlow}><Image source={require('../assets/icon.png')} style={s.logo} /></View>
            <Text style={s.wordmark}>Stress<Text style={{ color: BLUE }}>Twin</Text></Text>
            <Text style={s.tagline}>Understand  •  Predict  •  Thrive</Text>
          </View>

          {/* Heading + art */}
          <View style={s.headRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.h1}>{login ? 'Welcome ' : 'Create '}<Text style={{ color: BLUE }}>{login ? 'Back!' : 'Account'}</Text></Text>
              <Text style={s.h1sub}>{login ? 'Sign in to continue your journey' : 'Start your journey to calm'}</Text>
            </View>
            <View style={s.art} pointerEvents="none"><HeadPulse width={rs(120)} /></View>
          </View>

          {/* Form */}
          {!login && (
            <View style={s.field}>
              <Ionicons name="person-outline" size={22} color="#9AA3C7" />
              <TextInput style={s.input} placeholder="Full name" placeholderTextColor="#7A84A8"
                value={fullName} onChangeText={setFullName} autoCapitalize="words" autoComplete="name" />
            </View>
          )}
          <View style={s.field}>
            <Ionicons name="mail-outline" size={22} color="#9AA3C7" />
            <TextInput style={s.input} placeholder="Email" placeholderTextColor="#7A84A8"
              value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false}
              keyboardType="email-address" autoComplete="email" />
          </View>
          <View style={s.field}>
            <Ionicons name="lock-closed-outline" size={22} color="#9AA3C7" />
            <TextInput style={s.input} placeholder={login ? 'Password' : 'Password (8+ characters)'} placeholderTextColor="#7A84A8"
              value={password} onChangeText={setPassword} secureTextEntry={!show}
              autoCapitalize="none" autoComplete={login ? 'current-password' : 'new-password'}
              onSubmitEditing={submit} returnKeyType="go" />
            <TouchableOpacity onPress={() => setShow(v => !v)} hitSlop={10} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
              <Ionicons name={show ? 'eye-outline' : 'eye-off-outline'} size={22} color="#9AA3C7" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.btn} onPress={submit} disabled={loading} activeOpacity={0.85} accessibilityRole="button">
            <GradientFill />
            {loading ? <ActivityIndicator color="#fff" /> : (
              <View style={s.btnRow}>
                <Text style={s.btnTxt}>{login ? 'Sign In' : 'Create Account'}</Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          <View style={s.switchWrap}>
            <View style={s.rule} />
            <TouchableOpacity onPress={() => setMode(login ? 'register' : 'login')} style={s.switchBtn} accessibilityRole="button">
              <Text style={s.switchTxt}>{login ? 'No account? ' : 'Have an account? '}<Text style={s.switchLink}>{login ? 'Create one' : 'Sign in'}</Text></Text>
            </TouchableOpacity>
            <View style={s.rule} />
          </View>

          <View style={s.footer}>
            <Lotus />
            <Text style={s.footTxt}>A calmer mind. A healthier you.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

const s = StyleSheet.create({
  scroll:   { flexGrow: 1, paddingHorizontal: 26 },
  brand:    { alignItems: 'center' },
  logoGlow: { borderRadius: rs(26), shadowColor: '#4F7BFF', shadowOpacity: 0.55, shadowRadius: 22, shadowOffset: { width: 0, height: 4 }, elevation: 12 },
  logo:     { width: rs(82), height: rs(82), borderRadius: rs(22) },
  wordmark: { fontSize: rs(34), fontWeight: '600', color: '#fff', letterSpacing: -0.5, marginTop: 12 },
  tagline:  { fontSize: 13, color: '#AEB6D6', marginTop: 4, letterSpacing: 0.3 },
  headRow:  { flexDirection: 'row', alignItems: 'center', marginTop: rs(34), marginBottom: rs(18) },
  h1:       { fontSize: rs(32), fontWeight: '600', color: '#fff', letterSpacing: -0.5 },
  h1sub:    { fontSize: 15, color: '#C3CAE6', marginTop: 8 },
  art:      { position: 'absolute', right: -26, top: -rs(36), opacity: 0.95 },
  field:    { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: rs(56), borderRadius: 18, paddingHorizontal: 18, marginBottom: 14, backgroundColor: FIELD_BG, borderWidth: 1, borderColor: FIELD_BORDER },
  input:    { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 14 },
  btn:      { minHeight: rs(54), borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginTop: 8, overflow: 'hidden', shadowColor: '#4F7BFF', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  btnRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btnTxt:   { color: '#fff', fontSize: 17, fontWeight: '600' },
  switchWrap:{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: rs(22), minHeight: MIN_TOUCH },
  rule:     { flex: 1, height: 1, backgroundColor: 'rgba(120,130,180,0.25)' },
  switchBtn:{ minHeight: MIN_TOUCH, justifyContent: 'center' },
  switchTxt:{ fontSize: 15, color: '#D5DAF0' },
  switchLink:{ color: BLUE, fontWeight: '700' },
  footer:   { alignItems: 'center', marginTop: 'auto', paddingTop: rs(40), gap: 8 },
  footTxt:  { fontSize: 14, color: '#9AA3C7' },
})
