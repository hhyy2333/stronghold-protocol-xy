// public/js/ui/announce.js — the 全体公告 banner: ONE operator-authored line from /admin/, shown across the top of EVERY
// page — the title, the lobby, a room and a running match alike. The server pushes `announce` (shared/announce.js) to the
// whole session registry AND replays the current line to every session that connects afterwards, so this component needs
// no room and no match: main.js hands it every frame that arrives, and it renders whatever is current.
//
// READABILITY IS THE POINT (the owner's requirement of 2026-10-11: "别整那种一闪就没了、连字都看不清的破玩意"):
//   * the text scrolls at a CONSTANT speed, so a long announcement simply takes longer instead of moving faster;
//   * it keeps scrolling for as long as the server keeps the line current — a standing notice stays readable for hours;
//   * `prefers-reduced-motion` gets a STATIC, wrapped line instead of a marquee — never a moving target;
//   * a ✕ dismisses it for this page (the next announcement shows again, and a reload restores the current one).
//
// PERSISTENCE (the owner's request of 2026-10-11). The banner is NOT self-destructing: the SERVER decides when an
// announcement is over — a newer one replaces it, or the panel withdraws it (an `announce` frame with empty text). The
// client only ever renders what the server says is current, so a line published while nobody was looking is still on
// screen when the next player arrives. More than one announcement can arrive back to back: they queue
// (ANNOUNCE_QUEUE_MAX, oldest dropped) and play one at a time, so a burst never overwrites a line before it was read.

import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { useDocClass } from './device.js';
import { t } from '../../../shared/i18n.js';

/** Announcements waiting behind the one on screen (oldest dropped). */
export const ANNOUNCE_QUEUE_MAX = 5;
/** Shortest time one announcement stays up, whatever its length (ms). */
export const ANNOUNCE_MIN_MS = 9000;
/** Reading speed of the marquee: seconds per character, so the scroll is constant-speed rather than proportional. */
export const ANNOUNCE_SEC_PER_CHAR = 0.22;
/** How long the text holds after finishing its pass before the marquee loops (ms). */
export const ANNOUNCE_HOLD_MS = 1800;

/** @type {{ id: string, text: string, at: number } | null} the announcement on screen */
let current = null;
/** @type {{ id: string, text: string, at: number }[]} */
const queue = [];
const listeners = new Set();
const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch (err) { console.error('[announce] listener failed', err); } } };

/** How long one pass of this text takes (ms): constant speed, never under ANNOUNCE_MIN_MS. */
export function announceDuration(text) {
  const len = String(text ?? '').length;
  return Math.max(ANNOUNCE_MIN_MS, Math.round((len * ANNOUNCE_SEC_PER_CHAR + ANNOUNCE_HOLD_MS / 1000) * 1000));
}

/**
 * Take one `announce` frame from the server (main.js `net.on('announce')`). Defensive about the shape: a frame with no
 * usable text is ignored rather than shown as an empty strip.
 *
 * An empty `text` is the server WITHDRAWING the announcement (the panel's 撤回): the line on screen goes away and the
 * queue is dropped. An empty announcement is never *shown*, so "withdrawn" and "nothing to show" cannot be confused.
 * @param {{ id?: unknown, text?: unknown, at?: unknown }} msg
 */
export function pushAnnouncement(msg) {
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (!text) {
    // 撤回：只有明确收到一个空 text 的帧才清屏（没有 text 字段的畸形帧什么都不做）。
    if (typeof msg?.text === 'string') { current = null; queue.length = 0; emit(); }
    return;
  }
  const id = typeof msg.id === 'string' && msg.id ? msg.id : `a${Date.now().toString(36)}-${text.slice(0, 8)}`;
  // A re-delivery of the line already showing (or queued) is not a second announcement.
  if (current?.id === id || queue.some((q) => q.id === id)) return;
  const item = { id, text, at: Number.isFinite(msg.at) ? msg.at : Date.now() };
  if (!current) current = item;
  else {
    queue.push(item);
    if (queue.length > ANNOUNCE_QUEUE_MAX) queue.splice(0, queue.length - ANNOUNCE_QUEUE_MAX);
  }
  emit();
}

