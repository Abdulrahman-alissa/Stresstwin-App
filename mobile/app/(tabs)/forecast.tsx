import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAppStore } from '../../src/store/useAppStore'
import { loadForecast } from '../../src/lib/loadForecast'
import { parseDay } from '../../src/lib/deviceStats'
import ForecastBasis, { basisText, StarterNote } from '../../src/components/ForecastBasis'
import { Colors, shared, T, riskColor, rs, ICON, MIN_TOUCH } from '../../src/theme'

export default function ForecastScreen() {
  const { forecasts, forecastReady, daysUntilReady, forecastBasis, forecastError } = useAppStore()
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try { await loadForecast() } finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>3-Day Forecast</Text>
            <Text style={s.sub}>LSTM · calendar-aware prediction</Text>
          </View>
          <TouchableOpacity style={s.refreshBtn} onPress={refresh} disabled={loading}>
            {loading
              ? <ActivityIndicator color={Colors.muted} size="small" />
              : <Ionicons name="refresh" size={ICON.lg} color={Colors.muted} />}
          </TouchableOpacity>
        </View>

        {forecastError && (
          <View style={s.errBox}>
            <Text style={s.errTxt}>Couldn't reach the server{forecasts.length ? ' — showing the last forecast.' : '.'}</Text>
            <TouchableOpacity onPress={refresh} style={s.errBtn}><Text style={s.errBtnTxt}>Retry</Text></TouchableOpacity>
          </View>
        )}
        {forecastReady && <StarterNote />}
        {forecastReady && forecastBasis && <Text style={s.basis}>{basisText(forecastBasis)} · refreshed every 6 hours</Text>}

        {loading && forecasts.length === 0 ? (
          <ActivityIndicator color={Colors.brand} style={{ marginTop: 60 }} size="large" />
        ) : !forecastReady ? (
          <View style={shared.card}>
            <Ionicons name="calendar-outline" size={ICON.hero} color={Colors.hint} style={{ alignSelf: 'center', marginBottom: 16 }} />
            <Text style={s.emptyTitle}>Forecast not yet available</Text>
            <Text style={s.emptySub}>
              The LSTM model activates after {daysUntilReady} more day{daysUntilReady !== 1 ? 's' : ''} of data
              and {forecastBasis?.checkins_needed ?? 20} mood check-ins.{'\n\n'}
              Connect your Google or Outlook calendar in Settings to get the full calendar-aware forecast.
            </Text>
            <ForecastBasis />
          </View>
        ) : (
          forecasts.map((f, i) => {
            const rc = riskColor(f.risk_label)
            const day = parseDay(f.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
            return (
              <View key={f.date} style={[shared.card, { marginBottom: 12 }]}>
                <View style={s.fcHeader}>
                  <Text style={s.fcDay}>{day}</Text>
                  <View style={[s.fcBadge, { backgroundColor: `${rc}22` }]}>
                    <Text style={[s.fcBadgeTxt, { color: rc }]}>{f.risk_label} risk</Text>
                  </View>
                </View>

                {/* Risk bar */}
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: `${f.risk * 100}%` as any, backgroundColor: rc }]} />
                </View>
                <Text style={[s.fcPct, { color: rc }]}>{Math.round(f.risk * 100)}% risk probability</Text>

                {f.primary_stressor && (
                  <View style={s.stressorBox}>
                    <View style={s.iconLine}><Ionicons name="warning-outline" size={ICON.md} color={Colors.amber} /><Text style={s.stressorTxt}>{f.primary_stressor}</Text></View>
                  </View>
                )}
                {f.recommendation && (
                  <View style={s.recBox}>
                    <View style={s.iconLine}><Ionicons name="bulb-outline" size={ICON.md} color={Colors.muted} /><Text style={s.recTxt}>{f.recommendation}</Text></View>
                  </View>
                )}
              </View>
            )
          })
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  scroll:   { padding: 16, paddingBottom: 32 },
  header:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  title:    { fontSize: rs(22), fontWeight: '500', color: Colors.text, letterSpacing: -0.3 },
  sub:      { fontSize: 12, color: Colors.muted, marginTop: 3 },
  refreshBtn:{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  iconLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errBox:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: Colors.amberDim, borderRadius: 10, paddingLeft: 12, marginBottom: 12 },
  errTxt:   { flex: 1, fontSize: 12, color: Colors.amber, paddingVertical: 10 },
  errBtn:   { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 14 },
  errBtnTxt:{ fontFamily: T.mono, fontSize: 12, fontWeight: '700', color: Colors.amber },
  basis:    { fontFamily: T.mono, fontSize: 11, color: Colors.hint, marginBottom: 12 },
  confRow:  { flexDirection: 'row', gap: 8, marginBottom: 14 },
  confBadge:{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: Colors.surface2, borderWidth: 0.5, borderColor: Colors.border2 },
  confText: { fontFamily: T.mono, fontSize: 11, fontWeight: '600', color: Colors.muted },
  emptyTitle:{ fontSize: 16, fontWeight: '600', color: Colors.text, textAlign: 'center', marginBottom: 10 },
  emptySub: { fontSize: 13, color: Colors.muted, lineHeight: 20, textAlign: 'center' },
  fcHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  fcDay:    { fontSize: 14, fontWeight: '500', color: Colors.text, flex: 1 },
  fcBadge:  { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  fcBadgeTxt:{ fontFamily: T.mono, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  barTrack: { height: 6, backgroundColor: Colors.surface2, borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  barFill:  { height: '100%', borderRadius: 3 },
  fcPct:    { fontFamily: T.mono, fontSize: 12, fontWeight: '600', marginBottom: 10 },
  stressorBox:{ backgroundColor: Colors.amberDim, borderRadius: 8, padding: 10, marginBottom: 8 },
  stressorTxt:{ flex: 1, fontSize: 13, color: Colors.amber, lineHeight: 18 },
  recBox:   { backgroundColor: Colors.surface2, borderRadius: 8, padding: 10 },
  recTxt:   { flex: 1, fontSize: 13, color: Colors.muted, lineHeight: 18 },
})
