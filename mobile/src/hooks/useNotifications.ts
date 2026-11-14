import { useEffect, useRef } from 'react'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge:  false,
  }),
})

export function useNotifications() {
  const notifListener = useRef<any>()
  const responseListener = useRef<any>()

  useEffect(() => {
    registerForPushNotifications()

    notifListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification)
    })

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response:', response)
    })

    return () => {
      Notifications.removeNotificationSubscription(notifListener.current)
      Notifications.removeNotificationSubscription(responseListener.current)
    }
  }, [])
}

async function registerForPushNotifications() {
  if (!Device.isDevice) return null

  const { status: existing } = await Notifications.getPermissionsAsync()
  let finalStatus = existing
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  if (finalStatus !== 'granted') return null

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: 'YOUR_EAS_PROJECT_ID',
  }).catch(() => null)

  return token?.data ?? null
}

export async function scheduleLocalNotification(title: string, body: string, delaySeconds = 0) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: false },
    trigger: delaySeconds > 0 ? { seconds: delaySeconds } : null,
  })
}
