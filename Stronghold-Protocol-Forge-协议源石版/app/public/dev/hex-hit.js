// public/dev/hex-hit.js — the preview page's own script (/dev/hex-hit.html). CSP is `script-src 'self'`, so it lives
// in its own file instead of an inline block (docs: the same reason dev/title-ui keeps its script outside).
//
// It replays what a 记录部抑制 charge does in a real match, using the real CSS:
//   ui/hexHit.js  → html.sp-hex-hit for ~1.1 s + a `.hex-hit` vignette
//   ui/toasts.js  → a `toast--hex` toast, DEFAULT_MS.hex = 4200 ms
// The numbers below mirror those two modules on purpose: if they drift, the preview lies.

const HEX_ICON = 'M12 1.8 21 7v10l-9 5.2L3 17V7l9-5.2Zm-4.4 9.6v2h8.8v-2H7.6Z';
const HEX_HIT_CLASS = 'sp-hex-hit';
const HEX_HIT_MS = 1100;
const HEX_TOAST_MS = 4200;

const host = document.getElementById('host');
const lpEl = document.getElementById('lpVal');
let lp = Number(lpEl.textContent) || 28;
let flashTimer = null;

function showToast(text) {
  const el = document.createElement('div');
  el.className = 'toast toast--hex';
  el.innerHTML = `<svg class="toast__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${HEX_ICON}" /></svg>`
    + '<span class="toast__text"></span>';
  el.querySelector('.toast__text').textContent = text;
  el.addEventListener('click', () => el.remove());
  host.appendChild(el);
  setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 220); }, HEX_TOAST_MS);
}

function flash() {
  const root = document.documentElement;
  clearTimeout(flashTimer);
  root.classList.remove(HEX_HIT_CLASS);
  void root.offsetHeight;                      // a reflow, so re-adding the class restarts the CSS animation
  root.classList.add(HEX_HIT_CLASS);
  const old = document.querySelector('.hex-hit');
  if (old) old.remove();
  const layer = document.createElement('div');
  layer.className = 'hex-hit';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  flashTimer = setTimeout(() => {
    layer.remove();
    root.classList.remove(HEX_HIT_CLASS);
  }, HEX_HIT_MS);
}

/** One charged deploy: LP − 1 (the floor is 1, exactly like server/match/match/intents.js), then the alert. */
function deploy() {
  if (lp <= 1) { flash(); showToast('记录部抑制：策略生命已见底，未再扣除'); return; }
  lp -= 1;
  lpEl.textContent = String(lp);
  flash();
  showToast(`记录部抑制：部署干员消耗 1 点策略生命（剩余 ${lp}）`);
}

document.getElementById('once').addEventListener('click', deploy);
document.getElementById('thrice').addEventListener('click', () => {
  deploy();
  setTimeout(deploy, 700);
  setTimeout(deploy, 1400);
});
document.getElementById('reset').addEventListener('click', () => {
  lp = 28;
  lpEl.textContent = String(lp);
  host.innerHTML = '';
  const old = document.querySelector('.hex-hit');
  if (old) old.remove();
  document.documentElement.classList.remove(HEX_HIT_CLASS);
});
