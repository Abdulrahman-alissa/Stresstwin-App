/**
 * useSignalFeed — keeps the Insights data fresh.
 * Loads the recent keyboard windows from the on-device store (so the charts
 * survive an app restart), and reloads whenever the keyboard bridge delivers
 * a new 15 s window. Motion samples are pushed by useBehavioralMonitor.
 */
import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { getRecentSnapshots, subscribeSnapshots } from '../services/localFeatureStore'
import type { SignalSample } from '../lib/insights'

export function useSignalFeed(enabled = true) {
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = async () => {
      try {
        const rows = await getRecentSnapshots(240)
        if (!alive) return
        const kb: SignalSample[] = rows.reverse().map(r => ({
          t: new Date(r.window_start).getTime() + (r.session_duration ?? 15) * 1000,
          dur: r.session_duration ?? 15,
          keys: r.char_count ?? 0,
          cps: r.typing_speed_cps ?? null,
          interKeyMs: r.inter_key_interval_ms ?? null,
          errorRate: r.backspace_rate ?? null,
          pauses: r.pause_frequency ?? null,
          bursts: r.typing_bursts ?? null,
          motion: null,
        }))
        // keep motion samples (they only live in memory), replace keyboard ones with the stored truth
        const st = useAppStore.getState()
        const motion = st.signals.filter(s => s.keys == null && !s.simulated)
        const keepDemo = st.signals.some(s => s.simulated) && kb.length === 0
        if (keepDemo) return
        const merged = [...kb, ...motion].sort((a, b) => a.t - b.t).slice(-240)
        st.setSignals(merged)
      } catch { /* store not ready yet */ }
    }
    load()
    const unsub = subscribeSnapshots(load)
    return () => { alive = false; unsub() }
  }, [enabled])
}
