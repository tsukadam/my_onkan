import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { getAudioEngine } from './audio/engine'
import { buildFreeInputPool, shufflePool, type PoolItem } from './problems/pool'
import { normalizedToKatakana } from './problem/normalize'
import { bumpStats, normalizeKeyForCumulativeStats, type StatsStore } from './stats/storage'
import { loadAllStats, saveAllStats } from './db/stats'
import { buildChordPickPoolFromEditorText } from './problem/chordPick'
import { buildFixedEndPool } from './problem/fixedEnd'
import { ChordPickQuizSettings } from './ChordPickQuizSettings'
import { FixedEndQuizSettings } from './FixedEndQuizSettings'
import { FreeQuizSettings } from './FreeQuizSettings'
import { KEYBOARD_MIDI_MAX, KEYBOARD_MIDI_MIN } from './problem/noteTokens'
import { USER_SETTINGS_HELP_TEXT } from './quizHelp'
import { loadUserSettings, saveUserSettings, type UserSettingsStore } from './db/userSettings'
import { rangeSliderVars } from './rangeSliderStyle'
import './App.css'

type QuizMode = 'free' | 'fixedEnd' | 'chordPick'

type PianoKey = {
  note: string
  isBlack: boolean
  xInWhiteUnits?: number
}

const KEY_OPTIONS = [
  { id: 'C', label: 'C' },
  { id: 'C#', label: 'C# / D♭' },
  { id: 'D', label: 'D' },
  { id: 'D#', label: 'D# / E♭' },
  { id: 'E', label: 'E' },
  { id: 'F', label: 'F' },
  { id: 'F#', label: 'F# / G♭' },
  { id: 'G', label: 'G' },
  { id: 'G#', label: 'G# / A♭' },
  { id: 'A', label: 'A' },
  { id: 'A#', label: 'A# / B♭' },
  { id: 'B', label: 'B' },
] as const

const KEY_TO_SEMITONES: Record<(typeof KEY_OPTIONS)[number]['id'], number> = {
  C: 0,
  'C#': 1,
  D: 2,
  'D#': 3,
  E: 4,
  F: 5,
  'F#': 6,
  G: 7,
  'G#': 8,
  A: 9,
  'A#': 10,
  B: 11,
}

/** 画面ピアノと出題パースの「鍵盤内」（`noteTokens` の KEYBOARD_MIDI_* と一致） */
const VISIBLE_KEYBOARD_MIDI = { from: KEYBOARD_MIDI_MIN, to: KEYBOARD_MIDI_MAX } as const

/** 再生・照合用: MIDI → Tone の音名（例 60 → "C4"） */
function midiToToneNoteName(midi: number): string {
  return Tone.Frequency(midi, 'midi').toNote()
}

/** 可視鍵盤上なら Tone 音名、範囲外は null（青鍵ハイライト用） */
function toneNoteNameIfMidiOnVisibleKeyboard(midi: number): string | null {
  if (midi < VISIBLE_KEYBOARD_MIDI.from || midi > VISIBLE_KEYBOARD_MIDI.to) return null
  return midiToToneNoteName(midi)
}

/**
 * `attackRelease(..., durationSeconds * 0.95)` で音を鳴らしているが、
 * `engine.ts` のシンセ側エンベロープでは release が 0.7s 残るため、
 * 次の再生（回答の再生など）との重なりを避ける目的で余裕を取る。
 */
const AUDIO_TAIL_SEC = 0.75
const ADS_RUNTIME_SRC = `${import.meta.env.BASE_URL}ads.runtime.js`
const KEY_HOLD_SAFETY_MS = 1600

function buildKeyboard(range: { from: number; to: number }): PianoKey[] {
  // MIDI: 既定は C3..C5（VISIBLE_KEYBOARD_MIDI）
  const result: PianoKey[] = []
  let whiteCount = 0

  const isBlackByPitchClass = (pc: number) => [1, 3, 6, 8, 10].includes(pc)

  for (let midi = range.from; midi <= range.to; midi++) {
    const note = Tone.Frequency(midi, 'midi').toNote()
    const pc = ((midi % 12) + 12) % 12
    const isBlack = isBlackByPitchClass(pc)

    if (!isBlack) {
      result.push({ note, isBlack: false })
      whiteCount += 1
      continue
    }

    // place black key between adjacent whites: C#=1, D#=2, F#=4, G#=5, A#=6 (within an octave)
    const posInOctave: Record<number, number> = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 }
    const octave = Math.floor((midi - range.from) / 12)
    const base = posInOctave[pc]
    result.push({ note, isBlack: true, xInWhiteUnits: octave * 7 + base })
  }

  return result
}

