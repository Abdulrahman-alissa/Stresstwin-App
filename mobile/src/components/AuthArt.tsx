import { StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Path, Circle, G } from 'react-native-svg'

/** Full-screen deep-navy background with soft glows and flowing wave lines (decorative only). */
export function AuthBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 400 860" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0B1330" />
            <Stop offset="0.45" stopColor="#060A1A" />
            <Stop offset="1" stopColor="#050818" />
          </LinearGradient>
          <RadialGradient id="glowA" cx="0.15" cy="0.05" r="0.6">
            <Stop offset="0" stopColor="#2447C9" stopOpacity="0.45" />
            <Stop offset="1" stopColor="#2447C9" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="glowB" cx="0.9" cy="0.95" r="0.6">
            <Stop offset="0" stopColor="#3A2FD0" stopOpacity="0.4" />
            <Stop offset="1" stopColor="#3A2FD0" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="400" height="860" fill="url(#bg)" />
        <Rect width="400" height="860" fill="url(#glowA)" />
        <Rect width="400" height="860" fill="url(#glowB)" />
        <Path d="M-10 150 C 60 140 150 90 175 -10" stroke="#3B5BDB" strokeOpacity="0.35" strokeWidth="1.2" fill="none" />
        <Path d="M-10 175 C 80 170 170 110 200 -10" stroke="#3B5BDB" strokeOpacity="0.2" strokeWidth="1" fill="none" />
        <Path d="M-10 770 C 80 700 190 700 260 745 C 320 785 370 750 410 690" stroke="#4B4FE0" strokeOpacity="0.45" strokeWidth="1.4" fill="none" />
        <Path d="M-10 800 C 90 735 200 735 270 775 C 330 808 380 780 410 730" stroke="#4B4FE0" strokeOpacity="0.25" strokeWidth="1" fill="none" />
        <Path d="M280 250 C 340 220 380 210 410 190" stroke="#3B5BDB" strokeOpacity="0.2" strokeWidth="1" fill="none" />
      </Svg>
    </View>
  )
}

/** Head-profile with a brain and a heartbeat line (original line art). */
export function HeadPulse({ width = 130 }: { width?: number }) {
  return (
    <Svg width={width} height={width * 0.92} viewBox="0 0 140 128">
      <Defs>
        <LinearGradient id="ln" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#38A3FF" />
          <Stop offset="1" stopColor="#4F46E5" />
        </LinearGradient>
      </Defs>
      <G fill="none" stroke="url(#ln)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M72 14 C 44 12 30 36 34 58 L 24 72 L 33 76 L 31 86 L 38 90 C 38 100 44 106 54 108 L 54 128" />
        <Path d="M72 14 C 96 14 112 34 108 58 C 106 72 98 82 92 92 L 92 128" />
        <Path d="M52 48 C 48 38 62 30 70 36 C 76 28 92 32 90 44 C 100 46 100 62 90 64 C 90 74 76 76 70 70 C 62 76 48 70 52 60 C 44 56 46 50 52 48 Z" strokeWidth={1.3} />
        <Path d="M70 36 C 68 46 72 54 70 70 M60 48 C 66 50 66 56 62 60 M80 44 C 76 50 80 56 84 58" strokeWidth={1.1} />
        <Path d="M40 100 L 82 100 L 88 88 L 98 116 L 106 94 L 112 100 L 140 100" strokeWidth={1.8} />
      </G>
    </Svg>
  )
}

export function Lotus({ size = 44 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <G fill="none" stroke="#2E7FD8" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M24 8 C 18 16 18 28 24 38 C 30 28 30 16 24 8 Z" />
        <Path d="M22 36 C 14 34 8 26 8 16 C 16 16 22 22 24 30" />
        <Path d="M26 36 C 34 34 40 26 40 16 C 32 16 26 22 24 30" />
        <Path d="M16 42 C 20 38 28 38 32 42" />
      </G>
    </Svg>
  )
}

/** Left-to-right blue→violet pill used behind the primary button. */
export function GradientFill() {
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="btn" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#3B9BFF" />
          <Stop offset="1" stopColor="#5B45EE" />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#btn)" />
    </Svg>
  )
}
