import { QuizModeHelpPanel, UI_PLACEHOLDERS } from './quizHelp'

type Props = {
  text: string
  onTextChange: (value: string) => void
  helpOpen: boolean
  onHelpOpenToggle: () => void
}

export function FreeQuizSettings({ text, onTextChange, helpOpen, onHelpOpenToggle }: Props) {
  return (
    <>
      <div className="quizTextBlock">
        <label className="editorBody editorBodyNoLabel">
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            rows={4}
            placeholder={UI_PLACEHOLDERS.quizFreeTextarea}
            aria-label="問題テキスト（自由入力）"
          />
        </label>
      </div>
      <div className="settingsHelpAboveStart">
        <div className="quizTextActions">
          <button
            type="button"
            className="helpHintChar"
            onClick={onHelpOpenToggle}
            aria-expanded={helpOpen}
            aria-label="入力の詳しい説明を表示"
          >
            ？
          </button>
        </div>
        {helpOpen ? (
          <div className="editorHelp freeInputHelpExpand quizHelpPanel">
            <QuizModeHelpPanel mode="free" />
          </div>
        ) : null}
      </div>
    </>
  )
}
