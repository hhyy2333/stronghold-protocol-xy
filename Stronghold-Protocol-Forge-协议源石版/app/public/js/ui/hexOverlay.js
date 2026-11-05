// ui/hexOverlay.js — 协议源石 (Protocol Originium) draft overlay (DESIGN §29).
//
// (Named 海克斯 until 2026-10-08: display-only rename, the internal `hex` / `hextech` keys stay.)
//
// A parallel draft: m.public.hex.offers[myPlayerId] holds the three cards offered to the local player, everyone picks at
// the same time and each player has one reroll. The screen shares the official draft shell of the 机变 phase
// (ui/choiceOverlay.js): the `.spov` veil / inner / header / three-card grid, the same two-tap gesture (tap = arm, tap
// again or 确认选择 = pick), the busy strip and the 决策 header line — the two drafts read as one game. A card's FACE is
// the tier's 阶位 art (`hextech/tier/<tier>.png`, the user-supplied dot-matrix 1 / 2 / 3, tools/hextech-tier-import.mjs)
// with the bold name, the tier and the effect text over it; without that local art the card draws its own plate with the
// name's first character. The third-party mod's rune plate and rarity frames used as that fallback were removed on
// 2026-10-12 (tools/hextech-import.mjs header).
//
// The enemy side's accumulated cards (m.public.enemyHexes, one per draw round, persisting to the end of the match) are on
// show where the player decides and everywhere else it matters: the top bar's compact strip (ui/hud.js TopBar), this
// overlay's footer and the 敌方情报 tab (ui/enemyDrawer.js). What the enemy is bringing is never a surprise.
//
// The player's OWN accumulated cards get the same strip in this overlay's footer, right beside the enemy's (业主
// 2026-11-04「加一个在选择协议源石时，可以查看自己已有的协议源石」): a pick is then made knowing what the player already
// holds, instead of having to remember it (or leave the overlay to read the 效果栏).
//
// Art: the two sound cues are unpacked from HextechRunes.pck into public/assets/local/hextech/audio/** and listed in
// data/local-assets.json by tools/hextech-import.mjs (its rune icons, rarity frames and button sprites were removed on
// 2026-10-12); the three 阶位 card images are the user's own and go in through tools/hextech-tier-import.mjs (the
// local-client manifest, DESIGN §13). Without them the card draws its own plate with the name's first character. The
// reroll control is NOT the mod's own button sprite: it is the game's own 刷新 button (ui/shopBar.js
// `toolbtn toolbtn--amber`: the official shopPanel/refresh_icon sprite + the label + a badge, here the remaining
// rerolls) so the draft reads as one game.

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, Countdown, MicroLabel, HexBadge, Tooltip } from './components.js';
import { t, N_ } from '../../../shared/i18n.js';
import { PHASE } from '../../../shared/constants.js';
// 第 6 回合「点卡刷新」的每局张数（业主口径：2 次）。只读：那一份是服务端初始化 `PlayerState.hexRecycleLeft` 的同一个
// 常量，客户端拿它做「剩 n 次」的兜底初值与那颗菱形指示的格数。
import { HEX_RECYCLE_BUDGET } from '../../../shared/hextech.js';
import { data, localAsset } from '../data.js';
import { Img } from './gameComponents.js';
import { uiUrl } from './assetUrls.js';
import { normalizeEnemyHexes } from './gameLogic/draft.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
/**
 * 确认选择时的「吸入屏幕中心」动画时长（owner 2026-10-18）。这一小段时间**之后**才真正发 `g.pickHex`：
 * 动画放完再走网络，避免服务器回包把卡牌提前换掉、动画只播一个开头。520ms 对人眼是「一瞬」，对网络可忽略。
 */
const CONFIRM_ANIM_MS = 620;
/** 确认时覆盖在卡面上的乱码/数据流（纯装饰，不进 i18n；aria-hidden）。 */
const GLITCH_STREAM = '0x4C 0x7F 0x91 0xA2\n1101 0110 1001 1110\n0xF3 0x0A 0x5C 0xD8\n0000 1111 0101 1010';
/** The tier label a rarity shows when the roster record is missing (the data's `rarities[].name` is the real source). */
const RARITY_FALLBACK = { silver: N_('1阶'), gold: N_('2阶'), prismatic: N_('3阶') };
/** The rarity a hex falls back to when the record names none (the CSS keys `.hxcard--<rarity>`). */
const RARITY_DEFAULT = 'silver';

/** The rarity record of data/hextech.json (`{ id, name, weight, tier }`), or null. */
function rarityRecord(rarity) {
  const list = data.get('hextech')?.rarities;
  return Array.isArray(list) ? list.find((r) => r && r.id === rarity) || null : null;
}

/** The rarity's display name from data/hextech.json, else the built-in label. */
export function rarityName(rarity) {
  return rarityRecord(rarity)?.name || RARITY_FALLBACK[rarity] || '';
}

/**
 * URL of the rarity's 阶位 card art (local art `hextech/tier/<tier>.png`, tools/hextech-tier-import.mjs), or null
 * without the manifest. This is the card's FACE since 2026-10-08: the user-supplied dot-matrix 1 / 2 / 3 that the owner
 * chose to carry the tier. The tier comes from the rarity record (`rarities[].tier` in data/hextech.json), so a
 * re-mapped rarity needs no client change.
 * @param {string} rarity 'silver'|'gold'|'prismatic'
 * @returns {string|null}
 */
export function rarityTierArt(rarity) {
  const tier = rarityRecord(rarity)?.tier;
  return Number.isInteger(tier) && tier > 0 ? localAsset('hextech/tier', String(tier)) : null;
}

/**
 * The pixel aspect ratio (w / h) of a rarity's 阶位 art from data/local-assets.json, or null. The supplied images are
 * LANDSCAPE (~1.25) and their numeral fills most of the frame, so the card takes their own ratio and draws the art
 * `cover` — matching ratios mean nothing is cropped (a fixed portrait card would cut the numeral in half).
 * @param {string} rarity
 * @returns {number|null}
 */
