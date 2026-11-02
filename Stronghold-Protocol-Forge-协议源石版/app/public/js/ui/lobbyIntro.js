// 开场演出（业主 2026-11-01：把融合版 0.3.3 的那支「卫戍协议：盟约」入场片搬进来）。门面只有 playLobbyIntro()，
// main.js 在标题页画出来之后调一次；片子怎么画在 ui/allianceScene.js，这里只管**什么时候放、声音怎么接**。
//
// 什么时候放：每次打开页面一次（与来源一致）。房间 / 对局里不播（selectRoute），带 ?room= 的邀请也不播
// （store 的 ui.pendingJoin —— 那条路要直接进房间，别拿 2.8 秒盖住它）；手机竖屏不播、等转横屏再播
// （whenPhoneReady：竖屏里这支 16:9 的片子只剩一条，而且游戏本来就在提示转屏）。
// 系统里关了动效（prefers-reduced-motion）不播，开关是 sp.pref.lobby.intro —— 两条都只是「这次不播」，不影响任何功能。
//
// 声音：入场音效在录屏 1.686 s，大厅音乐从 2.144 s 起**从头**放（audio.js 自己的入口，0.8 s 淡入与 intro 段都在）。
// **不装「点击进入 / TAP TO START」闸门**：来源的 PACKAGING.md 还写着要点一下，但它的代码早已改成「主动 resume，
// 500 ms 拿不到就静音放」（C-表现层 §2.3 点名说文档过期了）——以代码为准。
// 我方要留神一处差别：audio.ctx 是**首次手势才创建**的（audio.js 的 _unlock），所以全新打开页面时多半还没有上下文，
// 这支片子会静音放完（点一下即跳过）；环境允许自动播放时（启动器 / WebView2）就出声。
//
// 素材没下载齐怎么办：**不播，也不黑屏**。判据是 ui/allianceScene.js 的 preloadSprites（8 张入场贴图全部 decode
// 成功才算齐），所以这里先预载、齐了才挂 <dialog>；缺图就静默返回，标题页照常（我方标题页本来就有 CSS / SVG 兜底）。
//
// 回退：删本文件 + ui/allianceScene.js + main.js 里那两行（import 与调用），别的文件没动。只想临时关掉不删代码，
// 就写 localStorage 的 sp.pref.lobby.intro = false —— playLobbyIntro 读的就是它。
import { store, selectRoute, loadPref } from '../store.js';
import { reducedMotion } from './device.js';
import { audio, resolveBgm } from '../audio.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { mountAllianceIntro, preloadSprites, INTRO_AUDIO, INTRO_SPAN } from './allianceScene.js';

const ENTRY_SFX = '/assets/audio/sfx/customse/act1autochess/act1autochess_g_ui_load.mp3';
// 音效与音乐的相对音量按录屏的混音（音效约 ×0.28、音乐约 ×0.18 文件原音），折算到默认音量（音效 0.8 → ×0.576，
// 音乐 0.6 → ×0.198，见 audio.js 的 _applyVolumes）得出这一个系数：改混音就改它。
const SFX_GAIN = 0.54;
const SPRITES_MS = 3000; // 素材预载上限：缺图的机器在这之内就被判「不播」，不会对着黑屏等下载
const UNLOCK_MS = 500;   // 等音频上下文出声的上限：拿不到就静音放，画面不等音频

// 「点击跳过」故意压得很淡（满屏近黑里才看得见），想让人看完这支片子；它不吃事件（pointer-events:none），
// 点画面任何地方都算跳过。来源 CSS 里那套 .spa-entry__gate / spa-pulse 是「点击进入」闸门的遗物，代码已经不用，不搬。
const CSS = `
.spa-entry{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;
  border:0;outline:0;overflow:hidden;background:#000;cursor:pointer;color:#dfe9ea}
.spa-entry::backdrop{background:transparent}
.spa-entry__skip{position:absolute;right:3%;bottom:3.5%;z-index:2;font:12px/1 "Microsoft YaHei","Noto Sans SC",sans-serif;
  letter-spacing:.2em;color:rgba(220,240,236,.45);pointer-events:none;transition:opacity .3s}`;

