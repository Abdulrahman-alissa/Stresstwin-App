import { useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { earlyWarning, readSignals, recommend } from '../lib/insights'

/** Derives everything the Insights widgets need from the store. */
export function useInsights() {
  const { signals, trend, currentScore, user, forecasts, sessionStart } = useAppStore()
  const threshold = user?.if_threshold ?? 70
  return useMemo(() => {
    const score = trend.length ? trend[trend.length - 1].score : currentScore
    const readings = readSignals(signals)
    const ew = earlyWarning(score, trend, signals, threshold)
    const actions = recommend(ew, signals, forecasts, sessionStart)
    const hasSignals = signals.length >= 6
    // nothing measured yet → don't present "0/100, all calm" as if it were a result
    const waiting = !hasSignals && trend.length < 3
    return { threshold, score, readings, ew, actions, hasSignals, waiting }
  }, [signals, trend, currentScore, threshold, forecasts, sessionStart])
}
