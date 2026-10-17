// 玩法说明 (How to play): viewer for the 19 official tutorial pages of the mode: guide/autochess_{home 1–9, shop 1–6,
// handbook 1–4} from the local-client art (DESIGN §13: data/local-assets.json) when it is there, else the copies setup
// downloads from the public mirror (data/assets.json → ui['guide/<key>']; GitHub issue #42) — data.js artUrls; a page
// whose picture fails to load tries its next URL. The pages are stored squashed to 1024² (both copies) and are
// displayed stretched back to 16:9. Three chapters (基础规则 / 调度手册 / 进阶图鉴), ‹ › buttons, ←/→ (A/D) keys, page
// dots, thumbnails; Esc or the backdrop closes. Only the next page is preloaded (a page is 0.9–1.5 MB; the one before
// has usually just been seen, so preloading it too doubled the download — host bandwidth, layer 0).
// With no page listed the viewer shows the official loading-screen tips (config.tips) instead, and so does a page none
// of whose copies loads (`guideStage`: data/assets.json lists the downloaded pages but the files are not on disk — a
// `git pull` and restart without setup, an older asset folder, a failed download the shrink guard kept); the chapter
// tabs, the page dots and the keys still reach the other pages.
//
// The FOURTH tab is not an official page at all: 协议源石图鉴 (DESIGN §29, owner's request 2026-10-12) is the
// 协议源石 roster of data/hextech.json, grouped by rarity and split into the player and the enemy side. Its chapter
// carries NO `pages` — the 19 official pages above stay exactly 19 (test/ui/localArt.test.js counts them and compares
// them with tools/assets/plan.mjs GUIDE_PAGES, which is the DOWNLOAD list), and the tab switches the viewer to a
// scrolled card grid built from the draft's own HexCard (ui/hexOverlay.js), so the codex reads as the same 协议源石
// surface as the 三选一. The page dots and the `i / n` count belong to the official pages and are hidden there.
//
// Global & imperative so every screen can open it: `openGuide(page?)`; <GuideHost/> is mounted once by main.js
// (and by the dev mock harness); <GuideButton/> is the standard trigger (title, lobby, room, in-match menu).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel, Button, Spinner } from './components.js';
import { HexCard, rarityTierArt } from './hexOverlay.js';
import { createStore, useStore } from '../store.js';
import { data, useData, artUrls, nextArtUrl } from '../data.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Page catalogue in reading order (titles transcribed from the pages). */
export const GUIDE_CODEX_NAME = N_('协议源石图鉴');
export const GUIDE_CHAPTERS = [
  { id: 'home', name: N_('基础规则'), micro: 'BASICS', pages: [
    ['autochess_home_1', N_('卫戍协议已运行')], ['autochess_home_2', N_('攻防战')], ['autochess_home_3', N_('休整期 · 区域')],
    ['autochess_home_4', N_('休整期 · 资金与调度')], ['autochess_home_5', N_('机变阶段')], ['autochess_home_6', N_('限时战斗')],
    ['autochess_home_7', N_('作战期')], ['autochess_home_8', N_('协同战斗')], ['autochess_home_9', N_('盟约')],
  ] },
  { id: 'shop', name: N_('调度手册'), micro: 'HANDBOOK', pages: [
    ['autochess_shop_1', N_('调度手册')], ['autochess_shop_2', N_('干员晋级')], ['autochess_shop_3', N_('加成情况')],
    ['autochess_shop_4', N_('卫戍能力')], ['autochess_shop_5', N_('盟约')], ['autochess_shop_6', N_('助战及自选编队')],
  ] },
  { id: 'handbook', name: N_('进阶图鉴'), micro: 'ADVANCED', pages: [
    ['autochess_handbook_1', N_('敌人类型')], ['autochess_handbook_2', N_('盟约激活与叠加')], ['autochess_handbook_3', N_('追加盟约')],
    ['autochess_handbook_4', N_('策略与轮选')],
  ] },
  // The 4th tab: NO pages (the roster is data, ui/hexOverlay.js HexCard draws it) — see the header.
  { id: 'codex', name: GUIDE_CODEX_NAME, micro: 'PROTOCOL', pages: [] },
];

/** The id of the data tab (no official page behind it). */
export const GUIDE_CODEX_ID = 'codex';

/**
 * Flat page list with URLs (only pages the local-art manifest or the asset manifest lists): `urls` best first (the
 * local file, then the mirror copy), `url` the first of them.
 * @returns {Array<{ key: string, title: string, chapter: number, url: string, urls: string[] }>}
 */
