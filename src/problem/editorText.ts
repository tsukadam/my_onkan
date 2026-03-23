import { EDITOR_ALLOWED_CHAR_SET } from './noteTokens'

export type ParseEditorResult = {
  validLines: string[]
  ignoredLines: Array<{ lineNo: number; content: string; reason: string }>
}

function isEffectivelyBlank(line: string): boolean {
  // 行内に「音名/記号」が何もなく、空白だけなら無視
  return line.replace(/[ 　]/g, '').length === 0
}

function lineHasOnlyAllowedChars(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (!EDITOR_ALLOWED_CHAR_SET.has(ch)) return false
  }
  return true
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

    if (!lineHasOnlyAllowedChars(raw)) {
      ignoredLines.push({ lineNo: i + 1, content: raw, reason: '許可されていない文字を含む' })
      continue
    }

    validLines.push(raw)
  }

  return { validLines, ignoredLines }
}
