export type ParsedStep =
  | {
      kind: 'note'
      pc: number
      midi: number
      quarters: number
      raw: string
    }
  | { kind: 'rest'; quarters: number; raw: string }

export type ParseResult =
  | { ok: true; steps: ParsedStep[] }
  | { ok: false; error: string }

// Minimal starter mapping. Expand this table to match your exact 西塚式（カナで半音）ルール.
// Current test set only uses: ド/レ/ミ/ソ + 伸ばし/休符
const NOTE_TOKENS: Array<{ token: string; semitone: number }> = [
  { token: 'ド', semitone: 0 },
  { token: 'レ', semitone: 2 },
  { token: 'ミ', semitone: 4 },
  { token: 'ファ', semitone: 5 },
  { token: 'ソ', semitone: 7 },
  { token: 'ラ', semitone: 9 },
  { token: 'シ', semitone: 11 },

  // common ASCII/JP sharp variants (optional)
  { token: 'ド#', semitone: 1 },
  { token: 'ド＃', semitone: 1 },
  { token: 'レ#', semitone: 3 },
  { token: 'レ＃', semitone: 3 },
  { token: 'ファ#', semitone: 6 },
  { token: 'ファ＃', semitone: 6 },
  { token: 'ソ#', semitone: 8 },
  { token: 'ソ＃', semitone: 8 },
  { token: 'ラ#', semitone: 10 },
  { token: 'ラ＃', semitone: 10 },
  { token: 'デ', semitone: 1 },
  { token: 'リ', semitone: 3 },
  { token: 'フィ', semitone: 6 },
  { token: 'サ', semitone: 8 },
  { token: 'チ', semitone: 10 },
]

const isRestChar = (ch: string) => ch === ' ' || ch === '　'
const isExtendChar = (ch: string) => ch === '-' || ch === '－' || ch === 'ー'
const isUpChar = (ch: string) => ch === '↑'
const isDownChar = (ch: string) => ch === '↓'

export function parseProblemLine(line: string): ParseResult {
  const steps: ParsedStep[] = []

  let i = 0
  let pendingShift = 0
  // ガイドは「直前に指定された（=パースで決まった）音」。基準0（ド）はC4=60。
  let guideMidi = 60
  let isFirstNote = true
  while (i < line.length) {
    const ch = line[i] ?? ''

    if (isUpChar(ch)) {
      pendingShift += 1
      i += 1
      continue
    }

    if (isDownChar(ch)) {
      pendingShift -= 1
      i += 1
      continue
    }

    if (isRestChar(ch)) {
      // ↑↓ が休符に付いている場合は無視（次の音へ持ち越さない）
      pendingShift = 0
      steps.push({ kind: 'rest', quarters: 1, raw: ch })
      i += 1
      continue
    }

    if (isExtendChar(ch)) {
      // ↑↓ が伸ばしに付いている場合は無視（次の音へ持ち越さない）
      pendingShift = 0
      const last = steps.at(-1)
      if (!last || last.kind !== 'note') {
        return { ok: false, error: '伸ばし（－）が音符の前にあります。' }
      }
      last.quarters += 1
      i += 1
      continue
    }

    // match longest token
    const candidates = NOTE_TOKENS.filter((t) => line.startsWith(t.token, i))
    if (candidates.length === 0) {
      return { ok: false, error: `未知のトークン: 「${line.slice(i, i + 4)}…」` }
    }
    candidates.sort((a, b) => b.token.length - a.token.length)
    const tok = candidates[0]!
    const pc = ((tok.semitone % 12) + 12) % 12
    let midi: number

    if (isFirstNote && pendingShift === 0) {
      midi = 60 + pc
    } else {
      const k = Math.round((guideMidi - pc) / 12)
      midi = pc + 12 * k
    }
    if (pendingShift !== 0) midi += 12 * pendingShift

    steps.push({ kind: 'note', pc, midi, quarters: 1, raw: tok.token })
    guideMidi = midi
    isFirstNote = false
    pendingShift = 0
    i += tok.token.length
  }

  return { ok: true, steps }
}

