import { parseDay } from '../../src/lib/deviceStats'
import { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, Animated, Easing,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import DeviceDashboard from '../../src/components/DeviceDashboard'
import LiveKeyboardData from '../../src/components/LiveKeyboardData'
import EarlyWarningCard from '../../src/components/insights/EarlyWarningCard'
import Playbook from '../../src/components/insights/Playbook'
import { useInsights } from '../../src/hooks/useInsights'
import { useRouter } from 'expo-router'
import { useAppStore } from '../../src/store/useAppStore'
import { getCurrentScore, submitCheckin } from '../../src/api/client'
import { loadForecast } from '../../src/lib/loadForecast'
import ForecastBasis, { StarterNote } from '../../src/components/ForecastBasis'
import { Colors, shared, T, riskColor, scoreColor, rs, ICON, MIN_TOUCH, SCREEN_WIDTH } from '../../src/theme'
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg'

const GAUGE_W = Math.min(Math.max(SCREEN_WIDTH - 120, 180), 230)

// ── Mini SVG gauge ────────────────────────────────────────────────────────────
function ScoreGauge({ score }: { score: number }) {
  const color = scoreColor(score)
  const R = 70, CX = 90, CY = 90
  const START = 220 * (Math.PI / 180), SWEEP = 280 * (Math.PI / 180)
  const clamp = Math.min(Math.max(score, 0), 100)

  const polar = (cx: number, cy: number, r: number, angle: number) => ({
    x: cx + r * Math.cos(angle - Math.PI / 2),
    y: cy + r * Math.sin(angle - Math.PI / 2),
  })

  const arcPath = (startDeg: number, endDeg: number) => {
    const s = polar(CX, CY, R, (startDeg * Math.PI) / 180)
    const e = polar(CX, CY, R, (endDeg * Math.PI) / 180)
    const large = endDeg - startDeg > 180 ? 1 : 0
    return `M ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`
  }

  const fillEnd = 220 + (clamp / 100) * 280
  const needle  = polar(CX, CY, R - 10, (fillEnd * Math.PI) / 180)

  return (
    <Svg width={GAUGE_W} height={(GAUGE_W * 150) / 160} viewBox="10 10 160 150">
      <Path d={arcPath(220, 500)} fill="none" stroke={Colors.surface3} strokeWidth={12} strokeLinecap="round" />
      <Path d={arcPath(220, fillEnd)} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round" />
      <Circle cx={needle.x} cy={needle.y} r={5} fill={color} />
      <SvgText x={CX} y={CY + 10} textAnchor="middle" fill={Colors.text} fontSize={34} fontWeight="300">
        {Math.round(clamp)}
      </SvgText>
      <SvgText x={CX} y={CY + 26} textAnchor="middle" fill={Colors.hint} fontSize={11}>
        / 100
      </SvgText>
    </Svg>
  )
}

// ── Trend mini bars ───────────────────────────────────────────────────────────
function TrendBars({ ticks }: { ticks: { score: number; at: string }[] }) {
  const last = ticks.slice(-14)
  if (last.length === 0) return (
    <Text style={{ color: Colors.hint, fontSize: 12, textAlign: 'center', padding: 16 }}>
      Collecting data…
    </Text>
  )
  const max = Math.max(...last.map(t => t.score), 1)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 52, gap: 4 }}>
      {last.map((t, i) => {
        const h = Math.max((t.score / max) * 52, 4)
        const c = scoreColor(t.score)
        return (
          <View key={i} style={{ flex: 1, height: h, backgroundColor: c, borderRadius: 2, opacity: 0.75 }} />
        )
      })}
    </View>
  )
}

