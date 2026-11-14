/**
 * keyboardSync
 * ─────────────
 * Two independent cadences, as required:
 *
 *   COLLECTION  — every ~15s: pull whatever the native keyboard/sensor layer
 *                 has buffered and enqueue it into the local SQLite store.
 *                 Never touches the network.
 *
 *   SYNC        — every ~10min: drain the local store and upload in one
 *                 batch to POST /api/events/batch-upload. Only rows the
 *                 server acknowledges are marked synced; everything else
 *                 stays queued for the next attempt (offline-safe).
 *
 * Foreground: both run on JS timers while the app is open.
 * Background: iOS/Android both restrict background execution, so we also
 * register a background task (matching the existing useBackgroundFetch.ts
 * pattern) that — when the OS actually wakes it — runs one pull + one sync
 * pass. Background wake cadence is controlled by the OS, not us; per
 * platform docs, treat the 10-minute figure as a target, not a guarantee,
 * while the app is backgrounded or terminated.
 */
import { useEffect, useRef } from 'react'
import * as BackgroundFetch from 'expo-background-fetch'
import * as TaskManager from 'expo-task-manager'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { pullNativeSnapshots } from './keyboardBridge'
import { getPendingSnapshots, markSynced, purgeOldSynced } from './localFeatureStore'
import { uploadSnapshotBatch } from '../api/client'
import { getOrCreateDeviceId } from './deviceId'

const COLLECTION_INTERVAL_MS = 15_000
const SYNC_INTERVAL_MS = 10 * 60_000
const BG_TASK_NAME = 'STRESSTWIN_KEYBOARD_SYNC'

async function runCollectionPass() {
  await pullNativeSnapshots()
}

async function runSyncPass(): Promise<{ uploaded: number }> {
  const token = await SecureStore.getItemAsync('st_token')
  if (!token) return { uploaded: 0 }

  const pending = await getPendingSnapshots(500)
  if (pending.length === 0) {
    await purgeOldSynced()
    return { uploaded: 0 }
  }

  const deviceId = await getOrCreateDeviceId()
  try {
    const res = await uploadSnapshotBatch({
      device_id: deviceId,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      source: 'mobile_keyboard',
      snapshots: pending as unknown as Record<string, unknown>[],
    })
    // Server accepted duplicates gracefully too — either way these client ids
    // are now resolved server-side, so it's safe to mark them synced locally.
    await markSynced(pending.map(p => p.client_snapshot_id))
    await purgeOldSynced()
    return { uploaded: res.accepted ?? pending.length }
  } catch {
    // Offline or server error — leave everything queued, retry next cycle.
    return { uploaded: 0 }
  }
}

// ── Background task (best-effort; OS decides actual wake frequency) ──────────
TaskManager.defineTask(BG_TASK_NAME, async () => {
  try {
    await runCollectionPass()
    const { uploaded } = await runSyncPass()
    return uploaded > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed
  }
})

export async function registerKeyboardSyncBackgroundTask() {
  const status = await BackgroundFetch.getStatusAsync()
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) {
    return false
  }
  const already = await TaskManager.isTaskRegisteredAsync(BG_TASK_NAME)
  if (!already) {
    await BackgroundFetch.registerTaskAsync(BG_TASK_NAME, {
      minimumInterval: 10 * 60, // 10 minutes — iOS/Android may still throttle this further
      stopOnTerminate: false,
      startOnBoot: true,
    })
  }
  return true
}

export async function unregisterKeyboardSyncBackgroundTask() {
  if (await TaskManager.isTaskRegisteredAsync(BG_TASK_NAME)) {
    await TaskManager.unregisterTaskAsync(BG_TASK_NAME)
  }
}

/** Mount once near the app root (alongside useBehavioralMonitor) while the user is signed in. */
export function useKeyboardSync(enabled: boolean) {
  const collectionTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const syncTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!enabled) return

    registerKeyboardSyncBackgroundTask()

    collectionTimer.current = setInterval(runCollectionPass, COLLECTION_INTERVAL_MS)
    syncTimer.current = setInterval(runSyncPass, SYNC_INTERVAL_MS)
    // Kick off one of each immediately rather than waiting a full interval.
    runCollectionPass()
    runSyncPass()

    return () => {
      if (collectionTimer.current) clearInterval(collectionTimer.current)
      if (syncTimer.current) clearInterval(syncTimer.current)
    }
  }, [enabled])
}
