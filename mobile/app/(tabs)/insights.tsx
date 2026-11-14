import { useMemo } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAppStore } from '../../src/store/useAppStore'
import { useInsights } from '../../src/hooks/useInsights'
import { demoForecast, demoSignals, demoTrend } from '../../src/lib/demo'
import { minuteBuckets, sessionStats } from '../../src/lib/insights'
import { Colors, T, rs, ICON, MIN_TOUCH } from '../../src/theme'
import EarlyWarningCard from '../../src/components/insights/EarlyWarningCard'
import SessionStats from '../../src/components/insights/SessionStats'
import PreventionPath from '../../src/components/insights/PreventionPath'
import SignalTiles from '../../src/components/insights/SignalTiles'
import WorkloadStrain from '../../src/components/insights/WorkloadStrain'
import SignalHeatmap from '../../src/components/insights/SignalHeatmap'
import DeviceCompare from '../../src/components/insights/DeviceCompare'
import Playbook from '../../src/components/insights/Playbook'

export default function InsightsScreen() {
  const { signals, forecasts, setSignals, setScore, setForecasts } = useAppStore()
  const { threshold, score, readings, ew, actions, hasSignals, waiting } = useInsights()
  const ready = hasSignals || !waiting
  const stats = useMemo(() => sessionStats(signals), [signals])
  const buckets = useMemo(() => minuteBuckets(signals, 30), [signals])
  const sample = signals.some(x => x.simulated)

  const loadSample = () => {
    const t = demoTrend()
    setSignals(demoSignals(), t)
    setScore(t[t.length - 1].score, false, null, true)
    if (forecasts.length === 0) setForecasts(demoForecast(), true, 0)
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Insights</Text>
            <Text style={s.sub}>What your phone is measuring, and what to do before stress builds.</Text>
          </View>
          {hasSignals && (
            <View style={[s.chip, { backgroundColor: sample ? Colors.amberDim : Colors.accentDim }]}>
              <View style={[s.dot, { backgroundColor: sample ? Colors.amber : Colors.accent }]} />
              <Text style={[s.chipTxt, { color: sample ? Colors.amber : Colors.accent }]}>{sample ? 'Sample' : 'Live'}</Text>
            </View>
          )}
        </View>

        {!hasSignals && (
          <View style={s.emptyCard}>
            <Ionicons name="keypad-outline" size={ICON.hero} color={Colors.hint} />
            <Text style={s.emptyT}>No data yet</Text>
            <Text style={s.emptyB}>Type with the StressTwin Keyboard and your first 15-second windows show up here. Want to see how it will look?</Text>
            <TouchableOpacity style={s.sampleBtn} onPress={loadSample}>
              <Ionicons name="flask-outline" size={ICON.md} color="#fff" /><Text style={s.sampleTxt}>Load sample data</Text>
            </TouchableOpacity>
          </View>
        )}

        <EarlyWarningCard ew={ew} threshold={threshold} waiting={waiting} />
        {ready && (
          <>
            {hasSignals && <SessionStats st={stats} />}
            {!sample && <DeviceCompare />}
            <PreventionPath score={score} threshold={threshold} ew={ew} actions={actions} />
            <SignalTiles readings={readings} />
            <Text style={s.note}>Only counts and timings are measured. Which keys you press, and what you type, is never recorded.</Text>
            <WorkloadStrain buckets={buckets} />
            <SignalHeatmap buckets={buckets} />
            <Playbook actions={actions} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  scroll: { padding: 16, gap: 14, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 4 },
  title: { fontSize: rs(22), fontWeight: '500', color: Colors.text, letterSpacing: -0.3 },
  sub: { fontSize: 12.5, color: Colors.muted, marginTop: 3, lineHeight: 18 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, marginTop: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipTxt: { fontFamily: T.mono, fontSize: 11, fontWeight: '700' },
  emptyCard: { alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 18, borderWidth: 0.5, borderColor: Colors.border, padding: 24, gap: 8 },
  emptyT: { fontSize: 16, fontWeight: '600', color: Colors.text },
  emptyB: { fontSize: 13, color: Colors.muted, lineHeight: 20, textAlign: 'center' },
  sampleBtn: { marginTop: 8, minHeight: MIN_TOUCH, paddingHorizontal: 18, borderRadius: 12, backgroundColor: Colors.brand, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sampleTxt: { color: '#fff', fontSize: 14, fontWeight: '600' },
  note: { fontFamily: T.mono, fontSize: 10.5, color: Colors.hint, lineHeight: 16, marginTop: -4 },
})