// ── Intervention modal ────────────────────────────────────────────────────────
function InterventionModal({ type, onClose }: { type: string; onClose: () => void }) {
  const configs: Record<string, { title: string; body: string; emoji: React.ComponentProps<typeof Ionicons>['name']; duration: number }> = {
    breathing:  { title: '4-7-8 Breathing', body: 'Inhale for 4 seconds, hold for 7, exhale for 8. Repeat 4 times to lower cortisol.', emoji: 'leaf-outline', duration: 76 },
    focus:      { title: 'Focus Mode', body: 'Your behavioral signals suggest scattered attention. Silence notifications for 20 minutes.', emoji: 'eye-off-outline', duration: 1200 },
    step_away:  { title: 'Step Away', body: "You've been elevated for a while. Put the phone down and take a 5-minute walk.", emoji: 'walk-outline', duration: 300 },
    prevention: { title: 'Tomorrow Looks Heavy', body: 'High-risk day predicted. Consider finishing work early tonight to build recovery buffer.', emoji: 'shield-checkmark-outline', duration: 0 },
  }
  const cfg = configs[type] ?? configs.breathing
  const [secs, setSecs] = useState(cfg.duration)

  useEffect(() => {
    if (!cfg.duration) return
    const iv = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(iv)
  }, [type])

  const pct = cfg.duration > 0 ? ((cfg.duration - secs) / cfg.duration) * 100 : 100

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={ms.overlay}>
        <View style={ms.card}>
          <View style={ms.iconWrap}><Ionicons name={cfg.emoji} size={ICON.xl} color={Colors.brand} /></View>
          <Text style={ms.ivType}>{type.replace(/_/g, ' ').toUpperCase()}</Text>
          <Text style={ms.ivTitle}>{cfg.title}</Text>
          <Text style={ms.ivBody}>{cfg.body}</Text>

          {cfg.duration > 0 && (
            <View style={{ marginVertical: 14, width: '100%' }}>
              <View style={ms.timerTrack}>
                <View style={[ms.timerFill, { width: `${pct}%` as any }]} />
              </View>
              <Text style={ms.timerText}>
                {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} remaining
              </Text>
            </View>
          )}

          <View style={ms.btnRow}>
            <TouchableOpacity style={ms.btnAccept} onPress={onClose}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ms.btnDismiss} onPress={onClose}>
              <Text style={{ color: Colors.muted, fontWeight: '600', fontSize: 13 }}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Dashboard screen ──────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const { currentScore, trend, modelReady, user, interventionType, forecasts, forecastReady,
          daysUntilReady, setForecasts, clearIntervention } = useAppStore()
  const [checkinSent, setCheckinSent] = useState(false)
  const { threshold, ew, actions, waiting } = useInsights()
  const router = useRouter()

  useEffect(() => {
    loadForecast()
    const iv = setInterval(loadForecast, 360_000)
    return () => clearInterval(iv)
  }, [])

  const sendCheckin = async (rating: number) => {
    setCheckinSent(true)
    try { await submitCheckin(rating) } catch {}
  }

  const slabel = currentScore < 50 ? 'Optimal' : currentScore < 75 ? 'Elevated' : 'Critical'
  const scolor = scoreColor(currentScore)

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>Dashboard</Text>
          <View style={[shared.pill, { backgroundColor: Colors.accentDim }]}>
            <Text style={{ color: Colors.accent, fontFamily: T.mono, fontSize: 10, fontWeight: '600' }}>
              ● Live
            </Text>
          </View>
        </View>

        {/* Early warning — what is building, and how long you have */}
        <EarlyWarningCard ew={ew} threshold={threshold} waiting={waiting} />

        {/* Score card */}
        <View style={[shared.card, s.scoreCard]}>
          <Text style={shared.clbl}>Current Stress Index</Text>
          <ScoreGauge score={currentScore} />
          <Text style={[s.scoreLabel, { color: scolor }]}>{slabel}</Text>
          {!modelReady && (
            <View style={s.coldStartRow}>
              <Text style={s.coldText}>Learning baseline · Day {user?.days_of_data ?? 0}/7</Text>
              <View style={s.coldBar}>
                <View style={[s.coldFill, { width: `${((user?.days_of_data ?? 0) / 7) * 100}%` as any }]} />
              </View>
            </View>
          )}
        </View>

        {/* What to do before stress builds */}
        {!waiting && <Playbook actions={actions} limit={2} title="Do this before stress builds" />}
        <TouchableOpacity style={s.moreLink} onPress={() => router.push('/insights')}>
          <Text style={s.moreTxt}>See all insights and the prevention path</Text>
          <Ionicons name="arrow-forward" size={ICON.md} color={Colors.brand} />
        </TouchableOpacity>

        {/* Live data coming from the keyboard on this phone */}
        <LiveKeyboardData />

        {/* Devices contributing data to this profile */}
        <DeviceDashboard />

        {/* 60-min trend */}
        <View style={shared.card}>
          <Text style={shared.clbl}>60-min Trend</Text>
          <TrendBars ticks={trend} />
        </View>

        {/* Forecast strip */}
        {forecastReady ? (
          <View style={shared.card}>
            <Text style={shared.clbl}>3-Day Forecast</Text>
            <StarterNote compact />
            {forecasts.map((f, i) => {
              const rc = riskColor(f.risk_label)
              const day = parseDay(f.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              return (
                <View key={f.date} style={[s.fcRow, i < forecasts.length - 1 && { marginBottom: 14 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.fcDay}>{day}</Text>
                    <View style={s.fcBarTrack}>
                      <View style={[s.fcBarFill, { width: `${f.risk * 100}%` as any, backgroundColor: rc }]} />
                    </View>
                    {f.primary_stressor && <Text style={[s.fcStressor, { color: Colors.amber }]}>{f.primary_stressor}</Text>}
                  </View>
                  <View style={[s.fcBadge, { backgroundColor: `${rc}22` }]}>
                    <Text style={{ color: rc, fontFamily: T.mono, fontSize: 10, fontWeight: '700' }}>
                      {Math.round(f.risk * 100)}%
                    </Text>
                  </View>
                </View>
              )
            })}
          </View>
        ) : (
          <View style={shared.card}>
            <Text style={shared.clbl}>3-Day Forecast</Text>
            <Text style={s.forecastNA}>
              Available after {daysUntilReady} more day{daysUntilReady !== 1 ? 's' : ''} of data + 20 mood check-ins.
              Connect your calendar in Settings to enable.
            </Text>
            <ForecastBasis />
          </View>
        )}

        {/* Mood check-in */}
        <View style={shared.card}>
          <Text style={shared.clbl}>Mood Check-in</Text>
          {checkinSent ? (
            <View style={s.doneRow}>
              <Ionicons name="checkmark-circle" size={ICON.lg} color={Colors.accent} />
              <Text style={s.checkinDone}>Logged — thank you!</Text>
            </View>
          ) : (
            <>
              <Text style={s.checkinPrompt}>How stressed do you feel right now?</Text>
              <View style={s.starsRow}>
                {[1,2,3,4,5].map(n => (
                  <TouchableOpacity key={n} onPress={() => sendCheckin(n)} style={s.starBtn} accessibilityLabel={`Stress level ${n} of 5`}>
                    <Ionicons name="star" size={ICON.xl} color={Colors.amber} />
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={s.checkinHint}>1 = calm  ·  5 = very stressed</Text>
              <View style={{ marginTop: 10 }}>
                <Text style={[shared.clbl, { marginBottom: 4 }]}>
                  Check-ins: {user?.mood_checkins_count ?? 0}/20 for LSTM
                </Text>
                <View style={s.coldBar}>
                  <View style={[s.coldFill, { width: `${Math.min(((user?.mood_checkins_count ?? 0) / 20) * 100, 100)}%` as any, backgroundColor: Colors.accent }]} />
                </View>
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* Intervention modal */}
      {interventionType && (
        <InterventionModal type={interventionType} onClose={clearIntervention} />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  moreLink:   { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  moreTxt:    { color: Colors.brand, fontSize: 13, fontWeight: '600' },
  scroll:     { padding: 16, gap: 12, paddingBottom: 24 },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, marginTop: 4 },
  title:      { fontSize: rs(22), fontWeight: '500', color: Colors.text, letterSpacing: -0.3 },
  scoreCard:  { alignItems: 'center' },
  scoreLabel: { fontFamily: T.mono, fontSize: 13, fontWeight: '600', marginTop: 4 },
  coldStartRow: { width: '100%', marginTop: 10 },
  coldText:   { fontSize: 11, color: Colors.muted, textAlign: 'center', marginBottom: 6 },
  coldBar:    { height: 2, backgroundColor: Colors.surface3, borderRadius: 1, overflow: 'hidden', width: '100%' },
  coldFill:   { height: '100%', backgroundColor: Colors.brand, borderRadius: 1 },
  fcRow:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fcDay:      { fontFamily: T.mono, fontSize: 11, color: Colors.muted, marginBottom: 5 },
  fcBarTrack: { height: 5, backgroundColor: Colors.surface2, borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  fcBarFill:  { height: '100%', borderRadius: 3 },
  fcBadge:    { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 },
  fcStressor: { fontSize: 11 },
  forecastNA: { fontSize: 13, color: Colors.muted, lineHeight: 20 },
  checkinPrompt:{ fontSize: 13, color: Colors.muted, marginBottom: 12 },
  starsRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  starBtn:    { flex: 1, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  doneRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  star:       { fontSize: 26 },
  checkinHint:{ fontSize: 10, color: Colors.hint, fontFamily: T.mono },
  checkinDone:{ fontSize: 14, color: Colors.accent },
})

const ms = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  card:       { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, paddingBottom: 40, alignItems: 'center' },
  iconWrap:   { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.brandDim, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  ivType:     { fontFamily: T.mono, fontSize: 10, fontWeight: '600', letterSpacing: 1.5, color: Colors.brand, marginBottom: 6 },
  ivTitle:    { fontSize: 18, fontWeight: '600', color: Colors.text, marginBottom: 8, textAlign: 'center' },
  ivBody:     { fontSize: 13, color: Colors.muted, lineHeight: 20, textAlign: 'center' },
  timerTrack: { height: 3, backgroundColor: Colors.surface2, borderRadius: 2, overflow: 'hidden' },
  timerFill:  { height: '100%', backgroundColor: Colors.brand, borderRadius: 2 },
  timerText:  { fontFamily: T.mono, fontSize: 10, color: Colors.hint, marginTop: 4, textAlign: 'center' },
  btnRow:     { flexDirection: 'row', gap: 10, width: '100%', marginTop: 6 },
  btnAccept:  { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center', backgroundColor: Colors.brand, borderRadius: 12, alignItems: 'center' },
  btnDismiss: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center', backgroundColor: Colors.surface2, borderRadius: 12, alignItems: 'center', borderWidth: 0.5, borderColor: Colors.border2 },
})
