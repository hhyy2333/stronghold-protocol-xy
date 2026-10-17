// ui/testArena.js — 测试场 (the owner's request of 2026-10-11): the in-match panel a room created with
// `room.create.test: true` offers.
//
// A 测试场 is a normal match whose 协议源石 draft never runs (server/match/match/phases.js) and whose extra intents are
// accepted (server/match/match/testField.js): add funds, grant one 协议源石 to the PLAYER, grant one to the ENEMY, and
// clear either side. This module is that panel's UI — deliberately small and self-contained:
//
//   * 资金: three buttons (+10 / +100 / +1000) and a read-out of the current funds. The tester asked for manual grants
//     only (never an automatic purse), so nothing here fires on its own.
//   * 协议源石: two tabs — 我方 (the player's own cards, `data/hextech.json` `playerHexes`) and 敌方 (`enemyHexes`). Each
//     card is a compact, tier-coloured button; a tap grants it at once (`actions.testHex` / `actions.testEnemyHex`), the
//     ones already held / owned are marked, and each side has its own 清空.
//
// The two sides differ in a way the UI must show rather than hide: a PLAYER card is per-seat and a repeat is allowed (the
// immediate part runs again, the production `applyHex` dedupes the persistent effect), while an ENEMY card is
// match-global and its multipliers MULTIPLY, so the server refuses a card the enemy already owns (`ALREADY`) — the panel
// marks owned cards and disables them, so the rule is visible before the tap instead of surfacing as an error after it.
//
// Every string goes through t() (docs/I18N.md); the card names / effects are data texts (data/hextech.json), shown as
// the game sends them. The panel is a plain section in the game HUD (like ui/damageReport.js's panel), not a modal, so a
// tester can keep playing while it is open.

import { html, Icon, Button, MicroLabel, Tabs } from './components.js';
import { data } from '../data.js';
import { rarityName, rarityTierArt } from './hexOverlay.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** The three funds buttons, weakest first (the label is the amount, so it is never translated). */
export const TEST_FUND_AMOUNTS = Object.freeze([10, 100, 1000]);

/** The panel's two card sides, in tab order: the player's own roster and the enemy's. */
export const TEST_HEX_SIDES = Object.freeze(['player', 'enemy']);

/**
 * The roster of one side from the room's own data, in data order (`[]` without data/hextech.json).
 * @param {'player'|'enemy'} side
 */
export function hexesOf(side) {
  const roster = data.get('hextech')?.[side === 'enemy' ? 'enemyHexes' : 'playerHexes'];
  return roster && typeof roster === 'object' ? Object.values(roster).filter((h) => h && typeof h.id === 'string') : [];
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
 * The 测试场 panel: funds, then the two 协议源石 sides.
 *
 * The side tab is CONTROLLED (`side` + `onSide`), like the damage report's metric switch: the caller owns which tab is
 * open, so the panel itself needs no hook and stays renderable by the UI suites' plain expansion.
 * @param {{ funds: number, ownedPlayer: string[], ownedEnemy: string[], busy: string|null, side?: string,
 *   onSide?: (id: string) => void, onGrantPlayer: (id: string) => void, onGrantEnemy: (id: string) => void,
 *   onClearPlayer: () => void, onClearEnemy: () => void, onFunds: (amount: number) => void, onClose?: () => void }} props
 */
export function TestArenaPanel({
  funds = 0, ownedPlayer = [], ownedEnemy = [], busy = null, side = 'player', onSide = null,
  onGrantPlayer, onGrantEnemy, onClearPlayer, onClearEnemy, onFunds, onClose = null,
}) {
  const active = TEST_HEX_SIDES.includes(side) ? side : 'player';
  const enemySide = active === 'enemy';
  const hexes = hexesOf(active);
  const owned = enemySide ? (Array.isArray(ownedEnemy) ? ownedEnemy : []) : (Array.isArray(ownedPlayer) ? ownedPlayer : []);
  const held = new Set(owned);
  // an enemy card already owned can never be granted again (it would double a multiplier): show it and disable it
  const locked = (id) => enemySide && held.has(id);
  const grant = enemySide ? onGrantEnemy : onGrantPlayer;
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

    <div class="tarena__sec tarena__sec--hex">
      <span class="tarena__label">
        <${Tabs} size="sm" value=${active} onChange=${(id) => onSide && onSide(id)}
          items=${TEST_HEX_SIDES.map((id) => ({
            id,
            label: id === 'enemy' ? t('敌方') : t('我方'),
            badge: (id === 'enemy' ? ownedEnemy : ownedPlayer).length || null,
          }))} />
        <${Button} variant="secondary" size="sm" icon="close" disabled=${!held.size || busy != null}
          onClick=${enemySide ? onClearEnemy : onClearPlayer}>${t('清空')}<//>
      </span>
      ${/* The enemy side is match-global and its multipliers multiply, so a held card is shown but not tappable — the
            rule is visible here instead of as an ALREADY error after a tap. */ ''}
      ${enemySide ? html`<p class="tarena__note t-lo">${t('敌方协议源石全局生效，已拥有的不能重复添加。')}</p>` : null}
      ${hexes.length
        ? html`<div class="tarena__grid">
            ${hexes.map((h) => html`<${TestHexButton} key=${h.id} hex=${h} owned=${held.has(h.id)} locked=${locked(h.id)}
              busy=${busy === h.id} onGrant=${grant} />`)}
          </div>`
        : html`<p class="tarena__empty t-lo">${t('本机数据里没有协议源石。')}</p>`}
    </div>
  </section>`;
}

/** The panel's HUD toggle (a gear-sized button), mirroring ui/damageReport.js DamageReportButton. */
export function TestArenaButton({ open, onToggle = null, class: cls }) {
  return html`<button type="button" class=${cx('gm__gear', 'gm__test', open && 'is-on', cls)}
      aria-expanded=${open ? 'true' : 'false'} aria-label=${t('测试场')} title=${t('测试场')}
      onClick=${() => onToggle?.(!open)}><${Icon} name="dots" /></button>`;
}
