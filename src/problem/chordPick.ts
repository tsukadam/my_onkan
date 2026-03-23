import { parseEditorTextToQuestions } from './editorText'
import type { ParsedStep } from './parse'
import { normalizeForJudgement, normalizedToKatakana } from './normalize'
import type { PoolItem } from '../problems/pool'
import {
  KEYBOARD_MIDI_MAX,
  KEYBOARD_MIDI_MIN,
  PARSED_NOTE_RAW_PLACEHOLDER,
  isNotationExtendDash,
  isNotationOctaveDown,
  isNotationOctaveUp,
  isNotationRestChar,
  isNotationWildcardStar,
  matchLongestNoteTokenAt,
  midiForNearGuideInMelody,
} from './noteTokens'

/**
 * 構成音モード: 行内の * ＊ を、パースの直前にランダムな1文字カナ（0〜11PC）へ置換する。
 * 1行につき各 * は1回だけ決定し、その後は通常の構成音と同じ（順列・転回）。
 */
export function resolveChordPickWildcards(line: string): string {
  let out = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (isNotationWildcardStar(ch)) {
      const pc = Math.floor(Math.random() * 12)
      out += normalizedToKatakana([pc])
    } else {
      out += ch
    }
  }
  return out
}

const KB_MIN = KEYBOARD_MIDI_MIN
const KB_MAX = KEYBOARD_MIDI_MAX

type ChordTok =
  | { kind: 'note'; pc: number; voiceIndex: number }
  | { kind: 'rest'; raw: string }
  | { kind: 'extend' }

/**
 * 構成音モード: 音符・休符・伸ばし（ー）を独立トークンとして切り出す。
 * 各音符に「直前の音に最も近い」ルールで絶対音高を付与。
 * 順列は groupChordPickTokens で「音符＋直後のー・　」を1ユニットにまとめてから行う。
 */
export function parseChordPickConstituentLine(
  line: string,
): { ok: true; tokens: ChordTok[]; refMidis: number[] } | { ok: false; error: string } {
  const text = line.replace(/\r/g, '')
  if (!/[^\s　]/.test(text)) return { ok: false, error: '空行です。' }

  const tokens: ChordTok[] = []
  const refMidis: number[] = []

  let i = 0
  let pendingShift = 0
  let guideMidi = 60
  let isFirstNote = true
  let voiceIndex = 0

  while (i < text.length) {
    const ch = text[i] ?? ''

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

    if (isNotationWildcardStar(ch)) {
      // ＊: ランダム音は「見えてる鍵盤範囲（KB_MIN..KB_MAX）」に収める。
      // ↑↓ が付いている場合も同様に範囲内へクランプする（音は鳴るが青鍵盤は範囲外に出ない）。
      const pc0 = Math.floor(Math.random() * 12)
      const opts: number[] = []
      for (let m = KB_MIN; m <= KB_MAX; m++) {
        const pc = ((m % 12) + 12) % 12
        if (pc === pc0) opts.push(m)
      }
      let midi = opts[Math.floor(Math.random() * opts.length)]!
      if (pendingShift !== 0) {
        midi += 12 * pendingShift
        midi = Math.max(KB_MIN, Math.min(KB_MAX, midi))
      }

      const npc = ((midi % 12) + 12) % 12
      refMidis[voiceIndex] = midi
      tokens.push({ kind: 'note', pc: npc, voiceIndex })
      guideMidi = midi
      isFirstNote = false
      pendingShift = 0
      voiceIndex += 1
      i += 1
      continue
    }

    if (isNotationRestChar(ch)) {
      pendingShift = 0
      tokens.push({ kind: 'rest', raw: ch })
      i += 1
      continue
    }

    if (isNotationExtendDash(ch)) {
      pendingShift = 0
      tokens.push({ kind: 'extend' })
      i += 1
      continue
    }

    const tok = matchLongestNoteTokenAt(text, i)
    if (!tok) {
      return { ok: false, error: `未知のトークン: 「${text.slice(i, i + 4)}…」` }
    }
    const pc = ((tok.semitone % 12) + 12) % 12
    const midi = midiForNearGuideInMelody(pc, guideMidi, isFirstNote, pendingShift)

    refMidis[voiceIndex] = midi
    tokens.push({ kind: 'note', pc, voiceIndex })
    guideMidi = midi
    isFirstNote = false
    pendingShift = 0
    voiceIndex += 1
    i += tok.token.length
  }

  const noteCount = tokens.filter((t) => t.kind === 'note').length
  if (noteCount < 2) {
    return { ok: false, error: '構成音は2音以上にしてください。' }
  }

  return { ok: true, tokens, refMidis }
}

/** 順列の単位: 音符 + 直後に続く ー・　（連続もまとめて直前の音に付く） */
export type ChordGroup = {
  note: Extract<ChordTok, { kind: 'note' }>
  tail: Array<Extract<ChordTok, { kind: 'rest' | 'extend' }>>
}

