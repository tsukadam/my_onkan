import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 既定は GitHub Pages 向け。独自サーバー時は VITE_BASE_PATH=/onkan/ で上書きする。
  base: process.env.VITE_BASE_PATH || '/my_onkan/',
})