export function rarityTierAspect(rarity) {
  const tier = rarityRecord(rarity)?.tier;
  if (!Number.isInteger(tier) || tier <= 0) return null;
  const e = data.get('local')?.groups?.['hextech/tier']?.[String(tier)];
  const w = e?.w;
  const h = e?.h;
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : null;
}

/** The tier number of a rarity from the roster (null without the record). */
export function rarityTier(rarity) {
  const tier = rarityRecord(rarity)?.tier;
  return Number.isInteger(tier) && tier > 0 ? tier : null;
}

/** URL of an official hextech cue (`hextech/audio`: selectGold / reroll), or null without the manifest. */
export function hexSfxUrl(name) {
  return localAsset('hextech/audio', name);
}

/** The official shop-refresh sprite the game's own 刷新 button uses (`shopPanel/refresh_icon`), or null. */
export function refreshIconUrl() {
  return uiUrl(data.get('assets'), 'shopPanel/refresh_icon');
}

/**
 * Whether a pointerdown keeps the armed selection: presses on a card, the reroll button or the confirm button do. The
 * confirm button MUST be in here — its own pointerdown would otherwise disarm it and unmount it before the click lands
 * (user report: 「选择海克斯后点击确认无效，必须双击海克斯才有效」). Anything else drops the selection.
 * @param {any} target the event target (an Element, or nothing)
 * @returns {boolean}
 */
export function keepsArmed(target) {
  return !!(target && typeof target.closest === 'function' && target.closest('.hxcard, .hxov__reroll, .spov__confirm'));
}

/** One 协议源石 card: the tier's 阶位 art as its face, name / tier and effect text on top. */
export function HexCard({ hex, armed = false, picked = false, faded = false, busy = false, compact = false, vanishing = false, vanishDir = 0, onClick = null, onReroll = null, rerollTitle = null }) {
  const rarity = hex.rarity || RARITY_DEFAULT;
  // The tier art is the card's face — the FULL card and the compact enemy chip alike. The enemy chips used to keep the
  // mod's rune plate "because a 阶位 numeral is illegible at .36rem"; that left the third-party mod's rune as the last
  // 海克斯-looking art in the game after the rename (user report 2026-10-08). The chip is drawn a little wider now and
  // the numeral is centred and large inside the art, so the tier reads at chip size; without the local art the card
  // falls back to a drawn plate carrying the name's first character.
  const useTier = !!rarityTierArt(rarity);
  const tierArt = useTier ? rarityTierArt(rarity) : null;
  const cls = cx('hxcard', `hxcard--${rarity}`, compact && 'hxcard--compact', useTier && 'has-tier',
    armed && 'is-armed', picked && 'is-picked', faded && 'is-faded', busy && 'is-busy', onClick && 'is-tappable',
    vanishing && `is-vanishing is-vanish-${vanishDir}`);
  // The card's face is the tier art; the plate is the drawn fallback only (no local art / no tier). The third-party rune
  // image that used to fill it was removed on 2026-10-12 (tools/hextech-import.mjs header).
  const plate = html`<span class="hxcard__plate">
      <span class="hxcard__glyph">${String(hex.name || '?').slice(0, 1)}</span>
    </span>`;
  // a compact chip with the tier art has no body: the art IS the chip (its tooltip carries the name and the effect)
  const body = compact ? (useTier ? null : plate) : html`<span class="hxcard__head">${plate}
      <span class="hxcard__title">
        <b class="hxcard__name">${t(hex.name)}</b>
        <span class="hxcard__rarity">${t(rarityName(rarity))}</span>
      </span>
    </span>
    <span class="hxcard__desc">${t(hex.desc)}</span>`;
  const tip = `${t(hex.name)} · ${t(hex.desc)}`;
  // the card takes the tier art's own aspect ratio (--hx-tier-ar) and draws it `cover`: with matching ratios nothing of
  // the numeral is cropped. Without a ratio from the manifest the CSS keeps the portrait default.
  const ar = useTier ? rarityTierAspect(rarity) : null;
  const style = tierArt ? `--hx-tier:url("${tierArt}")${ar ? `;--hx-tier-ar:${ar}` : ''}` : null;
  // A display-only COMPACT card is the enemy 协议源石 chip: it prints no text of its own (the 阶位 art IS the chip), so
  // its description has to come from somewhere. It must NOT be a native `title`: touch browsers never show one, which
  // left the enemy's cards unreadable on a phone (user report 2026-10-11: 「手机上…不知道怎么看敌人选的词条」). The row
  // that owns the chip carries the app Tooltip instead (EnemyHexRow / the draft footer), which a long press reaches
  // (components.js TOUCH_TIP_MS). A full card prints its name and effect itself, so it keeps the native title.
  // 视觉重制 (owner 2026-10-18): 磨砂玻璃底板 + 发光倒角 —— 倒角是一层独立的边（compact 小卡不画，省像素）
  // 选中瞬间的点阵「由中心向外亮起」：一层高亮的阶位图 + 圆形裁切动画（只在 has-tier 的整卡上）。
  const dotwave = !compact && useTier ? html`<span class="hxcard__dotwave" aria-hidden="true"></span>` : null;
  const dotring = !compact && useTier ? html`<span class="hxcard__dotring" aria-hidden="true"></span>` : null;
  // 确认时把卡面盖成数据流（纯装饰；卡牌本身同时在 CSS 里被吸向屏幕中心）
  const glitch = compact ? null : html`<span class="hxcard__glitch" aria-hidden="true">${GLITCH_STREAM}</span>`;
  const bevel = compact ? null : html`<span class="hxcard__bevel" aria-hidden="true"></span>`;
  if (!onClick) return html`<span class=${cls} style=${style} title=${compact ? null : tip} data-hex=${hex.id || ''}>${bevel}${dotwave}${dotring}${glitch}${body}</span>`;
  // 分别刷新 (业主 2026-10-20「把刷新按钮改成分别刷新每个」): a card can carry its own reroll control. It is a SIBLING of the
  // card button, not a child — a <button> inside a <button> is invalid HTML and the inner click would also arm/pick the
  // card. The wrapper is what tilts/hovers; the card keeps its own gestures untouched.
  const card = html`<button type="button" class=${cls} style=${style} title=${tip} data-hex=${hex.id || ''} disabled=${busy} onClick=${onClick}
      data-testid=${`hex-card-${hex.idx}`}>
    <span class="hxcard__glow" aria-hidden="true"></span>${bevel}${dotwave}${dotring}${glitch}${body}
    ${armed ? html`<span class="hxcard__confirm" role="status"><b>${t('确认选择')}</b><small>${t('再次点击')}</small></span>` : null}
    ${busy ? html`<span class="hxcard__busy" role="status">${t('选择中')}</span>` : null}
  </button>`;
  if (!onReroll) return card;
  return html`<span class="hxcard-slot">${card}
    <button type="button" class="hxcard__reroll" data-testid=${`hex-reroll-${hex.idx}`} title=${rerollTitle || t('只刷新这一张')}
      aria-label=${rerollTitle || t('只刷新这一张')} onClick=${(e) => { e.stopPropagation(); onReroll(); }}>
      <${Icon} name="refresh" />
    </button>
  </span>`;
}

