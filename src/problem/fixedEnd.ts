/**
 * 開始音・終止音を指定し、間の旋律パターンを列挙するモード（旧称 randomMelody）。
 * コード上のモード名: `fixedEnd`（両端固定）。
 */
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

const KB_MIN = KEYBOARD_MIDI_MIN
const KB_MAX = KEYBOARD_MIDI_MAX

/** 列挙の安全上限（メモリ・UI 対策） */
const MAX_PATTERNS = 80_000

/** 音符・＊ と、直後に続く ー・　（入力文字を tailExtends / tailRests に保持） */
export type MelodySlot =
  | { kind: 'wild'; shift: number; tailExtends: string[]; tailRests: string[] }
  | { kind: 'note'; pc: number; shift: number; tailExtends: string[]; tailRests: string[] }
  | { kind: 'rest'; raw: string }

/** 白鍵7音 / 黒鍵込みは12音（半音階） */
function pcPoolFromOptions(noBlack: boolean): number[] {
  return noBlack ? [0, 2, 4, 5, 7, 9, 11] : Array.from({ length: 12 }, (_, i) => i)
}

type MiddleTok = MelodySlot | { kind: 'extend'; ch: string }

function mergeMelodyFine(raw: MiddleTok[]): MelodySlot[] {
  const out: MelodySlot[] = []
  for (const s of raw) {
    if ((s as { kind: string }).kind === 'extend') {
      const last = out.at(-1)
      if (last && (last.kind === 'note' || last.kind === 'wild')) {
        last.tailExtends.push((s as { ch: string }).ch)
      }
      continue
    }
    if (s.kind === 'rest') {
      const last = out.at(-1)
      if (last && (last.kind === 'note' || last.kind === 'wild')) {
        last.tailRests.push(s.raw)
      } else {
        out.push(s)
      }
      continue
    }
    if (s.kind === 'note' || s.kind === 'wild') {
      out.push(s)
    }
  }
  return out
}

/**
 * 開始音・終了音: 空＝ランダム。＊ー のように＊に伸ばしを付け可能。
 */
export function parseFixedEndSlotField(
  text: string,
): { ok: true; slot: MelodySlot } | { ok: false; error: string } {
  const s0 = text.replace(/\r/g, '').replace(/\n/g, '')
  let i = 0
  let pendingShift = 0
  // ↑↓ のあいだにも、先頭と同様に無意味な ー・休符・空白を無視（直前音がないので伸ばしはノーオペ）
  while (i < s0.length) {
    const ch = s0[i]!
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
    if (isNotationRestChar(ch) || isNotationExtendDash(ch) || /\s/.test(ch)) {
      i += 1
      continue
    }
    break
  }
  let s = s0.slice(i)
  // 末尾は空白だけ除去（ー・休符は音に付く可能性があるので触らない）
  while (s.length > 0 && /\s/.test(s[s.length - 1]!)) {
    s = s.slice(0, -1)
  }
  if (s.length === 0) {
    return { ok: true, slot: { kind: 'wild', shift: 0, tailExtends: [], tailRests: [] } }
  }

  i = 0

  if (isNotationWildcardStar(s[i] ?? '')) {
    // ランダム音のオクターブは別途決まるので、＊直前の ↑↓ は realize で扱わない（既に消費済み）
    i += 1
    const tailExtends: string[] = []
    while (i < s.length && isNotationExtendDash(s[i]!)) {
      tailExtends.push(s[i]!)
      i += 1
    }
    const tailRests: string[] = []
    while (i < s.length && isNotationRestChar(s[i]!)) {
      tailRests.push(s[i]!)
      i += 1
    }
    while (i < s.length && /\s/.test(s[i]!)) i += 1
    if (i < s.length) {
      return { ok: false, error: '開始/終了音は＊と伸ばし・休符以外を続けられません。' }
    }
    return { ok: true, slot: { kind: 'wild', shift: 0, tailExtends, tailRests } }
  }

  const tok = matchLongestNoteTokenAt(s, i)
  if (!tok) {
    return { ok: false, error: `開始/終了音が解釈できません: 「${s.slice(0, 8)}…」` }
  }
  const pc = ((tok.semitone % 12) + 12) % 12
  i += tok.token.length
  const tailExtends: string[] = []
  while (i < s.length && isNotationExtendDash(s[i]!)) {
    tailExtends.push(s[i]!)
    i += 1
  }
  const tailRests: string[] = []
  while (i < s.length && isNotationRestChar(s[i]!)) {
    tailRests.push(s[i]!)
    i += 1
  }
  while (i < s.length && /\s/.test(s[i]!)) i += 1
  if (i < s.length) {
    return { ok: false, error: '開始/終了音に余分な文字があります。' }
  }
  return { ok: true, slot: { kind: 'note', pc, shift: pendingShift, tailExtends, tailRests } }
}