export function groupChordPickTokens(tokens: ChordTok[]): ChordGroup[] {
  const groups: ChordGroup[] = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]!
    if (t.kind === 'extend' || t.kind === 'rest') {
      i += 1
      continue
    }
    if (t.kind !== 'note') {
      i += 1
      continue
    }
    const note = t
    i += 1
    const tail: ChordGroup['tail'] = []
    while (i < tokens.length) {
      const u = tokens[i]!
      if (u.kind === 'note') break
      if (u.kind === 'extend' || u.kind === 'rest') {
        tail.push(u)
        i += 1
      } else {
        break
      }
    }
    groups.push({ note, tail })
  }
  return groups
}

function permutationsIndices(n: number): number[][] {
  const idx = Array.from({ length: n }, (_, i) => i)
  function rec(arr: number[]): number[][] {
    if (arr.length <= 1) return [arr]
    const out: number[][] = []
    for (let i = 0; i < arr.length; i++) {
      const first = arr[i]!
      const rest = arr.filter((_, j) => j !== i)
      for (const p of rec(rest)) {
        out.push([first, ...p])
      }
    }
    return out
  }
  return rec(idx)
}

function applyOctaveMask(base: number[], shiftableIndices: number[], mask: boolean[]): number[] {
  const midis = [...base]
  for (let j = 0; j < shiftableIndices.length; j++) {
    if (mask[j]) {
      const vi = shiftableIndices[j]!
      midis[vi] = midis[vi]! - 12
    }
  }
  return midis
}

function allBoolMasks(k: number): boolean[][] {
  if (k === 0) return [[]]
  const out: boolean[][] = []
  for (let m = 0; m < 1 << k; m++) {
    const row: boolean[] = []
    for (let b = 0; b < k; b++) row.push(((m >> b) & 1) === 1)
    out.push(row)
  }
  return out
}

/** グループ順序から再生用 ParsedStep を組み立てる */
function buildStepsFromGroupOrder(
  order: number[],
  groups: ChordGroup[],
  voiceMidis: number[],
): ParsedStep[] {
  const steps: ParsedStep[] = []

  for (const gi of order) {
    const g = groups[gi]!
    const tok = g.note
    const m = voiceMidis[tok.voiceIndex]!
    steps.push({
      kind: 'note',
      pc: tok.pc,
      midi: m,
      quarters: 1,
      raw: PARSED_NOTE_RAW_PLACEHOLDER,
    })
    for (const tr of g.tail) {
      if (tr.kind === 'extend') {
        for (let s = steps.length - 1; s >= 0; s--) {
          const prev = steps[s]!
          if (prev.kind === 'note') {
            prev.quarters += 1
            break
          }
        }
      } else {
        steps.push({ kind: 'rest', quarters: 1, raw: tr.raw })
      }
    }
  }

  return steps
}

function stepsDedupeKey(steps: ParsedStep[]): string {
  return JSON.stringify(
    steps.map((s) => {
      if (s.kind === 'note') return ['n', s.midi, s.quarters] as const
      if (s.kind === 'rest') return ['r', s.quarters, s.raw] as const
      return ['?']
    }),
  )
}

/** 成績・ログ用: 順列どおりに音符・休符・伸ばし（ー）を並べた表記 */
function displayStringForGroupOrder(order: number[], groups: ChordGroup[]): string {
  let s = ''
  for (const gi of order) {
    const g = groups[gi]!
    s += normalizedToKatakana([g.note.pc])
    for (const tr of g.tail) {
      if (tr.kind === 'extend') s += 'ー'
      else s += tr.raw
    }
  }
  return s
}

export function buildChordPickPoolForLine(line: string): PoolItem[] {
  const parsed = parseChordPickConstituentLine(line)
  if (!parsed.ok) return []

  const { tokens, refMidis } = parsed
  const groups = groupChordPickTokens(tokens)
  if (groups.length < 2) return []

  const nNote = refMidis.length

  const minMidi = Math.min(...refMidis)
  const shiftableVoices: number[] = []
  for (let vi = 0; vi < nNote; vi++) {
    if (refMidis[vi]! > minMidi) shiftableVoices.push(vi)
  }

  const perms = permutationsIndices(groups.length)
  const masks = allBoolMasks(shiftableVoices.length)
  const seen = new Set<string>()
  const out: PoolItem[] = []

  for (const mask of masks) {
    const voiceMidis = applyOctaveMask(refMidis, shiftableVoices, mask)

    for (const perm of perms) {
      const steps = buildStepsFromGroupOrder(perm, groups, voiceMidis)
      const key = stepsDedupeKey(steps)
      if (seen.has(key)) continue
      seen.add(key)

      const answerPcs = normalizeForJudgement(steps).notes
      const raw = displayStringForGroupOrder(perm, groups)

      out.push({
        raw,
        setId: 'chordPick',
        steps: steps as any,
        normalizedNotes: answerPcs,
      })
    }
  }

  return out
}

export function buildChordPickPoolFromEditorText(text: string): PoolItem[] {
  const { validLines } = parseEditorTextToQuestions(text)
  const seen = new Set<string>()
  const out: PoolItem[] = []

  for (const line of validLines) {
    for (const item of buildChordPickPoolForLine(line)) {
      const key = stepsDedupeKey(item.steps as ParsedStep[])
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }

  return out
}