/**
 * One strip of accumulated 协议源石 as compact cards, with every card's name and effect as a tooltip over the row.
 * An optional `label` turns it into the labeled strip the top bar and the 敌方情报 tab use; without one it is the bare
 * chip row. `testid` names the side, so a test (and an E2E shot) can tell the player's own row from the enemy's.
 *
 * Shared by BOTH sides of the draft (业主 2026-11-04「加一个在选择协议源石时，可以查看自己已有的协议源石」): the enemy row
 * below and the own row (`OwnHexRow`) that the draft's footer shows next to it, so the two read the same and a phone
 * gets the same tap-to-read behaviour on both.
 *
 * The name and effect of every card live in the app's own Tooltip over the WHOLE row, not in a native `title` on it: a
 * native title is never shown on a touch screen, so a phone player had no way to read the enemy's cards at all (user
 * report 2026-10-11). The row asks for `tapShow`, so on touch a plain TAP opens it (and a second tap closes it) rather
 * than the default long press — the chips have no tap action of their own, and a tap is what a player tries first. The
 * row is the target rather than the single chip because a chip is only .3rem across with a .05rem gap — a 44 px per-chip
 * hit area would overlap its neighbours and show the wrong card.
 * @param {{ list: any[], label?: string|null, class?: string, testid?: string }} props
 */
export function HexStripRow({ list, label = null, class: cls = '', testid = 'hex-strip' }) {
  const hexes = normalizeEnemyHexes(list);
  if (!hexes.length) return null;
  const tip = hexes.map((h) => `${t(h.name)} · ${t(h.desc)}`).join('\n');
  return html`<${Tooltip} text=${tip} placement="bottom" class="hxstrip-anchor" tapShow=${true}>
    <span class=${cx('hxstrip', cls)} data-testid=${testid} role="button" tabindex="0" aria-label=${tip.replace(/\n/g, '；')}>
      ${label ? html`<span class="hxstrip__label">${t(label)}</span>` : null}
      <span class="hxstrip__row">${hexes.map((h) => html`<${HexCard} key=${`${h.id}:${h.idx ?? ''}`} hex=${h} compact=${true} />`)}</span>
    </span>
  <//>`;
}

/**
 * The enemy side's accumulated 协议源石 (m.public.enemyHexes): compact cards with a tooltip each. An optional `label` turns
 * it into the labeled strip the top bar and the 敌方情报 tab use; without one it is the bare chip row.
 * @param {{ list: any[], label?: string|null, class?: string }} props
 */
export function EnemyHexRow({ list, label = null, class: cls = '' }) {
  return HexStripRow({ list, label, class: cls, testid: 'enemy-hex-strip' });
}

/**
 * The player's OWN accumulated 协议源石, as the draft footer shows them (业主 2026-11-04「加一个在选择协议源石时，可以查看
 * 自己已有的协议源石」): the same labeled strip as the enemy row, one side over.
 *
 * `list` is the shape `recycleCardsOf(ownHexIds(pub, myId), data.get('hextech')?.playerHexes)` gives — `{ id, idx,
 * name, desc, rarity }` per owned card, 1:1 with the player's own refs (so two copies of one card are two chips, 业主
 * 2026-11-02「相同的海克斯，在刷新回合会被当成一个海克斯」). The idx keeps those two chips apart as vnode keys.
 * @param {{ list: any[], label?: string|null, class?: string }} props
 */
export function OwnHexRow({ list, label = null, class: cls = '' }) {
  return HexStripRow({ list, label, class: cls, testid: 'own-hex-strip' });
}

/**
 * The labeled enemy-card strip (nothing without cards): the top bar's always-visible row and the 敌方情报 tab's row.
 * @param {{ list: any[], label?: string, class?: string }} props
 */
export function EnemyHexStrip({ list, label = N_('敌方协议源石'), class: cls = '' }) {
  return EnemyHexRow({ list, label, class: cx('hxstrip--labeled', cls) });
}

/**
 * The enemy's accumulated 协议源石 as a READABLE list (name + tier + effect text), for the 敌方情报 tab: the chips of
 * EnemyHexRow only carry their art, so their meaning is reachable through a tooltip — hover on a desktop, a long press on
 * a phone (user report 2026-10-11: 「手机上…不知道怎么看敌人选的词条」). Here the words are simply printed, which is what
 * the tab is for: it is the place a player goes to read what the enemy is bringing, on any device.
 * @param {{ list: any[], label?: string|null, class?: string }} props
 */
