# MyOnkan

相対音感トレーニング用の Web アプリです。  
ブラウザで出題音を聴き、鍵盤で回答して練習できます。

## 現在の主な機能

- 2オクターブ鍵盤（表示範囲: C3..C5）で回答
- 3つの出題モード
  - 手入力（自由入力）
  - 構成音から生成
  - 指定＋ランダム（開始音/終止音/途中音）
- `↑` `↓` によるオクターブ指定
- `*` `＊` によるランダム音
- 出題間隔・キー・テンポ設定
- 累計成績（IndexedDB 保存）
- ユーザー設定の一部を保存
  - 構成音モード: 出題数
  - 指定＋ランダム: 出題数 / 白鍵のみ / 跳躍をオクターブ以下

## 技術スタック

- React + TypeScript + Vite
- Tone.js
- IndexedDB

## 開発環境

- Node.js 20 以上推奨
- npm

## ローカル起動

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

## デプロイ

### 1) GitHub Pages（既定）

`vite.config.ts` の既定 `base` は GitHub Pages 向けです。

- 既定 base: `/my_onkan/`
- 公開URL（想定）: [https://tsukadam.github.io/my_onkan/](https://tsukadam.github.io/my_onkan/)

### 2) 独自サーバー（例: `https://service.aramugi.com/onkan/`）

ビルド時に base を上書きします。

PowerShell:

```powershell
$env:VITE_BASE_PATH='/onkan/'
npm run build
```

または Windows のバッチ:

```bat
build-onkan.bat
```

生成された `dist/` を `/onkan/` 配下に配置してください。  
`public/.htaccess` は `dist/.htaccess` として出力されるので、同時に配置されます。

## 広告スニペット運用（任意）

リポジトリに広告本体コードを置かずに運用できます。

- 実行時に `ads.runtime.js` を読み込む方式です
- `public/ads.runtime.js` は `.gitignore` で管理外
- テンプレート: `public/ads.runtime.example.js`

`public/ads.runtime.js` を用意してビルドすると、`dist/ads.runtime.js` として出力されます。

### PWA と広告（既定）

**既定では、PWA（スタンドアロン表示）のとき広告枠は出しません。**  
`ads.runtime.js` 内の `MYONKAN_ADS_HIDE_IN_STANDALONE` が `true` のためです。

PWA でも広告を出したい場合:

1. `MYONKAN_ADS_HIDE_IN_STANDALONE` を `false` にする、または
2. `ads.runtime.js` より前に  
   `window.MYONKAN_ADS_CONFIG = { hideInStandalone: false }` を置く

ブラウザ表示では従来どおり広告を読み込みます（AdSense を配置している場合）。

## ライセンス

[MIT](./LICENSE)
