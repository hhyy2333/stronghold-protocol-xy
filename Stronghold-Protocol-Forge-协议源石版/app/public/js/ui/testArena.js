// ui/testArena.js — 测试场 (the owner's request of 2026-10-11): the in-match panel a room created with
// `room.create.test: true` offers.
//
// A 测试场 is a normal match whose 协议源石 draft never runs (server/match/match/phases.js) and whose extra intents are
// accepted (server/match/match/testField.js): add funds, grant one 协议源石 to the PLAYER, grant one to the ENEMY, clear
// either side, jump to a leader fight — and buy any operator (业主 2026-10-26). This module is that panel's UI —
// deliberately small and self-contained:
//
//   * 资金: three buttons (+10 / +100 / +1000) and a read-out of the current funds. The tester asked for manual grants
//     only (never an automatic purse), so nothing here fires on its own.
//   * 最终攻势: the leader picker and the jump to that leader's prep (`actions.testBoss`).
//   * the list: three tabs — 我方 / 敌方 (the two 协议源石 sides, `data/hextech.json` `playerHexes` / `enemyHexes`) and
//     干员 (the operator picker). Each 协议源石 card is a compact, tier-coloured button; a tap grants it at once
//     (`actions.testHex` / `actions.testEnemyHex`), the ones already held / owned are marked, and each side has its own
//     清空. The 干员 tab lists every shop operator of the room's data with its tier price and a search box; a tap BUYS it
//     (`actions.testChess`, the ordinary purchase path on the server: tier price, hand limit, merge, onBuy hooks) —
//     the shop's draw, its level cap, the match's bans and the pool's remaining copies do not apply, which is the whole
//     point of the tab.
//
// The two 协议源石 sides differ in a way the UI must show rather than hide: a PLAYER card is per-seat and a repeat is
// allowed (the immediate part runs again, the production `applyHex` dedupes the persistent effect), while an ENEMY card
// is match-global and its multipliers MULTIPLY, so the server refuses a card the enemy already owns (`ALREADY`) — the
// panel marks owned cards and disables them, so the rule is visible before the tap instead of surfacing as an error.
//
// The 干员 tab is a purchase, so it is only live in PREP before that player is Ready (the server answers WRONG_PHASE
// otherwise): the rows are disabled and one line says why. `canBuy` is the screen's answer — this module never reads the
// match state itself.
//
// Every string goes through t() (docs/I18N.md); the card names / effects are data texts (data/hextech.json), the operator
// names are data texts too (data/chess.json), shown as the game sends them. The panel is a plain section in the game HUD
// (like ui/damageReport.js's panel), not a modal, so a tester can keep playing while it is open.

import { html, Icon, Button, MicroLabel, Tabs } from './components.js';
import { data } from '../data.js';
import { rarityName, rarityTierArt } from './hexOverlay.js';
import { chessPriceOf } from '../../../shared/chessPrice.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** The three funds buttons, weakest first (the label is the amount, so it is never translated). */
export const TEST_FUND_AMOUNTS = Object.freeze([10, 100, 1000]);

/** The panel's two 协议源石 sides, in tab order: the player's own roster and the enemy's. */
export const TEST_HEX_SIDES = Object.freeze(['player', 'enemy']);

/** The 干员 tab's id (业主 2026-10-26「在测试场增加功能可以购买任何干员」). */
export const TEST_CHESS_TAB = 'chess';

/** Every tab of the list section, in order: the player's cards, the enemy's, then the operator picker. */
export const TEST_LIST_TABS = Object.freeze([...TEST_HEX_SIDES, TEST_CHESS_TAB]);

/**
 * The roster of one 协议源石 side from the room's own data, in data order (`[]` without data/hextech.json).
 * @param {'player'|'enemy'} side
 */
export function hexesOf(side) {
  const roster = data.get('hextech')?.[side === 'enemy' ? 'enemyHexes' : 'playerHexes'];
  return roster && typeof roster === 'object' ? Object.values(roster).filter((h) => h && typeof h.id === 'string') : [];
}