export function EnemyHexList({ list, label = null, class: cls = '' }) {
  const hexes = normalizeEnemyHexes(list);
  if (!hexes.length) return null;
  return html`<div class=${cx('hxlist', cls)} data-testid="enemy-hex-list">
    ${label ? html`<span class="hxlist__label">${t(label)}</span>` : null}
    <ul class="hxlist__rows">
      ${hexes.map((h) => html`<li key=${h.id} class="hxlist__row" data-hex=${h.id || ''}>
        <${HexCard} hex=${h} compact=${true} />
        <span class="hxlist__text">
          <b class="hxlist__name">${t(h.name)}</b>
          <span class="hxlist__desc">${t(h.desc)}</span>
        </span>
        <span class=${`hxlist__tier hxlist__tier--${h.rarity || RARITY_DEFAULT}`}>${t(rarityName(h.rarity || RARITY_DEFAULT))}</span>
      </li>`)}
    </ul>
  </div>`;
}

/**
 * The draft's footer: the player's OWN accumulated 协议源石 on the left (业主 2026-11-04「加一个在选择协议源石时，可以查看
 * 自己已有的协议源石」), the enemy's on the right, and the rule line. Presentational only (no hooks), so a Node test can
 * render it as a plain function — the overlay itself cannot be called without a hook context.
 *
 * Both sides print a count instead of chips while that side owns nothing: the very first draft of a match owns none
 * yet, and a bare 0 says so more honestly than an empty row. `own` is `recycleCardsOf(ownHexIds(pub, myId), …)` (see
 * OwnHexRow); `enemy` is m.public.enemyHexes.
 * @param {{ own?: any[], enemy?: any[] }} props
 */
export function HexOverlayFooter({ own = [], enemy = [] }) {
  const ownHexes = normalizeEnemyHexes(own);
  const enemyHexes = normalizeEnemyHexes(enemy);
  return html`<footer class="hxov__foot">
    <span class="hxov__own" data-testid="hex-own">
      <${MicroLabel} tone="gold">${t('我方协议源石')}</${MicroLabel}>
      ${ownHexes.length
        ? html`<${OwnHexRow} list=${ownHexes} class="hxov__ownrow" />`
        : html`<b class="hxov__num num">0</b>`}
    </span>
    <span class="hxov__enemy">
      <${MicroLabel} tone="gold">${t('敌方协议源石')}</${MicroLabel}>
      ${enemyHexes.length
        // the shared row, so the footer's chips are long-pressable on a phone exactly like the top bar's (EnemyHexRow)
        ? html`<${EnemyHexRow} list=${enemyHexes} class="hxov__enemyrow" />`
        : html`<b class="hxov__num num">0</b>`}
    </span>
    <span class="hxov__hint">${t('敌人会获得同阶位的协议源石')}</span>
  </footer>`;
}

/**
 * The draft overlay.
 * @param {{ hex: any, enemy?: any[], own?: any[], busyIdx?: number|null, onPick: (idx: number) => void,
 *   onReroll: (idx?: number) => void }} props
 *   hex: ui/gameLogic/draft.js normalizeHex(m.public.hex, myId, players); enemy: m.public.enemyHexes; own: the player's
 *   already-owned cards (recycleCardsOf(ownHexIds(pub, myId), data.get('hextech')?.playerHexes)) — the footer shows them
 *   next to the enemy's, so the pick is made knowing what the player already has (业主 2026-11-04).
 *   `onReroll(idx)` replaces that ONE card (业主 2026-10-20「把刷新按钮改成分别刷新每个」); without an index it replaces the
 *   whole batch (the header button). Both cost the same one reroll.
 */
/**
 * Which reroll controls are live right now — the ONE place that decision is made, so the component and its test
 * cannot disagree.
 *
 * 业主 2026-10-20「为什么刷新一个其他的都没了」: the in-flight lock used to gate every card. A single-slot reroll only
 * touches the card it refreshes, so only that card goes away while it is in flight; the whole-batch button waits for
 * ANY reroll (it would replace all three), and every card waits while the batch one runs.
 * @param {{ myPick?: number|null, myRerolls?: number, mySlotRerolls?: number[] }} hex
 * @param {number|null} busyIdx `-1` = a whole-batch reroll is in flight, `>= 0` = that card's, null = idle
 * @returns {{ canReroll: boolean, canRerollSlot: (idx: number) => boolean }}
 */
export function hexOverlayRerollGates(hex, busyIdx = null) {
  const h = hex || {};
  const waiting = h.myPick == null;
  const myRerolls = Number(h.myRerolls) || 0;
  const budget = Array.isArray(h.mySlotRerolls) ? h.mySlotRerolls : [];
  const busyAll = busyIdx === -1;
  const busySlot = Number.isInteger(busyIdx) && busyIdx >= 0 ? busyIdx : null;
  return {
    canReroll: waiting && myRerolls > 0 && busyIdx == null,
    canRerollSlot: (idx) => waiting && !busyAll && busySlot !== idx && (budget[idx] || 0) > 0,
  };
}

/**
 * 这一批 offer 的身份（卡 id + 槽位）。管理员 (业主 2026-10-26) 的第二次三选一换的是**另一批**牌，签名因此不同。
 * @param {any[]} offer
 * @returns {string}
 */
export function offerSignature(offer) {
  return (Array.isArray(offer) ? offer : []).map((c) => `${c && c.id != null ? c.id : ''}:${c && c.idx != null ? c.idx : ''}`).join('|');
}

/**
 * 仍在放「吸入屏幕中心」动画的那张卡，或 null。
 *
 * 业主 2026-10-26「策略『管理员』第一回合第二次三选一不给刷新不能选」: the confirm animation state used to be a bare idx.
 * 管理员选完第一张后服务端立刻换一批三张，动画还挂着（620 ms 动画 + 1.5 s 兜底），新一批的卡在这段时间里点不动 ——
 * 玩家看到的就是「不能选」。动画记下它属于哪一批（`key`），批次一换就失效，新卡立刻可点。
 * @param {{ idx: number, key: string }|null} vanishing
 * @param {string} offerKey the CURRENT offer's `offerSignature`
 * @returns {number|null} the vanishing card's idx, or null
 */
export function vanishActive(vanishing, offerKey) {
  return vanishing && vanishing.key === offerKey ? vanishing.idx : null;
}

