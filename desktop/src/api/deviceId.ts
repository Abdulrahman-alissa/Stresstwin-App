const KEY = 'st_device_id'

export function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(KEY, id)
  }
  return id
}

const NAME_KEY = 'st_device_name'
const PAUSE_KEY = 'st_monitor_paused'

export function defaultDeviceName(): string {
  const p = (navigator.platform || navigator.userAgent || '').toLowerCase()
  if (p.includes('mac')) return 'Mac'
  if (p.includes('win')) return 'Windows PC'
  if (p.includes('linux')) return 'Linux PC'
  return 'Desktop'
}
export function getDeviceName(): string {
  try { return localStorage.getItem(NAME_KEY) || defaultDeviceName() } catch { return defaultDeviceName() }
}
export function setDeviceName(n: string) { try { localStorage.setItem(NAME_KEY, n) } catch {} }
export function isMonitorPaused(): boolean { try { return localStorage.getItem(PAUSE_KEY) === '1' } catch { return false } }
export function setMonitorPaused(v: boolean) { try { v ? localStorage.setItem(PAUSE_KEY, '1') : localStorage.removeItem(PAUSE_KEY) } catch {} }
