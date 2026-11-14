import { getForecast } from '../api/client'
import { useAppStore } from '../store/useAppStore'

/** Fetch the forecast and put it (and its real basis counts) into the store. Returns false on failure. */
export async function loadForecast(): Promise<boolean> {
  const st = useAppStore.getState()
  try {
    const d = await getForecast()
    st.setForecasts(d.forecasts ?? [], !!d.model_ready, d.days_until_ready ?? d.days_needed ?? 28, {
      days_of_data: d.days_of_data ?? 0,
      checkins_count: d.checkins_count ?? 0,
      days_needed: d.days_needed ?? 28,
      checkins_needed: d.checkins_needed ?? 20,
      source: d.source ?? 'none',
      personal_ready: !!d.personal_ready,
      cohort_size: d.cohort_size ?? 0,
    })
    return true
  } catch {
    st.setForecastError(true)
    return false
  }
}
