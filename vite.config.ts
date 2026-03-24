import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readSeoDescriptionFromFile(): string | undefined {
  const p = join(__dirname, 'seo-description.txt')
  if (!existsSync(p)) return undefined
  try {
    const raw = readFileSync(p, 'utf8').trim()
    if (!raw) return undefined
    return raw.replace(/\s+/g, ' ')
  } catch {
    return undefined
  }
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function seoHeadPlugin(): Plugin {
  return {
    name: 'seo-head-inject',
    transformIndexHtml(html) {
      const raw = process.env.VITE_SEO_PUBLIC_URL?.trim()
      const descRaw =
        process.env.VITE_SEO_DESCRIPTION?.trim() || readSeoDescriptionFromFile()
      const ogImageRaw = process.env.VITE_SEO_OG_IMAGE?.trim()

      if (!raw) {
        return html.replace(/\s*<!--\s*@SEO_HEAD@\s*-->\s*/g, '\n')
      }

      const base = raw.replace(/\/+$/, '')
      const canonical = `${base}/`
      // 環境変数・seo-description.txt 未指定時は短い既定文（リポジトリ index に長文を置かない）
      const description = descRaw || 'MyOnkan 相対音感練習'
      // SNS プレビュー用は背景付き PWA アイコンの方が無難（SVG 非対応クローラは PNG 推奨）
      const ogImage = ogImageRaw || `${base}/pwa-icon.svg`
      const esc = escapeHtmlAttr(description)
      const escImg = escapeHtmlAttr(ogImage)

      const jsonLd = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'MyOnkan 相対音感練習',
        description,
        url: canonical,
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Web',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' },
        inLanguage: 'ja',
      })

      const block = `
    <meta name="description" content="${esc}" />
    <link rel="canonical" href="${escapeHtmlAttr(canonical)}" />
    <meta property="og:site_name" content="MyOnkan" />
    <meta property="og:title" content="MyOnkan 相対音感練習" />
    <meta property="og:description" content="${esc}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="ja_JP" />
    <meta property="og:url" content="${escapeHtmlAttr(canonical)}" />
    <meta property="og:image" content="${escImg}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="MyOnkan 相対音感練習" />
    <meta name="twitter:description" content="${esc}" />
    <script type="application/ld+json">${jsonLd}</script>`

      return html.replace(/\s*<!--\s*@SEO_HEAD@\s*-->\s*/g, `\n${block}\n`)
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), seoHeadPlugin()],
  base: command === 'serve' ? '/' : process.env.VITE_BASE_PATH || '/my_onkan/',
}))