function App() {
  const engine = useMemo(() => getAudioEngine(), [])
  const [activeNotes, setActiveNotes] = useState<Set<string>>(() => new Set())
  const activeNotesRef = useRef<Set<string>>(new Set())
  const [audioReady, setAudioReady] = useState(false)
  const [audioPriming, setAudioPriming] = useState(false)
  const primeAudioPromiseRef = useRef<Promise<boolean> | null>(null)
  const audioReadyAutoOpenedRef = useRef(false)
  const noteOffSafetyTimersRef = useRef<Map<string, number>>(new Map())
  const [currentKey, setCurrentKey] =
    useState<(typeof KEY_OPTIONS)[number]['id']>('C')
  const [quizInlineText, setQuizInlineText] = useState('')
  const [freeInputHelpOpen, setFreeInputHelpOpen] = useState(false)
  const [fixedEndStartText, setFixedEndStartText] = useState('')
  const [fixedEndEndText, setFixedEndEndText] = useState('')
  const [fixedEndMiddleText, setFixedEndMiddleText] = useState('')
  const [quizMode, setQuizMode] = useState<QuizMode>('free')
  const [chordPickText, setChordPickText] = useState('')
  const [chordPickHelpOpen, setChordPickHelpOpen] = useState(false)
  const [fixedEndHelpOpen, setFixedEndHelpOpen] = useState(false)
  /** 白鍵のみ（黒鍵 PC を途中の候補から外す） */
  const [fixedEndWhiteKeysOnly, setFixedEndWhiteKeysOnly] = useState(true)
  const [fixedEndLimitLeapToOctave, setFixedEndLimitLeapToOctave] = useState(true)
  const [questionCount, setQuestionCount] = useState<number>(10)
  const [questionIntervalSec, setQuestionIntervalSec] = useState<2 | 3 | 4 | 5>(2)
  const [tempoBpm, setTempoBpm] = useState<50 | 60 | 70 | 80 | 90 | 100 | 110 | 120>(80)
  const [quizState, setQuizState] = useState<
    | { kind: 'idle' }
    | { kind: 'presenting' }
    | { kind: 'answering' }
    | { kind: 'revealing' }
    | { kind: 'finished' }
  >({ kind: 'idle' })

  const [view, setView] = useState<'game' | 'user'>('game')
  const [problemSettingsOpen, setProblemSettingsOpen] = useState(false)
  /** 結果直後だけ true。タブ・設定編集・モード切替で false → 主ボタンは「スタート」 */
  const [resultFreshForAgainStart, setResultFreshForAgainStart] = useState(true)
  const prevQuizModeRef = useRef<QuizMode>('free')
  /** 構成音モードで「入室時の出題数デフォルト」を一度だけ適用したか */
  const chordPickDefaultsAppliedRef = useRef(false)
  /** 開始音・終始音指定モードで出題数デフォルトを一度だけ適用したか */
  const fixedEndDefaultsAppliedRef = useRef(false)
  const chordPickSavedQuestionCountRef = useRef(10)
  const fixedEndSavedQuestionCountRef = useRef(10)

  /** 出題モードタブ: 同一タブ押下で開閉、別モードは展開して切替 */
  const handleModeTabClick = useCallback(
    (next: QuizMode) => {
      if (view === 'user') {
        setView('game')
        setProblemSettingsOpen(true)
        setResultFreshForAgainStart(false)
        setQuizMode(next)
        return
      }
      if (quizState.kind === 'finished') {
        setResultFreshForAgainStart(false)
      }
      if (quizMode === next) {
        setProblemSettingsOpen((v) => !v)
      } else {
        setProblemSettingsOpen(true)
      }
      setQuizMode(next)
    },
    [quizState.kind, quizMode, view],
  )

  // 出題終了時は設定を折りたたむ（必要ならタブ押下で開閉）
  useEffect(() => {
    if (quizState.kind === 'finished') setProblemSettingsOpen(false)
  }, [quizState.kind])

  useEffect(() => {
    if (!audioReady) return
    if (audioReadyAutoOpenedRef.current) return
    audioReadyAutoOpenedRef.current = true
    setProblemSettingsOpen(true)
  }, [audioReady])

  useEffect(() => {
    if (quizState.kind === 'finished') setResultFreshForAgainStart(true)
  }, [quizState.kind])

  const [cycleQueue, setCycleQueue] = useState<number[]>([])
  const [presentCount, setPresentCount] = useState(0)
  const currentPoolRef = useRef<PoolItem[]>([])

  const [currentQuestionRaw, setCurrentQuestionRaw] = useState<string>('')
  const [currentBpm, setCurrentBpm] = useState(80)
  const [currentSteps, setCurrentSteps] = useState<
    Array<{ kind: 'note'; pc: number; midi: number; quarters: number; raw: string } | { kind: 'rest'; quarters: number; raw: string }>
  >([])
  const [expectedNotes, setExpectedNotes] = useState<number[]>([])
  // いま処理中の問題情報は ref にも保持する（setState の反映タイミングずれで
  // revealAndAdvance 側が空を掴むのを防ぐ）。
  const currentQuestionRawRef = useRef(currentQuestionRaw)
  const currentBpmRef = useRef(currentBpm)
  const currentStepsRef = useRef(currentSteps)
  const expectedNotesRef = useRef(expectedNotes)
  const [inputNotes, setInputNotes] = useState<Array<{ pc: number; wrong: boolean }>>([])
  const [answerNotes, setAnswerNotes] = useState<number[]>([])

  const [keyMark, setKeyMark] = useState<Record<string, 'correct' | 'wrong'>>({})
  const [blueKeys, setBlueKeys] = useState<Set<string>>(() => new Set())

  const [sessionLog, setSessionLog] = useState<
    Array<{ questionText: string; ok: boolean; answered: string; expected: string }>
  >([])
  const [cumulative, setCumulative] = useState<StatsStore>(() => ({}))

  const pendingTimers = useRef<number[]>([])
  // cyclePos/cycleQueue は state だが、非同期（setTimeout）内でクロージャが古くなると
  // 「次の問題がズレる/進行が止まる」原因になるので ref を正にする。
  const cycleQueueRef = useRef<number[]>([])
  const cyclePosRef = useRef(0)
  const startCurrentQuestionRef = useRef<(queue: number[], pos: number) => Promise<void>>(async () => {})
  const questionTokenRef = useRef(0)
  const revealStartedRef = useRef(false)
  const presentationDoneRef = useRef(false)
  const questionSettledRef = useRef(false)
  const pendingRevealRef = useRef<null | { isCorrect: boolean }>(null)

  // 音声初期化（ユーザー操作起点、重複実行は promise で抑止）。
  const primeAudio = useCallback(async (): Promise<boolean> => {
    if (audioReady) return true
    if (primeAudioPromiseRef.current) return primeAudioPromiseRef.current
    const run = (async () => {
    setAudioPriming(true)
    const nav = navigator as Navigator & {
      audioSession?: { type: 'auto' | 'ambient' | 'playback' | 'play-and-record' }
    }
    if (nav.audioSession && nav.audioSession.type !== 'playback') {
      try {
        nav.audioSession.type = 'playback'
      } catch {
        // 非対応/制限環境は無視して通常フローを続行。
      }
    }
      try {
        await engine.ensureReady()
        const raw = Tone.getContext().rawContext
        if (raw.state !== 'running') await raw.resume()
        const ok = raw.state === 'running'
        setAudioReady(ok)
        return ok
      } catch {
        setAudioReady(false)
        return false
      } finally {
        setAudioPriming(false)
        primeAudioPromiseRef.current = null
      }
    })()
    primeAudioPromiseRef.current = run
    return run
  }, [audioReady, engine])

  const clearTimers = useCallback(() => {
    for (const t of pendingTimers.current) window.clearTimeout(t)
    pendingTimers.current = []
  }, [])

  useEffect(() => {
    void loadAllStats().then(setCumulative)
  }, [])

  // 広告コード本体はリポジトリに置かず、配置されたときだけ実行する。
  useEffect(() => {
    if (document.querySelector(`script[data-ads-runtime="${ADS_RUNTIME_SRC}"]`)) return
    const s = document.createElement('script')
    s.src = ADS_RUNTIME_SRC
    s.async = true
    s.defer = true
    s.setAttribute('data-ads-runtime', ADS_RUNTIME_SRC)
    s.onerror = () => {
      // GitHub など配置していない環境では 404 が正常。
    }
    document.body.appendChild(s)
    return () => {
      // 画面切替で二重ロードしないため、App unmount 時のみ後始末。
      if (s.parentNode) s.parentNode.removeChild(s)
    }
  }, [])

  useEffect(() => {
    void loadUserSettings().then((saved) => {
      const chordCount = saved.chordPickQuestionCount
      const fixedCount = saved.fixedEndQuestionCount
      chordPickSavedQuestionCountRef.current =
        typeof chordCount === 'number' && Number.isFinite(chordCount) ? Math.max(1, Math.floor(chordCount)) : 10
      fixedEndSavedQuestionCountRef.current =
        typeof fixedCount === 'number' && Number.isFinite(fixedCount) ? Math.max(1, Math.floor(fixedCount)) : 10
      if (typeof saved.fixedEndWhiteKeysOnly === 'boolean') setFixedEndWhiteKeysOnly(saved.fixedEndWhiteKeysOnly)
      if (typeof saved.fixedEndLimitLeapToOctave === 'boolean') {
        setFixedEndLimitLeapToOctave(saved.fixedEndLimitLeapToOctave)
      }
    })
  }, [])

  const keys = useMemo(() => buildKeyboard(VISIBLE_KEYBOARD_MIDI), [])
  const whiteKeys = useMemo(() => keys.filter((k) => !k.isBlack), [keys])
  const blackKeys = useMemo(() => keys.filter((k) => k.isBlack), [keys])
  const transposeSemitones = useMemo(() => KEY_TO_SEMITONES[currentKey], [currentKey])

  useEffect(() => {
    return () => {
      clearTimers()
      engine.dispose()
    }
  }, [clearTimers, engine])

  const resetPerQuestionUi = useCallback(() => {
    clearTimers()
    setInputNotes([])
    setAnswerNotes([])
    setKeyMark({})
    setBlueKeys(new Set())
  }, [clearTimers])

  const keyForMidiIfVisible = useCallback(
    (midi: number) => toneNoteNameIfMidiOnVisibleKeyboard(midi),
    [],
  )

  const pool = useMemo(() => {
    if (quizMode !== 'free') return []
    return buildFreeInputPool(quizInlineText)
  }, [quizMode, quizInlineText])

  const chordPickPool = useMemo(
    () => (quizMode === 'chordPick' ? buildChordPickPoolFromEditorText(chordPickText) : []),
    [quizMode, chordPickText],
  )

  const fixedEndPool = useMemo(
    () =>
      quizMode === 'fixedEnd'
        ? buildFixedEndPool({
            startText: fixedEndStartText,
            endText: fixedEndEndText,
            middleText: fixedEndMiddleText,
            noBlack: fixedEndWhiteKeysOnly,
            limitLeap: fixedEndLimitLeapToOctave,
          })
        : [],
    [
      quizMode,
      fixedEndStartText,
      fixedEndEndText,
      fixedEndMiddleText,
      fixedEndWhiteKeysOnly,
      fixedEndLimitLeapToOctave,
    ],
  )

  const poolSize = pool.length
  const chordPickPoolSize = chordPickPool.length
  const fixedEndPoolSize = fixedEndPool.length

  const canStart =
    quizMode === 'fixedEnd'
      ? fixedEndPoolSize > 0
      : quizMode === 'free'
        ? poolSize > 0
        : chordPickPoolSize > 0

  const primaryStartLabel =
    quizState.kind === 'finished'
      ? resultFreshForAgainStart
        ? 'もう一度スタート'
        : 'スタート'
      : quizState.kind !== 'idle'
        ? '中断して再スタート'
        : 'スタート'

  useEffect(() => {
    if (quizMode === 'chordPick' && prevQuizModeRef.current !== 'chordPick') {
      chordPickDefaultsAppliedRef.current = false
    }
    if (quizMode === 'fixedEnd' && prevQuizModeRef.current !== 'fixedEnd') {
      fixedEndDefaultsAppliedRef.current = false
    }
    prevQuizModeRef.current = quizMode
  }, [quizMode])

  useEffect(() => {
    if (quizMode !== 'chordPick') return
    if (chordPickPoolSize === 0) return
    const max = chordPickPoolSize

    if (!chordPickDefaultsAppliedRef.current) {
      chordPickDefaultsAppliedRef.current = true
      setQuestionCount(Math.max(1, Math.min(chordPickSavedQuestionCountRef.current, max)))
      return
    }

    setQuestionCount((prev) => {
      return Math.max(1, Math.min(prev, max))
    })
  }, [quizMode, chordPickPoolSize])

  useEffect(() => {
    if (quizMode !== 'fixedEnd') return
    if (fixedEndPoolSize === 0) return
    const max = fixedEndPoolSize

    if (!fixedEndDefaultsAppliedRef.current) {
      fixedEndDefaultsAppliedRef.current = true
      setQuestionCount(Math.max(1, Math.min(fixedEndSavedQuestionCountRef.current, max)))
      return
    }

    setQuestionCount((prev) => {
      return Math.max(1, Math.min(prev, max))
    })
  }, [quizMode, fixedEndPoolSize])

  const saveModeSettings = useCallback((patch: Partial<UserSettingsStore>) => {
    void loadUserSettings().then((cur) => saveUserSettings({ ...cur, ...patch }))
  }, [])

  const handleChordPickQuestionCountChange = useCallback(
    (n: number) => {
      const normalized = Math.max(1, Math.floor(n))
      setQuestionCount(normalized)
      chordPickSavedQuestionCountRef.current = normalized
      saveModeSettings({ chordPickQuestionCount: normalized })
    },
    [saveModeSettings],
  )

  const handleFixedEndQuestionCountChange = useCallback(
    (n: number) => {
      const normalized = Math.max(1, Math.floor(n))
      setQuestionCount(normalized)
      fixedEndSavedQuestionCountRef.current = normalized
      saveModeSettings({ fixedEndQuestionCount: normalized })
    },
    [saveModeSettings],
  )

  const handleFixedEndWhiteKeysOnlyChange = useCallback(
    (v: boolean) => {
      setFixedEndWhiteKeysOnly(v)
      saveModeSettings({ fixedEndWhiteKeysOnly: v })
    },
    [saveModeSettings],
  )

  const handleFixedEndLimitLeapToOctaveChange = useCallback(
    (v: boolean) => {
      setFixedEndLimitLeapToOctave(v)
      saveModeSettings({ fixedEndLimitLeapToOctave: v })
    },
    [saveModeSettings],
  )

  const pickQuestionAt = useCallback((pos: number, queue: number[]) => {
    const items = currentPoolRef.current
    const idx = queue[pos]
    if (idx === undefined || !items[idx]) return null
    const q = items[idx]!
    setCurrentQuestionRaw(q.raw)
    setCurrentBpm(tempoBpm)
    setCurrentSteps(q.steps as any)
    setExpectedNotes(q.normalizedNotes)
    // UI 用 state と別に、制御用 ref も即時更新する（setState の反映待ちをしない）
    currentQuestionRawRef.current = q.raw
    currentBpmRef.current = tempoBpm
    currentStepsRef.current = q.steps as any
    expectedNotesRef.current = q.normalizedNotes
    return { raw: q.raw, bpm: tempoBpm, steps: q.steps, normalizedNotes: q.normalizedNotes }
  }, [tempoBpm])

  const scheduleQuestionPlayback = useCallback(
    async (opts: {
      bpm: number
      steps: Array<{ kind: 'note'; pc: number; midi: number; quarters: number } | { kind: 'rest'; quarters: number }>
      showBlueKeys?: boolean
      onNote?: (pc: number, midi: number, atSeconds: number) => void
    }) => {
      // 解答欄/青鍵盤の更新は setTimeout で行っているため、
      // 直前フェーズのタイマーが残っていると「混入バグ」になる。ここで止める。
      clearTimers()
      const quarterSec = 60 / opts.bpm
      let t = 0
      for (const step of opts.steps) {
        const durSeconds = step.quarters * quarterSec
        if (step.kind === 'note') {
          const relNote = midiToToneNoteName(step.midi)
          const at = Tone.now() + t
          await engine.attackRelease(relNote, durSeconds * 0.95, transposeSemitones, at)

          if (opts.onNote) opts.onNote(step.pc, step.midi, t)

          if (opts.showBlueKeys) {
            const key = keyForMidiIfVisible(step.midi)
            if (key) {
              const id = window.setTimeout(() => {
                setBlueKeys((prev) => new Set(prev).add(key))
              }, Math.max(0, Math.floor(t * 1000)))
              pendingTimers.current.push(id)
            }
          }
        }
        t += durSeconds
      }
      return t
    },
    [clearTimers, engine, keyForMidiIfVisible, transposeSemitones],
  )

  const revealAndAdvance = useCallback(
    (isCorrect: boolean, token: number) => {
      if (token !== questionTokenRef.current) {
        return
      }
      if (revealStartedRef.current) {
        return
      }
      revealStartedRef.current = true
      setQuizState({ kind: 'revealing' })
      if (isCorrect) {
        setAnswerNotes([...expectedNotesRef.current])
        if (currentStepsRef.current.length > 0) {
          void scheduleQuestionPlayback({
            bpm: currentBpmRef.current,
            steps: currentStepsRef.current,
            showBlueKeys: true,
          }).then((total) => {
            const queueLen = cycleQueueRef.current.length
            const nextPos = cyclePosRef.current + 1
            const isLast = nextPos >= queueLen
            const gapSec = isLast ? 0 : questionIntervalSec
            const delayMs = Math.floor((total + AUDIO_TAIL_SEC + 0.05 + gapSec) * 1000)
            const doneId = window.setTimeout(() => {
              if (token !== questionTokenRef.current) return
              const queue = cycleQueueRef.current
              const resolvedNextPos = cyclePosRef.current + 1
              if (resolvedNextPos >= queue.length) {
                setQuizState({ kind: 'finished' })
                return
              }
              cyclePosRef.current = resolvedNextPos
              void startCurrentQuestionRef.current(queue, resolvedNextPos)
            }, delayMs)
            pendingTimers.current.push(doneId)
          })
        }
        return
      }

      setAnswerNotes([])
      if (currentStepsRef.current.length > 0) {
        void scheduleQuestionPlayback({
          bpm: currentBpmRef.current,
          steps: currentStepsRef.current,
          showBlueKeys: true,
          onNote: (pcAt, _midi, atSeconds) => {
            const id = window.setTimeout(() => {
              setAnswerNotes((prev) => [...prev, pcAt])
            }, Math.max(0, Math.floor(atSeconds * 1000)))
            pendingTimers.current.push(id)
          },
        }).then((total) => {
          const queueLen = cycleQueueRef.current.length
          const nextPos = cyclePosRef.current + 1
          const isLast = nextPos >= queueLen
          const gapSec = isLast ? 0 : questionIntervalSec
          const delayMs = Math.floor((total + AUDIO_TAIL_SEC + 0.05 + gapSec) * 1000)
          const doneId = window.setTimeout(() => {
            if (token !== questionTokenRef.current) return
            const queue = cycleQueueRef.current
            const resolvedNextPos = cyclePosRef.current + 1
            if (resolvedNextPos >= queue.length) {
              setQuizState({ kind: 'finished' })
              return
            }
            cyclePosRef.current = resolvedNextPos
            void startCurrentQuestionRef.current(queue, resolvedNextPos)
          }, delayMs)
          pendingTimers.current.push(doneId)
        })
      }
    },
    [
      questionIntervalSec,
      scheduleQuestionPlayback,
    ],
  )

  const startCurrentQuestion = useCallback(
    async (queue: number[], pos: number) => {
      resetPerQuestionUi()
      const token = ++questionTokenRef.current
      revealStartedRef.current = false
      presentationDoneRef.current = false
      questionSettledRef.current = false
      pendingRevealRef.current = null
      if (pos >= queue.length) {
        setQuizState({ kind: 'finished' })
        return
      }
      const q = pickQuestionAt(pos, queue)
      if (!q) {
        setQuizState({ kind: 'finished' })
        return
      }
      setPresentCount(pos + 1)
      setQuizState({ kind: 'presenting' })
      void scheduleQuestionPlayback({ bpm: q.bpm, steps: q.steps })
      const totalQuarters = q.steps.reduce((acc, s) => acc + s.quarters, 0)
      const presentationMs = Math.floor((totalQuarters * (60 / q.bpm) + AUDIO_TAIL_SEC + 0.05) * 1000)
      const doneId = window.setTimeout(() => {
        if (token !== questionTokenRef.current) return
        presentationDoneRef.current = true
        const pending = pendingRevealRef.current
        if (pending) {
          pendingRevealRef.current = null
          revealAndAdvance(pending.isCorrect, token)
          return
        }
        if (!questionSettledRef.current) setQuizState({ kind: 'answering' })
      }, presentationMs)
      pendingTimers.current.push(doneId)
    },
    [pickQuestionAt, resetPerQuestionUi, revealAndAdvance, scheduleQuestionPlayback],
  )

  useEffect(() => {
    startCurrentQuestionRef.current = startCurrentQuestion
  }, [startCurrentQuestion])

  const handleStart = useCallback(() => {
    if (!canStart) return
    if (!audioReady) return
    setProblemSettingsOpen(false)

    // プールは上の useMemo（pool / chordPickPool / fixedEndPool）と同一 — 二重構築しない
    let slice: PoolItem[]
    if (quizMode === 'fixedEnd') {
      const built = fixedEndPool
      if (built.length === 0) return
      const take = Math.min(Math.max(1, questionCount), built.length)
      slice = shufflePool(built).slice(0, take)
    } else if (quizMode === 'chordPick') {
      const built = chordPickPool
      if (built.length === 0) return
      const take = Math.min(Math.max(1, questionCount), built.length)
      slice = shufflePool(built).slice(0, take)
    } else {
      const built = pool
      if (built.length === 0) return
      slice = shufflePool(built)
    }

    currentPoolRef.current = slice
    const queue = Array.from({ length: slice.length }, (_, i) => i)
    setCycleQueue(queue)
    cycleQueueRef.current = queue
    cyclePosRef.current = 0
    setPresentCount(0)
    setSessionLog([])
    setQuizState({ kind: 'presenting' })
    void startCurrentQuestion(
      queue,
      0,
    )
  }, [
    canStart,
    audioReady,
    quizMode,
    questionCount,
    pool,
    chordPickPool,
    fixedEndPool,
    setProblemSettingsOpen,
    startCurrentQuestion,
  ])

  const noteOn = useCallback(
    async (note: string) => {
      if (!audioReady) return
      setActiveNotes((prev) => {
        const next = new Set(prev)
        next.add(note)
        activeNotesRef.current = next
        return next
      })
      await engine.attack(note, transposeSemitones)
      const existing = noteOffSafetyTimersRef.current.get(note)
      if (existing !== undefined) window.clearTimeout(existing)
      const id = window.setTimeout(() => {
        noteOffSafetyTimersRef.current.delete(note)
        setActiveNotes((prev) => {
          const next = new Set(prev)
          next.delete(note)
          activeNotesRef.current = next
          return next
        })
        engine.release(note, transposeSemitones)
      }, KEY_HOLD_SAFETY_MS)
      noteOffSafetyTimersRef.current.set(note, id)
    },
    [audioReady, engine, transposeSemitones],
  )

  const noteOff = useCallback((note: string) => {
    const safetyId = noteOffSafetyTimersRef.current.get(note)
    if (safetyId !== undefined) {
      window.clearTimeout(safetyId)
      noteOffSafetyTimersRef.current.delete(note)
    }
    setActiveNotes((prev) => {
      const next = new Set(prev)
      next.delete(note)
      activeNotesRef.current = next
      return next
    })
    engine.release(note, transposeSemitones)
  }, [engine, transposeSemitones])

  const releaseAllActiveNotes = useCallback(() => {
    for (const id of noteOffSafetyTimersRef.current.values()) window.clearTimeout(id)
    noteOffSafetyTimersRef.current.clear()
    const notes = Array.from(activeNotesRef.current)
    for (const n of notes) engine.release(n, transposeSemitones)
    activeNotesRef.current = new Set()
    setActiveNotes(new Set())
  }, [engine, transposeSemitones])

  useEffect(() => {
    const onGlobalPointerUp = () => releaseAllActiveNotes()
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') releaseAllActiveNotes()
    }
    window.addEventListener('pointerup', onGlobalPointerUp)
    window.addEventListener('pointercancel', onGlobalPointerUp)
    window.addEventListener('blur', onGlobalPointerUp)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pointerup', onGlobalPointerUp)
      window.removeEventListener('pointercancel', onGlobalPointerUp)
      window.removeEventListener('blur', onGlobalPointerUp)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [releaseAllActiveNotes])

  const handleAnswerKey = useCallback(
    (relativeNote: string) => {
      if (quizState.kind !== 'presenting' && quizState.kind !== 'answering') {
        return
      }
      if (questionSettledRef.current) {
        return
      }

      const pc = ((Tone.Frequency(relativeNote).toMidi() ?? 0) % 12 + 12) % 12
      const nextIndex = inputNotes.length
      const expectedPc = expectedNotesRef.current[nextIndex]

      if (expectedPc === undefined) {
        return
      }

      if (pc === expectedPc) {
        const answeredPcs = [...inputNotes.map((n) => n.pc), pc]
        setInputNotes((prev) => [...prev, { pc, wrong: false }])
        setKeyMark((prev) => ({ ...prev, [relativeNote]: 'correct' }))

        if (nextIndex + 1 === expectedNotesRef.current.length) {
          questionSettledRef.current = true
          setSessionLog((prev) => [
            ...prev,
            {
              questionText: currentQuestionRawRef.current,
              ok: true,
              answered: normalizedToKatakana(answeredPcs),
              expected: normalizedToKatakana(expectedNotesRef.current),
            },
          ])
          setCumulative((prev) => {
            const next = bumpStats(
              prev,
              normalizeKeyForCumulativeStats(currentQuestionRawRef.current),
              true,
            )
            void saveAllStats(next)
            return next
          })
          if (presentationDoneRef.current) {
            revealAndAdvance(true, questionTokenRef.current)
          } else {
            pendingRevealRef.current = { isCorrect: true }
          }
        }
        return
      }

      // wrong: lock question, replay and reveal
      questionSettledRef.current = true
      const answeredPcs = [...inputNotes.map((n) => n.pc), pc]
      setInputNotes((prev) => [...prev, { pc, wrong: true }])
      setKeyMark((prev) => ({ ...prev, [relativeNote]: 'wrong' }))
      setSessionLog((prev) => [
        ...prev,
        {
          questionText: currentQuestionRawRef.current,
          ok: false,
          answered: normalizedToKatakana(answeredPcs),
          expected: normalizedToKatakana(expectedNotesRef.current),
        },
      ])
      setCumulative((prev) => {
        const next = bumpStats(
          prev,
          normalizeKeyForCumulativeStats(currentQuestionRawRef.current),
          false,
        )
        void saveAllStats(next)
        return next
      })
      if (presentationDoneRef.current) {
        revealAndAdvance(false, questionTokenRef.current)
      } else {
        pendingRevealRef.current = { isCorrect: false }
      }
    },
    [
      inputNotes.length,
      quizState.kind,
      revealAndAdvance,
    ],
  )

  return (
    <div className={`app ${view === 'user' ? 'viewUser' : ''}`}>
      <main className="main">
        <section className="panel">
          <div className="settings userSettingsPanel">
            <div className="settingsRow">
              <label className="keySelect">
                <span>キー</span>
                <select
                  value={currentKey}
                  onChange={(e) =>
                    setCurrentKey(
                      e.target.value as (typeof KEY_OPTIONS)[number]['id'],
                    )
                  }
                >
                  {KEY_OPTIONS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="settingsRow userSliderRow">
              <label className="keySelect userSliderLabel">
                <span>出題間隔</span>
                <input
                  type="range"
                  className="countBar"
                  min={2}
                  max={5}
                  step={1}
                  value={questionIntervalSec}
                  style={rangeSliderVars(2, 5, questionIntervalSec)}
                  onChange={(e) => setQuestionIntervalSec(Number(e.target.value) as 2 | 3 | 4 | 5)}
                />
                <span className="countLabel">{questionIntervalSec}秒</span>
              </label>
            </div>
            <div className="settingsRow userSliderRow">
              <label className="keySelect userSliderLabel">
                <span>テンポ</span>
                <input
                  type="range"
                  className="countBar"
                  min={50}
                  max={120}
                  step={10}
                  value={tempoBpm}
                  style={rangeSliderVars(50, 120, tempoBpm)}
                  onChange={(e) =>
                    setTempoBpm(
                      Number(e.target.value) as
                        | 50
                        | 60
                        | 70
                        | 80
                        | 90
                        | 100
                        | 110
                        | 120,
                    )
                  }
                />
                <span className="countLabel">{tempoBpm}</span>
              </label>
            </div>
          </div>
          <div className="userSettingsHelpPlain">{USER_SETTINGS_HELP_TEXT}</div>
          <div className="quizGameControls">
            <div className="modeTabs" role="tablist" aria-label="mode">
              <div className="modeTabsLeft">
                <button
                  type="button"
                  className={`modeTab ${quizMode === 'free' ? 'active' : ''}`}
                  onClick={() => handleModeTabClick('free')}
                  role="tab"
                  aria-selected={quizMode === 'free'}
                >
                  手入力
                </button>
                <button
                  type="button"
                  className={`modeTab ${quizMode === 'fixedEnd' ? 'active' : ''}`}
                  onClick={() => handleModeTabClick('fixedEnd')}
                  role="tab"
                  aria-selected={quizMode === 'fixedEnd'}
                >
                  指定＋ランダム
                </button>
                <button
                  type="button"
                  className={`modeTab ${quizMode === 'chordPick' ? 'active' : ''}`}
                  onClick={() => handleModeTabClick('chordPick')}
                  role="tab"
                  aria-selected={quizMode === 'chordPick'}
                >
                  構成音から生成
                </button>
              </div>
              <div className="modeTabsRight">
                <button
                  type="button"
                  className={`gearBtn${view === 'user' ? ' gearBtnOn' : ''}`}
                  onClick={() => setView((v) => (v === 'user' ? 'game' : 'user'))}
                  aria-label="設定"
                  aria-pressed={view === 'user'}
                  title="設定"
                >
                  ⚙
                </button>
              </div>
            </div>

            {problemSettingsOpen && (
              <div className="settings">
                {quizMode === 'free' ? (
                  <FreeQuizSettings
                    text={quizInlineText}
                    onTextChange={setQuizInlineText}
                    helpOpen={freeInputHelpOpen}
                    onHelpOpenToggle={() => setFreeInputHelpOpen((o) => !o)}
                  />
                ) : null}

                {quizMode === 'chordPick' ? (
                  <ChordPickQuizSettings
                    text={chordPickText}
                    onTextChange={setChordPickText}
                    poolSize={chordPickPoolSize}
                    questionCount={questionCount}
                    onQuestionCountChange={handleChordPickQuestionCountChange}
                    helpOpen={chordPickHelpOpen}
                    onHelpOpenToggle={() => setChordPickHelpOpen((o) => !o)}
                  />
                ) : null}

                {quizMode === 'fixedEnd' ? (
                  <FixedEndQuizSettings
                    startText={fixedEndStartText}
                    endText={fixedEndEndText}
                    middleText={fixedEndMiddleText}
                    onStartTextChange={setFixedEndStartText}
                    onEndTextChange={setFixedEndEndText}
                    onMiddleTextChange={setFixedEndMiddleText}
                    whiteKeysOnly={fixedEndWhiteKeysOnly}
                    onWhiteKeysOnlyChange={handleFixedEndWhiteKeysOnlyChange}
                    limitLeapToOctave={fixedEndLimitLeapToOctave}
                    onLimitLeapToOctaveChange={handleFixedEndLimitLeapToOctaveChange}
                    poolSize={fixedEndPoolSize}
                    questionCount={questionCount}
                    onQuestionCountChange={handleFixedEndQuestionCountChange}
                    helpOpen={fixedEndHelpOpen}
                    onHelpOpenToggle={() => setFixedEndHelpOpen((o) => !o)}
                  />
                ) : null}

                <div className="settingsRow settingsStartRow">
                  <button
                    type="button"
                    className="startBtn"
                    onClick={() => {
                      void handleStart()
                    }}
                    disabled={!canStart || !audioReady || audioPriming}
                  >
                    {primaryStartLabel}
                  </button>
                </div>
              </div>
            )}

            {quizState.kind === 'finished' && !problemSettingsOpen && (
              <div className="finishedActionsBox">
                <div className="finishedActions">
                  <button
                    type="button"
                    className="startBtn"
                    disabled={!canStart || !audioReady || audioPriming}
                    onClick={() => {
                      void handleStart()
                    }}
                  >
                    {primaryStartLabel}
                  </button>
                  <button
                    type="button"
                    className="startBtn startBtnSecondary"
                    onClick={() => {
                      setResultFreshForAgainStart(false)
                      setProblemSettingsOpen(true)
                    }}
                  >
                    設定編集
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="qCount">
            {quizState.kind !== 'idle'
              ? `${presentCount} / ${cycleQueue.length} 問`
              : '\u00A0'}
          </div>

          <div className="keyboardScroll" role="group" aria-label="piano keyboard">
            <div className="keyboard">
              <div className="white-keys">
                {whiteKeys.map((k) => (
                  <button
                    key={k.note}
                    type="button"
                    className={[
                      'key',
                      'white',
                      activeNotes.has(k.note) ? 'active' : '',
                      keyMark[k.note] === 'correct' ? 'correct' : '',
                      keyMark[k.note] === 'wrong' ? 'wrong' : '',
                      blueKeys.has(k.note) ? 'blue' : '',
                    ].join(' ')}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId)
                      void noteOn(k.note)
                    }}
                    onPointerUp={() => {
                      noteOff(k.note)
                      handleAnswerKey(k.note)
                    }}
                    onPointerLeave={() => noteOff(k.note)}
                    onLostPointerCapture={() => noteOff(k.note)}
                    onPointerCancel={() => noteOff(k.note)}
                  >
                    <span className="srOnly">{k.note}</span>
                  </button>
                ))}
              </div>

              <div className="black-keys">
                {blackKeys.map((k) => (
                  <button
                    key={k.note}
                    type="button"
                    className={[
                      'key',
                      'black',
                      activeNotes.has(k.note) ? 'active' : '',
                      keyMark[k.note] === 'correct' ? 'correct' : '',
                      keyMark[k.note] === 'wrong' ? 'wrong' : '',
                      blueKeys.has(k.note) ? 'blue' : '',
                    ].join(' ')}
                    style={{
                      left: `calc(var(--unit) * ${k.xInWhiteUnits ?? 0} - var(--black-w) / 2)`,
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.currentTarget.setPointerCapture(e.pointerId)
                      void noteOn(k.note)
                    }}
                    onPointerUp={() => {
                      noteOff(k.note)
                      handleAnswerKey(k.note)
                    }}
                    onPointerLeave={() => noteOff(k.note)}
                    onLostPointerCapture={() => noteOff(k.note)}
                    onPointerCancel={() => noteOff(k.note)}
                  >
                    <span className="srOnly">{k.note}</span>
                  </button>
                ))}
              </div>
              {!audioReady && (
                <div className="keyboardInitOverlay">
                  <button
                    type="button"
                    className="startBtn keyboardInitBtn"
                    onClick={() => {
                      void primeAudio()
                    }}
                    disabled={audioPriming}
                  >
                    {audioPriming ? '音声を初期化中...' : '音声を初期化'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="io">
            <div className="ioRow">
              <div className="ioLabel">入力</div>
              <div className="ioValue">
                {inputNotes.map((n, idx) => (
                  <span key={idx} className={n.wrong ? 'textWrong' : ''}>
                    {normalizedToKatakana([n.pc])}
                  </span>
                ))}
              </div>
            </div>
            <div className="ioRow">
              <div className="ioLabel">解答</div>
              <div className="ioValue textAnswer">
                {answerNotes.map((pc, idx) => (
                  <span key={idx}>{normalizedToKatakana([pc])}</span>
                ))}
              </div>
            </div>
          </div>

          {quizState.kind === 'finished' && (
            <div className="logs">
              <h2>結果</h2>
              <div className="logGrid">
                <div className="logCol">
                  <h3>今回</h3>
                  <ul>
                    {sessionLog.map((r, idx) => (
                      <li key={`${idx}-${r.questionText}`}>
                        <span className={`mark ${r.ok ? 'ok' : 'ng'}`}>{r.ok ? '○' : '×'}</span>
                        <span className="q">{r.questionText}</span>
                        {!r.ok && <span className="statSession">入力:{r.answered}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="logCol">
                  <h3>累計</h3>
                  <ul>
                    {Object.entries(cumulative)
                      .filter(([statsKey]) =>
                        sessionLog.some(
                          (s) =>
                            normalizeKeyForCumulativeStats(s.questionText) === statsKey,
                        ),
                      )
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([statsKey, st]) => {
                        const rate = st.attempts ? Math.round((st.correct / st.attempts) * 100) : 0
                        const rateClass = rate >= 80 ? 'rateGood' : rate <= 20 ? 'rateBad' : 'rateNum'
                        return (
                          <li key={statsKey}>
                            <span className="q">
                              {statsKey}{' '}
                              <span className="rateMeta"> (</span>
                              <span className={rateClass}>
                                {rate}%
                              </span>
                              <span className="rateMeta"> {st.attempts}回)</span>
                            </span>
                          </li>
                        )
                      })}
                  </ul>
                </div>
              </div>

            </div>
          )}

        </section>
        <div
          id="ad-footer-slot"
          className="footerAdSlot"
          {...(import.meta.env.VITE_ADS_HIDE_IN_STANDALONE === 'true'
            ? { 'data-ads-hide-standalone': 'true' as const }
            : {})}
        />
        <div className="footerLinks">
          <span>MyOnkan 相対音感練習</span>
          <span>　　　</span>
          <span><a href="https://aramugi.com" target="_blank" rel="noreferrer">制作者</a></span>
          <span> / </span>
          <a href="https://github.com/tsukadam/my_onkan" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </main>
    </div>
  )
}

export default App
