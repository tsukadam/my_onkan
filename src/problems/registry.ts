import testProblem from './test.problem.json'
import test2Problem from './test2.problem.json'

export type ProblemSet = {
  meta: {
    id: string
    title: string
    filename: string
    bpm?: number
  }
  questions: string[]
}

export const problemSets: ProblemSet[] = [
  {
    ...(testProblem as Omit<ProblemSet, 'meta'> & { meta: { id: string; title: string; bpm?: number } }),
    meta: { ...(testProblem as any).meta, filename: 'test.problem.json' },
  } as ProblemSet,
  {
    ...(test2Problem as Omit<ProblemSet, 'meta'> & { meta: { id: string; title: string; bpm?: number } }),
    meta: { ...(test2Problem as any).meta, filename: 'test2.problem.json' },
  } as ProblemSet,
]

export function getProblemSet(id: string): ProblemSet | undefined {
  return problemSets.find((p) => p.meta.id === id)
}

