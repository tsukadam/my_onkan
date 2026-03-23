# リファクタ・改善メモ

優先度は「バグりやすさ・重複の痛み・分割のしやすさ」をざっくり基準にした仮順。必要に応じて入れ替えてよい。

## 優先度付きタスクリスト

| 順位 | 内容 |
|------|------|
| **1** | ~~**音高・記号まわりの共通化**~~ **（完了）** — 入力トークン・表示正規形・記号1文字・鍵盤レンジ・near-guide MIDI・`R` プレースホルダは **`noteTokens.ts` に集約**。`problem/editorText.ts` の許可文字も **`NOTE_TOKENS` から生成**。残りは **両端固定モード**（`fixedEnd`：クランプ・跳躍・＊列挙）。 |
| **2** | ~~**プール構築の二重呼び出し**~~ **（完了）** — `handleStart` は `useMemo` の `pool` / `chordPickPool` / `fixedEndPool` をそのまま使用（`App.tsx`）。 |
| **3** | **保留** — `App.tsx` のファイル分割（フック/子コンポーネント化）。今は1ファイルのほうが編集しやすい。**判断基準は下記「いつファイルを分けるか」**。 |
| **4** | **MIDI / 鍵盤（一段落）** — ~~まず `App.tsx` 上部で `VISIBLE_KEYBOARD_MIDI`・`midiToToneNoteName`・`toneNoteNameIfMidiOnVisibleKeyboard`・`buildKeyboard` を整理済み~~。**別ファイルに切り出すかは未決**（音域を変えたくなったら再検討）。 |
| **5** | ~~**未使用 export の削除**~~ **（完了）** — `formatQuizHelp`、`getNoteCount` を削除。 |
| **6** | ~~**モード別設定 UI のコンポーネント化**~~ **（完了）** — `FreeQuizSettings` / `ChordPickQuizSettings` / `FixedEndQuizSettings` を作成し、`App.tsx` から巨大な設定 JSX 分岐を除去。 |
| **7** | **保留** — `QUIZ_HELP_MODE_SPECIFIC` の**空文字は、あとからモード固有文を入れる前提**でそのまま。型・分岐の整理が必要になったら再検討。 |
| **8** | ~~**依存の向き・フォルダ名**~~ **（今回実施分は完了）** — `editorText.ts` を `problem/` へ移動し、`db/` は IndexedDB 系 (`stats.ts`) のみへ整理。`pool`/`chordPick` 側 import も更新し、循環参照は発生していない。 |
| **9** | ~~**スタイルの変数化（ヘッダー・モードタブ・スタート）**~~ **（完了）** — `index.css` の `:root` に `--header-*` / `--mode-tab-*` / `--start-btn-*` を定義し、`App.css` で参照。 |

---

### いつファイルを分けるか（App 保留・`problem/` モジュール化との違い）

- **`problem/` に切り出した処理** — 目的は **再利用**と**入出力の境界の固定**（パース・記号・プール生成）。呼び出し元が1つでも、テストしやすく重複を止められるなら分ける価値がある。
- **`App.tsx` のコンポーネント分割** — 目的は **UI とロジックの関心分離**と**巨大ファイルの読みやすさ**。トレードオフで、**小さな変更のたびにファイルを跨ぐ**コストが出る。
- **保留でよい条件** — まだ頻繁に仕様が動く・1画面で全体を追いたい・行数が許容範囲。**分割は「責務が固まった」「ファイルが肥大して迷子になる」あたりで再検討**でよい。
- **仕様の説明は README 追記より** — **関数名・型・データの流れ**で読めることが先。ドキュメントは補助。累計キーは `stats/storage.ts` の `normalizeKeyForCumulativeStats` で足りる（§3・用語解説と連動）。

---

## 音高・記号のデータフロー（現状）

### 設計上の筋（意図）

