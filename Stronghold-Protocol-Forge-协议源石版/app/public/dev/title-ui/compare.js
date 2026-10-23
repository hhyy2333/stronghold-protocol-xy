const stage = document.getElementById('stage');
const wrap = document.getElementById('wrap');
const range = document.querySelector('input[type="range"]');
const left = stage.querySelector('iframe.base');
const tagLeft = stage.querySelector('.tagbefore');
let W = 1600, H = 900;

function fit() {
  const box = document.querySelector('main');
  const availW = box.clientWidth - 36;
  const availH = box.clientHeight - 36;
  const s = Math.min(availW / W, availH / H, 1);
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';
  stage.style.transformOrigin = 'center center';
  stage.style.transform = `scale(${s})`;
  wrap.style.width = W * s + 'px';
  wrap.style.height = H * s + 'px';
}
function setP(v) {
  stage.style.setProperty('--p', v + '%');
  range.value = v;
}
range.addEventListener('input', () => setP(range.value));
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { setP(Math.max(0, +range.value - 4)); e.preventDefault(); }
  if (e.key === 'ArrowRight') { setP(Math.min(100, +range.value + 4)); e.preventDefault(); }
});

// 两组 chip：视口尺寸（data-size）/ 左侧对照版本（data-left）
document.querySelectorAll('button.chip').forEach((b) => {
  b.addEventListener('click', () => {
    const group = b.dataset.left ? 'data-left' : 'data-size';
    document.querySelectorAll(`button.chip[${group}]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (b.dataset.left) {
      left.src = `title-preview.html?v=${b.dataset.left}`;
      tagLeft.textContent = b.dataset.left === 'tactical' ? '上一版 · 战术' : '原始版';
    } else {
      const [w, h] = b.dataset.size.split('x').map(Number);
      W = w; H = h;
      fit();
    }
  });
});
window.addEventListener('resize', fit);
fit();
setP(50);
