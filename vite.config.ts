import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // 開発時はルート配信、ビルド時は base を適用する。
  // 既定は GitHub Pages 向け。独自サーバー時は VITE_BASE_PATH=/onkan/ で上書き。
  base: command === 'serve' ? '/' : process.env.VITE_BASE_PATH || '/my_onkan/',
}))