export function HexOverlay({ hex, enemy = [], own = [], busyIdx = null, onPick, onReroll }) {
  const [armed, setArmed] = useState(null);
  /** 确认动画进行中的卡：{ idx, key } —— key 是这一手所在那一批 offer 的签名（见 vanishActive）。 */
  const [vanishing, setVanishing] = useState(null);
  const vanishTimer = useRef(null);
  const offerKey = offerSignature(hex && hex.myOffer);
  const vanishIdx = vanishActive(vanishing, offerKey);
  useEffect(() => () => { if (vanishTimer.current != null) clearTimeout(vanishTimer.current); }, []);
  // a selection is dropped with Esc, like the 机变 screen (ui/choiceOverlay.js)
  useEffect(() => {
    if (armed == null) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setArmed(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed]);
  // 已选状态回来（服务器确认了这一手）：确认动画的状态必须收掉，卡牌重新按「已选」显示。
  useEffect(() => {
    if (hex && hex.myPick != null && vanishIdx != null) setVanishing(null);
  }, [hex && hex.myPick, vanishIdx]);
  if (!hex || !hex.myOffer.length) return null;
  const picked = hex.myPick;
  const waiting = picked == null;
  // 整批刷新（header 那颗）与单张刷新（每张卡角上）各有各的次数：整批仍是一次/局，单张是**每张卡各一次**
  // （业主 2026-10-20「单个刷新应该3个都能刷一次」）。
  //
  // 业主 2026-10-20「为什么刷新一个其他的都没了」：`busyIdx` 是「有一次刷新在飞」的锁，原来它把**每一张卡**的按
  // 钮都关掉了 —— 按下一张之后、服务端回包之前，三颗按钮会一起消失一下。锁只需要管住**正在刷的那一张**（以及
  // header 那颗整批按钮，因为整批换的是全部三张）：别的卡既没被改、也没理由跟着变灰。
  const { canReroll, canRerollSlot } = hexOverlayRerollGates(hex, busyIdx);
  /**
   * 二段点击（确认，owner 2026-10-18）：先放「卡牌化作数据流吸入屏幕中心 + 轻微震屏」的动画，
   * 动画结束才真正 onPick —— 否则服务器的回包会把卡牌提前换成已选状态，动画只播一个开头。
   */
  const commit = (idx) => {
    if (vanishIdx != null || !waiting || busyIdx != null) return;
    // 最后一秒才点确认：动画会跨过截止时间，服务器可能已经替玩家随机选了。这种情况下直接发请求，
    // 让「按时交卷」优先于演出（动画只在时间还够时播）。
    if (!hex.untimed && Number.isFinite(hex.turnDeadline) && hex.turnDeadline - Date.now() < CONFIRM_ANIM_MS + 300) {
      onPick(idx);
      return;
    }
    setArmed(null);
    setVanishing({ idx, key: offerKey });
    vanishTimer.current = setTimeout(() => {
      onPick(idx);
      // 服务器的回包（hex.myPick）通常几十毫秒就到，effect 会清掉；这一手只是兜底：动画结束后卡牌不能一直隐身。
      vanishTimer.current = setTimeout(() => { vanishTimer.current = null; setVanishing(null); }, 1500);
    }, CONFIRM_ANIM_MS);
  };
  const tap = (card) => {
    if (!waiting || busyIdx != null || vanishIdx != null) return;
    if (armed === card.idx) { commit(card.idx); return; }
    setArmed(card.idx);
  };
  // a press anywhere but a card, the reroll button or the confirm button drops the selection (keepsArmed)
  const onDown = (e) => {
    if (vanishIdx != null || armed == null || keepsArmed(e.target)) return;
    setArmed(null);
  };
  // the game's own 刷新 button (ui/shopBar.js): the official shopPanel/refresh_icon sprite, the label and a badge — here
  // the rerolls left instead of the price. The mod's own button sprites are not used (user feedback: they read as a
  // foreign skin next to the shop's).
  // 业主 2026-10-20：「把刷新按钮改成分别刷新每个」。一张刷新按次要标在**卡片自己**身上（每张卡的角上一颗小刷新），
  // header 那颗留给整批（一次换掉三张）。次数是两本独立的账：整批 1 次/局，单张**每张卡各 1 次**。
  // 整批刷新那颗按钮只在**还有次数**时才画（业主要求：用完了就别留按钮），所以标题里不会再出现「已用完」那一档。
  const rerollLabel = t('刷新（剩余 {n} 次）', { n: hex.myRerolls });
  const cardReroll = (idx) => { if (!canRerollSlot(idx)) return; setArmed(null); onReroll(idx); };
  const armedName = armed != null ? (hex.myOffer.find((c) => c && c.idx === armed)?.name || null) : null;
  return html`<div class=${cx('spov', 'hxov', armed != null && 'has-armed', vanishIdx != null && 'is-vanishing')} role="dialog" aria-label=${t('协议源石')} onPointerDown=${onDown}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="hxov__ambient" aria-hidden="true"></div>
    <div class="spov__inner">
      <header class="spov__head">
        <div class="spov__titles">
          <${MicroLabel} tone="gold">${t('PROTOCOL // 协议源石')}</${MicroLabel}>
          <h2 class="spov__title hxov__title"><span class="hx-glitch" data-text=${t('协议源石')}>${t('协议源石')}</span><span class="spov__bar">|</span><span class="spov__desc">${waiting ? t('从三枚协议源石中选择一枚') : t('已选择')}</span></h2>
          <p class="spov__sub">${hex.exclusive ? t('盟约专属协议 · 只出现已激活盟约的专属协议源石') : ''}${hex.exclusive ? ' · ' : ''}${hex.untimed ? t('选择一项（无时间限制）') : t('倒计时结束后仍未选定将自动分配')}${waiting ? t(' · 点击卡牌选中，再次点击确认') : ''}</p>
        </div>
        <div class="spov__turn">
          ${armed != null ? html`<${Button} variant="primary" size="lg" icon="check" class="spov__confirm" data-testid="hex-confirm"
              disabled=${vanishing != null}
              title=${armedName ? t('确认选择「{armedName}」（再次点击卡牌亦可）', { armedName }) : t('确认选择')}
              onClick=${() => tap({ idx: armed })}>${t('确认选择')}<//>` : null}
          ${hex.myRerolls > 0 ? html`<button type="button" class="toolbtn toolbtn--amber hxov__reroll" disabled=${!canReroll} data-testid="hex-reroll"
            aria-label=${t('刷新全部三张')} title=${rerollLabel}
            onClick=${() => { if (canReroll) { setArmed(null); onReroll(); } }}>
            <${Img} src=${refreshIconUrl()} class="toolbtn__img" fallback=${html`<${Icon} name="refresh" />`} />
            <span>${t('刷新')}</span>
            <${HexBadge} value=${hex.myRerolls} tone=${canReroll ? 'gold' : 'dark'} size="sm" />
          </button>` : null}
          ${hex.untimed ? null : html`<${Countdown} deadline=${hex.turnDeadline} total=${hex.timerSec || undefined} size="sm" />`}
        </div>
      </header>
      <div class="spov__grid spov__grid--3">
        ${hex.myOffer.map((c) => html`<${HexCard} key=${`${c.id}:${c.idx}`} hex=${c}
          armed=${armed === c.idx} picked=${picked === c.idx} faded=${picked != null && picked !== c.idx}
          busy=${busyIdx === c.idx} vanishing=${vanishIdx === c.idx} vanishDir=${c.idx} onClick=${() => tap(c)}
          onReroll=${canRerollSlot(c.idx) ? () => cardReroll(c.idx) : null}
          rerollTitle=${t('只刷新这一张')} />`)}
      </div>
      <${HexOverlayFooter} own=${own} enemy=${enemy} />
    </div>
  </div>`;
}

// ---- 协议源石 · 刷新 (recycle) -----------------------------------------------------------------------------------
// 业主 2026-10-30「在第6回合玩家可以舍弃1-2个协议源石随机获得相同数量的协议源石」；2026-10-31 改成界面：
// 「不要按钮形式，你就搞个界面把有的协议源石放上去点击刷新。算力无限，搞美观些」「就是选完协议源石，这面板直接出现，
// 用协议源石的界面也行」。
//
// 所以这一手**没有角落按钮**：窗口一开面板自己出现，把玩家已拥有的每一张协议源石铺成卡，**点哪张刷哪张** —— 点一次
// 立刻发 `g.hexRecycle { ids: [那张] }`，没有确认、没有多选。每局共 `HEX_RECYCLE_BUDGET`（2）次，点一次花一次（可以
// 点同一张两次，也可以点两张各一次）；换回的牌按 1/2/3 阶的抽取权重完全随机，被换掉那张已经给过的一次性收益不收回
// （那是服务端的账）。服务端在 HEX_DRAFT 里受理时**不改 offer、不改 picks**（只摘自己身上的 `hex:<id>` ref 再发一张
// 新的），所以抽卡界面本身不受影响。
//
// 窗口（`hexRecycleAvailable`）＝ 第 6 回合 && 存活 && 还有次数 && 至少拥有一张 && 下面两种时刻之一：
//   * `HEX_DRAFT` 且自己**已经选完** —— 业主「选完协议源石，这面板直接出现」：抽卡是并行的，自己选完就不必等别人。
//     同回合还有机变的难度（`spRounds` 含 6）例外：那一档等休整期再弹，否则面板只会闪一下、还会盖住机变；
//   * `PREP` —— 机变回合夹在中间时（`spRounds` 含 6 的难度），休整期会再给一次。这一条还要「未准备」，而 `priv.ready`
//     不在这个纯函数拿得到的帧里，所以由 screens/game.js 补在判据外面（`recycleWindow`）；纯函数只按契约来，于是能被
//     单测逐条钉住。
//
// 状态留在 screens/game.js（按没按过「完成」、哪张在飞、哪张是新入场的），`HexRecyclePanel` 是不持有状态的纯视图 ——
// 与 ui/damageReport.js 的面板同一条规矩，测试可以直接把它当函数调（test/ui/hexRecycle.test.js）。

/** 这一手只在第 6 回合被受理（服务端的拒绝码 WRONG_PHASE）。 */
export const HEX_RECYCLE_ROUND = 6;

/** 「新卡入场闪一下」的时长（毫秒）。屏上只是给个确认：换回来的那张是新的，别让玩家以为点错了。 */
export const RECYCLE_FLASH_MS = 1100;

/**
 * m.public.players[] 里属于自己那一行（`hexes` / `hexRefs` / `hexRecycleLeft` 都在这行上），观战 / 已淘汰没有这一行
 * 时返回 null。
 * @param {any} pub m.public
 * @param {string|null|undefined} myId
 * @returns {any|null}
 */
export function playerRowOf(pub, myId) {
  const list = Array.isArray(pub?.players) ? pub.players : [];
  return list.find((p) => p && p.playerId === myId) || null;
}

/**
 * 自己已拥有的协议源石 id —— 这份列表既是面板铺卡的数据源，也是「至少拥有一张」那条判据。
 *
 * 业主 2026-11-02「相同的海克斯，在刷新回合会被当成一个海克斯」：行上另有 `hexRefs` 是**不去重**的那一份（同名的两张写
 * 两次，服务端只在「有卡被拥有多于一次」时才写它，见 `server/match/match/views.js publicPlayerView`），有它就用它 ——
 * 同名的两张于是铺成两个槽。没有 `hexRefs`（老服务端 / 没有重复的帧）仍读 `hexes`，并照旧去重、丢掉非字符串。
 * @param {any} pub m.public
 * @param {string|null|undefined} myId
 * @returns {string[]}
 */
export function ownHexIds(pub, myId) {
  const row = playerRowOf(pub, myId);
  const refs = Array.isArray(row?.hexRefs) ? row.hexRefs : null;
  const list = refs || (Array.isArray(row?.hexes) ? row.hexes : []);
  const ids = list.filter((id) => typeof id === 'string' && id);
  return refs ? ids : [...new Set(ids)];
}

/**
 * 这一局还能刷几次（0…`HEX_RECYCLE_BUDGET`）。
 *
 * 服务端只在第 6 回合的帧里把余数写成行上的 `hexRecycleLeft`（其它回合不写）。**缺省按满额**：业主的口径是每局 2 次，
 * 所以第 6 回合的帧里没有这个键时（老服务端 / 混合部署）按 2 起算，而不是一上来就显示「次数已用完」。
 * @param {any} pub m.public
 * @param {string|null|undefined} myId
 * @returns {number}
 */
export function hexRecycleLeft(pub, myId) {
  const row = playerRowOf(pub, myId);
  if (!row) return 0;                                   // 观战席位没有自己那一行
  const n = row.hexRecycleLeft;
  if (Number.isFinite(n)) return Math.max(0, Math.min(HEX_RECYCLE_BUDGET, Math.trunc(n)));
  return HEX_RECYCLE_BUDGET;
}

/**
 * 抽卡阶段里「自己已经选完」：`picks[myId]` 落下了，也没有欠着的额外选牌（管理员的第一回合额外选牌 —— 欠着的时候
 * 服务端换了一批新牌在等第二手，那时不算选完）。
 * @param {any} pub m.public
 * @param {string|null|undefined} myId
 * @returns {boolean}
 */
export function draftPicked(pub, myId) {
  const hex = pub?.hex;
  const picks = hex && typeof hex === 'object' && hex.picks && typeof hex.picks === 'object' ? hex.picks : null;
  if (!picks || picks[myId] == null) return false;      // 0 是合法槽位，所以不能写成 `if (!picks[myId])`
  const extra = hex.extraPicksLeft && typeof hex.extraPicksLeft === 'object' ? Number(hex.extraPicksLeft[myId]) : 0;
  return !(Number.isFinite(extra) && extra > 0);
}

/**
 * 这一手的**阶段窗口**（不含次数）：第 6 回合、存活、至少拥有一张，并且是 `HEX_DRAFT`（自己已选完）或 `PREP` 之一。
 * PREP 那条还要「未准备」，`priv.ready` 不在这个纯函数拿得到的帧里，由 screens/game.js 补（见文件头）。
 *
 * 与 `hexRecycleAvailable` 分开的理由是「次数用完那一刻」：业主 2026-10-31 要面板留在原地显示「次数已用完」、按「完成」
 * 才走 —— 那一刻服务端已经不受理了（`hexRecycleAvailable` 假），但阶段窗口还在（这个函数真），面板于是留得住。
 * @param {any} pub m.public
 * @param {string|null|undefined} myId
 * @returns {boolean}
 */
export function hexRecycleWindow(pub, myId) {
  const row = playerRowOf(pub, myId);
  if (!row || row.alive === false) return false;
  if (!pub || pub.round !== HEX_RECYCLE_ROUND) return false;
  if (ownHexIds(pub, myId).length < 1) return false;
  if (pub.phase === PHASE.HEX_DRAFT) {
    // 同回合还有机变（`spRounds` 含 6 的难度：标准 / 同盟标准）：选完协议源石后马上就是机变的整屏界面 —— 这时弹面板只会
    // 闪一下（下一帧阶段就变了），而且它是同层的兄弟节点，压上去还会盖住机变。那一档等休整期再弹（同一回合、选完之后）。
    if (pub.spRound === true) return false;
    return draftPicked(pub, myId);
  }
  return pub.phase === PHASE.PREP;
}

/**
 * 这一手「协议源石 · 刷新」此刻服务端会不会受理 —— 「还能不能换」的唯一判据（阶段窗口 + 还有次数）。
 *
 * 服务端仍然是权威（拒绝码 ALREADY / BAD_TARGET / WRONG_PHASE，`act()` 会自动 toast）；这里只是**不弹**一个注定被
 * 拒绝的面板。
 * @param {any} pub m.public
 * @param {string|null|undefined} myId
 * @returns {boolean}
 */
export function hexRecycleAvailable(pub, myId) {
  return hexRecycleWindow(pub, myId) && hexRecycleLeft(pub, myId) > 0;
}

/**
 * 一张卡此刻能不能点：还有次数，并且没有别的卡正在刷新（请求在途时整排都禁用，避免一次点击花掉两次）。
 * @param {number} left 剩余次数
 * @param {string|null} [busyKey] 正在刷新的那个槽的键（`recycleCardKey`；非空 = 有请求在飞）
 * @returns {boolean}
 */
export function recycleCanRefresh(left, busyKey = null) {
  return !busyKey && Number.isFinite(Number(left)) && Number(left) > 0;
}

/**
 * 把「自己拥有的 id」换成卡面记录（HexCard 要的 `{ id, name, desc, rarity }`），保持行上的顺序。
 *
 * 一对同名卡（`ownHexIds` 给出两个相同 id）就是**两个槽**：映射 1:1，`idx` 不同即可 —— 点哪一个都由这个 `idx` 认领。
 *
 * 记录来自 `data.get('hextech').playerHexes` —— 那是**以 id 为键的对象**（data/hextech.json；ui/guide.js 与
 * ui/testArena.js hexesOf 都按 Object.values 读），不是数组；这里也接受数组形态，省得两处写法对不上。
 * 查不到的 id **保留**（名字退回 id、阶位退回缺省）：玩家仍然必须能刷它，否则那一局就卡死了。
 * @param {string[]|null|undefined} ownedIds
 * @param {any} roster data.get('hextech')?.playerHexes
 * @returns {{ id: string, idx: number, name: string, desc: string, rarity: string }[]}
 */
export function recycleCardsOf(ownedIds, roster) {
  const list = Array.isArray(ownedIds) ? ownedIds.filter((id) => typeof id === 'string' && id) : [];
  const recOf = (id) => {
    if (Array.isArray(roster)) return roster.find((h) => h && h.id === id) || null;
    return roster && typeof roster === 'object' ? roster[id] || null : null;
  };
  return list.map((id, idx) => {
    const rec = recOf(id);
    return {
      id, idx,
      name: typeof rec?.name === 'string' && rec.name ? rec.name : id,
      desc: typeof rec?.desc === 'string' ? rec.desc : '',
      rarity: typeof rec?.rarity === 'string' && rec.rarity ? rec.rarity : RARITY_DEFAULT,
    };
  });
}

/**
 * 一个卡槽的身份（`recycleCardsOf` 的一张卡 → 「正在刷新的那个槽」「刚换回来的那个槽」的键）。
 *
 * 业主 2026-11-02「相同的海克斯，在刷新回合会被当成一个海克斯」：同名的两张卡是两个槽，它们只有 `idx` 不同，所以
 * 「在飞」与「新卡入场」都按这个键记 —— 按 `id` 记的话两张同名卡会一起闪光、一起演「被吸走」，等于又合成了一张。
 * @param {{ id?: string, idx?: number }|null|undefined} card
 * @returns {string}
 */
export function recycleCardKey(card) {
  const idx = Number.isFinite(Number(card?.idx)) ? Math.trunc(Number(card?.idx)) : -1;
  const id = typeof card?.id === 'string' ? card.id : '';
  return `${idx}:${id}`;
}

/**
 * 「协议源石 · 刷新」面板：业主 2026-10-31「把有的协议源石放上去点击刷新」。
 *
 * 外壳就是抽卡那套（`.spov` veil / inner / head / grid + `HexCard`），所以两个界面读起来是同一个游戏。纯视图 ——
 * `cards` / `left` / `busyKey` / `freshKey` 都由 screens/game.js 给，关面板也由它决定（组件只回调 `onClose`：
 * 「完成」按钮、点 veil、Esc 三处都走同一条）。
 *
 * 点卡即刷新（没有确认按钮）：`onRefresh(id, idx)` 由屏幕立刻发 `g.hexRecycle { ids: [id] }`。请求在途时**整排卡都点
 * 不动**（`recycleCanRefresh`）—— 一次点击只该花一次次数。
 *
 * `busyKey` / `freshKey` 是**槽**的键（`recycleCardKey`）而不是卡 id：同名的两张是两张，点其中一张时只有它自己被吸走，
 * 换回来的那张也只在它自己的槽里闪（业主 2026-11-02）。
 *
 * @param {{ cards?: any[], left?: number, busyKey?: string|null, freshKey?: string|null,
 *   onRefresh?: ((id: string, idx: number) => void)|null, onClose?: (() => void)|null }} props
 */
export function HexRecyclePanel({ cards = [], left = 0, busyKey = null, freshKey = null, onRefresh = null, onClose = null }) {
  const list = Array.isArray(cards) ? cards : [];
  const rest = Math.max(0, Math.min(HEX_RECYCLE_BUDGET, Math.trunc(Number(left) || 0)));
  const canRefresh = recycleCanRefresh(rest, busyKey);
  // 一行状态：在飞 > 还有次数 > 用完了。业主 2026-10-31 要「剩 n 次」看得见，用完那一刻也要说清楚。
  const status = busyKey ? t('刷新中') : rest > 0 ? t('剩 {n} 次', { n: rest }) : t('次数已用完');
  return html`<div class="spov hxrec" role="dialog" aria-label=${t('协议源石 · 刷新')} data-testid="hex-recycle-panel">
    <div class="spov__veil" aria-hidden="true" onClick=${() => onClose?.()}></div>
    <div class="spov__inner">
      <header class="spov__head">
        <div class="spov__titles">
          <${MicroLabel} tone="gold">${t('PROTOCOL // 协议源石')}</${MicroLabel}>
          <h2 class="spov__title hxov__title">${t('协议源石 · 刷新')}</h2>
          <p class="spov__sub">${t('第 6 回合限定 · 每局 2 次 · 点击一张，随机换回一张')}</p>
        </div>
        <div class="spov__turn">
          ${/* 剩余次数：几颗菱形（业主「算力无限，搞美观些」），数出来的那一行同时给出文字 */ ''}
          <span class=${cx('hxrec__pips', rest > 0 && 'is-live', busyKey && 'is-busy')} data-testid="hex-recycle-pips"
            aria-hidden="true">${Array.from({ length: HEX_RECYCLE_BUDGET }, (_, i) => html`<i key=${i}
              class=${cx('hxrec__pip', i < rest && 'is-on')}></i>`)}</span>
          <span class=${cx('hxrec__left', rest > 0 && 'is-live')} data-testid="hex-recycle-left"
            role="status" aria-live="polite">${status}</span>
        </div>
      </header>
      ${/* 一张卡一个槽：卡自己仍是那个大按钮（点整张 = 刷新它），槽负责悬停抬升 / 点击波纹 / 新卡入场的那一下闪光。
            `vanishing` 是抽卡确认时那套「化作数据流被吸走」的动画，这里借来表示「这张正在被换掉」。
            槽的身份是 `recycleCardKey(c)`（`idx:id`）而不是卡 id：同名的两张是两个槽，按 id 记会把它们合成一个（业主
            2026-11-02「相同的海克斯，在刷新回合会被当成一个海克斯」）。 */ ''}
      <div class=${cx('spov__grid', list.length <= 3 ? 'spov__grid--3' : list.length > 6 && 'spov__grid--many')}
        data-testid="hex-recycle-grid">
        ${list.map((c) => {
          const key = recycleCardKey(c);
          return html`<span key=${key}
          class=${cx('hxcard-slot', 'hxrec__slot', freshKey === key && 'is-fresh', busyKey === key && 'is-refreshing')}>
          <${HexCard} hex=${c} vanishing=${busyKey === key} vanishDir=${c.idx % 3}
            onClick=${canRefresh ? () => onRefresh?.(c.id, c.idx) : null} />
        </span>`;
        })}
      </div>
      <footer class="hxov__foot">
        <span class="hxov__hint hxrec__hint">${t('点击一张协议源石，随机换回一张')}</span>
        <${Button} variant="secondary" size="md" icon="check" data-testid="hex-recycle-done"
          onClick=${() => onClose?.()}>${t('完成')}<//>
      </footer>
    </div>
  </div>`;
}
