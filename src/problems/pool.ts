import { parseEditorTextToQuestions } from '../problem/editorText'
import type { ParsedStep } from '../problem/parse'
import { parseFreeInputMelodyLine } from '../problem/parse'
import { normalizeForJudgement, stepsToQuizDisplayRaw } from '../problem/normalize'

/** テキストエリア等から得た「1セット分の出題リスト」（ファイル・DB の問題セット機能とは無関係） */
export type TextQuestionSet = {
  meta: { id: string; title: string }
  questions: string[]
}

export type PoolItem = {
  raw: string
  setId: string
  steps: ParsedStep[]
  normalizedNotes: number[]
}

/**
 * 出題プールを構築する。
 * setId 指定時: その meta.id のセットだけ対象。
 * noteCount 指定時: 休符/伸ばし無視後の音数で絞る。
 */
export function buildPool(
  sets: TextQuestionSet[],
  setId: string | null,
  noteCount: number | null,
  startPc: number | null,
  lastPc: number | null,
): PoolItem[] {
  const out: PoolItem[] = []

  const targetSets = setId ? sets.filter((p) => p.meta.id === setId) : sets
  for (const set of targetSets) {
    for (const raw of set.questions) {
      const parsed = parseFreeInputMelodyLine(raw)
      if (!parsed.ok) continue
      const norm = normalizeForJudgement(parsed.steps)
      if (noteCount != null && norm.notes.length !== noteCount) continue
      if (startPc != null) {
        const first = norm.notes.at(0)
        if (first === undefined || first !== startPc) continue
      }
      if (lastPc != null) {
        const last = norm.notes.at(-1)
        if (last === undefined || last !== lastPc) continue
      }
      out.push({
        raw: stepsToQuizDisplayRaw(parsed.steps),
        setId: set.meta.id,
        steps: parsed.steps,
        normalizedNotes: norm.notes,
      })
    }
  }

  return out
}

/** 自由入力モード用: テキストエリアの全文からプールを構築 */
export function buildFreeInputPool(quizInlineText: string): PoolItem[] {
  const { validLines } = parseEditorTextToQuestions(quizInlineText)
  const synthetic: TextQuestionSet = {
    meta: { id: 'inline', title: 'inline' },
    questions: validLines,
  }
  return buildPool([synthetic], 'inline', null, null, null)
}

export function shufflePool<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}
