import { useState } from 'react'
import { View } from 'react-native'
import Svg, { Polyline, Line } from 'react-native-svg'

/** Tiny area-sparkline that measures its own width (no stretched strokes). */
export default function Spark({ values, color, height = 30, base }: { values: number[]; color: string; height?: number; base?: number }) {
  const [w, setW] = useState(0)
  const H = height
  let body = null
  if (w > 0 && values.length > 1) {
    const lo = Math.min(...values, base ?? Infinity), hi = Math.max(...values, base ?? -Infinity)
    const span = hi - lo > 1e-9 ? hi - lo : 1
    const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6)
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${y(v)}`).join(' ')
    body = (
      <>
        <Polyline points={`0,${H} ${pts} ${w},${H}`} fill={color} fillOpacity={0.15} stroke="none" />
        {base != null && <Line x1={0} x2={w} y1={y(base)} y2={y(base)} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" strokeWidth={1} />}
        <Polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      </>
    )
  }
  return (
    <View style={{ height: H, width: '100%' }} onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w > 0 && <Svg width={w} height={H}>{body}</Svg>}
    </View>
  )
}
