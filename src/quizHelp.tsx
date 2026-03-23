/**
 * 出題まわりの文言（ヘルプ・入力欄プレースホルダー）をまとめたファイル。
 */

// --- テキストエリア / 入力欄の placeholder（編集しやすいよう一元化） ---

export const UI_PLACEHOLDERS = {
  /** ユーザー設定 → 問題セットのタイトル */
  editorProblemSetTitle: '（空欄なら自動）',
  /** 出題設定 → 自由入力 */
  quizFreeTextarea:
    '入力された問題文をランダムに出題します。\n使用文字: ドデレリミファフィソサラチシ\n１行＝１問',
  /** 出題設定 → 構成音から生成 */
  quizChordPickTextarea:
    '入力された構成音の順番を入れ替えて、全パターン出題します。（含む転回形）',
  /** 開始音・終止音指定 → 開始 / 終了（空＝ランダム） */
  randomStartEnd: '＊',
  /** 開始音・終止音指定 → 途中音 */
  randomMiddle:
    '途中音は空白OK。＊＝ランダム',
} as const

// --- ？ヘルプ: モード固有（あれば上）＋全モード共通。固有が空なら汎用のみ・区切り線なし。 ---
export const QUIZ_HELP_COMMON = [
  'オクターブ違いの同名音は、直前の音に最も近い音が選ばれます。',
  '音名の前に↑や↓をつけるとオクターブを上下できます。',
  '全角/半角スペースで休符',
  '伸ばし棒（ー）で音値を伸ばす',
].join('\n')

/** モード固有（空なら汎用のみ表示・区切り線なし） */
export const QUIZ_HELP_MODE_SPECIFIC = {
  free: '',
  chord: '',
  random: '',
} as const

export type QuizHelpMode = keyof typeof QUIZ_HELP_MODE_SPECIFIC

/** 単一テキストが必要なとき（テスト等）。固有があるときは上段に固有。 */
export function formatQuizHelp(modeSpecific: string): string {
  const common = QUIZ_HELP_COMMON.trim()
  const extra = modeSpecific.trim()
  if (!extra) return common
  return `${extra}\n\n${common}`
}

export function QuizModeHelpPanel({ mode }: { mode: QuizHelpMode }) {
  const specific = QUIZ_HELP_MODE_SPECIFIC[mode].trim()
  return (
    <>
      {specific ? <div className="quizHelpMode">{specific}</div> : null}
      <div
        className={
          specific ? 'quizHelpCommon quizHelpCommonWithSepAbove' : 'quizHelpCommon'
        }
      >
        {QUIZ_HELP_COMMON}
      </div>
    </>
  )
}
