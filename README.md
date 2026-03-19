# MyOnkan

相対音感トレーニング用のWebアプリです。  
ブラウザ上でメロディを聴き、鍵盤で回答する形式の練習ができます。

## 主な機能

- 2オクターブ鍵盤（C3-C5）で入力
- 問題セット出題 / ランダムメロディ出題
- 開始音・最終音・音数・出題数の設定
- 問題セット編集（IndexedDBに保存）
- 問題セットのインポート / エクスポート（JSON）
- 累計正答率の表示

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

## デプロイ（GitHub Pages）

このリポジトリでは、`main` への push をトリガーに GitHub Actions で Pages へ自動デプロイします。

初回のみ、GitHubリポジトリ設定で以下を確認してください。

1. `Settings` -> `Pages`
2. `Build and deployment` を `GitHub Actions` に設定

公開URL（想定）:

- [https://tsukadam.github.io/my_onkan/](https://tsukadam.github.io/my_onkan/)