/**
 * 途中音: * ＊ はランダム（＊の前の ↑↓ は無視）。ー・　は後で直前の音・＊にマージ。
 */
export function tokenizeFixedEndMiddleLine(
  text: string,
): { ok: true; slots: MelodySlot[] } | { ok: false; error: string } {
  const line = text.replace(/\r/g, '')
  if (!/[^\s　]/.test(line)) {
    return { ok: true, slots: [] }
  }

  const raw: MiddleTok[] = []
  let i = 0
  let pendingShift = 0

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

    // 先頭の ー・休符・空白は直前音がないので無視（空欄のみは上で []）
    if (raw.length === 0 && (isNotationRestChar(ch) || isNotationExtendDash(ch) || /\s/.test(ch))) {
      i += 1
      continue
    }

    if (isNotationRestChar(ch)) {
      pendingShift = 0
      raw.push({ kind: 'rest', raw: ch })
      i += 1
      continue
    }

    if (isNotationExtendDash(ch)) {
      pendingShift = 0
      raw.push({ kind: 'extend', ch })
      i += 1
      continue
    }

    if (isNotationWildcardStar(ch)) {
      // ＊の前の ↑↓ は無視（ランダム音には意味がない）
      raw.push({ kind: 'wild', shift: 0, tailExtends: [], tailRests: [] })
      pendingShift = 0
      i += 1
      continue
    }

    const tok = matchLongestNoteTokenAt(line, i)
    if (!tok) {
      return { ok: false, error: `途中音: 未知の文字「${line.slice(i, i + 4)}…」` }
    }
    const pc = ((tok.semitone % 12) + 12) % 12
    raw.push({ kind: 'note', pc, shift: pendingShift, tailExtends: [], tailRests: [] })
    pendingShift = 0
    i += tok.token.length
  }

  const merged = mergeMelodyFine(raw)
  return { ok: true, slots: merged }
}

function clampMidiToKeyboard(m: number): number | null {
  if (m < KB_MIN || m > KB_MAX) return null
  return m
}

/** 跳躍制限あり: そのPCで prev から1オクターブ以内に乗る MIDI が存在するか */
function existsMidiForPc(pc: number, prevMidi: number | null, limitLeap: boolean): boolean {
  if (!limitLeap || prevMidi === null) return true
  for (let m = KB_MIN; m <= KB_MAX; m++) {
    if (((m % 12) + 12) % 12 !== pc) continue
    if (Math.abs(m - prevMidi) <= 12) return true
  }
  return false
}

/** 跳躍なし: ランダムにオクターブ決定 */
function randomMidiForPc(pc: number): number {
  const opts: number[] = []
  for (let m = KB_MIN; m <= KB_MAX; m++) {
    if (((m % 12) + 12) % 12 === pc) opts.push(m)
  }
  return opts[Math.floor(Math.random() * opts.length)]!
}

/** 跳躍あり: 決定的に最小の有効 MIDI */
function firstMidiForPc(pc: number, prevMidi: number | null, limitLeap: boolean): number | null {
  for (let m = KB_MIN; m <= KB_MAX; m++) {
    if (((m % 12) + 12) % 12 !== pc) continue
    if (!limitLeap || prevMidi === null || Math.abs(m - prevMidi) <= 12) return m
  }
  return null
}

/** 最終ステップ: 跳躍なしはオクターブをランダム、跳躍ありは最小 MIDI */
function pickWildMidiFinal(
  pc: number,
  prevMidi: number | null,
  shift: number,
  limitLeap: boolean,
): number | null {
  let m = limitLeap ? firstMidiForPc(pc, prevMidi, true) : randomMidiForPc(pc)
  if (m === null) return null
  if (shift !== 0) m += 12 * shift
  return clampMidiToKeyboard(m)
}

