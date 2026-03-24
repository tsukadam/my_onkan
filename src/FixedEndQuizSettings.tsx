import { QuizModeHelpPanel, UI_PLACEHOLDERS } from './quizHelp'
import { rangeSliderVars } from './rangeSliderStyle'

type Props = {
  startText: string
  endText: string
  middleText: string
  onStartTextChange: (v: string) => void
  onEndTextChange: (v: string) => void
  onMiddleTextChange: (v: string) => void
  whiteKeysOnly: boolean
  onWhiteKeysOnlyChange: (v: boolean) => void
  limitLeapToOctave: boolean
  onLimitLeapToOctaveChange: (v: boolean) => void
  poolSize: number
  questionCount: number
  onQuestionCountChange: (n: number) => void
  helpOpen: boolean
  onHelpOpenToggle: () => void
}

function stripNewlines(v: string): string {
  return v.replace(/\r/g, '').replace(/\n/g, '')
}

export function FixedEndQuizSettings({
  startText,
  endText,
  middleText,
  onStartTextChange,
  onEndTextChange,
  onMiddleTextChange,
  whiteKeysOnly,
  onWhiteKeysOnlyChange,
  limitLeapToOctave,
  onLimitLeapToOctaveChange,
  poolSize,
  questionCount,
  onQuestionCountChange,
  helpOpen,
  onHelpOpenToggle,
}: Props) {
  const qMax = Math.max(1, poolSize)
  const qVal = poolSize === 0 ? 1 : Math.min(questionCount, poolSize)
  return (
    <>
      <div className="settingsRow fixedEndStartEndRow">
        <label className="keySelect fixedEndStartEndLabel">
          <span>開始音</span>
          <input
            type="text"
            className="fixedEndStartEndInput"
            value={startText}
            placeholder={UI_PLACEHOLDERS.fixedEndStartEnd}
            autoComplete="off"
            spellCheck={false}
            aria-label="開始音"
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault()
            }}
            onChange={(e) => onStartTextChange(stripNewlines(e.target.value))}
          />
        </label>
        <label className="keySelect fixedEndStartEndLabel">
          <span>終止音</span>
          <input
            type="text"
            className="fixedEndStartEndInput"
            value={endText}
            placeholder={UI_PLACEHOLDERS.fixedEndStartEnd}
            autoComplete="off"
            spellCheck={false}
            aria-label="終止音"
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault()
            }}
            onChange={(e) => onEndTextChange(stripNewlines(e.target.value))}
          />
        </label>
      </div>
      <div className="settingsRow fixedEndMiddleRow">
        <label className="keySelect fixedEndMiddleLabel">
          <span>途中音</span>
          <input
            type="text"
            className="fixedEndMiddleInput"
            value={middleText}
            placeholder={UI_PLACEHOLDERS.fixedEndMiddle}
            autoComplete="off"
            spellCheck={false}
            aria-label="途中音"
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault()
            }}
            onChange={(e) => onMiddleTextChange(stripNewlines(e.target.value))}
          />
        </label>
      </div>
      <div className="settingsRow">
        <label className="check">
          <input
            type="checkbox"
            checked={whiteKeysOnly}
            onChange={(e) => onWhiteKeysOnlyChange(e.target.checked)}
          />
          <span>白鍵のみ</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={limitLeapToOctave}
            onChange={(e) => onLimitLeapToOctaveChange(e.target.checked)}
          />
          <span>跳躍をオクターブ以下にする</span>
        </label>
      </div>
      <div className="settingsRow questionCountRow chordPickCountRow">
        <label className="keySelect chordPickCountLabel">
          <span className="chordPickCountTitle">出題数</span>
          <input
            type="range"
            className="chordPickCountBar countBar"
            min={1}
            max={qMax}
            value={qVal}
            style={rangeSliderVars(1, qMax, qVal)}
            onChange={(e) =>
              onQuestionCountChange(Math.min(poolSize, Math.max(1, Number(e.target.value))))
            }
            disabled={poolSize === 0}
            aria-label="出題数"
          />
          <span className="countLabel chordPickCountSlash">
            {poolSize === 0 ? '0' : Math.min(questionCount, poolSize)} / {poolSize}問
          </span>
        </label>
      </div>
      <div className="settingsHelpAboveStart">
        <div className="quizTextActions">
          <button
            type="button"
            className="helpHintChar"
            onClick={onHelpOpenToggle}
            aria-expanded={helpOpen}
            aria-label="開始音・終止音指定の説明を表示"
          >
            ？
          </button>
        </div>
        {helpOpen ? (
          <div className="editorHelp freeInputHelpExpand quizHelpPanel">
            <QuizModeHelpPanel mode="fixedEnd" />
          </div>
        ) : null}
      </div>
    </>
  )
}