/**
 * The operator picker's roster: every SHOP operator of the room's data — the same predicate `GameData.visibleChess`
 * applies on the server (visible, not golden, not 自选, not hidden, a real tier), so the panel offers exactly the ids
 * `g.testChess` accepts. No ban / pool / shop-level filter: "任何干员" is the feature.
 *
 * Sorted by tier, then the shop's own order (`shopSortId`), then the id — a stable order the search box can narrow.
 * The price comes from shared/chessPrice.js, the SAME rule the server charges (业主 2026-10-26: the label and the
 * charge may never disagree).
 *
 * @param {any[]|null} records `data.list('chess')`
 * @param {any} [config] `data/config.json` (the mode's price overrides live in `modes[modeId].economy`)
 * @param {string|null} [modeId] the room's mode (`m.public.modeId`)
 * @returns {{ id: string, name: string, tier: number, price: number }[]}
 */
export function operatorsOf(records, config = null, modeId = null) {
  const list = Array.isArray(records) ? records : [];
  const mode = config && config.modes && typeof modeId === 'string' ? config.modes[modeId] : null;
  const modeEconomy = mode && mode.economy ? mode.economy : null;
  const economy = config && config.economy ? config.economy : null;
  return list
    .filter((c) => c && typeof c.chessId === 'string' && c.visible === true
      && !c.isGolden && !c.isDiy && !c.isHidden && Number.isInteger(c.tier))
    .map((c) => ({
      id: c.chessId,
      name: c.name || c.chessId,
      tier: c.tier,
      price: chessPriceOf(c, c.tier, modeEconomy, economy),
      sort: Number.isFinite(c.shopSortId) ? c.shopSortId : Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => (a.tier - b.tier) || (a.sort - b.sort) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ sort, ...op }) => op);
}

/**
 * Narrow the picker's roster by a search box: case-insensitive substring of the operator's name or id (the id keeps
 * English / pinyin-ish queries working, the name is what a player types). An empty query keeps the whole list.
 * @param {{ id: string, name: string }[]} operators
 * @param {string} search
 */
export function filterOperators(operators = [], search = '') {
  const q = String(search || '').trim().toLowerCase();
  if (!q) return Array.isArray(operators) ? operators : [];
  return (Array.isArray(operators) ? operators : [])
    .filter((op) => op && (String(op.name).toLowerCase().includes(q) || String(op.id).toLowerCase().includes(q)));
}

/**
 * One 协议源石 as a tappable button: the tier's 阶位 art (like the draft card and the effects column) with the name under
 * it, the tier chip in the corner and the effect as its tooltip. `owned` marks a card that is already in play — the
 * player owns it, or the enemy already has it — and, for the enemy side, `locked` also disables it (enemy multipliers
 * multiply, so the server refuses a repeat: testField.js testEnemyHex).
 * @param {{ hex: any, owned: boolean, busy: boolean, locked?: boolean, onGrant: (id: string) => void }} props
 */
export function TestHexButton({ hex, owned, busy, locked = false, onGrant }) {
  const rarity = hex.rarity || 'silver';
  // the tier art (the 阶位 image) is the tile when the local manifest has it; otherwise the name's first character on the
  // drawn plate — the draft card's own fallback (ui/hexOverlay.js HexCard)
  const tierArt = rarityTierArt(rarity);
  const plateStyle = tierArt ? `--hx-tier:url("${tierArt}")` : null;
  return html`<button type="button" class=${cx('thx', `thx--${rarity}`, tierArt && 'has-tier', owned && 'is-owned')}
      disabled=${busy || locked} data-hex=${hex.id} title=${`${t(hex.name)} · ${t(hex.desc)}`} onClick=${() => onGrant(hex.id)}>
    <span class="thx__plate" style=${plateStyle} aria-hidden="true">
      ${tierArt ? null : html`<span class="thx__glyph">${String(hex.name || '?').slice(0, 1)}</span>`}
    </span>
    <span class="thx__name">${t(hex.name)}</span>
    <span class="thx__rarity num">${t(rarityName(rarity))}</span>
    ${owned ? html`<span class="thx__owned" aria-hidden="true"><${Icon} name="check" /></span>` : null}
  </button>`;
}

/**
 * One operator of the 干员 picker: a row whose tap BUYS that operator (`g.testChess`). The tier chip and the price are the
 * two things a tester needs before the tap — the price is the one the server charges (shared/chessPrice.js), so the row
 * can be trusted as a label.
 * @param {{ op: { id: string, name: string, tier: number, price: number }, busy?: boolean, canBuy?: boolean,
 *   onBuy: (id: string) => void }} props
 */
