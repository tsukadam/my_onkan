import type { CSSProperties } from 'react'

/** 0〜100。min===max のときは 0（塗りなし） */
export function rangeFillPercent(min: number, max: number, value: number): number {
  const span = max - min
  if (span <= 0) return 0
  const clamped = Math.min(max, Math.max(min, value))
  return ((clamped - min) / span) * 100
}

/** `.countBar` 用: WebKit トラックの塗り境界をつまみ位置と揃える */
export function rangeSliderVars(
  min: number,
  max: number,
  value: number,
): CSSProperties {
  const p = rangeFillPercent(min, max, value)
  return { ['--range-p' as string]: `${p}%` }
}
