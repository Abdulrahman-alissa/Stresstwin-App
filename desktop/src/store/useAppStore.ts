import { create } from 'zustand'

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

/** One 5-second aggregate window from the local monitor. Numbers only — never text. */
export interface SignalSample {
  t: number                    // epoch ms
  keys: number                 // key presses in window (count only)
  cps: number                  // keys per second
  interKeyMs: number | null    // mean gap between keys
  errorRate: number | null     // backspace share 0..1
  mouseSpeed: number | null    // px/s
  clicks: number
  pauses: number
  simulated?: boolean
}

interface AppStore {
  // Auth
  token: string | null
  user: User | null
  setToken: (t: string | null) => void
  setUser: (u: User | null) => void

  // Live score
  currentScore: number
  thresholdCrossed: boolean
  interventionType: string | null
  modelReady: boolean
  trend: ScoreTick[]
  setScore: (s: number, crossed: boolean, intervention: string | null, ready: boolean) => void
  addTrend: (tick: ScoreTick) => void

  // Live signals (local, 5s windows, ~30 min kept)
  signals: SignalSample[]
  sessionStart: number
  addSignal: (s: SignalSample) => void
  setSignals: (s: SignalSample[], trend?: ScoreTick[]) => void

  // Completed prevention actions (this session)
  resets: ResetEvent[]
  addReset: (r: ResetEvent) => void

  // Forecast
  forecasts: DayForecast[]
  forecastReady: boolean
  daysUntilReady: number
  forecastBasis: ForecastBasis | null
  forecastError: boolean
  setForecasts: (f: DayForecast[], ready: boolean, days: number, basis?: ForecastBasis | null) => void
  setForecastError: (v: boolean) => void

  // Monitor
  monitorRunning: boolean
  setMonitorRunning: (v: boolean) => void

  // Nav
  page: string
  setPage: (p: string) => void
}

/** What the forecast is actually built on (real counts from the server). */
export interface ForecastBasis { days_of_data: number; checkins_count: number; days_needed: number; checkins_needed: number; source?: 'personal' | 'global' | 'none'; personal_ready?: boolean; cohort_size?: number }

export const useAppStore = create<AppStore>((set) => ({
  token: null,
  user: null,
  setToken: (token) => set({ token }),
  setUser:  (user)  => set({ user }),

  currentScore: 0,
  thresholdCrossed: false,
  interventionType: null,
  modelReady: false,
  trend: [],
  setScore: (currentScore, thresholdCrossed, interventionType, modelReady) =>
    set({ currentScore, thresholdCrossed, interventionType, modelReady }),
  addTrend: (tick) => set((s) => ({ trend: [...s.trend.slice(-119), tick] })),

  signals: [],
  sessionStart: Date.now(),
  addSignal: (sample) => set((st) => ({ signals: [...st.signals.slice(-359), sample] })),
  setSignals: (signals, trend) => set(trend ? { signals, trend } : { signals }),

  resets: [],
  addReset: (r) => set((st) => ({ resets: [...st.resets.filter(x => x.id !== r.id), r] })),

  forecasts: [],
  forecastReady: false,
  daysUntilReady: 28,
  forecastBasis: null,
  forecastError: false,
  setForecasts: (forecasts, forecastReady, daysUntilReady, basis) =>
    set((st) => ({ forecasts, forecastReady, daysUntilReady, forecastError: false, forecastBasis: basis === undefined ? st.forecastBasis : basis })),
  setForecastError: (forecastError) => set({ forecastError }),

  monitorRunning: false,
  setMonitorRunning: (monitorRunning) => set({ monitorRunning }),

  page: 'dashboard',
  setPage: (page) => set({ page }),
}))
