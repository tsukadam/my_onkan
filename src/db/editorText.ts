import type { DbProblemSet } from './problemSets'

export type ParseEditorResult = {
  validLines: string[]
  ignoredLines: Array<{ lineNo: number; content: string; reason: string }>
}

const allowedLineRegex = /^[ドデレリミファフィソサラチシ↑↓ 　ー－\-]+$/

function isEffectivelyBlank(line: string): boolean {
  // 行内に「音名/記号」が何もなく、空白だけなら無視
  return line.replace(/[ 　]/g, '').length === 0
}

export function parseEditorTextToQuestions(text: string): ParseEditorResult {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const validLines: string[] = []
  const ignoredLines: Array<{ lineNo: number; content: string; reason: string }> = []

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''

    if (raw.length === 0 || isEffectivelyBlank(raw)) {
      ignoredLines.push({ lineNo: i + 1, content: raw, reason: '空行/空白のみ' })
      continue
    }

    if (!allowedLineRegex.test(raw)) {
      ignoredLines.push({ lineNo: i + 1, content: raw, reason: '許可されていない文字を含む' })
      continue
    }

    validLines.push(raw)
  }

  return { validLines, ignoredLines }
}

export function formatProblemSetToEditorText(set: DbProblemSet): string {
  const sorted = [...set.questions].sort((a, b) => a.id - b.id)
  return sorted.map((q) => q.text).join('\n')
}

