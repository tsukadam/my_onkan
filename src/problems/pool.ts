import type { ParsedStep } from '../problem/parse'
import { parseProblemLine } from '../problem/parse'
import { normalizeForJudgement } from '../problem/normalize'
import type { ProblemSet } from './registry'

export type PoolItem = {
  raw: string
  setId: string
  bpm: number
  steps: ParsedStep[]
  normalizedNotes: number[]
}

/** 休符・伸ばしを無視した音の数 */
export function getNoteCount(raw: string): number | null {
  const r = parseProblemLine(raw)
  if (!r.ok) return null
  return normalizeForJudgement(r.steps).notes.length
}

/**
 * 出題プールを構築する。
 * fileId 指定時: そのファイルの問題を対象にする。
 * fileId 未指定: 全ファイルを対象にする。
 * noteCount 指定時: 休符/伸ばし無視後の音数で絞る。
 */
export function buildPool(
  sets: ProblemSet[],
  fileId: string,
  noteCount: number | null,
  startPc: number | null,
  lastPc: number | null,
): PoolItem[] {
  const out: PoolItem[] = []

  const targetSets = fileId ? sets.filter((p) => p.meta.id === fileId) : sets
  for (const set of targetSets) {
    for (const raw of set.questions) {
      const parsed = parseProblemLine(raw)
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
        raw,
        setId: set.meta.id,
        bpm: set.meta.bpm ?? 80,
        steps: parsed.steps,
        normalizedNotes: norm.notes,
      })
    }
  }

  return out
}

export function shufflePool<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}