/** DFS 用: 同じ PC 列で安定した prevMidi を渡す（最小 MIDI） */
function stableMidiForWildPc(
  pc: number,
  prevMidi: number | null,
  shift: number,
  limitLeap: boolean,
): number | null {
  let m = firstMidiForPc(pc, prevMidi, limitLeap)
  if (m === null) return null
  if (shift !== 0) m += 12 * shift
  return clampMidiToKeyboard(m)
}

function stepsToDisplayRaw(steps: ParsedStep[]): string {
  let s = ''
  for (const st of steps) {
    if (st.kind === 'note') {
      s += normalizedToKatakana([st.pc])
    } else if (st.kind === 'rest') {
      s += st.raw
    }
  }
  return s
}

/** 重複判定は MIDI ではなく音名・休符のパターン（跳躍なしでオクターブが違っても同一扱い） */
function patternDedupeKey(steps: ParsedStep[]): string {
  return JSON.stringify(
    steps.map((st) => {
      if (st.kind === 'note') return ['n', st.pc, st.quarters] as const
      if (st.kind === 'rest') return ['r', st.quarters, st.raw] as const
      return ['?']
    }),
  )
}

/** 成績・ログ用: ー・－・　・↑↓ を入力どおりに並べた表記（steps と slots を同期走査） */
function buildMelodyDisplayRaw(slots: MelodySlot[], steps: ParsedStep[]): string | null {
  let si = 0
  let out = ''

  for (const sl of slots) {
    if (sl.kind === 'rest') {
      const st = steps[si]
      if (!st || st.kind !== 'rest') return null
      out += sl.raw
      si += 1
      continue
    }

    if (sl.kind === 'wild') {
      const st = steps[si]
      if (!st || st.kind !== 'note') return null
      out += normalizedToKatakana([st.pc])
      for (const ch of sl.tailExtends) out += ch
      si += 1
      for (let j = 0; j < sl.tailRests.length; j++) {
        const rj = steps[si]
        if (!rj || rj.kind !== 'rest') return null
        out += sl.tailRests[j]!
        si += 1
      }
      continue
    }

    if (sl.shift > 0) out += '↑'.repeat(sl.shift)
    else if (sl.shift < 0) out += '↓'.repeat(-sl.shift)
    const st = steps[si]
    if (!st || st.kind !== 'note') return null
    out += normalizedToKatakana([sl.pc])
    for (const ch of sl.tailExtends) out += ch
    si += 1
    for (let j = 0; j < sl.tailRests.length; j++) {
      const rj = steps[si]
      if (!rj || rj.kind !== 'rest') return null
      out += sl.tailRests[j]!
      si += 1
    }
  }

  if (si !== steps.length) return null
  return out
}

function realizeSteps(
  slots: MelodySlot[],
  wildPcs: number[],
  limitLeap: boolean,
): ParsedStep[] | null {
  const steps: ParsedStep[] = []
  let guideMidi = 60
  let isFirstNote = true
  let prevNoteMidi: number | null = null
  let wi = 0

  for (const sl of slots) {
    if (sl.kind === 'rest') {
      steps.push({ kind: 'rest', quarters: 1, raw: sl.raw })
      continue
    }

    if (sl.kind === 'wild') {
      const pc = wildPcs[wi]
      wi += 1
      if (pc === undefined) return null
      const clamped = pickWildMidiFinal(pc, prevNoteMidi, sl.shift, limitLeap)
      if (clamped === null) return null
      if (limitLeap && prevNoteMidi !== null && Math.abs(clamped - prevNoteMidi) > 12) return null
      const npc = ((clamped % 12) + 12) % 12
      steps.push({
        kind: 'note',
        pc: npc,
        midi: clamped,
        quarters: 1 + sl.tailExtends.length,
        raw: PARSED_NOTE_RAW_PLACEHOLDER,
      })
      guideMidi = clamped
      prevNoteMidi = clamped
      isFirstNote = false
      for (const r of sl.tailRests) {
        steps.push({ kind: 'rest', quarters: 1, raw: r })
      }
      continue
    }

    const sn = sl
    let m = midiForNearGuideInMelody(sn.pc, guideMidi, isFirstNote, sn.shift)
    if (limitLeap && prevNoteMidi !== null && Math.abs(m - prevNoteMidi) > 12) return null
    const npc = ((m % 12) + 12) % 12
    steps.push({
      kind: 'note',
      pc: npc,
      midi: m,
      quarters: 1 + sn.tailExtends.length,
      raw: PARSED_NOTE_RAW_PLACEHOLDER,
    })
    guideMidi = m
    prevNoteMidi = m
    isFirstNote = false
    for (const r of sn.tailRests) {
      steps.push({ kind: 'rest', quarters: 1, raw: r })
    }
  }

  if (wi !== wildPcs.length) return null
  return steps
}

