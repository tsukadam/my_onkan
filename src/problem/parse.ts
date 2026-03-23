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

export {
  KEYBOARD_MIDI_MAX,
  KEYBOARD_MIDI_MIN,
  NOTE_TOKENS,
  matchLongestNoteTokenAt,
} from './noteTokens'

import {
  KEYBOARD_MIDI_MAX,
  KEYBOARD_MIDI_MIN,
  isNotationExtendDash,
  isNotationOctaveDown,
  isNotationOctaveUp,
  isNotationRestChar,
  isNotationWildcardStar,
  matchLongestNoteTokenAt,
  midiForNearGuideInMelody,
} from './noteTokens'

function randomMidiInKeyboard(): number {
  const span = KEYBOARD_MIDI_MAX - KEYBOARD_MIDI_MIN + 1
  return KEYBOARD_MIDI_MIN + Math.floor(Math.random() * span)
}

/** 自由入力モード: 1行を `ParsedStep[]` にパース（＊は鍵盤内ランダム MIDI） */
export function parseFreeInputMelodyLine(line: string): ParseResult {
  const steps: ParsedStep[] = []

  let i = 0
  let pendingShift = 0
  // ガイドは「直前に指定された（=パースで決まった）音」。基準0（ド）はC4=60。
  let guideMidi = 60
  let isFirstNote = true
  while (i < line.length) {
    const ch = line[i] ?? ''

    if (isNotationOctaveUp(ch)) {
      pendingShift += 1
      i += 1
      continue
    }

    if (isNotationOctaveDown(ch)) {
      pendingShift -= 1
      i += 1
      continue
    }

    if (isNotationRestChar(ch)) {
      // ↑↓ が休符に付いている場合は無視（次の音へ持ち越さない）
      pendingShift = 0
      // いままでに音符が1つもなければ、先頭の　などは無視
      if (!steps.some((st) => st.kind === 'note')) {
        i += 1
        continue
      }
      steps.push({ kind: 'rest', quarters: 1, raw: ch })
      i += 1
      continue
    }

    if (isNotationExtendDash(ch)) {
      // ↑↓ が伸ばしに付いている場合は無視（次の音へ持ち越さない）
      pendingShift = 0
      // 直前の「音符」にマージ（休符を挟んでもよい）
      let merged = false
      for (let s = steps.length - 1; s >= 0; s--) {
        const prev = steps[s]!
        if (prev.kind === 'note') {
          prev.quarters += 1
          merged = true
          break
        }
      }
      if (!merged) {
        i += 1
        continue
      }
      i += 1
      continue
    }

    if (isNotationWildcardStar(ch)) {
      // ＊: プール生成時に1回だけ鍵盤内ランダム MIDI。行数は増やさない（1行=1問のまま）。
      let midi = randomMidiInKeyboard()
      if (pendingShift !== 0) {
        midi += 12 * pendingShift
        midi = Math.max(KEYBOARD_MIDI_MIN, Math.min(KEYBOARD_MIDI_MAX, midi))
      }
      const pc = ((midi % 12) + 12) % 12
      steps.push({ kind: 'note', pc, midi, quarters: 1, raw: ch })
      guideMidi = midi
      isFirstNote = false
      pendingShift = 0
      i += 1
      continue
    }

    const tok = matchLongestNoteTokenAt(line, i)
    if (!tok) {
      return { ok: false, error: `未知のトークン: 「${line.slice(i, i + 4)}…」` }
    }
    const pc = ((tok.semitone % 12) + 12) % 12
    const midi = midiForNearGuideInMelody(pc, guideMidi, isFirstNote, pendingShift)

    steps.push({ kind: 'note', pc, midi, quarters: 1, raw: tok.token })
    guideMidi = midi
    isFirstNote = false
    pendingShift = 0
    i += tok.token.length
  }

  return { ok: true, steps }
}
