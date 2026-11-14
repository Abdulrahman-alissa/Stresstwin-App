/**
 * keyboardBridge
 * ───────────────
 * Thin wrapper around the native `stresstwin-keyboard` Expo module
 * (see /modules/stresstwin-keyboard). That module is a *bridge only* — the
 * actual keystroke-timing collection happens inside:
 *   - Android: StressTwinInputMethodService (an InputMethodService)
 *   - iOS:     KeyboardViewController (a UIInputViewController keyboard extension)
 * which run as separate OS processes from this app and cannot be called
 * directly. Instead they write finished 15s snapshots to a location this
 * module can read:
 *   - Android: a SQLite file in shared app storage
 *   - iOS:     an App Group shared container (UserDefaults/suite)
 *
 * Requires `expo prebuild` (or a custom dev client / EAS build) — this will
 * NOT work in Expo Go, since Expo Go can't ship a third-party keyboard
 * extension or IME service. If the native module isn't present (e.g. still
 * running in Expo Go during UI development), every call below degrades to a
 * safe no-op / neutral status so the rest of the app keeps working.
 */
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'
import * as Linking from 'expo-linking'
import { enqueueSnapshot, FeatureSnapshot } from './localFeatureStore'

const native = requireOptionalNativeModule('StressTwinKeyboard')

export interface KeyboardStatus {
  /** Is the StressTwin keyboard installed/enabled as an available keyboard at all. */
  installed: boolean
  /** Is it the *currently selected/active* keyboard right now (Android only — iOS can't tell us this). */
  isActive: boolean
  available: boolean // native module present (i.e. this is a prebuilt/dev-client build, not Expo Go)
}

export async function getKeyboardStatus(): Promise<KeyboardStatus> {
  if (!native) return { installed: false, isActive: false, available: false }
  try {
    const result = await native.getStatus()
    return { installed: !!result.installed, isActive: !!result.isActive, available: true }
  } catch {
    return { installed: false, isActive: false, available: false }
  }
}

/** Deep-links into the OS keyboard settings screen so the user can enable/select StressTwin Keyboard. */
export async function openKeyboardSettings() {
  if (native?.openSystemKeyboardSettings) {
    try {
      await native.openSystemKeyboardSettings()
      return
    } catch {
      /* fall through to generic Linking below */
    }
  }
  if (Platform.OS === 'android') {
    // ACTION_INPUT_METHOD_SETTINGS — lets the user enable + select the IME.
    await Linking.sendIntent?.('android.settings.INPUT_METHOD_SETTINGS').catch(() => Linking.openSettings())
  } else {
    // iOS has no direct deep link into Settings > General > Keyboard > Keyboards;
    // Apple restricts this. Send the user to the app's Settings page instead.
    await Linking.openSettings()
  }
}

/**
 * Drains any 15s snapshots the native keyboard extension has produced since
 * the last pull, and copies them into the shared localFeatureStore queue
 * that keyboardSync.ts uploads on the 10-minute cadence. Call this on a
 * ~15s foreground timer AND opportunistically on app resume/background-task
 * wakeups, since the extension process can't push to this app directly.
 */
export async function pullNativeSnapshots(): Promise<number> {
  if (!native?.drainSnapshots) return 0
  try {
    const raw: FeatureSnapshot[] = await native.drainSnapshots()
    for (const snap of raw) await enqueueSnapshot(snap)
    return raw.length
  } catch {
    return 0
  }
}
