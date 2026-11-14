import { parseDay } from '../../src/lib/deviceStats'
import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { getScoreHistory } from '../../src/api/client'
import { useAppStore } from '../../src/store/useAppStore'
import { Colors, shared, T, scoreColor, rs, ICON, MIN_TOUCH } from '../../src/theme'

interface HistoryItem { date: string; mean_score: number; max_score: number; sample_count: number }

export default function HistoryScreen() {
  const { user } = useAppStore()
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [days, setDays]       = useState(14)
  const [loading, setLoading] = useState(false)
  const threshold = user?.if_threshold ?? 70

  const load = async () => {
    setLoading(true)
    try {
      const data = await getScoreHistory(days)
      setHistory(data.history ?? [])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [days])

  const maxScore = history.length ? Math.max(...history.map(h => h.mean_score), 1) : 100

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>Score History</Text>
            <Text style={s.sub}>Daily mean deviation scores</Text>
          </View>
          <View style={s.dayPills}>
            {[7,14,30].map(d => (
              <TouchableOpacity key={d}
                style={[s.dayPill, days===d && s.dayPillActive]}
                onPress={() => setDays(d)}>
                <Text style={[s.dayPillTxt, days===d && s.dayPillTxtActive]}>{d}d</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Stats row */}
        {history.length > 0 && (
          <View style={s.statsRow}>
            {[
              { label:'Avg',   val: Math.round(history.reduce((a,b)=>a+b.mean_score,0)/history.length) },
              { label:'Peak',  val: Math.round(Math.max(...history.map(h=>h.max_score))) },
              { label:'Above', val: history.filter(h=>h.mean_score>threshold).length },
              { label:'Days',  val: history.length },
            ].map(st => (
              <View key={st.label} style={s.statCard}>
                <Text style={s.statVal}>{st.val}</Text>
                <Text style={s.statLbl}>{st.label}</Text>
              </View>
            ))}
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={Colors.brand} style={{ marginTop: 60 }} size="large" />
        ) : history.length === 0 ? (
          <View style={[shared.card, { alignItems: 'center', padding: 40 }]}>
            <Ionicons name="bar-chart-outline" size={ICON.hero} color={Colors.hint} style={{ marginBottom: 12 }} />
            <Text style={s.emptyTitle}>No history yet</Text>
            <Text style={s.emptySub}>Start a monitoring session and come back in 24 hours.</Text>
          </View>
        ) : (
          <View style={shared.card}>
            <Text style={shared.clbl}>Daily Scores</Text>

            {/* Bar chart */}
            <View style={s.chartArea}>
              {/* Threshold line */}
              <View style={[s.threshLine, { bottom: `${(threshold / 100) * 140}%` as any }]} />

              <View style={s.bars}>
                {history.map((h, i) => {
                  const barH = Math.max((h.mean_score / maxScore) * 140, 4)
                  const color = scoreColor(h.mean_score)
                  const label = parseDay(h.date).toLocaleDateString('en-US', { weekday: 'narrow' })
                  return (
                    <View key={h.date} style={s.barCol}>
                      <View style={[s.bar, { height: barH, backgroundColor: color }]} />
                      <Text style={s.barLabel}>{label}</Text>
                    </View>
                  )
                })}
              </View>
            </View>

            <View style={s.legend}>
              {[['var(--accent)', Colors.accent, 'Optimal'], [Colors.amber, Colors.amber, 'Elevated'], [Colors.red, Colors.red, 'High']].map(([_, c, l]) => (
                <View key={l} style={s.legItem}>
                  <View style={[s.legDot, { backgroundColor: c }]} />
                  <Text style={s.legTxt}>{l}</Text>
                </View>
              ))}
              <View style={s.legItem}>
                <View style={[s.legDot, { backgroundColor: Colors.amber, borderRadius: 0, height: 1, width: 12 }]} />
                <Text style={s.legTxt}>Threshold</Text>
              </View>
            </View>

            {/* List */}
            <View style={{ marginTop: 16, gap: 8 }}>
              {[...history].reverse().slice(0, 7).map(h => {
                const color = scoreColor(h.mean_score)
                const day = parseDay(h.date).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
                return (
                  <View key={h.date} style={s.listRow}>
                    <Text style={s.listDay}>{day}</Text>
                    <View style={s.listBarTrack}>
                      <View style={[s.listBarFill, { width:`${h.mean_score}%` as any, backgroundColor: color }]} />
                    </View>
                    <Text style={[s.listScore, { color }]}>{Math.round(h.mean_score)}</Text>
                  </View>
                )
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  scroll:  { padding: 16, paddingBottom: 32 },
  header:  { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  title:   { fontSize: rs(22), fontWeight: '500', color: Colors.text, letterSpacing: -0.3 },
  sub:     { fontSize: 12, color: Colors.muted, marginTop: 3 },
  dayPills:{ flexDirection: 'row', gap: 6, marginTop: 4 },
  dayPill: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 20, borderWidth: 0.5, borderColor: Colors.border2, backgroundColor: Colors.surface },
  dayPillActive: { backgroundColor: Colors.brandDim, borderColor: 'rgba(59,91,219,.3)' },
  dayPillTxt: { fontFamily: T.mono, fontSize: 12, fontWeight: '600', color: Colors.muted },
  dayPillTxtActive: { color: Colors.brand },
  statsRow:{ flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard:{ flex: 1, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 0.5, borderColor: Colors.border, padding: 12, alignItems: 'center' },
  statVal: { fontFamily: T.mono, fontSize: rs(20), fontWeight: '300', color: Colors.brand },
  statLbl: { fontFamily: T.mono, fontSize: 10, color: Colors.hint, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.8 },
  chartArea: { height: 160, marginBottom: 8, position: 'relative', justifyContent: 'flex-end' },
  threshLine:{ position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Colors.amber, opacity: 0.5 },
  bars:  { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 140 },
  barCol:{ flex: 1, alignItems: 'center', gap: 4 },
  bar:   { width: '100%', borderRadius: 3 },
  barLabel:{ fontFamily: T.mono, fontSize: 10, color: Colors.hint },
  legend:{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 6 },
  legItem:{ flexDirection: 'row', alignItems: 'center', gap: 5 },
  legDot: { width: 8, height: 8, borderRadius: 4 },
  legTxt: { fontFamily: T.mono, fontSize: 10, color: Colors.muted },
  listRow:{ flexDirection: 'row', alignItems: 'center', gap: 10 },
  listDay:{ fontFamily: T.mono, fontSize: 11, color: Colors.muted, width: 72 },
  listBarTrack:{ flex: 1, height: 4, backgroundColor: Colors.surface2, borderRadius: 2, overflow: 'hidden' },
  listBarFill:{ height: '100%', borderRadius: 2 },
  listScore:{ fontFamily: T.mono, fontSize: 12, fontWeight: '600', width: 28, textAlign: 'right' },
  emptyTitle:{ fontSize: 16, fontWeight: '600', color: Colors.text, marginBottom: 8 },
  emptySub:{ fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
})