const mq = (q) => { try { return !!matchMedia(q).matches; } catch { return false; } };
/** 手机 / 平板：只有粗指针、没有鼠标。 */
const touchDevice = () => (mq('(pointer: coarse)') || mq('(any-pointer: coarse)')) && !mq('(any-pointer: fine)');
/** 竖屏还是横屏（这支片子是 16:9，竖屏里只剩一条）。 */
function phoneReady() {
  return innerWidth > innerHeight;
}
/** 现在就跑 `fn`；手机上等转成横屏再跑 —— 但等到那一刻时 `still()` 得还成立，否则作废。 */
function whenPhoneReady(still, fn) {
  if (!touchDevice() || phoneReady()) { fn(); return; }
  const EVENTS = [[window, 'resize'], [window, 'orientationchange']];
  let waiting = true;
  const stop = () => { waiting = false; EVENTS.forEach(([target, ev]) => target.removeEventListener(ev, check)); clearInterval(gone); };
  const check = () => {
    if (!waiting || !phoneReady()) return;
    stop();
    // 让旋转先落定（device.js 会在视口拿到最终尺寸后再发一次 resize）
    setTimeout(() => { if (still()) fn(); }, 400);
  };
  // 等待期间玩家可能已经进了房间 / 对局：每秒看一次「还该不该播」，不该了就收工
  const gone = setInterval(() => { if (!still()) stop(); }, 1000);
  EVENTS.forEach(([target, ev]) => target.addEventListener(ev, check));
}

/** 预解码入场音效，顺手把大厅音乐的两段载进缓存（真正开播仍交给 audio.playBgm）；此刻听不到就返回 null。 */
async function prepareSound() {
  const ctx = audio.ctx;
  if (!ctx || ctx.state !== 'running' || audio.volumes?.muted) return null;
  const track = resolveBgm(data.get('assets'), 'lobby');
  const wait = (p) => Promise.race([Promise.resolve(p).catch(() => null), new Promise((r) => setTimeout(() => r(null), 2500))]);
  const [sfx] = await Promise.all([wait(audio._buffer(ENTRY_SFX)), wait(track?.intro ? audio._buffer(track.intro) : null), wait(track ? audio._buffer(track.loop) : null)]);
  return { sfx };
}

/**
 * 片子期间先把 BGM「借走」：正在放的那首淡出，期间所有 playBgm 只记在手上；放开时把记住的那首（没有就用最后那首）
 * 从头放 —— 走的是 audio.js 自己的入口，淡入与 intro 段都还在。返回放开函数，没有可借的就返回 null。
 * 以下三种情况不借：没有音频上下文、音乐被静音 / 音量为 0、**玩家自己放了音乐**（ui/lobbyMusic.js 的
 * lobbyMusicOverride 在大厅里盖过默认音乐 —— 那就没有默认 BGM 可借，也不该动他的歌）。
 * 与来源的差别：它读的是 audio.lobbyTrack（融合版自己的字段），我方对应 lobbyMusicOverride（+ 玩家的 record.enabled）。
 */
function holdBgm() {
  if (!audio.ctx || audio.bgmSilent || Object.prototype.hasOwnProperty.call(audio, 'playBgm')) return null;
  try { if (audio.lobbyMusicOverride?.('lobby')) return null; } catch { return null; }
  let asked;
  audio.playBgm = (key) => { asked = key; };
  try { ++audio.bgmToken; audio._fadeOutBgm(); } catch { /* ignore */ }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    delete audio.playBgm;
    try { audio.playBgm(asked !== undefined ? asked : audio.lastBgmKey ?? 'lobby'); } catch { /* ignore */ }
  };
}