export function TestOperatorRow({ op, busy = false, canBuy = true, onBuy }) {
  // the tooltip is built outside the template: tools/i18n.mjs reads the t('…') literals from the source, and a call
  // nested inside a template expression is easy for that scanner to miss
  const tip = `${t('购买')} ${op.name} · ${op.price}`;
  return html`<button type="button" class="op" data-op=${op.id}
      disabled=${busy || !canBuy} title=${tip}
      onClick=${() => onBuy(op.id)}>
    <span class="op__name">${op.name}</span>
    <span class="op__tier num" data-tier=${op.tier}>${op.tier}</span>
    <span class="op__price num">${op.price}</span>
  </button>`;
}

/**
 * The 测试场 panel: funds, the leader jump, then the list (both 协议源石 sides and the 干员 picker).
 *
 * The open tab is CONTROLLED (`side` + `onSide`), like the damage report's metric switch, and so is the 干员 search box
 * (`search` + `onSearch`): the caller owns them, so the panel itself needs no hook and stays renderable by the UI
 * suites' plain expansion.
 * @param {{ funds: number, ownedPlayer: string[], ownedEnemy: string[], busy: string|null, side?: string,
 *   onSide?: (id: string) => void, onGrantPlayer: (id: string) => void, onGrantEnemy: (id: string) => void,
 *   onClearPlayer: () => void, onClearEnemy: () => void, onFunds: (amount: number) => void, onClose?: () => void,
 *   bosses?: { bossId: string, name: string, hidden?: boolean }[], boss?: string|null, onBossPick?: (id: string) => void,
 *   onBoss?: (id: string) => void,
 *   operators?: { id: string, name: string, tier: number, price: number }[], search?: string,
 *   onSearch?: (text: string) => void, onBuyOperator?: (id: string) => void, canBuy?: boolean }} props
 */
