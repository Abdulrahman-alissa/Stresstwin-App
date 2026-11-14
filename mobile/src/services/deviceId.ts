/**
 * A stable, app-generated device identifier — deliberately NOT the hardware
 * IDFA/IMEI/serial (Apple/Google restrict and deprecate those, and StressTwin
 * doesn't need cross-app device fingerprinting, only "same device across
 * StressTwin sessions"). Generated once, persisted in SecureStore, reused for
 * device registration, snapshot uploads, and the device dashboard.
 */
import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'

const KEY = 'st_device_id'

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY)
  if (existing) return existing
  const id = Crypto.randomUUID()
  await SecureStore.setItemAsync(KEY, id)
  return id
}

const NAME_KEY = 'st_device_name'
export function defaultDeviceName(os: string): string { return os === 'ios' ? 'iPhone' : 'Android Phone' }
export async function getDeviceName(os: string): Promise<string> {
  try { return (await SecureStore.getItemAsync(NAME_KEY)) || defaultDeviceName(os) } catch { return defaultDeviceName(os) }
}
export async function setDeviceName(name: string): Promise<void> {
  await SecureStore.setItemAsync(NAME_KEY, name)
}
