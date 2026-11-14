import { useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { earlyWarning, readSignals, recommend } from '../lib/insights'

/** Derives everything the Insights widgets need from the store. Recomputes when new data lands. */
export function useInsights() {
  const { signals, trend, currentScore, user, forecasts, sessionStart } = useAppStore()
  const threshold = user?.if_threshold ?? 70
  return useMemo(() => {
    const score = trend.length ? trend[trend.length - 1].score : currentScore
    const readings = readSignals(signals)
    const ew = earlyWarning(score, trend, signals, threshold)
    const actions = recommend(ew, signals, forecasts, sessionStart)
    return { threshold, score, readings, ew, actions, hasSignals: signals.length >= 6 }
  }, [signals, trend, currentScore, threshold, forecasts, sessionStart])
}
