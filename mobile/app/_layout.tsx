import { useEffect, useState } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import * as SecureStore from 'expo-secure-store'
import * as SplashScreen from 'expo-splash-screen'
import { View, ActivityIndicator } from 'react-native'
import { useAppStore } from '../src/store/useAppStore'
import { getProfile } from '../src/api/client'
import { useNotifications } from '../src/hooks/useNotifications'
import { Colors } from '../src/theme'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const { setToken, setUser, token } = useAppStore()
  const [ready, setReady] = useState(false)
  useNotifications()
  const router = useRouter()
  const segments = useSegments()
  const inAuth = segments[0] === 'auth'
  // Route guard: expo-router opens the first route (the dashboard) on its own, so signed-out users
  // must be sent to the sign-in screen explicitly (and signed-in users away from it).
  const misplaced = ready && ((!token && !inAuth) || (!!token && inAuth))
  useEffect(() => {
    if (!ready) return
    if (!token && !inAuth) router.replace('/auth')
    else if (token && inAuth) router.replace('/')
  }, [ready, token, inAuth])

  useEffect(() => {
    const boot = async () => {
      try {
        const saved = await SecureStore.getItemAsync('st_token')
        if (saved) {
          setToken(saved)
          const profile = await getProfile()
          setUser(profile)
        }
      } catch {
        await SecureStore.deleteItemAsync('st_token').catch(() => {})
        setToken(null)
        setUser(null)
      } finally {
        setReady(true)
        SplashScreen.hideAsync()
      }
    }
    boot()
  }, [])

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.brand} size="large" />
      </View>
    )
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={Colors.bg} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }}>
          <Stack.Screen name="auth" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
        </Stack>
        {misplaced && <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: Colors.bg }} />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
