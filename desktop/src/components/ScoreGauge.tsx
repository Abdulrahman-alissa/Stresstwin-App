interface Props { score: number; color: string }

const R = 80, CX = 100, CY = 100
const START_ANGLE = 220, SWEEP = 280

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180)
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polar(cx, cy, r, startDeg)
  const e = polar(cx, cy, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`
}

export default function ScoreGauge({ score, color }: Props) {
  const clampedScore = Math.min(Math.max(score, 0), 100)
  const endAngle = START_ANGLE + (clampedScore / 100) * SWEEP
  const trackPath = describeArc(CX, CY, R, START_ANGLE, START_ANGLE + SWEEP)
  const fillPath  = describeArc(CX, CY, R, START_ANGLE, endAngle)
  const needle = polar(CX, CY, R - 12, endAngle)

  return (
    <svg width={200} height={160} viewBox="0 40 200 140" style={{ overflow: 'visible', marginTop: 16 }}>
      {/* Track */}
      <path d={trackPath} fill="none" stroke="var(--surface2)" strokeWidth={14} strokeLinecap="round" />
      {/* Colored fill */}
      <path
        d={fillPath}
        fill="none"
        stroke={color}
        strokeWidth={14}
        strokeLinecap="round"
        style={{ transition: 'stroke 0.6s, d 0.4s' }}
      />
      {/* Needle dot */}
      <circle cx={needle.x} cy={needle.y} r={6} fill={color} />
      {/* Score number */}
      <text x={CX} y={CY + 14} textAnchor="middle"
            fill="var(--text)" fontSize={38} fontFamily="var(--mono)" fontWeight={300} letterSpacing="-2">
        {Math.round(clampedScore)}
      </text>
      <text x={CX} y={CY + 34} textAnchor="middle" fill="var(--hint)" fontSize={13} fontFamily="var(--mono)">
        / 100
      </text>
    </svg>
  )
}