function candidateWildPcs(prevMidi: number | null, pool: number[], limitLeap: boolean): number[] {
  return pool.filter((pc) => existsMidiForPc(pc, prevMidi, limitLeap))
}

function enumerateWild(
  slots: MelodySlot[],
  pool: number[],
  limitLeap: boolean,
): ParsedStep[][] {
  const wildCount = slots.filter((s) => s.kind === 'wild').length

  if (wildCount === 0) {
    const steps = realizeSteps(slots, [], limitLeap)
    return steps && normalizeForJudgement(steps).notes.length > 0 ? [steps] : []
  }

  const out: ParsedStep[][] = []
  const partial: number[] = []

  function walkSlot(
    slotIndex: number,
    prevMidi: number | null,
    guideMidi: number,
    isFirstNote: boolean,
  ) {
    if (out.length >= MAX_PATTERNS) return

    if (slotIndex >= slots.length) {
      const steps = realizeSteps(slots, partial, limitLeap)
      if (steps && normalizeForJudgement(steps).notes.length > 0) {
        out.push(steps)
      }
      return
    }

    const sl = slots[slotIndex]!

    if (sl.kind === 'rest') {
      walkSlot(slotIndex + 1, prevMidi, guideMidi, isFirstNote)
      return
    }

    if (sl.kind === 'wild') {
      const cands = candidateWildPcs(prevMidi, pool, limitLeap)
      for (const pc of cands) {
        if (out.length >= MAX_PATTERNS) return
        partial.push(pc)
        const mTry = stableMidiForWildPc(pc, prevMidi, sl.shift, limitLeap)
        if (mTry === null) {
          partial.pop()
          continue
        }
        if (limitLeap && prevMidi !== null && Math.abs(mTry - prevMidi) > 12) {
          partial.pop()
          continue
        }
        walkSlot(slotIndex + 1, mTry, mTry, false)
        partial.pop()
      }
      return
    }

    // fixed note (wild branch above handles wild)
    const slNote = sl
    let m = midiForNearGuideInMelody(slNote.pc, guideMidi, isFirstNote, slNote.shift)
    if (limitLeap && prevMidi !== null && Math.abs(m - prevMidi) > 12) return
    walkSlot(slotIndex + 1, m, m, false)
  }

  walkSlot(0, null, 60, true)
  return out
}

export function buildFixedEndPool(opts: {
  startText: string
  endText: string
  middleText: string
  noBlack: boolean
  limitLeap: boolean
}): PoolItem[] {
  const pool = pcPoolFromOptions(opts.noBlack)

  const a = parseFixedEndSlotField(opts.startText)
  if (!a.ok) return []
  const b = parseFixedEndSlotField(opts.endText)
  if (!b.ok) return []
  const mid = tokenizeFixedEndMiddleLine(opts.middleText)
  if (!mid.ok) return []

  const slots: MelodySlot[] = [a.slot, ...mid.slots, b.slot]

  const hasNoteOrWild = slots.some((s) => s.kind === 'wild' || s.kind === 'note')
  if (!hasNoteOrWild) return []

  const stepVariants = enumerateWild(slots, pool, opts.limitLeap)
  const seen = new Set<string>()
  const out: PoolItem[] = []

  for (const steps of stepVariants) {
    const key = patternDedupeKey(steps)
    if (seen.has(key)) continue
    seen.add(key)
    const normalizedNotes = normalizeForJudgement(steps).notes
    if (normalizedNotes.length === 0) continue
    const raw = buildMelodyDisplayRaw(slots, steps) ?? stepsToDisplayRaw(steps)
    out.push({
      raw,
      setId: 'fixedEnd',
      steps: steps as any,
      normalizedNotes,
    })
  }

  return out
}