/** 等音频上下文真能出声（最多 ms）。没有上下文 / 被浏览器拒了就是 false —— 画面从不等音频。 */
function waitUnlocked(ms) {
  const ctx = audio.ctx;
  if (!ctx) return Promise.resolve(false);
  if (ctx.state === 'running') return Promise.resolve(true);
  return new Promise((resolve) => {
    const until = performance.now() + ms;
    const step = () => {
      if (audio.ctx?.state === 'running') resolve(true);
      else if (performance.now() > until) resolve(false);
      else setTimeout(step, 30);
    };
    setTimeout(step, 0);
  });
}

function ensureStyle() {
  if (document.getElementById('spa-entry-style')) return;
  const st = document.createElement('style');
  st.id = 'spa-entry-style';
  st.textContent = CSS;
  document.head.append(st);
}

let playing = false;

/** 挂上 <dialog> 并开跑；声音按 `sound` 决定（null = 静音）。调用前素材已确认齐全。 */
function play(sound) {
  ensureStyle();
  // 顶层 modal <dialog>：连引导 / 全屏提示那类同样是 modal 的层也盖得住（z-index 只是兜底）
  const el = document.createElement('dialog');
  el.className = 'spa-entry';
  el.setAttribute('aria-label', t('卫戍协议：盟约'));
  el.innerHTML = `<span class="spa-entry__skip">${t('点击跳过')}</span>`;
  const skipLabel = el.querySelector('.spa-entry__skip');
  document.body.append(el);
  try { el.showModal(); } catch { el.setAttribute('open', ''); }

  let scene = null, raf = 0, release = null, bgmTimer = 0, done = false, src = null;
  const cleanup = () => {
    cancelAnimationFrame(raf);
    try { scene?.destroy(); } catch { /* ignore */ }
    try { el.close(); } catch { /* ignore */ }
    el.remove();
    playing = false;
  };
  const finish = (skipped) => {
    if (done) return;
    done = true;
    clearTimeout(bgmTimer);
    release?.();
    removeEventListener('keydown', onKey, true);
    if (skipped) {
      // 跳过：音效跟着画面一起收（0.08 s），音乐立刻从头开始（release 已经放开了）
      try { const now = audio.ctx.currentTime; src?.gain.gain.setTargetAtTime(0, now, 0.08); src?.node.stop(now + 0.5); } catch { /* ignore */ }
      el.style.transition = 'opacity .3s ease';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      setTimeout(cleanup, 320);
    } else cleanup();
  };
  const onKey = () => finish(true);
  el.addEventListener('cancel', (e) => { e.preventDefault(); finish(true); }); // Esc 与任意键一样是跳过
  el.addEventListener('pointerdown', () => finish(true));
  addEventListener('keydown', onKey, true);

  try { scene = mountAllianceIntro(el); } catch (err) { console.warn('[intro] could not start', err); cleanup(); return; }

  const { from, fadeAt, to } = INTRO_SPAN;
  const lead = 0.04;
  const t0 = performance.now() + lead * 1000; // 录屏第 from 秒落在 t0 这一帧上
  if (sound && audio.ctx?.state === 'running') {
    const ctx = audio.ctx;
    if (sound.sfx && audio.sfxGain) {
      try {
        const node = ctx.createBufferSource(), gain = ctx.createGain();
        node.buffer = sound.sfx; gain.gain.value = SFX_GAIN;
        node.connect(gain); gain.connect(audio.sfxGain);
        node.start(ctx.currentTime + lead + (INTRO_AUDIO.sfxAt - from));
        src = { node, gain };
      } catch { /* ignore */ }
    }
    release = holdBgm();
    // audio.js 收到 playBgm 之后 50 ms 才真正开播，所以早 50 ms 放开，让音乐正点落在 2.144 s 上
    if (release) bgmTimer = setTimeout(() => release?.(), Math.max(0, (lead + INTRO_AUDIO.bgmAt - from - 0.05) * 1000));
  }
  const frame = () => {
    if (done) return;
    const T = from + (performance.now() - t0) / 1000;
    if (T >= to) { finish(false); return; }
    if (T < 3.2) scene.grain();
    scene.render(Math.max(from, T));
    const fade = Math.min(1, Math.max(0, (T - fadeAt) / (to - fadeAt)));
    el.style.opacity = (1 - fade).toFixed(3);
    // 开始淡出就交还点击：下面已经是真页面了，别让人对着一个透明的层点空
    if (fade > 0) { el.style.pointerEvents = 'none'; skipLabel.style.opacity = '0'; }
    raf = requestAnimationFrame(frame);
  };
  scene.render(from);
  raf = requestAnimationFrame(frame);
}

