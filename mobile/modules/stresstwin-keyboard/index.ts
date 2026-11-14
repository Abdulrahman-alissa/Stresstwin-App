import { requireOptionalNativeModule } from 'expo-modules-core'

export type NativeFeatureSnapshot = {
  client_snapshot_id: string
  window_start: string
  typing_speed_cps?: number | null
  inter_key_interval_ms?: number | null
  backspace_rate?: number | null
  correction_rate?: number | null
  pause_frequency?: number | null
  typing_bursts?: number | null
  typing_interruptions?: number | null
  char_count?: number | null
  session_duration: number
}

export interface StressTwinKeyboardModule {
  /** installed = keyboard appears in the OS's list of available keyboards. isActive = it is the currently selected one (Android only; iOS has no API to check this). */
  getStatus(): Promise<{ installed: boolean; isActive: boolean }>
  /** Opens the platform's "manage keyboards" settings screen. */
  openSystemKeyboardSettings(): Promise<void>
  /** Returns and clears all 15s snapshots the keyboard extension has buffered since the last call. */
  drainSnapshots(): Promise<NativeFeatureSnapshot[]>
}

export default requireOptionalNativeModule<StressTwinKeyboardModule>('StressTwinKeyboard')
