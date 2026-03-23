// 西塚式カナ半音・譜入力の共通定義（パース・表示・エディタ許可文字）。
// 小さなヘルパはこの1ファイルにまとめる（過剰なファイル分割を避ける）。

/** 表示ロケール（将来 i18n で拡張） */
export type NoteNotationLocale = 'ja'

export type NoteTokenEntry = {
  token: string
  semitone: number
  /**
   * 同一 semitone に複数の入力表記（ド# と デ など）がある場合、
   * **正規の画面表示**に使う表記を1つだけ付ける（例: ja）。
   */
  notation?: Partial<Record<NoteNotationLocale, string>>
}

export const NOTE_TOKENS: NoteTokenEntry[] = [
  { token: 'ド', semitone: 0, notation: { ja: 'ド' } },
  { token: 'レ', semitone: 2, notation: { ja: 'レ' } },
  { token: 'ミ', semitone: 4, notation: { ja: 'ミ' } },
  { token: 'ファ', semitone: 5, notation: { ja: 'ファ' } },
  { token: 'ソ', semitone: 7, notation: { ja: 'ソ' } },
  { token: 'ラ', semitone: 9, notation: { ja: 'ラ' } },
  { token: 'シ', semitone: 11, notation: { ja: 'シ' } },

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
  { token: 'デ', semitone: 1, notation: { ja: 'デ' } },
  { token: 'リ', semitone: 3, notation: { ja: 'リ' } },
  { token: 'フィ', semitone: 6, notation: { ja: 'フィ' } },
  { token: 'サ', semitone: 8, notation: { ja: 'サ' } },
  { token: 'チ', semitone: 10, notation: { ja: 'チ' } },
]

function buildPitchClassToNotationJa(): Record<number, string> {
  const map: Partial<Record<number, string>> = {}
  for (const t of NOTE_TOKENS) {
    const ja = t.notation?.ja
    if (ja == null) continue
    const pc = ((t.semitone % 12) + 12) % 12
    if (map[pc] != null && map[pc] !== ja) {
      throw new Error(`noteTokens: 競合する notation.ja (pc=${pc})`)
    }
    map[pc] = ja
  }
  for (let pc = 0; pc < 12; pc++) {
    if (map[pc] == null) {
      throw new Error(`noteTokens: pc=${pc} に notation.ja がありません`)
    }
  }
  return map as Record<number, string>
}

/** PC 0..11 → 日本語の正規1文字（ドデレリ…） */
const PITCH_CLASS_TO_NOTATION_JA = buildPitchClassToNotationJa()

export function pitchClassToNotationJa(pc: number): string {
  const p = ((pc % 12) + 12) % 12
  return PITCH_CLASS_TO_NOTATION_JA[p]!
}

/** `index` 位置で最長一致する音名トークン。無ければ null */
export function matchLongestNoteTokenAt(
  line: string,
  index: number,
): { token: string; semitone: number } | null {
  const candidates = NOTE_TOKENS.filter((t) => line.startsWith(t.token, index))
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.token.length - a.token.length)
  const tok = candidates[0]!
  return { token: tok.token, semitone: tok.semitone }
}

/** 鍵盤 UI・＊ランダム音の MIDI 範囲 C3..C5 */
export const KEYBOARD_MIDI_MIN = 48
export const KEYBOARD_MIDI_MAX = 72

/**
 * 自由入力・構成音パースで共通:
 * 直前 MIDI（guide）に最も近いオクターブへ PC を置き、↑↓ によるオクターブシフトを加える。
 */
export function midiForNearGuideInMelody(
  pc: number,
  guideMidi: number,
  isFirstNote: boolean,
  pendingOctaveShift: number,
): number {
  let midi: number
  if (isFirstNote && pendingOctaveShift === 0) {
    midi = 60 + pc
  } else {
    const k = Math.round((guideMidi - pc) / 12)
    midi = pc + 12 * k
  }
  if (pendingOctaveShift !== 0) midi += 12 * pendingOctaveShift
  return midi
}

/**
 * プール生成で `ParsedStep[]` を合成するとき、音符の `raw` をプレースホルダにする場合の値。
 */
export const PARSED_NOTE_RAW_PLACEHOLDER = 'R'

/** 譜入力の1文字判定（累計キー除去は `stats/storage.ts` の `normalizeKeyForCumulativeStats` と手動同期） */
export function isNotationRestChar(ch: string): boolean {
  return ch === ' ' || ch === '　'
}

export function isNotationExtendDash(ch: string): boolean {
  return ch === '-' || ch === '－' || ch === 'ー'
}

export function isNotationOctaveUp(ch: string): boolean {
  return ch === '↑'
}

export function isNotationOctaveDown(ch: string): boolean {
  return ch === '↓'
}

export function isNotationWildcardStar(ch: string): boolean {
  return ch === '*' || ch === '＊'
}

/** エディタ1行に許可する文字（`NOTE_TOKENS` の字句 ＋ 記号）。`parseEditorTextToQuestions` 用 */
export function getEditorAllowedCharacterSet(): ReadonlySet<string> {
  const set = new Set<string>()
  for (const t of NOTE_TOKENS) {
    for (const ch of t.token) {
      set.add(ch)
    }
  }
  for (const ch of ['↑', '↓', ' ', '　', 'ー', '－', '-', '*', '＊']) {
    set.add(ch)
  }
  return set
}

export const EDITOR_ALLOWED_CHAR_SET: ReadonlySet<string> = getEditorAllowedCharacterSet()