/** 预载 → 判就绪 → 挂上去。任何一步不成立都**静默返回**（标题页照常，绝不黑屏）。 */
async function start(still) {
  if (playing) return;
  playing = true;
  // 主动 resume（不装闸门，见文件头）。这一步要尽早：浏览器只在真有过交互时才放行，越靠后越容易错过
  // 启动器里那个已经允许自动播放的窗口。
  try { audio.ctx?.resume?.(); } catch { /* ignore */ }
  const gate = waitUnlocked(UNLOCK_MS);
  // 字体晚到会让描边字的测量与缩放失准：等它，但有上限（Bender 是两个本机 woff2，通常一帧内就到）
  const fontsApi = globalThis.document?.fonts;
  const fonts = fontsApi?.load
    ? Promise.race([Promise.all(['300 40px Bender', '400 40px Bender'].map((f) => fontsApi.load(f).catch(() => null))), new Promise((r) => setTimeout(r, 1200))])
    : null;
  const [sprites, , sound] = await Promise.all([preloadSprites(undefined, SPRITES_MS), fonts, gate.then(() => prepareSound())]);
  if (!sprites || sprites.loaded < sprites.asked) {
    // 入场贴图没齐（素材没下载 / 走的是导入包）：这支片子放不出来，直接不播。console 只留一行便于报障。
    if (sprites?.missing?.length) console.info('[intro] skipped, sprites missing:', sprites.missing.join(', '));
    playing = false;
    return;
  }
  // 预载花了上百毫秒，这期间服务器可能刚把手上的对局恢复回来（ui.restoring / 路由变成 game）：再确认一次，别盖住它。
  if (!still()) { playing = false; return; }
  play(sound);
}

/**
 * 每次打开页面放一次（放在标题页画出来之后调用），房间 / 对局里不播。
 * @param {{ skip?: () => boolean }} [opts] skip() → true 表示这次不该播（例如恢复了一局对局）
 */
export function playLobbyIntro(opts = {}) {
  const { skip = () => false } = opts;
  // 开关：sp.pref.lobby.intro，默认开。业主或玩家嫌烦就关这一条，代码不用回滚（回退办法见文件头）。
  if (loadPref('lobby.intro', true) === false) return;
  const allowed = () => {
    const s = store.get();
    const route = selectRoute(s);
    // restoring：刷新时手里本来就有房间 / 对局，正在等服务端重新推回来（main.js 的 RESTORE_GRACE_MS）——
    // 这种时候也不能播，否则会先盖住一局正在恢复的对局。
    // reducedMotion：跟本仓其它地方同一条口径（css/theme.css 的 @media (prefers-reduced-motion: reduce)、
    // ui/device.js 的 sp-reduced-motion）。来源那支片子不看这个开关，但这里是一整屏 2.8 秒的动效，玩家既然
    // 在系统里关了动效就不该被强制看一遍——静默不播，标题页照常。
    return route !== 'room' && route !== 'game' && !s.ui?.pendingJoin && !s.ui?.restoring && !skip() && !reducedMotion();
  };
  if (!allowed()) return;
  whenPhoneReady(allowed, () => {
    start(allowed).catch((err) => { playing = false; console.warn('[intro] failed', err); });
  });
}
