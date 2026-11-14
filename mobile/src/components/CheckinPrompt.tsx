import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { submitCheckin } from '../api/client'
import { Colors, T, ICON, MIN_TOUCH } from '../theme'

const PROMPT_INTERVAL_MS = 90 * 60 * 1000 // 90 minutes

export default function CheckinPrompt() {
  const [visible, setVisible]   = useState(false)
  const [sent, setSent]         = useState(false)
  const opacity = useState(new Animated.Value(0))[0]

  useEffect(() => {
    const show = () => {
      setVisible(true)
      setSent(false)
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start()
    }

    // Show first prompt after 90 minutes, then every 90 minutes
    const timer = setTimeout(show, PROMPT_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [])

  const dismiss = () => {
    Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setVisible(false)
    })
  }

  const rate = async (rating: number) => {
    setSent(true)
    try { await submitCheckin(rating) } catch {}
    setTimeout(dismiss, 1500)
  }

  if (!visible) return null

  return (
    <Animated.View style={[s.container, { opacity }]}>
      {sent ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Ionicons name="checkmark-circle" size={ICON.lg} color={Colors.accent} /><Text style={s.thanks}>Check-in logged!</Text></View>
      ) : (
        <>
          <Text style={s.label}>MOOD CHECK-IN</Text>
          <Text style={s.question}>How stressed are you right now?</Text>
          <View style={s.stars}>
            {[1, 2, 3, 4, 5].map(n => (
              <TouchableOpacity key={n} onPress={() => rate(n)} style={s.starBtn}>
                <Ionicons name="star" size={ICON.xl} color={Colors.amber} />
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.hint}>1 = calm · 5 = very stressed</Text>
          <TouchableOpacity onPress={dismiss} style={s.dismiss}>
            <Text style={s.dismissTxt}>Skip</Text>
          </TouchableOpacity>
        </>
      )}
    </Animated.View>
  )
}

const s = StyleSheet.create({
  container: {
    position: 'absolute', bottom: 90, left: 16, right: 16,
    backgroundColor: Colors.surface,
    borderRadius: 18, padding: 20,
    borderWidth: 0.5, borderColor: Colors.border2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 20, elevation: 12,
  },
  label:   { fontFamily: T.mono, fontSize: 9, fontWeight: '600', letterSpacing: 1.2, color: Colors.brand, textTransform: 'uppercase', marginBottom: 6 },
  question:{ fontSize: 14, fontWeight: '500', color: Colors.text, marginBottom: 14 },
  stars:   { flexDirection: 'row', gap: 8, marginBottom: 6 },
  starBtn: { flex: 1, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  star:    { fontSize: 28 },
  hint:    { fontFamily: T.mono, fontSize: 10, color: Colors.hint },
  dismiss: { position: 'absolute', top: 6, right: 8, padding: 10 },
  dismissTxt:{ fontFamily: T.mono, fontSize: 12, color: Colors.hint },
  thanks:  { fontSize: 14, color: Colors.accent, textAlign: 'center', paddingVertical: 4 },
})
