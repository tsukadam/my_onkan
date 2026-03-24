# iOS Safari：文字サイズ・入力フォーカス時のズーム（調査メモ）

（英語の短い要約は下に同じ内容で記載）

## 要点（日本語）

- **React の MIT 全文**: `node_modules/react/LICENSE` など。`dist` のバンドルには通常入らない → リポジトリで `NOTICE` にまとめるのが一般的。
- **Safari と Chrome(iOS) で大きさが違う**: OS の「テキストサイズ」、Safari の「ページの拡大・縮小」、Chrome がテキストサイズに追随しやすい、などがよく挙がる（下記 SO）。
- **フォーカス時ズーム**: 多くの説明では **computed の font-size が小さい**とき。16px 付近がしきい値と言われ続けているが、カスケードで効かない例もある → **17px** と `font` 一括 `!important` で最後に潰す実装（`App.css` 末尾）。

---

# iOS Safari: text size and input focus zoom (notes)

## Where React MIT full text lives

After `npm install`, each package's license file is under `node_modules/<pkg>/LICENSE` (or `LICENSE.md`). Examples: `node_modules/react/LICENSE`, `node_modules/react-dom/LICENSE`.

Production Vite bundles in `dist/` usually do not embed those full strings. A repo-level `NOTICE` summarizes attributions.

MIT requires the permission notice to ship with copies of the software; it does not require showing credits in the UI.

## Safari vs Chrome on iOS: "same CSS, different size"

Often discussed causes:

- iOS Chrome follows Control Center **Text Size**; Safari has separate **Page Zoom** (Settings > Safari). See Stack Overflow: "Why is font-size different on iOS Chrome v. iOS Safari?" (stackoverflow.com/questions/62668640).

So if sizes differ, check system text size and Safari page zoom first.

## Focus zoom (not only textarea)

Commonly described: iOS zooms focused fields when computed font-size is small (often cited threshold ~16 CSS px). See e.g. CSS-Tricks article on 16px and form zoom.

This is tied to styled font-size, not DPR alone. Some apps still see failures at 16px due to cascade/`font` shorthand; using slightly larger px (e.g. 17) and full `font` override is a practical mitigation.

## This project's CSS approach

See end of `src/App.css`: single block, `max-width: 1024px` plus `@supports (-webkit-touch-callout: none)`, `font: 17px/... !important`.