/** Drop the line on screen (the ✕) and pull the next queued one in. */
export function dismissAnnouncement() {
  current = queue.shift() || null;
  emit();
}

/** The banner's own state, for tests: what is showing and what waits behind it. */
export function announceState() {
  return { current: current ? { ...current } : null, queued: queue.map((q) => ({ ...q })) };
}

/** Test-only: forget everything (module state survives between tests otherwise). */
export function resetAnnouncements() {
  current = null;
  queue.length = 0;
  emit();
}

const prefersReducedMotion = () =>
  typeof globalThis.matchMedia === 'function' && !!globalThis.matchMedia('(prefers-reduced-motion: reduce)')?.matches;

/**
 * The banner strip. Mounted once by main.js inside <App/> (so it covers every route: title, lobby, room, match) and
 * driven by the SERVER: the current announcement stays until one replaces it or the operator withdraws it.
 */
export function AnnounceBanner() {
  // The SERVER can push before this component exists: the announcement is replayed to a session the moment it says
  // hello, which on a page load is BEFORE <App/> mounts (measured: a reload received the `announce` frame with the
  // listeners set still empty, so the emit went nowhere and the strip never appeared). `pushAnnouncement` had already
  // stored the line in `current`; the component only has to notice it. Seeding the state from `current` is what makes
  // the replay render — without it the first paint after a reload shows nothing.
  const [, force] = useState(0);
  const [reduced, setReduced] = useState(() => prefersReducedMotion());
  const trackRef = useRef(null);

  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    // Anything that arrived while nobody was listening is applied now. This is not only the page-load case above: it
    // also covers a frame that lands between two mounts (a route change remounting <App/>).
    if (current) fn();
    return () => { listeners.delete(fn); };
  }, []);

  // A viewer can flip the OS setting at any time; re-read it when the banner comes and goes.
  useEffect(() => {
    const mq = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (!mq) return undefined;
    const fn = () => setReduced(!!mq.matches);
    mq.addEventListener?.('change', fn);
    return () => mq.removeEventListener?.('change', fn);
  }, []);

  // The marquee scrolls the text fully past the viewport: the distance is the text's own width plus the viewport's, so
  // the track's travel needs the measured width. Read it before paint (the animation is already running) and again if
  // the window is resized (a rotation changes the viewport width).
  const id = current?.id ?? null;
  useLayoutEffect(() => {
    if (!id || reduced) return undefined;
    const measure = () => {
      const el = trackRef.current;
      if (!el) return;
      const w = el.scrollWidth || el.getBoundingClientRect().width;
      if (w > 0) el.style.setProperty('--announce-text-w', `${Math.ceil(w)}px`);
    };
    measure();
    globalThis.addEventListener?.('resize', measure);
    return () => globalThis.removeEventListener?.('resize', measure);
  }, [id, reduced]);

  // While the strip shows, the chrome below it moves down (css/components.css .sp-announce) so nothing is covered.
  useDocClass('sp-announce', !!current);

  if (!current) return null;

  const text = current.text;
  // Constant speed: the pass takes as long as the text needs at ANNOUNCE_SEC_PER_CHAR, floored so a short line is not a
  // blur. `--announce-dur` drives the CSS animation, which loops while the server keeps this line current.
  const seconds = Math.max(6, Math.round(text.length * ANNOUNCE_SEC_PER_CHAR * 10) / 10);

  return html`<div class=${`announce-bar${reduced ? ' is-static' : ''}`} role="status" aria-live="polite">
    <span class="announce-bar__tag">${t('公告')}</span>
    <div class="announce-bar__view">
      <div class="announce-bar__track" ref=${trackRef} style=${`--announce-dur:${seconds}s`} key=${current.id}>
        <span class="announce-bar__text">${text}</span>
      </div>
    </div>
    <button type="button" class="announce-bar__close" aria-label=${t('关闭')} title=${t('关闭')}
      onClick=${() => dismissAnnouncement()}><${Icon} name="close" /></button>
  </div>`;
}