export function guidePages() {
  const out = [];
  GUIDE_CHAPTERS.forEach((ch, ci) => {
    for (const [key, title] of ch.pages) {
      const urls = artUrls('guide', key);
      if (urls.length) out.push({ key, title, chapter: ci, url: urls[0], urls });
    }
  });
  return out;
}

/**
 * What the viewer's stage shows for a page: `{ kind: 'image', src }` — the first of its URLs that has not failed to
 * load (the local file, then the downloaded copy) — or `{ kind: 'tips' }`, the official tips text, when none is left
 * (no page, or every copy failed to load).
 * @param {{ urls?: string[] }|null|undefined} page an entry of guidePages()
 * @param {Set<string>} [failed] URLs whose image fired an error
 * @returns {{ kind: 'image', src: string } | { kind: 'tips' }}
 */
export function guideStage(page, failed) {
  const src = page ? nextArtUrl(page.urls, failed) : null;
  return src ? { kind: 'image', src } : { kind: 'tips' };
}

/**
 * The 协议源石 codex (the 4th tab) as DATA, so a Node test can pin it without a DOM: both sides, the player's first,
 * each split by rarity in tier order (`rarities[].tier`, data/hextech.json). The two tables are OBJECTS keyed by id
 * (`playerHexes` / `enemyHexes`), so they are read with Object.values — never iterated. A missing or malformed roster
 * yields `[]` and the viewer falls back to its empty notice, like guidePages() on a server with no art manifest.
 * @returns {Array<{ id: 'player'|'enemy', label: string, groups: Array<{ rarity: string, name: string, cards: any[] }> }>}
 */
export function codexSides() {
  const roster = data.get('hextech');
  if (!roster || typeof roster !== 'object') return [];
  const rarities = (Array.isArray(roster.rarities) ? roster.rarities : [])
    .filter((r) => r && typeof r.id === 'string')
    .slice()
    .sort((a, b) => (Number(a.tier) || 0) - (Number(b.tier) || 0));
  const side = (id, label, table) => {
    const cards = Object.values(table && typeof table === 'object' ? table : {})
      .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string');
    if (!cards.length) return null;
    const groups = rarities
      .map((r) => ({ rarity: r.id, name: r.name || '', cards: cards.filter((c) => c.rarity === r.id) }))
      .filter((g) => g.cards.length);
    // a card whose rarity no longer has a record still shows, in its own group at the end (a hand-edited roster)
    const known = new Set(groups.map((g) => g.rarity));
    for (const c of cards) {
      const key = c.rarity || '';
      if (known.has(key)) continue;
      known.add(key);
      groups.push({ rarity: key, name: '', cards: [c] });
    }
    return { id, label, groups };
  };
  return [
    side('player', N_('我方协议源石'), roster.playerHexes),
    side('enemy', N_('敌方协议源石'), roster.enemyHexes),
  ].filter(Boolean);
}

/**
 * The one page the viewer preloads while page `i` is shown: the next one (wrapping around), its first URL that has not
 * failed — null without pages. The previous page is not preloaded (see the header).
 * @param {Array<{ urls?: string[] }>} pages guidePages()
 * @param {number} i
 * @param {Set<string>} [failed]
 */
export function guidePreloadUrl(pages, i, failed) {
  const n = Array.isArray(pages) ? pages.length : 0;
  if (!n || n < 2) return null;
  return nextArtUrl(pages[(((i + 1) % n) + n) % n]?.urls, failed);
}

/** Open/closed + current page. `codex` swaps the stage for the 协议源石图鉴 tab (the official pages stay untouched). */
export const guideStore = createStore({ open: false, page: 0, codex: false });

/** Open the viewer at an official page (the codex tab is never what a fresh open lands on). */
export function openGuide(page = 0) {
  data.load('local');
  data.load('assets');
  data.load('config');
  data.load('hextech');
  guideStore.set({ open: true, page: Math.max(0, page | 0), codex: false });
}
/** Switch the open viewer to the 协议源石图鉴 tab. */
export const openCodex = () => { data.load('hextech'); guideStore.set({ open: true, codex: true }); };
export const closeGuide = () => guideStore.set({ open: false });

/** Standard 玩法说明 trigger button. */
export function GuideButton({ class: cls, size = 'sm', variant = 'ghost', label = t('玩法说明'), square = false }) {
  return html`<${Button} variant=${variant} size=${size} icon="book" square=${square} class=${cx('guide-btn', cls)}
    onClick=${() => openGuide(0)} title=${t('玩法说明')} aria-label=${t('玩法说明')}>${square ? null : label}<//>`;
}

