import type { ParsedStep } from './parse'

export type Normalized = {
  notes: number[] // pitch class (0-11)
}

export function normalizeForJudgement(steps: ParsedStep[]): Normalized {
  const notes: number[] = []
  for (const s of steps) {
    if (s.kind !== 'note') continue
    notes.push(((s.pc % 12) + 12) % 12)
  }
  return { notes }
}

export function normalizedToKatakana(notes: number[]): string {
  // Display helper for answer/input rows.
  // Extend as you finalize 西塚式の半音表記。
  const pcToKana: Record<number, string> = {
    0: 'ド',
    1: 'デ',
    2: 'レ',
    3: 'リ',
    4: 'ミ',
    5: 'ファ',
    6: 'フィ',
    7: 'ソ',
    8: 'サ',
    9: 'ラ',
    10: 'チ',
    11: 'シ',
  }
  return notes.map((n) => pcToKana[n] ?? '?').join('')
}

