import type { ParsedStep } from './parse'
import { pitchClassToNotationJa } from './noteTokens'

export type Normalized = {
  notes: number[] // pitch class (0-11)
}

/**
 * 正答用: 音符ステップのピッチクラスだけを出現順に並べる。
 * 休符は再生タイミング用で鍵盤入力の対象にならないため含めない（先頭・途中問わず全モード共通）。
 * 伸ばしはパース時に音符の quarters に畳まれ、別ステップとしては存在しない。
 */
export function normalizeForJudgement(steps: ParsedStep[]): Normalized {
  const notes: number[] = []
  for (const s of steps) {
    if (s.kind !== 'note') continue
    notes.push(((s.pc % 12) + 12) % 12)
  }
  return { notes }
}

/**
 * ログ・結果表示用: パース済み steps から表記を組み立てる。
 * ＊解決後の PC をカナにし、伸ばしは quarters に応じて ー を付与。休符は step.raw のまま。
 */
export function stepsToQuizDisplayRaw(steps: ParsedStep[]): string {
  let s = ''
  for (const st of steps) {
    if (st.kind === 'rest') {
      s += st.raw
      continue
    }
    s += normalizedToKatakana([st.pc])
    if (st.quarters > 1) {
      s += 'ー'.repeat(st.quarters - 1)
    }
  }
  return s
}

/** ログ・正誤表示: PC 列を日本語正規表記（`noteTokens` の `notation.ja`）に変換 */
export function normalizedToKatakana(notes: number[]): string {
  return notes.map((n) => pitchClassToNotationJa(n)).join('')
}