function preload(url) {
  if (!url || typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.crossOrigin = 'anonymous';
  img.src = url;
}

/** Fallback body when no tutorial page can be shown: the official tips as a numbered list. */
function TipsFallback() {
  const tips = (Array.isArray(data.get('config')?.tips) ? data.get('config').tips : []).map((t) => t?.tip).filter(Boolean);
  return html`<div class="guide__tips">
    <${MicroLabel} tone="mint">${t('TIPS // 模拟要点')}</${MicroLabel}>
    <ol>${tips.map((t, i) => html`<li key=${i}>${t}</li>`)}</ol>
    ${!tips.length ? html`<p class="t-lo">${t('暂无说明内容')}</p>` : null}
  </div>`;
}

/**
 * The 协议源石图鉴 body: both sides, each split by rarity, every card drawn by the draft's own HexCard.
 *
 * The section head is an index (01 / 02) + the side's name + the side's card total, the group head is the tier's own
 * 阶位 image (a compact badge, `rarityTierArt` — the same crop the draft's chip uses) + its tier + its count, and each
 * card carries its position in `--i` so the whole roster enters as one staggered sweep (guide.css `codex-in`).
 */
function CodexStage({ sides }) {
  if (!sides.length) return html`<div class="guide__stage guide__stage--text"><p class="guide__empty t-lo">${t('暂无内容')}</p></div>`;
  let seen = 0; // the stagger index walks the WHOLE roster, so the entrance reads as a single sweep down the tab
  return html`<div class="guide__stage guide__codex">
    <div class="guide__codexbox">
      ${sides.map((side, si) => {
        const total = side.groups.reduce((n, g) => n + g.cards.length, 0);
        return html`<section key=${side.id} class=${cx('guide__side', `guide__side--${side.id}`)}>
          <header class="guide__sidehead">
            <span class="guide__sideidx num" aria-hidden="true">${String(si + 1).padStart(2, '0')}</span>
            <h3 class="guide__sidetitle">${t(side.label)}</h3>
            <span class="guide__sidecount num">${total}</span>
          </header>
          ${side.id === 'enemy' ? html`<p class="guide__sidenote">${t('敌方协议源石全局生效，已拥有的不能重复添加。')}</p>` : null}
          ${side.groups.map((g) => {
            const art = rarityTierArt(g.rarity);
            const from = seen;
            seen += g.cards.length;
            return html`<div key=${g.rarity} class="guide__group" data-rarity=${g.rarity}>
              <div class="guide__grouphead">
                ${art ? html`<span class="guide__groupnum" aria-hidden="true" style=${`background-image:url("${art}")`}></span>` : null}
                <span class="guide__grouptier">${t(g.name)}</span>
                <span class="guide__groupline" aria-hidden="true"></span>
                <span class="guide__groupcount num">${g.cards.length}</span>
              </div>
              <div class="guide__grid">
                ${g.cards.map((c, i) => html`<div key=${c.id} class="guide__card" style=${`--i:${from + i}`}><${HexCard} hex=${c} /></div>`)}
              </div>
            </div>`;
          })}
        </section>`;
      })}
    </div>
  </div>`;
}

/** The viewer (mounted once near the root). */
export function GuideHost() {
  const { open, page, codex } = useStore((s) => s, Object.is, guideStore);
  const ready = useData('local', 'assets', 'config');
  const pages = useMemo(() => (ready ? guidePages() : []), [ready]);
  const [loaded, setLoaded] = useState(() => new Set());
  const [failed, setFailed] = useState(() => new Set());
  // The roster is fetched only once the codex tab is opened (data/hextech.json is otherwise loaded by the match itself,
  // not by the title screen); the subscription re-renders when it settles, so the grid cannot stay on the empty notice.
  const [, bumpRoster] = useState(0);
  useEffect(() => {
    if (!open || !codex) return undefined;
    const unsub = data.subscribe((n) => { if (n === 'hextech') bumpRoster((v) => v + 1); });
    data.load('hextech');
    return unsub;
  }, [open, codex]);
  const boxRef = useRef(null);
  const n = pages.length;
  const i = n ? Math.min(Math.max(0, page), n - 1) : 0;
  const cur = pages[i] || null;
  const go = (k) => { if (n) guideStore.set({ open: true, codex: false, page: ((k % n) + n) % n }); };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      let handled = true;
      if (k === 'Escape') closeGuide();
      else if (guideStore.get().codex) handled = (!!k && k.length === 1) || k === ' '; // the codex scrolls, it does not page
      else if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'PageDown') go(guideStore.get().page + 1);
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'PageUp') go(guideStore.get().page - 1);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(n - 1);
      else handled = (!!k && k.length === 1) || k === ' '; // swallow game shortcuts (R/F/D/Space) while open
      if (handled) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    const t = setTimeout(() => boxRef.current?.focus?.(), 30);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(t); };
  }, [open, n]);

  useEffect(() => {
    if (!open || !n) return;
    preload(guidePreloadUrl(pages, i, failed));
  }, [open, i, n, failed]);

  if (!open) return null;
  const sides = codex ? codexSides() : [];
  const chapter = cur ? GUIDE_CHAPTERS[cur.chapter] : null;
  const firstOf = (ci) => pages.findIndex((p) => p.chapter === ci);
  const stage = guideStage(cur, failed); // the next copy when one fails to load; the tips when none is left
  const src = stage.kind === 'image' ? stage.src : null;
  const isLoaded = !!src && loaded.has(src);
  return html`<div class="guide" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) closeGuide(); }}>
    <div class="guide__box brackets" role="dialog" aria-modal="true" aria-label=${t('玩法说明')} tabindex="-1" ref=${boxRef}>
      <header class="guide__head">
        <div class="guide__titles">
          <${MicroLabel} tone="mint">HOW TO PLAY // STRONGHOLD PROTOCOL</${MicroLabel}>
          <h2 class="guide__title">${t('玩法说明')}</h2>
        </div>
        <nav class="guide__chapters" aria-label=${t('章节')}>
          ${GUIDE_CHAPTERS.map((ch, ci) => {
            const isCodex = ch.id === GUIDE_CODEX_ID;
            const at = isCodex ? -1 : firstOf(ci);
            // The codex tab is reachable even with no official page on disk (a server without the art): it needs only
            // data/hextech.json. Every other chapter still vanishes when the manifests list none of its pages.
            if (at < 0 && !isCodex) return null;
            const on = isCodex ? codex : (!codex && cur?.chapter === ci);
            return html`<button key=${ch.id} type="button" class=${cx('guide__chapter', on && 'is-on')} onClick=${() => (isCodex ? openCodex() : go(at))}>
              <span class="guide__chname">${t(ch.name)}</span><span class="guide__chmicro">${ch.micro}</span>
            </button>`;
          })}
        </nav>
        <button type="button" class="guide__close" aria-label=${t('关闭')} title=${t('关闭 (Esc)')} onClick=${closeGuide}><${Icon} name="close" /></button>
      </header>

      ${codex ? html`<${CodexStage} sides=${sides} />` : src ? html`<div class="guide__stage">
        <button type="button" class="guide__nav guide__prev" aria-label=${t('上一页')} onClick=${() => go(i - 1)}><${Icon} name="chevronLeft" /></button>
        <div class=${cx('guide__page', isLoaded && 'is-loaded')}>
          <img key=${src} src=${src} alt=${t(cur.title)} draggable=${false}
            onLoad=${() => setLoaded((s) => new Set(s).add(src))}
            onError=${() => setFailed((s) => new Set(s).add(src))} />
          ${!isLoaded ? html`<span class="guide__loading"><${Spinner} size="md" /></span>` : null}
        </div>
        <button type="button" class="guide__nav guide__next" aria-label=${t('下一页')} onClick=${() => go(i + 1)}><${Icon} name="chevronRight" /></button>
      </div>` : html`<div class="guide__stage guide__stage--text"><${TipsFallback} /></div>`}

      ${codex ? null : n ? html`<footer class="guide__foot">
        <div class="guide__label">
          <span class="guide__chtag">${t(chapter?.name || '')}</span>
          <b class="guide__ptitle">${t(cur?.title || '')}</b>
        </div>
        <div class="guide__dots" role="tablist" aria-label=${t('页码')}>
          ${pages.map((p, k) => html`<button key=${p.key} type="button" role="tab" aria-selected=${k === i ? 'true' : 'false'} title=${t(p.title)}
            class=${cx('guide__dot', k === i && 'is-on', k > 0 && pages[k - 1].chapter !== p.chapter && 'is-first')} onClick=${() => go(k)}></button>`)}
        </div>
        <span class="guide__count num">${i + 1} / ${n}</span>
      </footer>` : null}
    </div>
  </div>`;
}