1. **モードごと**にテキストを解釈し **`PoolItem[]` を構築**する（文法・順列展開・ランダム列挙などはここだけ）。
2. **`PoolItem` がそろったあとは** — `pickQuestionAt` → 再生 → 鍵盤入力との照合 → ログ・累計 — **モードによらず同じ流れ**でよい。現状の `App.tsx` もその形になっている。
3. **休符・伸ばしと「解答」** — ユーザーは鍵盤で **ピッチクラス列**だけを順に押す。**休符は再生の間だけ**に効き、正答列には入れない。先頭に休符があっても **出題上は意味がなく**、正答列からは除く — **モード共通**（`normalizeForJudgement` が `note` だけ拾う）。**伸ばし**は `ParsedStep` 上では音符の `quarters` に畳まれ、休符と同様に「押すステップ」にはならない。

---

### 1. 入力の入口（モード別）

| モード | 入力ソース | 行の前処理 |
|--------|------------|------------|
| **自由入力** | `quizInlineText` | `parseEditorTextToQuestions`（許可文字・空行）。`*` は `parseFreeInputMelodyLine` で鍵盤内ランダム MIDI に1回解決。 |
| **構成音から生成** | `chordPickText` | 同上。`*` は `resolveChordPickWildcards` でランダム1文字カナに置換後、`parseChordPickConstituentLine`。 |
| **開始音・終止音指定**（`fixedEnd`） | 開始/終了/途中の各欄 | `parseEditorTextToQuestions` は**通らない**。`fixedEnd.ts` の `parseFixedEndSlotField` / `tokenizeFixedEndMiddleLine`。 |

---

### 2. プール構築（1 問 = `PoolItem`）


```ts
{ raw: string; setId: string; steps: ParsedStep[]; normalizedNotes: number[] }
```

| モード | 主な処理 | `steps` | `raw`（ログの `q`） | `normalizedNotes` |
|--------|----------|---------|---------------------|-------------------|
| **自由** | `buildFreeInputPool` → `parseFreeInputMelodyLine` | パース結果 | **`stepsToQuizDisplayRaw(steps)`**（＊解決済みカナ・伸ばしは `ー`、休符は `raw`） | **`normalizeForJudgement(steps).notes`** |
| **構成音** | 順列・転回後 `buildStepsFromGroupOrder` | `ParsedStep[]` | `displayStringForGroupOrder` | 同上 |
| **開始音・終止音** | `realizeSteps` 等 | `ParsedStep[]` | `buildMelodyDisplayRaw` 等 | 同上 |

（結果画面の `questionText` は `raw` のコピー。）

正答用 PC 列は **すべて `normalizeForJudgement` に統一**済み（旧 `stepsToAnswerPcs` は論理が同一だったため削除）。

#### `PoolItem.raw` を軸にした下流（コメントに頼らず構造で追う）

プール生成の **終わりで** 1 問ぶんの `PoolItem` が完成する。その **同一オブジェクト**に `raw` / `steps` / `normalizedNotes` がまとまって載る（`raw` だけ後から `steps` を再パースしているわけではない）。

| フィールド | 決まるタイミング | プール以降の行き先 |
|------------|------------------|---------------------|
| **`raw`** | プール生成内 | → `pickQuestionAt` → **`currentQuestionRaw`** → 結果「今回」の **`questionText`**、累計キー **`normalizeKeyForCumulativeStats(...)`** の材料 |
| **`steps`** | プール生成内 | → **`currentSteps`** → 再生（`midi` / `quarters`） |
| **`normalizedNotes`** | プール生成内（`normalizeForJudgement(steps).notes`） | → **`expectedNotes`** → 鍵盤入力との **正答判定** |

ランタイムは **`PoolItem` をコピーして state に載せるだけ**で、`raw` から `steps` を再導出はしていない。

---

### 2.2 モード別の「1行読み」関数名（旧名との対応）

関数名に **どのモード向けか** を入れ、汎用パーサに見えないようにした。

| モード | 関数名 | 旧名（参考） |
|--------|--------|--------------|
| 自由入力 | `parseFreeInputMelodyLine` | `parseProblemLine` |
| 構成音 | `parseChordPickConstituentLine` | `tokenizeChordPickLine` |
| 開始音・終止音（各フィールド） | `parseFixedEndSlotField` | `parseRandomMelodyEndpointField` |
| 開始音・終止音（途中欄） | `tokenizeFixedEndMiddleLine` | `tokenizeRandomMelodyMiddleLine` |

