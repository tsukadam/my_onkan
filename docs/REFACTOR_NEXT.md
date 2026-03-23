# 次のリファクタ候補

現時点のコードを一巡して、次に手を付ける価値が高い候補を整理。
「動作は変えず、読みやすさ・安全性・保守性を上げる」観点。

## 優先度A（効果が高く、比較的安全）

1. `App.tsx` のクイズ進行ロジックを `useQuizSession` フック化
- 対象: `cycleQueue` / `cyclePos` / `presentCount` / `handleStart` / `startCurrentQuestion` / 判定分岐
- 目的: UI（JSX）と状態機械を分離し、変更時の見通しを上げる
- 効果: `App.tsx` の責務が減り、バグ修正点が絞れる

2. 鍵盤操作・再生ユーティリティを `App.tsx` 内でセクション化（分離は保留）
- 対象: `midiToToneNoteName` / `toneNoteNameIfMidiOnVisibleKeyboard` / `buildKeyboard` / `keyForMidiIfVisible`
- 目的: 既に整理済みだが、コメントブロックや命名をさらに統一して探索性を上げる
- 効果: 後で外出しするかどうかの判断がしやすくなる

3. `fixedEnd.ts` の関数群を「入力パース」「列挙」「表示組み立て」に段落化
- 対象: `parseFixedEndSlotField`〜`buildFixedEndPool`
- 目的: 500行級ファイルでの検索効率改善
- 効果: ロジック変更時に影響範囲を読み違えにくくなる

## 優先度B（中期）

4. `PoolItem.setId` を文字列リテラル union 化
- 対象: `'inline' | 'chordPick' | 'fixedEnd'`（必要なら追加）
- 目的: typo 防止、補完強化
- 効果: setId 周りの安全性向上

5. `noteTokens.ts` の責務を「定義」と「ヘルパ」に見出し分離
- 対象: `NOTE_TOKENS` / 表示マップ生成 / 記号判定 / エディタ許可文字
- 目的: 1ファイル集約方針は維持しつつ、可読性を上げる
- 効果: 将来の i18n 追加時に編集箇所が明確

6. 統計キー正規化のルール名を明示
- 対象: `normalizeKeyForCumulativeStats` の regex とコメント
- 目的: 「除去対象の意図」を列挙形式で明文化
- 効果: 記号追加時の更新漏れリスク低減

## 優先度C（必要になったら）

7. `docs/REFACTOR.md` を「完了項目」と「残課題」で2分割
- 目的: 現行の長文化を抑え、意思決定ログとして追いやすくする

8. `fixedEnd` の表記ゆれ統一（UI文言の「終止音」「終了音」）
- 目的: ドメイン用語の統一
- 効果: ヘルプ/実装/仕様の対応が取りやすい

---

## 循環参照チェック（現状）

- `db` は `stats.ts` のみ
- `problem/editorText.ts` は `problem/noteTokens.ts` を参照
- `problems/pool.ts` と `problem/chordPick.ts` は `problem/editorText.ts` を参照
- 明示的な循環 import は現状なし

