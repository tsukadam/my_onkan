export type QuestionStats = {
  attempts: number
  correct: number
}

export type StatsStore = Record<string, QuestionStats>

export function bumpStats(store: StatsStore, questionId: string, isCorrect: boolean): StatsStore {
  const cur = store[questionId] ?? { attempts: 0, correct: 0 }
  const next: QuestionStats = {
    attempts: cur.attempts + 1,
    correct: cur.correct + (isCorrect ? 1 : 0),
  }
  return { ...store, [questionId]: next }
}

