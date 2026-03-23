/**
 * 出題まわりの文言（ヘルプ・入力欄プレースホルダー）をまとめたファイル。
 */

// --- テキストエリア / 入力欄の placeholder（編集しやすいよう一元化） ---

export const UI_PLACEHOLDERS = {
  /** 出題設定 → 自由入力 */
  quizFreeTextarea:
    '入力された問題文をランダムに出題します。\n使用文字: ドデレリミファフィソサラチシ\n１行＝１問',
  /** 出題設定 → 構成音から生成 */
  quizChordPickTextarea:
    '入力された構成音の順番を入れ替えて、全パターン出題します。（含む転回形）',
  /** 開始音・終止音指定（fixedEnd）→ 開始 / 終了 */
  fixedEndStartEnd: '＊',
  /** 開始音・終止音指定 → 途中音 */
  fixedEndMiddle: '途中音は空白OK。＊＝ランダム',
} as const

// --- ？ヘルプ: モード固有（あれば上）＋全モード共通。固有が空なら汎用のみ・区切り線なし。 ---
export const QUIZ_HELP_COMMON = [
  '使用文字: ドデレリミファフィソサラチシ',
  'オクターブ違いの同名音は、直前の音に最も近い音が選ばれます。音名の前に↑や↓をつけるとオクターブを上下できます。',
  '全角/半角スペースで休符',
  '伸ばし棒（ー）で音値を伸ばす',
].join('\n')

/** モード固有（空なら汎用のみ表示・区切り線なし） */
export const QUIZ_HELP_MODE_SPECIFIC = {
  free: '',
  chord: '',
  fixedEnd: '',
} as const

// --- ユーザー設定（ギア画面）: ここに平文のヘルプを置く ---
export const USER_SETTINGS_HELP_TEXT =
  '相対音感のトレーニング用アプリです。\n' +
  'キーの設定によらずC調の鍵盤で表すことで、メロディをディグリーで捉えやすくします。\n' +
  '\n' +
  'ヒント：\n' +
  '鍵盤外の音は表示されません。\n' +
  '同名音はどのオクターブで回答しても正解になります。\n' +
  '\n' +
  'PWA対応しています。スマホでブラウザUIが邪魔な時に。'

export type QuizHelpMode = keyof typeof QUIZ_HELP_MODE_SPECIFIC

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