**なぜ関数が分かれるか** — どれも「1行のカナ譜入力」を読むが、**出すデータ構造と後工程が違う**ため。**重複はあるが役割の代替ではない**。

| 比較軸 | **`parseFreeInputMelodyLine`**（自由入力） | **`parseChordPickConstituentLine`**（構成音） |
|--------|---------------------------------------------|-----------------------------------------------|
| **目的** | その行を **そのまま1問**のメロディーにする | 行は **和音の素材**；あとで **順列 × 転回（オクターブマスク）** で多問に割る |
| **出力** | すぐ **`ParsedStep[]`**（再生・判定にそのまま使える時系列） | **`ChordTok[]`**（音符に **`voiceIndex`** 付き）＋ **`refMidis`**（声ごとの基準 MIDI） |
| **ー・休符** | パース中に **直前の音符へ quarters マージ** または `rest` ステップ | **いったん** `extend` / `rest` トークンのまま残し、**`groupChordPickTokens`** で「音符＋直後のー・　」を **1ユニット**にまとめる（**順列の塊**の境界になる） |
| **なぜ構成音だけグループか** | 順列しないので不要 | **ドー と レ を入れ替え**るとき、**ドに付いていたーがドについて回る**必要があるため。自由入力のメロディーでは「音の並び」だけでよい。 |

**開始音・終止音指定**（コード上 `fixedEnd`、旧 `randomMelody`）は別系統（`MelodySlot` → `realizeSteps`）。**＊列挙・鍵盤クランプ**があり、`parseFreeInputMelodyLine` とは入力文法も展開も違う。

#### 小さな処理の共通化（実装済み）

| モジュール | 内容 |
|------------|------|
| `noteTokens.ts` | `NOTE_TOKENS`（`notation.ja` で PC→日本語正規表記）、`matchLongestNoteTokenAt`、`pitchClassToNotationJa`、`KEYBOARD_MIDI_*`、`midiForNearGuideInMelody`、記号1文字判定、`PARSED_NOTE_RAW_PLACEHOLDER`、エディタ許可文字セット |

#### 開始音・終止音指定の「ー」はプールより後か？

**いいえ。プールより前（スロット化〜`realizeSteps`）で直前音に畳んでいる。** 構成音のような **順列用グループ** は要らないが、**列挙された各パターン**ごとに `ParsedStep[]`（`quarters` 込み）が必要なので、`buildFixedEndPool` に入る前の `mergeMelodyFine` / `realizeSteps` で **ー → `tailExtends` / `quarters`** にしている。プール以降は **完成した `steps`** だけを触る。

---

### 3. ランタイム（`App.tsx`）— プール以降はモード非依存

#### 登場人物（何がどこで使われるか）

画面上の「結果」は **今回** と **累計** の2列だけだが、内部では次のものが別物として動いている。**正答判定に使うもの**と**累計のキー**は一致しない。

| 名前（概念） | 型・中身 | 用途 |
|--------------|----------|------|
| **`PoolItem.raw`** | 文字列 | プール生成時に決まる「出題の見出し文」（カナ・休符・伸ばし・＊解決後など）。`pickQuestionAt` で state の **`currentQuestionRaw`** にコピーされる。 |
| **`normalizedNotes`** | `number[]`（0〜11 の PC） | **正答判定**専用。鍵盤入力を PC に直し、**この配列と順番比較**。累計キーとは無関係。 |
| **今回の1行**（`sessionLog` の要素） | `questionText`, `ok`, `answered`, `expected` | クイズ終了後の左列「今回」用。**`questionText`** = そのときの `currentQuestionRaw`（見た目の問題文）。**`answered` / `expected`** = 正誤表示用のカナ連結（`normalizedToKatakana`）。※「ログを吐く機能」というより **結果リスト用の配列**（コード上は過去にプロパティ名 `q` としていたが `questionText` に改名）。 |
| **累計ストアのキー** | 文字列 | `normalizeKeyForCumulativeStats(currentQuestionRaw)`。記号・空白・`*` 等を除いた文字列で、**同じ譜面を別表記で出したとき正答率をまとめる**ため。画面右列「累計」にそのキー文字列が出る。 |

