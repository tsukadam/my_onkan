/*
  使い方:
  1) このファイルを参考に、同じ場所に public/ads.runtime.js を作る（git 管理外）
  2) 本番サーバーへ ads.runtime.js を一緒に配置する
  3) App.tsx の #ad-footer-slot に広告を描画する
*/

(function () {
  var slot = document.getElementById('ad-footer-slot')
  if (!slot) return

  // 例: テキストの仮プレースホルダ（実運用では AdSense の script/ins に置き換え）
  // slot.innerHTML = '<div style="text-align:center;color:#9ca3af;font:12px/1.4 monospace;">ad slot</div>'

  // ---- AdSense 例（必要値を自分のものに置換）----
  // var loader = document.createElement('script')
  // loader.async = true
  // loader.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-xxxxxxxxxxxxxxxx'
  // loader.crossOrigin = 'anonymous'
  // document.head.appendChild(loader)
  //
  // var ins = document.createElement('ins')
  // ins.className = 'adsbygoogle'
  // ins.style.display = 'block'
  // ins.setAttribute('data-ad-client', 'ca-pub-xxxxxxxxxxxxxxxx')
  // ins.setAttribute('data-ad-slot', 'xxxxxxxxxx')
  // ins.setAttribute('data-ad-format', 'auto')
  // ins.setAttribute('data-full-width-responsive', 'true')
  // slot.appendChild(ins)
  //
  // ;(window.adsbygoogle = window.adsbygoogle || []).push({})
})()
