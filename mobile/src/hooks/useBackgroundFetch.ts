import * as BackgroundFetch from 'expo-background-fetch'
import * as TaskManager from 'expo-task-manager'
import * as SecureStore from 'expo-secure-store'
import axios from 'axios'
import Constants from 'expo-constants'

const TASK_NAME = 'STRESSTWIN_BACKGROUND_FETCH'
const BASE = Constants.expoConfig?.extra?.apiBaseUrl || 'http://localhost:8000'

// Register task handler (must be at top-level, outside component)
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const token = await SecureStore.getItemAsync('st_token')
    if (!token) return BackgroundFetch.BackgroundFetchResult.NoData

    // Fetch current score to keep model warmed up
    await axios.get(`${BASE}/api/scores/current`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    })

    return BackgroundFetch.BackgroundFetchResult.NewData
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed
  }
})

export async function registerBackgroundFetch() {
  const status = await BackgroundFetch.getStatusAsync()
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) {
    return false
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME)
  if (!isRegistered) {
    await BackgroundFetch.registerTaskAsync(TASK_NAME, {
      minimumInterval: 15 * 60, // 15 minutes minimum (iOS enforces this)
      stopOnTerminate: false,
      startOnBoot: true,
    })
  }
  return true
}

export async function unregisterBackgroundFetch() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME)
  if (isRegistered) {
    await BackgroundFetch.unregisterTaskAsync(TASK_NAME)
  }
}
