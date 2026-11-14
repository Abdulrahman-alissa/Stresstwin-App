import axios from 'axios'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'

const BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  Constants.expoConfig?.extra?.apiBaseUrl ||
  'http://localhost:8000'

const api = axios.create({ baseURL: BASE, timeout: 15000 })

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('st_token').catch(() => null)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      SecureStore.deleteItemAsync('st_token').catch(() => {})
    }
    return Promise.reject(err)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authRegister = (email: string, password: string, full_name?: string) =>
  api.post('/api/auth/register', { email, password, full_name }).then(r => r.data)

export const authLogin = (email: string, password: string) =>
  api.post('/api/auth/login', { email, password }).then(r => r.data)

export const authLogout = () =>
  api.post('/api/auth/logout').then(r => r.data)

// ── User ──────────────────────────────────────────────────────────────────────
export const getProfile = () =>
  api.get('/api/users/me').then(r => r.data)

export const updateProfile = (body: { full_name?: string; if_threshold?: number }) =>
  api.patch('/api/users/me', body).then(r => r.data)

export const deleteAllData = () =>
  api.delete('/api/users/me/data').then(r => r.data)

// ── Events ────────────────────────────────────────────────────────────────────
export const submitBatch = (features: Record<string, unknown>) =>
  api.post('/api/events/batch', { features }).then(r => r.data)

// 10-minute batched upload of locally-buffered 15s snapshots (keyboard/sensor).
export const uploadSnapshotBatch = (body: {
  device_id: string
  platform: 'android' | 'ios' | 'desktop'
  source: 'mobile_keyboard' | 'mobile_sensor' | 'desktop_sensor'
  snapshots: Array<Record<string, unknown>>
}) => api.post('/api/events/batch-upload', body).then(r => r.data)

// ── Devices ───────────────────────────────────────────────────────────────────
export const registerDevice = (body: { device_id: string; platform: 'android' | 'ios' | 'desktop'; display_name: string }) =>
  api.post('/api/devices/register', body).then(r => r.data)

export const getDevices = () =>
  api.get('/api/devices').then(r => r.data)

export const getDeviceStats = (hours = 24): Promise<import('../lib/deviceStats').DeviceStatsResponse> =>
  api.get(`/api/devices/stats?hours=${hours}`).then(r => r.data)

export const deviceHeartbeat = (deviceId: string, body: { keyboard_active?: boolean }) =>
  api.post(`/api/devices/${deviceId}/heartbeat`, body).then(r => r.data)

// ── Scores ────────────────────────────────────────────────────────────────────
export const getCurrentScore = () =>
  api.get('/api/scores/current').then(r => r.data)

export const getScoreHistory = (days = 30) =>
  api.get(`/api/scores/history?days=${days}`).then(r => r.data)

// ── Forecast ──────────────────────────────────────────────────────────────────
export const getForecast = () =>
  api.get('/api/forecast/3day').then(r => r.data)

export const submitCheckin = (rating: number, note?: string) =>
  api.post('/api/forecast/checkin', { rating, note }).then(r => r.data)

// ── Calendar ──────────────────────────────────────────────────────────────────
export const getCalendarAuthUrl = (provider: 'google' | 'outlook') =>
  api.get(`/api/calendar/${provider}/connect`).then(r => r.data)

export const syncCalendar = (provider: 'google' | 'outlook') =>
  api.post(`/api/calendar/${provider}/sync`).then(r => r.data)

export const disconnectCalendar = (provider: 'google' | 'outlook') =>
  api.delete(`/api/calendar/${provider}/disconnect`).then(r => r.data)

export const getCalendarStatus = () =>
  api.get('/api/calendar/status').then(r => r.data)

export default api
