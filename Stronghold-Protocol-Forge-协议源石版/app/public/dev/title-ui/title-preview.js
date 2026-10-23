const EMBLEM = [
  'XXX..XXX..XXX', 'XXX..XXX..XXX', 'XXXXXXXXXXXXX', '.XXXXXXXXXXX.',
  '..XXXXXXXXX..', '..XXXXXXXXX..', '..XXXX.XXXX..', '..XXXX.XXXX..',
  '..XXXXXXXXX..', '..XXXXXXXXX..', '..XXXXXXXXX..', '.XXXXXXXXXXX.',
  'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX',
];
const ICON = {
  user: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 7 0 0 1 16 0z',
  chevrons: 'M5.6 5 4.2 6.4 9.8 12l-5.6 5.6L5.6 19l7-7zm7 0-1.4 1.4 5.6 5.6-5.6 5.6 1.4 1.4 7-7z',
  chart: 'M4 12h4v7H4zm6-6h4v13h-4zm6 3h4v10h-4zM3 20h18v2H3z',
  signal: 'M2 17h3v4H2zm6-4h3v8H8zm6-4h3v12h-3zm6-4h3v16h-3z',
  book: 'M4 4h6a3 3 0 0 1 2 .8A3 3 0 0 1 14 4h6v15h-6a3 3 0 0 0-2 .8 3 3 0 0 0-2-.8H4zm2 2v11h3.2c.7 0 1.4.2 2 .6V7.4A2 2 0 0 0 9.6 6zm12 0h-3.4A2 2 0 0 0 12.8 7.4v10.2c.6-.4 1.3-.6 2-.6H20z',
  gear: 'M12 9.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zm9-1.1-1.9-.6-.5-1.2.9-1.8L17.3 2.5l-1.8.9-1.2-.5-.6-1.9H10.3l-.6 1.9-1.2.5-1.8-.9L4.5 4.7l.9 1.8-.5 1.2-1.9.6v3.4l1.9.6.5 1.2-.9 1.8 2.2 2.2 1.8-.9 1.2.5.6 1.9h3.4l.6-1.9 1.2-.5 1.8.9 2.2-2.2-.9-1.8.5-1.2 1.9-.6z',
  expand: 'M3 3h7v2H5v5H3zm11 0h7v7h-2V5h-5zM3 14h2v5h5v2H3zm16 0h2v7h-7v-2h5z',
  homePlus: 'M12 3 2 11h3v9h6v-5h2v5h6v-9h3zM11 6h2v3h2v2h-2v3h-2v-3H9V9h2z',
};
const icon = (name, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="${ICON[name] || ICON.user}"/></svg>`;

const emblem = () => {
  let dots = '';
  EMBLEM.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch !== 'X') return;
      const rad = 0.2 + (r / (EMBLEM.length - 1)) * 0.2;
      const accent = (r === 6 || r === 7) && (c === 5 || c === 7);
      dots += `<circle cx="${c + 0.5}" cy="${r + 0.5}" r="${rad.toFixed(3)}" class="${accent ? 'is-accent' : 'd' + ((r * 13 + c) % 7)}"/>`;
    });
  });
  return `<div class="emblem" aria-hidden="true">
    <span class="emblem__bracket emblem__bracket--l"></span>
    <svg class="emblem__svg" viewBox="-0.5 -0.5 14 15">${dots}</svg>
    <span class="emblem__bracket emblem__bracket--r"></span>
  </div>`;
};

const ridges = () => `<svg class="title-bg__ridges" viewBox="0 0 1920 420" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="ridge-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16231f"/><stop offset="1" stop-color="#0a0e0d"/></linearGradient>
    <linearGradient id="ridge-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1714"/><stop offset=".6" stop-color="#080b0a"/></linearGradient>
    <linearGradient id="ridge-edge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#17f9b7" stop-opacity="0"/><stop offset=".3" stop-color="#17f9b7" stop-opacity=".55"/><stop offset=".7" stop-color="#17f9b7" stop-opacity=".55"/><stop offset="1" stop-color="#17f9b7" stop-opacity="0"/></linearGradient>
  </defs>
  <path class="ridge ridge--far" fill="url(#ridge-far)" stroke="url(#ridge-edge)" d="M0 420V250l120-40 90 30 90-70 60 20 80-70 80 55 80-25 90 70 90-20 80 50 100-15 90 25 90-55 90-55 70-55 70 45 80-20 90 65 80-20 100 55 100-20 100 40v180z"/>
  <path class="ridge ridge--near" fill="url(#ridge-near)" stroke="url(#ridge-edge)" d="M0 420V322l160-32 100 20 120-50 90 40 130-20 120 50 140-30 140 35 120-35 140 20 140-50 120 30 120-20 120 40 160-20v147z"/>
</svg>`;

const backdrop = () => `<div class="title-bg" aria-hidden="true">
  <div class="title-bg__glow"></div>
  <div class="title-bg__radar"><div class="title-bg__sweep"></div></div>
  <div class="title-bg__target"></div>
  ${ridges()}
  <div class="title-bg__haze"></div>
  <div class="title-bg__grid"></div>
  <span class="cross" style="left:7%;top:22%"></span>
  <span class="cross" style="left:93%;top:30%"></span>
  <span class="cross" style="left:14%;top:70%"></span>
  <span class="cross" style="left:88%;top:62%"></span>
  <span class="cross" style="left:60%;top:12%"></span>
</div>`;

const cornerTL = () => `<div class="title-corner title-corner--tl">
  <span class="title-corner__mark"></span>
  <div class="title-corner__text"><span class="micro micro--mint">RHODES ISLAND // SIMULATION SERVICE</span><br /><span class="micro">TACTICAL CO-OP NODE · 02</span></div>
</div>`;

const cornerTR = () => `<div class="title-corner title-corner--tr">
  <div class="title-corner__stack">
    <div class="title-corner__tools">
      <button class="btn btn--ghost btn--sm title-stats">${icon('chart', 'icon btn__icon')}<span class="btn__label">统计</span></button>
      <button class="btn btn--ghost btn--sm title-notices"><span class="btn__label">公告</span></button>
      <label class="set-seg lang-toggle lang-select title-lang"><select aria-label="语言"><option>中文</option><option>English</option></select></label>
    </div>
    <div class="title-corner__caption"><span class="micro micro--hi">TARGET POINT</span><br /><span class="micro">STRONGHOLD PROTOCOL</span></div>
  </div>
</div>`;

const head = () => `<div class="title-brand">${emblem()}
  <div class="title-en">
    <span class="title-en__a">STRONGHOLD PROTOCOL</span>
    <span class="title-en__b">ALLIANCE</span>
  </div>
  <h1 class="title-cn">卫戍协议<span class="title-cn__colon">：</span><em>盟约</em></h1>
  <p class="title-tag">调配资金与干员，与同伴协同布防，抵御多波次进攻，直至击败敌方领袖。</p>
</div>`;

const fieldBox = () => `<label class="field field--lg">
  <span class="field__label">博士代号<span class="micro">CALLSIGN</span></span>
  <span class="field__box brackets">${icon('user', 'icon field__icon')}
    <input class="field__input" value="B" placeholder="输入你的代号（最多 12 字）" autocomplete="off" spellcheck="false" />
  </span>
</label>`;

const startBtn = () => `<button class="btn btn--primary btn--xl btn--block">
  <span class="btn__label">开始</span>${icon('chevrons', 'icon btn__icon')}
</button>`;

const assets = () => `<div class="title-assets">
  <div class="title-assets__item">
    <button class="btn btn--secondary btn--sm btn--block">预载素材</button>
    <small>画面约 450 MB、含语音约 790 MB，建议使用 Wi-Fi 下载。</small>
  </div>
  <div class="title-assets__item">
    <button class="btn btn--secondary btn--sm btn--block">导入素材包</button>
    <small>读取自己的素材包，美术不占服务器流量。</small>
  </div>
</div>`;

const ping = () => `<span class="ping ping--low" title="当前延迟 42ms">${icon('signal', 'icon ping__icon')}<span class="ping__value">42</span><span class="ping__unit">ms</span></span>`;

const stateItems = () => `<span class="status-dot is-on"></span><span>已连接服务器</span>${ping()}`;

const toolItems = () => `<button class="btn btn--ghost btn--sm guide-btn title-guide">${icon('book', 'icon btn__icon')}<span class="btn__label">玩法说明</span></button>
  <button type="button" class="title-settings fsbtn tapx" aria-label="设置" title="设置">${icon('gear', 'icon')}</button>
  <button type="button" class="title-fs fsbtn tapx" aria-label="全屏" title="全屏">${icon('expand', 'icon')}</button>`;

/* ---------------- 旧结构（与改造前的 title.js 一致） ---------------- */
const loginBefore = () => `<div class="title-login">
  ${fieldBox()}
  ${startBtn()}
  ${assets()}
  <div class="title-conn">${stateItems()}${toolItems()}</div>
</div>`;

/* ---------------- 新结构：身份 / 主动作 / 次要动作 / 状态与工具 ---------------- */
const loginAfter = () => `<div class="title-login">
  <div class="title-login__id">${fieldBox()}</div>
  <div class="title-login__act">${startBtn()}</div>
  ${assets()}
  <div class="title-conn">
    <span class="title-conn__state">${stateItems()}</span>
    <span class="title-conn__tools">${toolItems()}</span>
  </div>
  <i class="title-login__holo" aria-hidden="true"></i>
</div>`;

const footBefore = () => `<footer class="title-foot">
  <button class="btn btn--secondary btn--sm">${icon('homePlus', 'icon btn__icon')}<span class="btn__label">添加到桌面</span></button>
  <span>非官方同人复刻 · 游戏素材版权归 上海鹰角网络 / Yostar 所有</span>
  <span class="title-foot__meta">
    <a class="title-repo" href="#">项目仓库</a>
    <span class="micro">v0.19.17 · WEB SIMULATION</span>
  </span>
</footer>`;

const footAfter = () => `<footer class="title-foot">
  <div class="title-foot__left">
    <button class="btn btn--secondary btn--sm">${icon('homePlus', 'icon btn__icon')}<span class="btn__label">添加到桌面</span></button>
  </div>
  <span class="title-foot__legal">非官方同人复刻 · 游戏素材版权归 上海鹰角网络 / Yostar 所有</span>
  <span class="title-foot__meta">
    <a class="title-repo" href="#">项目仓库</a>
    <span class="micro">v0.19.17 · WEB SIMULATION</span>
  </span>
</footer>`;

// v = before（原始）| tactical（上一版：战术/版式稿）| after（本版：未来感）
const V = new URLSearchParams(location.search).get('v');
const v = V === 'tactical' ? 'tactical' : V === 'after' ? 'after' : 'before';
if (v === 'before') document.getElementById('title-css').setAttribute('href', 'title.before.css');
if (v === 'tactical') {
  document.getElementById('title-css').setAttribute('href', 'title.tactical.css');
  // 战术稿里没有这两个装饰节点：关掉，免得空 <i> 在 flex 列里撑出间距
  const s = document.createElement('style');
  s.textContent = '.title-bg__grid, .title-login__holo { display: none !important; }';
  document.head.appendChild(s);
}

document.getElementById('root').innerHTML = `<div class="screen title-screen">
  ${backdrop()}${cornerTL()}${cornerTR()}
  <main class="title-main">${head()}${v === 'before' ? loginBefore() : loginAfter()}</main>
  ${v === 'before' ? footBefore() : footAfter()}
</div>`;
document.documentElement.dataset.variant = v;
// 审图用：?probe=1 把关键盒子的实测位置写进 DOM（配合 --dump-dom 读数值，判断对齐与溢出）
if (new URLSearchParams(location.search).get('probe') === '1') {
  const box = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return [Math.round(b.left * 10) / 10, Math.round(b.top * 10) / 10, Math.round(b.right * 10) / 10, Math.round(b.bottom * 10) / 10];
  };
  const out = {
    rem: getComputedStyle(document.documentElement).fontSize,
    panel: box('.title-login'),
    field: box('.field__box'),
    start: box('.title-login .btn--primary'),
    assets: box('.title-assets'),
    assetsR: box('.title-assets__item:last-child .btn'),
    conn: box('.title-conn'),
    tools: box('.title-conn__tools'),
    foot: box('.title-foot'),
    legal: box('.title-foot__legal'),
    emblem: box('.emblem'),
    cornerTL: box('.title-corner--tl .micro'),
    cornerTRtools: box('.title-corner__tools'),
    cornerTRcap: box('.title-corner__caption'),
    titleCn: box('.title-cn'),
    tag: box('.title-tag'),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  };
  const pre = document.createElement('pre');
  pre.id = 'probe';
  pre.style.display = 'none';
  pre.textContent = JSON.stringify(out);
  document.body.appendChild(pre);
}
// 审图用：?zoom=1.6 把整屏放大，便于看清控制台的字号与间距
const zoom = Number(new URLSearchParams(location.search).get('zoom'));
if (zoom > 0) document.body.style.zoom = String(zoom);
// 审图用：?only=console 只画控制台，1rem = 100px（1:1 看内距与字号）
if (new URLSearchParams(location.search).get('only') === 'console') {
  document.documentElement.style.fontSize = '100px';
  const s = document.createElement('style');
  s.textContent = `.title-bg,.title-corner,.title-foot,.emblem,.title-en,.title-cn,.title-tag{display:none!important}
    .title-screen{justify-content:flex-start;align-items:flex-start;background:#0c0f0e}
    .title-main{margin:40px 0 0 60px;align-items:flex-start}
    .title-login{animation:none}`;
  document.head.appendChild(s);
}
