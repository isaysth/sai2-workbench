import type { ReactElement } from 'react'

/**
 * 品牌标记：柑橘切面。
 *
 * 几何全部由常量算出（圆心 50,50，外圆半径 48），和 tools/make_icon.py 同一套比例 ——
 * 所以界面上这个矢量标记与 build/icon.ico 是同一个图形，不是两张手画的图。
 * 改配色只改 COLORS，改比例只改 R_* 常量。
 */
const C = 50
const R_RIM = 48
const R_RIND = R_RIM * 0.980
const R_PITH = R_RIM * 0.885
const R_WEDGE = R_RIM * 0.775
const R_CENTER = R_RIM * 0.152
const STEP = 360 / 8
const GAP = 4.0 // 扇形两侧的白色缝隙（度）

const COLORS = [
  '#F0457E', // 玫红
  '#F4623A', // 橘红
  '#F79A3E', // 橙黄
  '#F7D23E', // 柠檬黄
  '#6BC24A', // 青绿
  '#35C6D6', // 天蓝
  '#4E7BE8', // 蓝
  '#A96BE0' // 紫
]

function pt(deg: number, r: number): string {
  const rad = (deg * Math.PI) / 180
  return `${(C + r * Math.cos(rad)).toFixed(2)} ${(C + r * Math.sin(rad)).toFixed(2)}`
}

const WEDGES = COLORS.map((color, i) => {
  const a0 = -90 + i * STEP + GAP
  const a1 = -90 + (i + 1) * STEP - GAP
  return {
    color,
    d: `M ${C} ${C} L ${pt(a0, R_WEDGE)} A ${R_WEDGE} ${R_WEDGE} 0 0 1 ${pt(a1, R_WEDGE)} Z`
  }
})

export function CitrusMark({
  size = 20,
  className
}: {
  size?: number
  className?: string
}): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="sai2工作台"
    >
      <circle cx={C} cy={C} r={R_RIM} fill="#E0721F" />
      <circle cx={C} cy={C} r={R_RIND} fill="#F4954A" />
      <circle cx={C} cy={C} r={R_PITH} fill="#FFFFFF" />
      {WEDGES.map((w) => (
        <path key={w.color} d={w.d} fill={w.color} />
      ))}
      <circle cx={C} cy={C} r={R_CENTER} fill="#FFFFFF" />
    </svg>
  )
}
