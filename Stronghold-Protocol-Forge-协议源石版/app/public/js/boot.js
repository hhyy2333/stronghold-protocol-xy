// Static boot diagnostics: CSP allows external scripts, never inline event handlers.
// i18n-ignore-file: pre-module legacy-browser fallback, as public/index.html.
// Boot diagnostics (plain ES5: runs everywhere). A browser too old for the app says so instead of spinning forever:
// no ES modules (nomodule below), a module graph that cannot load (e.g. import maps: Safari / iOS < 16.4), or no
// boot after 9 s.
//
// 加载期的可见性（业主 2026-10-21：网页停在启动画面时玩家看不出是在加载还是卡死）：进游戏之前这个文件是**唯一**已经
// 运行的前端脚本。模块图（370+ 个 js）还没下载完、`main.js` 还没执行，`#boot-bar` 就一直是一条空槽 —— 弱网、或页面
// 正好碰上蓝绿切流时，它看起来和死机一模一样。所以这里先把进度条点出 5%、写一行「正在加载资源…」，30 秒还没进游戏
// 再给一个「重新加载」按钮；停在启动画面的页面，刷新一次就能从新槽重新取文件（切流后的典型恢复方式）。
(function () {
  var boot = document.getElementById('boot');
  if (!boot) return;
  var bar = document.querySelector('#boot-bar > i');
  if (bar) bar.style.width = '5%';
  var inner = boot.querySelector('.boot__inner') || boot;
  var hint = document.createElement('div');
  hint.style.cssText = 'margin-top:14px;max-width:420px;text-align:center;color:#7f9b90;' +
    'font-size:12px;line-height:1.6;letter-spacing:.06em';
  hint.textContent = '正在加载资源…';
  inner.appendChild(hint);
  setTimeout(function () {
    var b = document.getElementById('boot');
    if (!b || b.classList.contains('is-done')) return;
    hint.textContent = '加载较慢：请确认网络正常；如果一直停在这里，点下面重新加载。';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '重新加载';
    btn.style.cssText = 'display:block;margin:10px auto 0;padding:5px 18px;border:1px solid rgba(78,216,175,.35);' +
      'border-radius:4px;background:rgba(22,34,30,.9);color:#4ed8af;font-size:13px;cursor:pointer';
    btn.addEventListener('click', function () { location.reload(); });
    hint.appendChild(btn);
  }, 30000);
})();

    window.__spBootFail = function (why) {
      var e = document.getElementById('boot-err');
      if (!e || e.getAttribute('data-final')) return;
      var im;
      try { im = !!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('importmap')); } catch (_x) { im = false; }
      e.textContent = why === 'old' || !im
        ? '当前浏览器版本过旧，无法运行本游戏。请升级到 iOS / iPadOS 16.4+（Safari 16.4+）、Chrome / Edge 90+ 或 Firefox 108+ 后刷新。'
        : '游戏脚本加载失败，请检查网络连接后刷新页面。';
      e.setAttribute('data-final', '1');
    };
    // a module graph that fails to link (bare specifier without import-map support) reports here, not on the <script>
    window.addEventListener('error', function (ev) {
      var b = document.getElementById('boot');
      if (!b || b.classList.contains('is-done')) return;
      if (/specifier|resolve|import|module/i.test(String(ev && ev.message))) window.__spBootFail('load');
    });
  
// If modules never boot (very old browser / blocked script), explain instead of spinning forever.
    setTimeout(function () {
      var b = document.getElementById('boot'), e = document.getElementById('boot-err');
      if (b && !b.classList.contains('is-done') && e && !e.textContent) e.textContent = '加载时间较长…如长时间无响应，请使用最新版 Chrome / Edge / Safari / Firefox 并刷新页面。';
    }, 9000);
  
document.addEventListener('error', function (event) {
  if (event.target && event.target.id === 'sp-main') window.__spBootFail('load');
}, true);
