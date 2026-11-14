import { create } from 'zustand'
import type { SignalSample } from '../lib/insights'

export interface User {
  id: string
  email: string
  full_name?: string
  if_threshold: number
  google_connected: boolean
  outlook_connected: boolean
  if_model_ready: boolean
  lstm_model_ready: boolean
  days_of_data: number
  mood_checkins_count: number
}

export interface DayForecast {
  date: string
  risk: number
  risk_label: 'low' | 'moderate' | 'high'
  primary_stressor?: string
  recommendation?: string
}

export interface ScoreTick { score: number; at: string }

/** A prevention action the person completed — kept so we can MEASURE what it did to their score. */
export interface ResetEvent { id: string; kind: string; title: string; at: number; scoreBefore: number }

interface AppStore {
  token: string | null
  user: User | null
  setToken: (t: string | null) => void
  setUser:  (u: User | null) => void

  currentScore:     number
  thresholdCrossed: boolean
  interventionType: string | null
  modelReady:       boolean
  trend:            ScoreTick[]
  setScore: (s: number, crossed: boolean, iv: string | null, ready: boolean) => void
  addTrend: (t: ScoreTick) => void
  clearIntervention: () => void

  // Live aggregate signals (keyboard windows + motion), newest last
  signals: SignalSample[]
  sessionStart: number
  setSignals: (s: SignalSample[], trend?: ScoreTick[]) => void
  addSignal: (s: SignalSample) => void

  // Completed prevention actions (this session)
  resets: ResetEvent[]
  addReset: (r: ResetEvent) => void

  forecasts:      DayForecast[]
  forecastReady:  boolean
  daysUntilReady: number
  forecastBasis: ForecastBasis | null
  forecastError: boolean
  setForecasts: (f: DayForecast[], ready: boolean, days: number, basis?: ForecastBasis | null) => void
  setForecastError: (v: boolean) => void

  monitorRunning: boolean
  setMonitorRunning: (v: boolean) => void
}

/** What the forecast is actually built on (real counts from the server). */
export interface ForecastBasis { days_of_data: number; checkins_count: number; days_needed: number; checkins_needed: number; source?: 'personal' | 'global' | 'none'; personal_ready?: boolean; cohort_size?: number }

export const useAppStore = create<AppStore>((set) => ({
  token: null,
  user:  null,
  setToken: (token) => set({ token }),
  setUser:  (user)  => set({ user }),

  currentScore:     0,
  thresholdCrossed: false,
  interventionType: null,
  modelReady:       false,
  trend:            [],
  setScore: (currentScore, thresholdCrossed, interventionType, modelReady) =>
    set({ currentScore, thresholdCrossed, interventionType, modelReady }),
  addTrend: (tick) =>
    set((s) => ({ trend: [...s.trend.slice(-119), tick] })),
  clearIntervention: () => set({ interventionType: null }),

  signals: [],
  sessionStart: Date.now(),
  setSignals: (signals, trend) => set(trend ? { signals, trend } : { signals }),
  addSignal: (sample) => set((st) => ({ signals: [...st.signals.slice(-239), sample] })),

  resets: [],
  addReset: (r) => set((st) => ({ resets: [...st.resets.filter(x => x.id !== r.id), r] })),

  forecasts:      [],
  forecastReady:  false,
  daysUntilReady: 28,
  forecastBasis:  null,
  forecastError:  false,
  setForecasts: (forecasts, forecastReady, daysUntilReady, basis) =>
    set((st) => ({ forecasts, forecastReady, daysUntilReady, forecastError: false, forecastBasis: basis === undefined ? st.forecastBasis : basis })),
  setForecastError: (forecastError) => set({ forecastError }),

  monitorRunning: false,
  setMonitorRunning: (monitorRunning) => set({ monitorRunning }),
}))
