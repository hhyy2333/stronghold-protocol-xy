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
 * The enemy side's accumulated 协议源石 (m.public.enemyHexes): compact cards with a tooltip each. An optional `label` turns
 * it into the labeled strip the top bar and the 敌方情报 tab use; without one it is the bare chip row.
 *
 * The name and effect of every card live in the app's own Tooltip over the WHOLE row, not in a native `title` on it: a
 * native title is never shown on a touch screen, so a phone player had no way to read the enemy's cards at all (user
 * report 2026-10-11). The row asks for `tapShow`, so on touch a plain TAP opens it (and a second tap closes it) rather
 * than the default long press — the chips have no tap action of their own, and a tap is what a player tries first. The
 * row is the target rather than the single chip because a chip is only .3rem across with a .05rem gap — a 44 px per-chip
 * hit area would overlap its neighbours and show the wrong card.
 * @param {{ list: any[], label?: string|null, class?: string }} props
 */
export function EnemyHexRow({ list, label = null, class: cls = '' }) {
  const hexes = normalizeEnemyHexes(list);
  if (!hexes.length) return null;
  const tip = hexes.map((h) => `${t(h.name)} · ${t(h.desc)}`).join('\n');
  return html`<${Tooltip} text=${tip} placement="bottom" class="hxstrip-anchor" tapShow=${true}>
    <span class=${cx('hxstrip', cls)} data-testid="enemy-hex-strip" role="button" tabindex="0" aria-label=${tip.replace(/\n/g, '；')}>
      ${label ? html`<span class="hxstrip__label">${t(label)}</span>` : null}
      <span class="hxstrip__row">${hexes.map((h) => html`<${HexCard} key=${h.id} hex=${h} compact=${true} />`)}</span>
    </span>
  <//>`;
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
 * The draft overlay.
 * @param {{ hex: any, enemy?: any[], busyIdx?: number|null, onPick: (idx: number) => void, onReroll: (idx?: number) => void }} props
 *   hex: ui/gameLogic/draft.js normalizeHex(m.public.hex, myId, players); enemy: m.public.enemyHexes.
 *   `onReroll(idx)` replaces that ONE card (业主 2026-10-20「把刷新按钮改成分别刷新每个」); without an index it replaces the
 *   whole batch (the header button). Both cost the same one reroll.
 */
export function HexOverlay({ hex, enemy = [], busyIdx = null, onPick, onReroll }) {
  const [armed, setArmed] = useState(null);
  /** 确认动画进行中的卡（idx）：动画放完才 onPick；期间不再接受点选。 */
  const [vanishing, setVanishing] = useState(null);
  const vanishTimer = useRef(null);
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
    if (hex && hex.myPick != null && vanishing != null) setVanishing(null);
  }, [hex && hex.myPick, vanishing]);
  if (!hex || !hex.myOffer.length) return null;
  const enemyHexes = normalizeEnemyHexes(enemy);
  const picked = hex.myPick;
  const waiting = picked == null;
  // 整批刷新（header 那颗）与单张刷新（每张卡角上）各有各的次数：整批仍是一次/局，单张是**每张卡各一次**
  // （业主 2026-10-20「单个刷新应该3个都能刷一次」）。busyIdx 期间两者都禁掉。
  const canReroll = waiting && hex.myRerolls > 0 && busyIdx == null;
  const slotBudget = Array.isArray(hex.mySlotRerolls) ? hex.mySlotRerolls : [];
  const canRerollSlot = (idx) => waiting && busyIdx == null && (slotBudget[idx] || 0) > 0;
  /**
   * 二段点击（确认，owner 2026-10-18）：先放「卡牌化作数据流吸入屏幕中心 + 轻微震屏」的动画，
   * 动画结束才真正 onPick —— 否则服务器的回包会把卡牌提前换成已选状态，动画只播一个开头。
   */
  const commit = (idx) => {
    if (vanishing != null || !waiting || busyIdx != null) return;
    // 最后一秒才点确认：动画会跨过截止时间，服务器可能已经替玩家随机选了。这种情况下直接发请求，
    // 让「按时交卷」优先于演出（动画只在时间还够时播）。
    if (!hex.untimed && Number.isFinite(hex.turnDeadline) && hex.turnDeadline - Date.now() < CONFIRM_ANIM_MS + 300) {
      onPick(idx);
      return;
    }
    setArmed(null);
    setVanishing(idx);
    vanishTimer.current = setTimeout(() => {
      onPick(idx);
      // 服务器的回包（hex.myPick）通常几十毫秒就到，effect 会清掉；这一手只是兜底：动画结束后卡牌不能一直隐身。
      vanishTimer.current = setTimeout(() => { vanishTimer.current = null; setVanishing(null); }, 1500);
    }, CONFIRM_ANIM_MS);
  };
  const tap = (card) => {
    if (!waiting || busyIdx != null || vanishing != null) return;
    if (armed === card.idx) { commit(card.idx); return; }
    setArmed(card.idx);
  };
  // a press anywhere but a card, the reroll button or the confirm button drops the selection (keepsArmed)
  const onDown = (e) => {
    if (vanishing != null || armed == null || keepsArmed(e.target)) return;
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
  return html`<div class=${cx('spov', 'hxov', armed != null && 'has-armed', vanishing != null && 'is-vanishing')} role="dialog" aria-label=${t('协议源石')} onPointerDown=${onDown}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="hxov__ambient" aria-hidden="true"></div>
    <div class="spov__inner">
      <header class="spov__head">
        <div class="spov__titles">
          <${MicroLabel} tone="gold">${t('PROTOCOL // 协议源石')}</${MicroLabel}>
          <h2 class="spov__title hxov__title"><span class="hx-glitch" data-text=${t('协议源石')}>${t('协议源石')}</span><span class="spov__bar">|</span><span class="spov__desc">${waiting ? t('从三枚协议源石中选择一枚') : t('已选择')}</span></h2>
          <p class="spov__sub">${hex.untimed ? t('选择一项（无时间限制）') : t('倒计时结束后仍未选定将自动分配')}${waiting ? t(' · 点击卡牌选中，再次点击确认') : ''}</p>
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
          busy=${busyIdx === c.idx} vanishing=${vanishing === c.idx} vanishDir=${c.idx} onClick=${() => tap(c)}
          onReroll=${canRerollSlot(c.idx) ? () => cardReroll(c.idx) : null}
          rerollTitle=${t('只刷新这一张')} />`)}
      </div>
      <footer class="hxov__foot">
        <span class="hxov__enemy">
          <${MicroLabel} tone="gold">${t('敌方协议源石')}</${MicroLabel}>
          ${enemyHexes.length
            // the shared row, so the footer's chips are long-pressable on a phone exactly like the top bar's (EnemyHexRow)
            ? html`<${EnemyHexRow} list=${enemyHexes} class="hxov__enemyrow" />`
            : html`<b class="hxov__enemynum num">0</b>`}
        </span>
        <span class="hxov__hint">${t('敌人会获得同阶位的协议源石')}</span>
      </footer>
    </div>
  </div>`;
}
