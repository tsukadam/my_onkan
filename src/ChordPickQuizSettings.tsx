import { QuizModeHelpPanel, UI_PLACEHOLDERS } from './quizHelp'

type Props = {
  text: string
  onTextChange: (value: string) => void
  poolSize: number
  questionCount: number
  onQuestionCountChange: (n: number) => void
  helpOpen: boolean
  onHelpOpenToggle: () => void
}

/** 構成音から生成モードの出題設定 */
export function ChordPickQuizSettings({
  text,
  onTextChange,
  poolSize,
  questionCount,
  onQuestionCountChange,
  helpOpen,
  onHelpOpenToggle,
}: Props) {
  return (
    <>
      <div className="quizTextBlock">
        <label className="editorBody editorBodyNoLabel">
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            rows={2}
            placeholder={UI_PLACEHOLDERS.quizChordPickTextarea}
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
            max={Math.max(1, poolSize)}
            value={poolSize === 0 ? 1 : Math.min(questionCount, poolSize)}
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
            aria-label="構成音から生成の説明を表示"
          >
            ？
          </button>
        </div>
        {helpOpen && (
          <div className="editorHelp freeInputHelpExpand quizHelpPanel">
            <QuizModeHelpPanel mode="chord" />
          </div>
        )}
      </div>
    </>
  )
}