export function TestArenaPanel({
  funds = 0, ownedPlayer = [], ownedEnemy = [], busy = null, side = 'player', onSide = null,
  onGrantPlayer, onGrantEnemy, onClearPlayer, onClearEnemy, onFunds, onClose = null,
  bosses = [], boss = null, onBossPick = null, onBoss = null,
  operators = [], search = '', onSearch = null, onBuyOperator = null, canBuy = true,
}) {
  const active = TEST_LIST_TABS.includes(side) ? side : 'player';
  const chessTab = active === TEST_CHESS_TAB;
  const enemySide = active === 'enemy';
  const leaders = Array.isArray(bosses) ? bosses.filter((b) => typeof b.bossId === 'string') : [];
  const hexes = chessTab ? [] : hexesOf(active);
  const owned = enemySide ? (Array.isArray(ownedEnemy) ? ownedEnemy : []) : (Array.isArray(ownedPlayer) ? ownedPlayer : []);
  const held = new Set(owned);
  // an enemy card already owned can never be granted again (it would double a multiplier): show it and disable it
  const locked = (id) => enemySide && held.has(id);
  const grant = enemySide ? onGrantEnemy : onGrantPlayer;
  const shown = filterOperators(operators, search);
  return html`<section class="tarena" role="region" aria-label=${t('测试场')}>
    <header class="tarena__head">
      <div class="tarena__titles">
        <${MicroLabel} tone="gold">${t('TEST FIELD // 测试场')}</${MicroLabel}>
        <b class="tarena__name">${t('测试场')}</b>
      </div>
      ${onClose ? html`<button type="button" class="tarena__x" aria-label=${t('关闭')} title=${t('关闭')}
        onClick=${onClose}><${Icon} name="close" /></button>` : null}
    </header>

    <div class="tarena__sec">
      <span class="tarena__label">${t('资金')}<b class="num t-gold">${funds}</b></span>
      <div class="tarena__funds">
        ${TEST_FUND_AMOUNTS.map((n) => html`<${Button} key=${n} variant="amber" size="sm"
          onClick=${() => onFunds(n)}>+${n}<//>`)}
      </div>
    </div>

    ${/* 测试场 直接到 boss 战 (业主 2026-10-21): skip the rounds before the leader round and land in its prep with the
          leader picked here (data/bosses.json, the hand-added boss_11 included). */ ''}
    <div class="tarena__sec">
      <span class="tarena__label">${t('最终攻势')}</span>
      ${leaders.length
        ? html`<div class="tarena__bossrow">
            <select class="tarena__boss" value=${(leaders.find((b) => b.bossId === boss) || leaders[0]).bossId}
              aria-label=${t('首领')} disabled=${busy != null}
              onChange=${(e) => onBossPick && onBossPick(e.currentTarget.value)}>
              ${leaders.map((b) => html`<option key=${b.bossId} value=${b.bossId}>${b.name}${b.hidden ? ` · ${t('隐秘核心')}` : ''}</option>`)}
            </select>
            <${Button} variant="amber" size="sm" disabled=${busy != null}
              onClick=${() => onBoss && onBoss((leaders.find((b) => b.bossId === boss) || leaders[0]).bossId)}>${t('跳到 boss 战')}<//>
          </div>`
        : html`<p class="tarena__empty t-lo">${t('本机数据里没有首领。')}</p>`}
    </div>

    <div class="tarena__sec tarena__sec--hex">
      <span class="tarena__label">
        <${Tabs} size="sm" value=${active} onChange=${(id) => onSide && onSide(id)}
          items=${TEST_LIST_TABS.map((id) => ({
            id,
            label: id === TEST_CHESS_TAB ? t('干员') : id === 'enemy' ? t('敌方') : t('我方'),
            badge: id === TEST_CHESS_TAB ? null : (id === 'enemy' ? ownedEnemy : ownedPlayer).length || null,
          }))} />
        ${/* 清空 belongs to the two 协议源石 sides only: the 干员 tab buys, it does not grant a list. */ ''}
        ${chessTab ? null : html`<${Button} variant="secondary" size="sm" icon="close" disabled=${!held.size || busy != null}
          onClick=${enemySide ? onClearEnemy : onClearPlayer}>${t('清空')}<//>`}
      </span>
      ${chessTab
        ? html`${/* 业主 2026-10-26「在测试场增加功能可以购买任何干员」: any shop operator at its tier price; the shop's
                 draw / level / bans / stock do not apply. The rows are live only in PREP before Ready (the server's own
                 gate), so the panel says that instead of letting a tap answer WRONG_PHASE. */ ''}
            ${canBuy
              ? html`<p class="tarena__note t-lo">${t('按阶级价购买：无视商店等级、卡池与禁用。')}</p>`
              : html`<p class="tarena__note t-lo">${t('只能在休整期（准备前）购买干员。')}</p>`}
            <input type="search" class="tarena__search" value=${search} placeholder=${t('搜索干员')}
              aria-label=${t('搜索干员')} onInput=${(e) => onSearch && onSearch(e.currentTarget.value)} />
            ${shown.length
              ? html`<div class="tarena__grid tarena__grid--ops">
                  ${shown.map((op) => html`<${TestOperatorRow} key=${op.id} op=${op} busy=${busy === op.id}
                    canBuy=${canBuy} onBuy=${onBuyOperator} />`)}
                </div>`
              : html`<p class="tarena__empty t-lo">${t('没有匹配的干员。')}</p>`}`
        : html`${/* The enemy side is match-global and its multipliers multiply, so a held card is shown but not tappable —
                   the rule is visible here instead of as an ALREADY error after a tap. */ ''}
            ${enemySide ? html`<p class="tarena__note t-lo">${t('敌方协议源石全局生效，已拥有的不能重复添加。')}</p>` : null}
            ${hexes.length
              ? html`<div class="tarena__grid">
                  ${hexes.map((h) => html`<${TestHexButton} key=${h.id} hex=${h} owned=${held.has(h.id)} locked=${locked(h.id)}
                    busy=${busy === h.id} onGrant=${grant} />`)}
                </div>`
              : html`<p class="tarena__empty t-lo">${t('本机数据里没有协议源石。')}</p>`}`}
    </div>
  </section>`;
}

/** The panel's HUD toggle (a gear-sized button), mirroring ui/damageReport.js DamageReportButton. */
export function TestArenaButton({ open, onToggle = null, class: cls }) {
  return html`<button type="button" class=${cx('gm__gear', 'gm__test', open && 'is-on', cls)}
      aria-expanded=${open ? 'true' : 'false'} aria-label=${t('测试场')} title=${t('测试场')}
      onClick=${() => onToggle?.(!open)}><${Icon} name="dots" /></button>`;
}
