import { useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, T, rs, MIN_TOUCH } from '../theme'

interface Props {
  onComplete: () => void
}

const STEPS = [
  {
    icon:     'pulse-outline',
    title:    'Zero extra hardware',
    body:     'StressTwin monitors your behavioral patterns using sensors already in your phone — no smartwatch, no clip-on device, no subscription wearable required.',
    cta:      'Next',
  },
  {
    icon:     'lock-closed-outline',
    title:    'Your data stays private',
    body:     'We capture only keystroke timing intervals and gyroscope variance — never what you type, where you click, or what\'s on your screen. Calendar titles are scanned then immediately deleted.',
    cta:      'Understood',
  },
  {
    icon:     'calendar-outline',
    title:    'Connect your calendar',
    body:     'Linking Google or Outlook Calendar unlocks the 3-day LSTM forecast — the system predicts high-stress days before they arrive so you can prepare.',
    cta:      'Got it',
  },
  {
    icon:     'flash-outline',
    title:    'Your first 7 days',
    body:     'The Isolation Forest model learns your personal behavioral baseline over 7 days. After that, every 30-second window is scored against *your* normal — not a global average.',
    cta:      'Let\'s go',
  },
]

export default function OnboardingScreen({ onComplete }: Props) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const insets = useSafeAreaInsets()

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1)
    } else {
      onComplete()
    }
  }

  return (
    <View style={[s.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      {/* Progress dots */}
      <View style={s.dots}>
        {STEPS.map((_, i) => (
          <View
            key={i}
            style={[s.dot, i === step && s.dotActive, i < step && s.dotDone]}
          />
        ))}
      </View>

      {/* Content */}
      <ScrollView style={{ flex: 1, width: '100%' }} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.iconCircle}>
          <Ionicons name={current.icon as any} size={rs(48)} color={Colors.brand} />
        </View>
        <Text style={s.title}>{current.title}</Text>
        <Text style={s.body}>{current.body}</Text>
      </ScrollView>

      {/* Step counter */}
      <Text style={s.counter}>{step + 1} of {STEPS.length}</Text>

      {/* CTA */}
      <TouchableOpacity style={s.cta} onPress={next}>
        <Text style={s.ctaText}>{current.cta}</Text>
      </TouchableOpacity>

      {step < STEPS.length - 1 && (
        <TouchableOpacity style={s.skip} onPress={onComplete}>
          <Text style={s.skipText}>Skip onboarding</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  root: {
    flex: 1, backgroundColor: Colors.bg,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dots: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.surface3,
  },
  dotActive: { backgroundColor: Colors.brand, width: 24 },
  dotDone:   { backgroundColor: Colors.brand, opacity: 0.4 },
  content: { alignItems: 'center', flexGrow: 1, justifyContent: 'center', paddingVertical: 12 },
  iconCircle: { width: rs(112), height: rs(112), borderRadius: rs(56), backgroundColor: Colors.brandDim, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  title:   { fontSize: rs(26), fontWeight: '600', color: Colors.text, textAlign: 'center', letterSpacing: -0.4, marginBottom: 16 },
  body:    { fontSize: 15, color: Colors.muted, textAlign: 'center', lineHeight: 24, maxWidth: 340 },
  counter: { fontFamily: T.mono, fontSize: 12, color: Colors.hint, marginVertical: 12 },
  cta: {
    width: '100%', backgroundColor: Colors.brand,
    borderRadius: 14, minHeight: 52, justifyContent: 'center',
    alignItems: 'center', marginBottom: 12,
  },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  skip: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  skipText: { color: Colors.hint, fontSize: 13, fontFamily: T.mono },
})
