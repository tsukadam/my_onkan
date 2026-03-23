/*
  使い方:
  1) このファイルを参考に、同じ場所に public/ads.runtime.js を作る（git 管理外）
  2) 本番サーバーへ ads.runtime.js を一緒に配置する
  3) App.tsx の #ad-footer-slot に広告を描画する
*/

(function () {
  var slot = document.getElementById('ad-footer-slot')
  if (!slot) return
  slot.classList.remove('hasAd')

  // 表示時に viewport 幅 - 20px（左右10px）で固定幅化
  var applySlotWidth = function () {
    var vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
    var w = Math.max(280, Math.min(880, vw - 20))
    slot.style.width = w + 'px'
  }
  applySlotWidth()
  window.addEventListener('resize', applySlotWidth)
  window.addEventListener('orientationchange', applySlotWidth)

  // 例: テキストの仮プレースホルダ（実運用では AdSense の script/ins に置き換え）
  // slot.innerHTML = '<div style="text-align:center;color:#9ca3af;font:12px/1.4 monospace;">ad slot</div>'

  // ---- AdSense 例（必要値を自分のものに置換）----
  // var loader = document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]')
  // if (!loader) {
  //   loader = document.createElement('script')
  //   loader.async = true
  //   loader.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-xxxxxxxxxxxxxxxx'
  //   loader.crossOrigin = 'anonymous'
  //   document.head.appendChild(loader)
  // }
  //
  // var ins = document.createElement('ins')
  // ins.className = 'adsbygoogle'
  // ins.style.display = 'block'
  // ins.style.background = 'transparent'
  // ins.setAttribute('data-ad-client', 'ca-pub-xxxxxxxxxxxxxxxx')
  // ins.setAttribute('data-ad-slot', 'xxxxxxxxxx')
  // ins.setAttribute('data-ad-format', 'auto')
  // slot.appendChild(ins)
  //
  // // iframe が載ったら表示。載らなければ枠は表示しない。
  // var obs = new MutationObserver(function () {
  //   if (ins.querySelector('iframe')) {
  //     slot.classList.add('hasAd')
  //     obs.disconnect()
  //   }
  // })
  // obs.observe(ins, { childList: true, subtree: true })
  // setTimeout(function () {
  //   obs.disconnect()
  //   if (!ins.querySelector('iframe')) {
  //     if (ins.parentNode) ins.parentNode.removeChild(ins)
  //     slot.classList.remove('hasAd')
  //   }
  // }, 8000)
  //
  // ;(window.adsbygoogle = window.adsbygoogle || []).push({})
})()
