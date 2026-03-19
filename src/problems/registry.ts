import testProblem from './test.problem.json'

export type ProblemSet = {
  meta: {
    id: string
    title: string
    filename: string
  }
  questions: string[]
}

export const problemSets: ProblemSet[] = [
  {
    ...(testProblem as Omit<ProblemSet, 'meta'> & { meta: { id: string; title: string } }),
    meta: { ...(testProblem as any).meta, filename: 'test.problem.json' },
  } as ProblemSet,
]

export function getProblemSet(id: string): ProblemSet | undefined {
  return problemSets.find((p) => p.meta.id === id)
}

