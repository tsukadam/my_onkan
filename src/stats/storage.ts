export type QuestionStats = {
  attempts: number
  correct: number
}

export type StatsStore = Record<string, QuestionStats>

/**
 * 累計（正答率など）の集計キー。`displayRaw` は通常 `PoolItem.raw` / 結果の `questionText` と同じ系列。
 * 正答判定とは別に、伸ばし・休符・オクターブ・＊などを除いて「同じ譜面」をまとめる。
 * 新しい表示記号をパースに足したら、ここ（`STRIP`）も手で揃える — `problem/noteTokens.ts` と照合。
 */
const STRIP_FOR_CUMULATIVE_STATS_KEY = /[\s　*＊\-－\u30FC↑↓]/gu

export function normalizeKeyForCumulativeStats(displayRaw: string): string {
  return displayRaw.replace(STRIP_FOR_CUMULATIVE_STATS_KEY, '')
}

export function bumpStats(store: StatsStore, questionId: string, isCorrect: boolean): StatsStore {
  const cur = store[questionId] ?? { attempts: 0, correct: 0 }
  const next: QuestionStats = {
    attempts: cur.attempts + 1,
    correct: cur.correct + (isCorrect ? 1 : 0),
  }
  return { ...store, [questionId]: next }
}