**よくある誤解:** 「入力はカナだから、正答判定は累計と同じ文字列を使っているのでは？」→ **いいえ。** 判定は常に **数値の PC 列 `expectedNotes`**。累計は **正規化した文字列キー**。目的が違う。

処理の流れ（プール以降）:

1. `pickQuestionAt` — `PoolItem.raw` → `currentQuestionRaw`、`steps`、`normalizedNotes` → `expectedNotes`  
2. `scheduleQuestionPlayback` — `steps` の `midi` / `quarters`  
3. **判定** — `expectedNotes` と鍵盤から得た PC 列（累計キーは使わない）  
4. **今回** — 1問終わるたび `sessionLog` に `{ questionText, ok, answered, expected }` を push  
5. **累計** — `bumpStats(store, normalizeKeyForCumulativeStats(currentQuestionRaw), 正誤)`。右列は今回出た問のキーだけ `cumulative` から表示。

---

### 4. 重複・非統一（レビュー観点）

- ~~記号判定のコピペ~~ → **`noteTokens.ts` に集約済み**（§2.2 表参照）。
- **オクターブ決定** — 自由入力・構成音は **`midiForNearGuideInMelody`** に統一。ランダム旋律は **鍵盤クランプ・跳躍・＊列挙**のため **`realizeSteps` 側が別アルゴリズム**（意図した二重）。
- **`step.raw === PARSED_NOTE_RAW_PLACEHOLDER`（`'R'`）** — 構成音・ランダム旋律は順列/列挙で `ParsedStep` を合成するため `raw` をプレースホルダに。**再生・判定は `midi` / `quarters` / `pc`**。見た目は **`PoolItem.raw`** 等で別組み立て。→ §「用語解説」参照。
- **`normalizeKeyForCumulativeStats` と記号集合** — 累計キー用の `STRIP_FOR_STATS` は、パーサが表示に載せる記号と **自動では連動しない**。新記号をパースに足したら **こちらも手で足す**運用。→ §「用語解説」参照。

---

### 用語解説（§4 の箇条書きの意味）

**「オクターブ決定ロジックの二重（自由・構成音 vs ランダム）」**  
自由入力・構成音は「直前に確定した MIDI（ガイド）に、同じ音程クラスで最も近いオクターブ」を **`midiForNearGuideInMelody`** で決める（先頭音は C4 基準）。一方、開始音・終止音モードは **スロット列挙のあと**、**鍵盤 48–72 に収める**・**音と音の跳躍制限**・**＊の PC 列挙**など、**別の制約付き**で MIDI を決める。見た目はどちらも「カナ＋↑↓」だが、**プール生成の仕様が違う**ので関数も分かれる。

**「`raw === 'R'` と表記」**  
`PARSED_NOTE_RAW_PLACEHOLDER` は **内部用**。画面やログの1行は **`PoolItem.raw`**（構成音なら `displayStringForGroupOrder`、ランダムなら `buildMelodyDisplayRaw` 等）。`ParsedStep.raw` が `'R'` でも **バグではなく**、再生は **`midi`** を見る。

**「`normalizeKeyForCumulativeStats` とパーサの手動同期」**  
累計は「**記号を剥がした文字列**」で問をまとめる。パーサや `raw` 組み立てで **新しい全角記号**などを **問題文に出す**ようにしたら、**同じ問を1つにまとめたいなら** `stats/storage.ts` 内 `normalizeKeyForCumulativeStats` の正規表現にも **同種の除去を手で追加**する。`noteTokens` の記号判定と **機械的に1対1ではない**が、変更時は **両方を見る**、という意味の「手動同期」。

---

### 5. 「この分岐は必要か」

| 分岐 | 判断 |
|------|------|
| モード別プールビルダー | **必要**（文法と展開が違う） |
| ランタイム（pick / 再生 / 判定 / ログ） | **既に共通** — これを維持 |
| `parseFreeInputMelodyLine` vs `parseChordPickConstituentLine` | **§2.2 参照** — 関数は別が正しい。記号・トークン・near-guide MIDI は **共通化済み** |

---

更新日: 2026-03-19
