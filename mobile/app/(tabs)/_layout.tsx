import { Tabs } from 'expo-router'
import { Platform } from 'react-native'
import { useEffect } from 'react'
import { useBehavioralMonitor } from '../../src/hooks/useBehavioralMonitor'
import { useKeyboardSync } from '../../src/services/keyboardSync'
import { useSignalFeed } from '../../src/hooks/useSignalFeed'
import { getOrCreateDeviceId, getDeviceName } from '../../src/services/deviceId'
import { registerDevice } from '../../src/api/client'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, ICON } from '../../src/theme'

type IconName = React.ComponentProps<typeof Ionicons>['name']
const icons: Record<string, [IconName, IconName]> = {
  index:    ['speedometer', 'speedometer-outline'],
  insights: ['pulse',        'pulse-outline'],
  forecast: ['calendar',     'calendar-outline'],
  history:  ['bar-chart',    'bar-chart-outline'],
  settings: ['settings',     'settings-outline'],
}

export default function TabLayout() {
  const insets = useSafeAreaInsets()
  // Respect the real bottom inset (home indicator / Android gesture bar) instead of guessing.
  const bottom = Math.max(insets.bottom, 8)
  // Start behavioral monitor for the entire tab session
  useBehavioralMonitor()

  // Register this device once per session and start the 15s-collect /
  // 10min-sync keyboard pipeline (services/keyboardSync.ts).
  useEffect(() => {
    Promise.all([getOrCreateDeviceId(), getDeviceName(Platform.OS)]).then(([deviceId, name]) => {
      registerDevice({
        device_id: deviceId,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        display_name: name,
      }).catch(() => {})
    })
  }, [])
  useKeyboardSync(true)
  // Live aggregate signals for the Insights tab (keyboard windows from the on-device store).
  useSignalFeed(true)

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor:  Colors.border,
          borderTopWidth:  0.5,
          paddingBottom:   bottom,
          paddingTop:      8,
          height:          56 + bottom,
        },
        tabBarIcon: ({ focused, color }) => {
          const [on, off] = icons[route.name] ?? icons.index
          return <Ionicons name={focused ? on : off} size={ICON.lg} color={color} />
        },
        tabBarActiveTintColor:   Colors.brand,
        tabBarInactiveTintColor: Colors.hint,
        tabBarLabelStyle: {
          fontSize:    11,
          fontWeight:  '600',
        },
      })}
    >
      <Tabs.Screen name="index"    options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="insights" options={{ title: 'Insights' }} />
      <Tabs.Screen name="forecast" options={{ title: 'Forecast' }} />
      <Tabs.Screen name="history"  options={{ title: 'History' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  )
}
