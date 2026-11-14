import { StyleSheet, Dimensions } from 'react-native'

// ── Responsive helpers ────────────────────────────────────────────────────────
// Design baseline is a 390pt-wide phone. rs() scales sizes gently (clamped) so
// small phones (320-360) don't overflow and large phones don't look tiny.
const { width: SCREEN_W } = Dimensions.get('window')
const SCALE = Math.min(Math.max(SCREEN_W / 390, 0.85), 1.15)
export const rs = (n: number) => Math.round(n * SCALE)
export const MIN_TOUCH = 44 // minimum comfortable tap target (iOS HIG / Material)
export const ICON = { sm: 16, md: 20, lg: 24, xl: 32, hero: 56 }
export const SCREEN_WIDTH = SCREEN_W

export const Colors = {
  brand:      '#3B5BDB',
  brandDim:   'rgba(59,91,219,0.14)',
  brandMid:   'rgba(59,91,219,0.30)',
  accent:     '#12B886',
  accentDim:  'rgba(18,184,134,0.14)',
  amber:      '#F59F00',
  amberDim:   'rgba(245,159,0,0.14)',
  red:        '#F03E3E',
  redDim:     'rgba(240,62,62,0.12)',
  bg:         '#0A0B0F',
  surface:    '#111318',
  surface2:   '#171B27',
  surface3:   '#1E2335',
  border:     'rgba(255,255,255,0.07)',
  border2:    'rgba(255,255,255,0.13)',
  text:       '#E8ECF4',
  muted:      '#8892A4',
  hint:       '#4B5567',
}

export const riskColor = (label: string) => {
  if (label === 'high')     return Colors.red
  if (label === 'moderate') return Colors.amber
  return Colors.accent
}

export const scoreColor = (score: number) => {
  if (score < 50) return Colors.accent
  if (score < 75) return Colors.amber
  return Colors.red
}

export const T = {
  mono: 'monospace' as const,
  sans: 'System'   as const,
}

export const shared = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: Colors.border,
    padding: 18,
  },
  darkCard: {
    backgroundColor: '#0D1017',
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: '#1A1D28',
    padding: 18,
  },
  clbl: {
    fontFamily: T.mono,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
    color: Colors.hint,
    marginBottom: 10,
  },
  pill: {
    fontFamily: T.mono,
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 20,
  },
  input: {
    backgroundColor: Colors.surface2,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: Colors.border2,
    color: Colors.text,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  btn: {
    backgroundColor: Colors.brand,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
})
