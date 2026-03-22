import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { getAudioEngine } from './audio/engine'
import type { ProblemSet } from './problems/registry'
import { buildPool, shufflePool, type PoolItem } from './problems/pool'
import { normalizedToKatakana } from './problem/normalize'
import { bumpStats, type StatsStore } from './stats/storage'
import { loadAllStats, saveAllStats } from './db/stats'
import {
  deleteProblemSet,
  getProblemSet,
  listAllProblemSets,
  listProblemSets,
  putProblemSet,
  replaceAllProblemSets,
} from './db/problemSets'
import { formatProblemSetToEditorText, parseEditorTextToQuestions } from './db/editorText'
import { buildChordPickPoolFromEditorText } from './problem/chordPick'
import './App.css'

type QuizMode = 'free' | 'random' | 'chordPick'

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

function buildKeyboard(range: { from: number; to: number }): PianoKey[] {
  // MIDI note numbers: C3=48, C5=72
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
  const [currentKey, setCurrentKey] =
    useState<(typeof KEY_OPTIONS)[number]['id']>('C')
  const [quizInlineText, setQuizInlineText] = useState('')
  const [freeInputHelpOpen, setFreeInputHelpOpen] = useState(false)
  const [randomFiltersOpen, setRandomFiltersOpen] = useState(false)
  const [noteCountFilter, setNoteCountFilter] = useState<number>(3)
  const [startPcFilter, setStartPcFilter] = useState<number | ''>('')
  const [lastPcFilter, setLastPcFilter] = useState<number | ''>('')
  const [quizMode, setQuizMode] = useState<QuizMode>('free')
  const [chordPickText, setChordPickText] = useState('')
  const [chordPickHelpOpen, setChordPickHelpOpen] = useState(false)
  const [randomNoBlack, setRandomNoBlack] = useState(true)
  const [randomLimitLeap, setRandomLimitLeap] = useState(true)
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
  const [problemSettingsOpen, setProblemSettingsOpen] = useState(true)
  /** 結果直後だけ true。タブ・設定編集・モード切替で false → 主ボタンは「スタート」 */
  const [resultFreshForAgainStart, setResultFreshForAgainStart] = useState(true)
  const prevQuizModeRef = useRef<QuizMode>('free')
  /** 構成音モードで「入室時の出題数デフォルト」を一度だけ適用したか */
  const chordPickDefaultsAppliedRef = useRef(false)

  // タブの折りたたみ状態:
  // - 初期（idle）は展開固定
  // - 出題中/リザルト（finished含む）は折りたたみ（必要ならタブ押下で開閉）
  useEffect(() => {
    if (quizState.kind === 'idle') setProblemSettingsOpen(true)
    if (quizState.kind === 'finished') setProblemSettingsOpen(false)
  }, [quizState.kind])

  useEffect(() => {
    if (quizState.kind === 'finished') setResultFreshForAgainStart(true)
  }, [quizState.kind])

  const [cycleQueue, setCycleQueue] = useState<number[]>([])
  const [cyclePos, setCyclePos] = useState(0)
  const [presentCount, setPresentCount] = useState(0)
  const currentPoolRef = useRef<PoolItem[]>([])

  const [currentQuestionRaw, setCurrentQuestionRaw] = useState<string>('')
  const [currentBpm, setCurrentBpm] = useState(80)
  const [currentSteps, setCurrentSteps] = useState<
    Array<{ kind: 'note'; pc: number; midi: number; quarters: number; raw: string } | { kind: 'rest'; quarters: number; raw: string }>
  >([])
  const [expectedNotes, setExpectedNotes] = useState<number[]>([])
  const [inputNotes, setInputNotes] = useState<Array<{ pc: number; wrong: boolean }>>([])
  const [answerNotes, setAnswerNotes] = useState<number[]>([])

  const [keyMark, setKeyMark] = useState<Record<string, 'correct' | 'wrong'>>({})
  const [blueKeys, setBlueKeys] = useState<Set<string>>(() => new Set())

  const [sessionLog, setSessionLog] = useState<Array<{ q: string; ok: boolean; answered: string; expected: string }>>([])
  const [cumulative, setCumulative] = useState<StatsStore>(() => ({}))

  const pendingTimers = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    for (const t of pendingTimers.current) window.clearTimeout(t)
    pendingTimers.current = []
  }, [])

  const [userProblemSets, setUserProblemSets] = useState<ProblemSet[]>([])

  // Editor UI state
  const [showEditorInUserSettings, setShowEditorInUserSettings] = useState(false)
  const [editorSelectedTitle, setEditorSelectedTitle] = useState<string>('__new__')
  const [editorTitle, setEditorTitle] = useState('')
  const [editorBody, setEditorBody] = useState('')
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const editorNewHelp = useMemo(
    () =>
      [
        '使用可能文字: ドデレリミファフィソサラチシ',
        'オクターブ違いの同名音は、直前の音に最も近い音が選ばれます。',
        '音名の前に↑や↓をつけるとオクターブを上下できます。',
        ' ',
        '全角/半角スペースで休符',
        '伸ばし棒（ー）で音値を伸ばす',
      ].join('\n'),
    [],
  )

  const freeInputHelpDetail = useMemo(
    () =>
      [
        'オクターブ違いの同名音は、直前の音に最も近い音が選ばれます。',
        '音名の前にやか↓をつけるとオクターブを上下できます。',
        '全角/半角スペースで休符',
        '伸ばし棒（ー）で音値を伸ばす',
      ].join('\n'),
    [],
  )

  const refreshUserSets = useCallback(async () => {
    const list = await listProblemSets()
    const loaded: ProblemSet[] = []
    for (const row of list) {
      const full = await getProblemSet(row.title)
      if (!full) continue
      const questions = [...full.questions].sort((a, b) => a.id - b.id).map((q) => q.text)
      loaded.push({
        meta: {
          id: `user:${full.title}`,
          title: full.title,
          filename: 'IndexedDB',
        },
        questions,
      })
    }
    setUserProblemSets(loaded.sort((a, b) => a.meta.title.localeCompare(b.meta.title)))
  }, [])

  useEffect(() => {
    void refreshUserSets()
  }, [refreshUserSets])

  useEffect(() => {
    void loadAllStats().then(setCumulative)
  }, [])

  const loadEditorSelection = useCallback(
    async (title: string) => {
      setEditorSelectedTitle(title)
      if (title === '__new__') {
        setEditorTitle('')
        setEditorBody('')
        return
      }
      const set = await getProblemSet(title)
      if (!set) {
        setEditorTitle(title)
        setEditorBody('')
        return
      }
      setEditorTitle(set.title)
      setEditorBody(formatProblemSetToEditorText(set))
    },
    [editorNewHelp],
  )

  const handleEditorSave = useCallback(async () => {
    let title = editorTitle.trim()
    if (!title) {
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      title = `問題セット ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    }

    const parsed = parseEditorTextToQuestions(editorBody)
    if (parsed.validLines.length === 0) {
      window.alert('有効な行がありません。保存しませんでした。')
      return
    }

    const questions = parsed.validLines.map((text, idx) => ({ id: idx + 1, text }))
    await putProblemSet({ title, questions })
    await refreshUserSets()

    const ignored = parsed.ignoredLines.length
    window.alert(
      `保存しました。\nタイトル: ${title}\n保存行: ${parsed.validLines.length}\n無視行: ${ignored}`,
    )

    await loadEditorSelection(title)
  }, [editorBody, editorTitle, loadEditorSelection, refreshUserSets])

  const handleEditorDelete = useCallback(async () => {
    const title = editorSelectedTitle === '__new__' ? '' : editorSelectedTitle
    if (!title) return
    const ok = window.confirm(`「${title}」を削除します。よろしいですか？`)
    if (!ok) return
    await deleteProblemSet(title)
    await refreshUserSets()
    await loadEditorSelection('__new__')
    window.alert('削除しました。')
  }, [deleteProblemSet, editorSelectedTitle, loadEditorSelection, refreshUserSets])

  const handleExportProblemSets = useCallback(async () => {
    const rows = await listAllProblemSets()
    const payload = {
      format: 'myonkan-problemsets',
      version: 1,
      exportedAt: new Date().toISOString(),
      problemSets: rows.map((r) => ({
        title: r.title,
        questions: [...r.questions].sort((a, b) => a.id - b.id),
      })),
    }
    const json = JSON.stringify(payload, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const ts = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    a.href = url
    a.download = `myonkan_problemsets_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    window.alert(`${payload.problemSets.length}件の問題セットをエクスポートしました。`)
  }, [])

  const handleImportProblemSets = useCallback(async (file: File) => {
    const text = await file.text()
    const raw = JSON.parse(text) as {
      format?: string
      version?: number
      problemSets?: Array<{
        title?: unknown
        questions?: Array<{ id?: unknown; text?: unknown }>
      }>
    }
    const input = Array.isArray(raw.problemSets) ? raw.problemSets : []
    const normalized: Array<{ title: string; questions: Array<{ id: number; text: string }> }> = []
    for (const s of input) {
      const title = typeof s.title === 'string' ? s.title.trim() : ''
      if (!title) continue
      const questions = Array.isArray(s.questions)
        ? s.questions
            .map((q, idx) => {
              const text = typeof q.text === 'string' ? q.text.trim() : ''
              const id = typeof q.id === 'number' ? q.id : idx + 1
              return { id, text }
            })
            .filter((q) => q.text.length > 0)
            .sort((a, b) => a.id - b.id)
            .map((q, idx) => ({ id: idx + 1, text: q.text }))
        : []
      if (questions.length === 0) continue
      normalized.push({ title, questions })
    }
    if (normalized.length === 0) {
      window.alert('有効な問題セットが見つかりませんでした。')
      return
    }
    const ok = window.confirm(
      `インポートすると既存の問題セットはすべて削除されます。\n${normalized.length}件を取り込みます。よろしいですか？`,
    )
    if (!ok) return
    await replaceAllProblemSets(normalized)
    await refreshUserSets()
    await loadEditorSelection('__new__')
    window.alert(`${normalized.length}件の問題セットをインポートしました。`)
  }, [loadEditorSelection, refreshUserSets])

  const keys = useMemo(() => buildKeyboard({ from: 48, to: 72 }), [])
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

  const keyForMidiIfVisible = useCallback((midi: number) => {
    // keyboard is C3..C5 (48..72). 範囲外は表示しない（null）
    if (midi < 48 || midi > 72) return null
    return Tone.Frequency(midi, 'midi').toNote()
  }, [])

  const pool = useMemo(() => {
    if (quizMode !== 'free') return []
    const { validLines } = parseEditorTextToQuestions(quizInlineText)
    const synthetic: ProblemSet = {
      meta: { id: 'inline', title: 'inline', filename: 'inline' },
      questions: validLines,
    }
    return buildPool([synthetic], 'inline', null, null, null)
  }, [quizMode, quizInlineText])

  const chordPickPool = useMemo(
    () => (quizMode === 'chordPick' ? buildChordPickPoolFromEditorText(chordPickText) : []),
    [quizMode, chordPickText],
  )

  const poolSize = pool.length
  const chordPickPoolSize = chordPickPool.length

  const questionCountMax =
    quizMode === 'random' ? 15 : quizMode === 'chordPick' ? Math.max(1, chordPickPoolSize || 1) : 15

  const effectiveQuestionCount =
    quizMode === 'random'
      ? Math.min(Math.max(1, questionCount), 15)
      : quizMode === 'chordPick'
        ? chordPickPoolSize === 0
          ? 1
          : Math.min(Math.max(1, questionCount), chordPickPoolSize)
        : poolSize

  const canStart =
    quizMode === 'random' ? true : quizMode === 'free' ? poolSize > 0 : chordPickPoolSize > 0

  const primaryStartLabel =
    quizState.kind === 'finished'
      ? resultFreshForAgainStart
        ? 'もう一度スタート'
        : 'スタート'
      : quizState.kind !== 'idle'
        ? '中断して再スタート'
        : 'スタート'

  useEffect(() => {
    if (quizMode === 'random') {
      setQuestionCount((c) => Math.min(Math.max(1, c), 15))
    }
  }, [quizMode])

  useEffect(() => {
    if (quizMode === 'chordPick' && prevQuizModeRef.current !== 'chordPick') {
      chordPickDefaultsAppliedRef.current = false
    }
    prevQuizModeRef.current = quizMode
  }, [quizMode])

  useEffect(() => {
    if (quizMode !== 'chordPick') return
    if (chordPickPoolSize === 0) return
    const max = chordPickPoolSize
    const defaultCount = max <= 10 ? max : 10

    if (!chordPickDefaultsAppliedRef.current) {
      chordPickDefaultsAppliedRef.current = true
      setQuestionCount(defaultCount)
      return
    }

    setQuestionCount((prev) => {
      const clamped = Math.min(prev, max)
      if (max <= 10) return max
      return Math.max(1, clamped)
    })
  }, [quizMode, chordPickPoolSize])

  const pickQuestionAt = useCallback((pos: number, queue: number[]) => {
    const items = currentPoolRef.current
    const idx = queue[pos]
    if (idx === undefined || !items[idx]) return null
    const q = items[idx]!
    setCurrentQuestionRaw(q.raw)
    setCurrentBpm(tempoBpm)
    setCurrentSteps(q.steps as any)
    setExpectedNotes(q.normalizedNotes)
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
      // 直前フェーズのタイマーが残っていると「混入バグ」になる。ここで必ず止める。
      clearTimers()
      const quarterSec = 60 / opts.bpm
      let t = 0
      for (const step of opts.steps) {
        const durSeconds = step.quarters * quarterSec
        if (step.kind === 'note') {
          const relNote = Tone.Frequency(step.midi, 'midi').toNote()
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

  const startCurrentQuestion = useCallback(
    async (queue: number[], pos: number) => {
      resetPerQuestionUi()
      setPresentCount((c) => c + 1)
      const q = pickQuestionAt(pos, queue)
      if (!q) {
        setQuizState({ kind: 'finished' })
        return
      }
      setQuizState({ kind: 'presenting' })
      await scheduleQuestionPlayback({ bpm: q.bpm, steps: q.steps })
      const doneId = window.setTimeout(() => {
        setQuizState({ kind: 'answering' })
      }, Math.floor((q.steps.reduce((acc, s) => acc + s.quarters, 0) * (60 / q.bpm) + 0.05) * 1000))
      pendingTimers.current.push(doneId)
    },
    [pickQuestionAt, resetPerQuestionUi, scheduleQuestionPlayback],
  )

  const handleStart = useCallback(() => {
    if (!canStart) return

    let slice: PoolItem[]
    if (quizMode === 'random') {
      const makeRandomQuestion = (): PoolItem => {
        const noteCount = noteCountFilter
        const pcs: number[] = []
        const pcPool = randomNoBlack ? [0, 2, 4, 5, 7, 9, 11] : Array.from({ length: 12 }, (_, i) => i)
        for (let i = 0; i < noteCount; i++) pcs.push(pcPool[Math.floor(Math.random() * pcPool.length)]!)
        if (startPcFilter !== '' && pcs.length > 0) pcs[0] = startPcFilter
        if (lastPcFilter !== '' && pcs.length > 0) pcs[pcs.length - 1] = lastPcFilter

        // Random absolute midi notes within keyboard range C3..C5 (48..72)
        const midis: number[] = []
        for (let i = 0; i < pcs.length; i++) {
          const pc = pcs[i]!
          const base = 48 + pc
          const choices = [base, base + 12, base + 24].filter((m) => m >= 48 && m <= 72)
          if (i === 0 || !randomLimitLeap) {
            midis.push(choices[Math.floor(Math.random() * choices.length)]!)
            continue
          }
          const prev = midis[i - 1]!
          const withinOctave = choices.filter((m) => Math.abs(m - prev) <= 12)
          if (withinOctave.length > 0) {
            midis.push(withinOctave[Math.floor(Math.random() * withinOctave.length)]!)
          } else {
            // keyboard range constraint may leave no candidate; pick nearest fallback
            midis.push([...choices].sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev))[0]!)
          }
        }

        const steps = midis.map((m) => ({
          kind: 'note' as const,
          pc: ((m % 12) + 12) % 12,
          midi: m,
          quarters: 1,
          raw: 'R',
        }))

        return {
          raw: normalizedToKatakana(pcs),
          setId: 'random',
          steps: steps as any,
          normalizedNotes: pcs,
        }
      }

      slice = Array.from({ length: effectiveQuestionCount }, makeRandomQuestion)
    } else if (quizMode === 'chordPick') {
      const built = buildChordPickPoolFromEditorText(chordPickText)
      if (built.length === 0) return
      const take = Math.min(Math.max(1, questionCount), built.length)
      slice = shufflePool(built).slice(0, take)
    } else {
      const { validLines } = parseEditorTextToQuestions(quizInlineText)
      const synthetic: ProblemSet = {
        meta: { id: 'inline', title: 'inline', filename: 'inline' },
        questions: validLines,
      }
      const built = buildPool([synthetic], 'inline', null, null, null)
      if (built.length === 0) return
      slice = shufflePool(built)
    }

    currentPoolRef.current = slice
    setCycleQueue(Array.from({ length: slice.length }, (_, i) => i))
    setCyclePos(0)
    setPresentCount(0)
    setSessionLog([])
    setQuizState({ kind: 'presenting' })
    void startCurrentQuestion(
      Array.from({ length: slice.length }, (_, i) => i),
      0,
    )
  }, [
    canStart,
    effectiveQuestionCount,
    lastPcFilter,
    noteCountFilter,
    quizInlineText,
    questionCount,
    randomLimitLeap,
    randomNoBlack,
    chordPickText,
    quizMode,
    startCurrentQuestion,
    startPcFilter,
    tempoBpm,
  ])

  const noteOn = useCallback(
    async (note: string) => {
      setActiveNotes((prev) => {
        const next = new Set(prev)
        next.add(note)
        return next
      })
      await engine.attack(note, transposeSemitones)
    },
    [engine, transposeSemitones],
  )

  const noteOff = useCallback((note: string) => {
    setActiveNotes((prev) => {
      const next = new Set(prev)
      next.delete(note)
      return next
    })
    engine.release(note, transposeSemitones)
  }, [engine, transposeSemitones])

  const handleAnswerKey = useCallback(
    (relativeNote: string) => {
      if (quizState.kind !== 'answering') return

      const pc = ((Tone.Frequency(relativeNote).toMidi() ?? 0) % 12 + 12) % 12
      const nextIndex = inputNotes.length
      const expectedPc = expectedNotes[nextIndex]

      if (expectedPc === undefined) return

      if (pc === expectedPc) {
        const answeredPcs = [...inputNotes.map((n) => n.pc), pc]
        setInputNotes((prev) => [...prev, { pc, wrong: false }])
        setKeyMark((prev) => ({ ...prev, [relativeNote]: 'correct' }))

        if (nextIndex + 1 === expectedNotes.length) {
          // 正解 → 即時で全鍵盤を青にし、解答文字も一括表示。その後再生のみ（青は増やさない）
          setSessionLog((prev) => [
            ...prev,
            {
              q: currentQuestionRaw,
              ok: true,
              answered: normalizedToKatakana(answeredPcs),
              expected: normalizedToKatakana(expectedNotes),
            },
          ])
          setCumulative((prev) => {
            const next = bumpStats(prev, currentQuestionRaw, true)
            void saveAllStats(next)
            return next
          })

          setQuizState({ kind: 'revealing' })
          setAnswerNotes([...expectedNotes])

          if (currentSteps.length > 0) {
            void scheduleQuestionPlayback({
              bpm: currentBpm,
              steps: currentSteps,
              showBlueKeys: true,
            }).then((total) => {
              const nextPos = cyclePos + 1
              const doneId = window.setTimeout(() => {
                if (nextPos >= cycleQueue.length) {
                  setQuizState({ kind: 'finished' })
                  return
                }
                setCyclePos(nextPos)
                void startCurrentQuestion(cycleQueue, nextPos)
              }, Math.floor((total + 0.2 + (nextPos >= cycleQueue.length ? 0 : questionIntervalSec)) * 1000))
              pendingTimers.current.push(doneId)
            })
          }
        }
        return
      }

      // wrong: lock question, replay and reveal
      const answeredPcs = [...inputNotes.map((n) => n.pc), pc]
      setInputNotes((prev) => [...prev, { pc, wrong: true }])
      setKeyMark((prev) => ({ ...prev, [relativeNote]: 'wrong' }))
      setQuizState({ kind: 'revealing' })
      setAnswerNotes([])
      setSessionLog((prev) => [
        ...prev,
        {
          q: currentQuestionRaw,
          ok: false,
          answered: normalizedToKatakana(answeredPcs),
          expected: normalizedToKatakana(expectedNotes),
        },
      ])
      setCumulative((prev) => {
        const next = bumpStats(prev, currentQuestionRaw, false)
        void saveAllStats(next)
        return next
      })

      if (currentSteps.length > 0) {
        void scheduleQuestionPlayback({
          bpm: currentBpm,
          steps: currentSteps,
          showBlueKeys: true,
          onNote: (pcAt, _midi, atSeconds) => {
            const id = window.setTimeout(() => {
              setAnswerNotes((prev) => [...prev, pcAt])
            }, Math.max(0, Math.floor(atSeconds * 1000)))
            pendingTimers.current.push(id)
          },
        }).then((total) => {
          const doneId = window.setTimeout(() => {
            const nextPos = cyclePos + 1
            if (nextPos >= cycleQueue.length) {
              setQuizState({ kind: 'finished' })
              return
            }
            setCyclePos(nextPos)
            void startCurrentQuestion(cycleQueue, nextPos)
          }, Math.floor((total + 0.2 + (cyclePos + 1 >= cycleQueue.length ? 0 : questionIntervalSec)) * 1000))
          pendingTimers.current.push(doneId)
        })
      }
    },
    [
      currentBpm,
      currentQuestionRaw,
      cyclePos,
      cycleQueue,
      expectedNotes,
      inputNotes.length,
      quizState.kind,
      scheduleQuestionPlayback,
      startCurrentQuestion,
      questionIntervalSec,
    ],
  )

  return (
    <div className={`app ${view === 'user' ? 'viewUser' : ''}`}>
      <header className="header">
        <div className="title">
          <h1>MyOnkan</h1>
        </div>
        <div className="headerBtns">
          <button
            type="button"
            className="homeBtn"
            onClick={() => setView('game')}
            aria-label="Home"
          >
            ⌂
          </button>
          <button
            type="button"
            className="gearBtn"
            onClick={() => setView((v) => (v === 'user' ? 'game' : 'user'))}
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      <main className="main">
        <section className="panel">
          <div className="userSettingsPanel">
            <div className="settingsRow">
              <label className="keySelect">
                <span>出題間隔</span>
                <select
                  value={questionIntervalSec}
                  onChange={(e) =>
                    setQuestionIntervalSec(
                      Number(e.target.value) as 2 | 3 | 4 | 5,
                    )
                  }
                >
                  <option value={2}>2秒</option>
                  <option value={3}>3秒</option>
                  <option value={4}>4秒</option>
                  <option value={5}>5秒</option>
                </select>
              </label>
              <label className="keySelect">
                <span>現在のキー</span>
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
              <label className="keySelect">
                <span>テンポ</span>
                <select
                  value={tempoBpm}
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
                >
                  <option value={50}>50</option>
                  <option value={60}>60</option>
                  <option value={70}>70</option>
                  <option value={80}>80</option>
                  <option value={90}>90</option>
                  <option value={100}>100</option>
                  <option value={110}>110</option>
                  <option value={120}>120</option>
                </select>
              </label>
            </div>
            <div className="settingsRow globalSettings">
              <label className="check">
                <input
                  type="checkbox"
                  checked={showEditorInUserSettings}
                  onChange={(e) => setShowEditorInUserSettings(e.target.checked)}
                />
                <span>問題セット編集を表示</span>
              </label>
            </div>
            {showEditorInUserSettings && (
              <div className="editor userSettingsEditor">
                <div className="editorRow">
                  <label className="keySelect">
                    <span>読み込み</span>
                    <select
                      value={editorSelectedTitle}
                      onChange={(e) => void loadEditorSelection(e.target.value)}
                    >
                      <option value="__new__">新規作成</option>
                      {userProblemSets.map((s) => (
                        <option key={s.meta.title} value={s.meta.title}>
                          {s.meta.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="startBtn" onClick={() => void handleEditorSave()}>
                    保存
                  </button>
                  <button
                    type="button"
                    className="startBtn"
                    onClick={() => void handleEditorDelete()}
                    disabled={editorSelectedTitle === '__new__'}
                  >
                    削除
                  </button>
                </div>
                <div className="editorRow">
                  <label className="keySelect editorTitle">
                    <span>タイトル</span>
                    <input
                      value={editorTitle}
                      onChange={(e) => setEditorTitle(e.target.value)}
                      placeholder="（空欄なら自動）"
                    />
                  </label>
                </div>
                <div className="editorRow">
                  <label className="editorBody">
                    <span>内容（1行=1問）</span>
                    <textarea
                      value={editorBody}
                      onChange={(e) => setEditorBody(e.target.value)}
                      rows={8}
                    />
                  </label>
                  <div className="editorHelp">{editorNewHelp}</div>
                </div>
                <div className="editorRow">
                  <button type="button" className="startBtn" onClick={() => void handleExportProblemSets()}>
                    エクスポート
                  </button>
                  <button type="button" className="startBtn" onClick={() => importInputRef.current?.click()}>
                    インポート
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="fileInputHidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.currentTarget.value = ''
                      if (!file) return
                      void handleImportProblemSets(file).catch(() => {
                        window.alert('インポートに失敗しました。JSON形式を確認してください。')
                      })
                    }}
                  />
                </div>
                <div className="editorRow">
                  <div className="editorHelp">
                    ブラウザ側で保存されている全ての問題セットをエクスポート/インポートできます。
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="quizGameControls">
            <div className="modeTabs" role="tablist" aria-label="mode">
              <button
                type="button"
                className={`modeTab ${quizMode === 'free' ? 'active' : ''}`}
                onClick={() => {
                  if (quizState.kind === 'finished') {
                    setResultFreshForAgainStart(false)
                    setProblemSettingsOpen(true) // 結果用ボタン箱を出さない
                  } else if (quizState.kind === 'idle') {
                    setProblemSettingsOpen(true)
                  } else {
                    setProblemSettingsOpen((v) => !v)
                  }
                  setQuizMode('free')
                }}
                role="tab"
                aria-selected={quizMode === 'free'}
              >
                自由入力
              </button>
              <button
                type="button"
                className={`modeTab ${quizMode === 'random' ? 'active' : ''}`}
                onClick={() => {
                  if (quizState.kind === 'finished') {
                    setResultFreshForAgainStart(false)
                    setProblemSettingsOpen(true) // 結果用ボタン箱を出さない
                  } else if (quizState.kind === 'idle') {
                    setProblemSettingsOpen(true)
                  } else {
                    setProblemSettingsOpen((v) => !v)
                  }
                  setQuizMode('random')
                }}
                role="tab"
                aria-selected={quizMode === 'random'}
              >
                ランダムメロディ
              </button>
              <button
                type="button"
                className={`modeTab ${quizMode === 'chordPick' ? 'active' : ''}`}
                onClick={() => {
                  if (quizState.kind === 'finished') {
                    setResultFreshForAgainStart(false)
                    setProblemSettingsOpen(true)
                  } else if (quizState.kind === 'idle') {
                    setProblemSettingsOpen(true)
                  } else {
                    setProblemSettingsOpen((v) => !v)
                  }
                  setQuizMode('chordPick')
                }}
                role="tab"
                aria-selected={quizMode === 'chordPick'}
              >
                構成音から生成
              </button>
            </div>

            {problemSettingsOpen && (
              <div className="settings">
                {quizMode === 'free' && (
                  <>
                    <div className="quizTextBlock">
                      <label className="editorBody editorBodyNoLabel">
                        <textarea
                          value={quizInlineText}
                          onChange={(e) => setQuizInlineText(e.target.value)}
                          rows={5}
                          placeholder={
                            '入力された問題文をランダムに出題します。\n使用文字: ドデレリミファフィソサラチシ\n１行＝１問'
                          }
                          aria-label="問題テキスト（自由入力）"
                        />
                      </label>
                    </div>
                  </>
                )}

                {quizMode === 'chordPick' && (
                  <>
                    <div className="quizTextBlock">
                      <label className="editorBody editorBodyNoLabel">
                        <textarea
                          value={chordPickText}
                          onChange={(e) => setChordPickText(e.target.value)}
                          rows={2}
                          placeholder={
                            '入力した構成音の順番を入れ替えて、全パターン出題します。（含む転回形）'
                          }
                          aria-label="問題テキスト（構成音）"
                        />
                      </label>
                    </div>
                    <div className="settingsRow questionCountRow chordPickCountRow">
                      <label className="keySelect chordPickCountLabel">
                        <span className="chordPickCountTitle">出題数</span>
                        <input
                          type="range"
                          className="chordPickCountBar countBar"
                          min={1}
                          max={Math.max(1, chordPickPoolSize)}
                          value={
                            chordPickPoolSize === 0
                              ? 1
                              : Math.min(questionCount, chordPickPoolSize)
                          }
                          onChange={(e) =>
                            setQuestionCount(
                              Math.min(
                                chordPickPoolSize,
                                Math.max(1, Number(e.target.value)),
                              ),
                            )
                          }
                          disabled={chordPickPoolSize === 0}
                          aria-label="出題数"
                        />
                        <span className="countLabel chordPickCountSlash">
                          {chordPickPoolSize === 0
                            ? '0'
                            : Math.min(questionCount, chordPickPoolSize)}{' '}
                          / {chordPickPoolSize}問
                        </span>
                      </label>
                    </div>
                  </>
                )}

                {quizMode === 'random' && (
                  <>
                    <button
                      type="button"
                      className="filterToggle"
                      onClick={() => setRandomFiltersOpen((o) => !o)}
                      aria-expanded={randomFiltersOpen}
                    >
                      {randomFiltersOpen ? '▲' : '▼'} フィルタ
                    </button>
                    {randomFiltersOpen && (
                      <>
                        <div className="settingsRow">
                          <label className="keySelect">
                            <span>開始音</span>
                            <select
                              value={startPcFilter}
                              onChange={(e) => {
                                const v = e.target.value
                                setStartPcFilter(v === '' ? '' : Number(v))
                              }}
                            >
                              <option value="">指定なし</option>
                              <option value={0}>ド</option>
                              <option value={1}>デ</option>
                              <option value={2}>レ</option>
                              <option value={3}>リ</option>
                              <option value={4}>ミ</option>
                              <option value={5}>ファ</option>
                              <option value={6}>フィ</option>
                              <option value={7}>ソ</option>
                              <option value={8}>サ</option>
                              <option value={9}>ラ</option>
                              <option value={10}>チ</option>
                              <option value={11}>シ</option>
                            </select>
                          </label>
                          <label className="keySelect">
                            <span>最終音</span>
                            <select
                              value={lastPcFilter}
                              onChange={(e) => {
                                const v = e.target.value
                                setLastPcFilter(v === '' ? '' : Number(v))
                              }}
                            >
                              <option value="">指定なし</option>
                              <option value={0}>ド</option>
                              <option value={1}>デ</option>
                              <option value={2}>レ</option>
                              <option value={3}>リ</option>
                              <option value={4}>ミ</option>
                              <option value={5}>ファ</option>
                              <option value={6}>フィ</option>
                              <option value={7}>ソ</option>
                              <option value={8}>サ</option>
                              <option value={9}>ラ</option>
                              <option value={10}>チ</option>
                              <option value={11}>シ</option>
                            </select>
                          </label>
                        </div>
                        <div className="settingsRow">
                          <label className="keySelect">
                            <span>音数</span>
                            <select
                              value={noteCountFilter}
                              onChange={(e) => setNoteCountFilter(Number(e.target.value))}
                            >
                              {[1, 2, 3, 4, 5, 6].map((n) => (
                                <option key={n} value={n}>
                                  {n}音
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="settingsRow questionCountRow">
                          <span className="keySelect questionCountLabel">
                            <span>出題数</span>
                            <span className="numberStepper">
                              <button
                                type="button"
                                className="stepBtn"
                                aria-label="出題数を減らす"
                                disabled={questionCount <= 1}
                                onClick={() =>
                                  setQuestionCount((c) => Math.max(1, c - 1))
                                }
                              >
                                −
                              </button>
                              <input
                                type="number"
                                className="stepInput"
                                min={1}
                                max={questionCountMax}
                                value={questionCount}
                                onChange={(e) => {
                                  const v = parseInt(e.target.value, 10)
                                  if (Number.isNaN(v)) return
                                  setQuestionCount(
                                    Math.min(questionCountMax, Math.max(1, v)),
                                  )
                                }}
                              />
                              <button
                                type="button"
                                className="stepBtn"
                                aria-label="出題数を増やす"
                                disabled={questionCount >= questionCountMax}
                                onClick={() =>
                                  setQuestionCount((c) =>
                                    Math.min(questionCountMax, c + 1),
                                  )
                                }
                              >
                                ＋
                              </button>
                            </span>
                            <span className="countLabel slashMax">/ 15問</span>
                          </span>
                        </div>
                      </>
                    )}
                    <div className="settingsRow">
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={randomNoBlack}
                          onChange={(e) => setRandomNoBlack(e.target.checked)}
                        />
                        <span>白鍵のみ</span>
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={randomLimitLeap}
                          onChange={(e) => setRandomLimitLeap(e.target.checked)}
                        />
                        <span>跳躍をオクターブ以下に固定</span>
                      </label>
                    </div>
                  </>
                )}

                <div className="settingsHelpAboveStart">
                  {quizMode === 'free' && (
                    <>
                      <div className="quizTextActions">
                        <button
                          type="button"
                          className="helpHintChar"
                          onClick={() => setFreeInputHelpOpen((o) => !o)}
                          aria-expanded={freeInputHelpOpen}
                          aria-label="入力の詳しい説明を表示"
                        >
                          ？
                        </button>
                      </div>
                      {freeInputHelpOpen && (
                        <div className="editorHelp freeInputHelpExpand">{freeInputHelpDetail}</div>
                      )}
                    </>
                  )}
                  {quizMode === 'chordPick' && (
                    <>
                      <div className="quizTextActions">
                        <button
                          type="button"
                          className="helpHintChar"
                          onClick={() => setChordPickHelpOpen((o) => !o)}
                          aria-expanded={chordPickHelpOpen}
                          aria-label="構成音から生成の説明を表示"
                        >
                          ？
                        </button>
                      </div>
                      {chordPickHelpOpen && (
                        <div className="editorHelp freeInputHelpExpand">
                          休符と伸ばし棒も音符の一種として扱われますが、先頭に来た時は何もしません。
                        </div>
                      )}
                    </>
                  )}
                  {quizMode === 'random' && <div className="startButtonTopSpacer" aria-hidden />}
                </div>

                <div className="settingsRow settingsStartRow">
                  <button
                    type="button"
                    className="startBtn"
                    onClick={() => {
                      setProblemSettingsOpen(false)
                      handleStart()
                    }}
                    disabled={!canStart}
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
                    disabled={!canStart}
                    onClick={() => {
                      setProblemSettingsOpen(false)
                      handleStart()
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
            {quizState.kind !== 'idle' ? `${presentCount} / ${cycleQueue.length} 問` : '\u00A0'}
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
                    onPointerCancel={() => noteOff(k.note)}
                  >
                    <span className="srOnly">{k.note}</span>
                  </button>
                ))}
              </div>
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
                      <li key={`${idx}-${r.q}`}>
                        <span className={`mark ${r.ok ? 'ok' : 'ng'}`}>{r.ok ? '○' : '×'}</span>
                        <span className="q">{r.q}</span>
                        {!r.ok && <span className="statSession">入力:{r.answered}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="logCol">
                  <h3>累計</h3>
                  <ul>
                    {Object.entries(cumulative)
                      .filter(([q]) => sessionLog.some((s) => s.q === q))
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([q, st]) => {
                        const rate = st.attempts ? Math.round((st.correct / st.attempts) * 100) : 0
                        const rateClass = rate >= 80 ? 'rateGood' : rate <= 20 ? 'rateBad' : 'rateNum'
                        return (
                          <li key={q}>
                            <span className="q">
                              {q}{' '}
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
        <div className="footerLinks">
          <a href="https://aramugi.com" target="_blank" rel="noreferrer">
            あらむぎ
          </a>
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
