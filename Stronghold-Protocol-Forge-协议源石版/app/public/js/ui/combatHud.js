// Combat HUD (research 06 §11.3/§11.7, research 09 §3.1 / §6.3): DP counter at the right edge and the bottom-centre
// pills.
//   Client-side combat (`client` prop, DESIGN §14 — the official behaviour):
//     * own normal battle over: "⌛ 作战结束，等待队友完成作战" with each teammate's live progress (kills / total, ✓);
//     * observing a teammate (team row → 前往查看): "👁 name" + 返回战场;
//     * 联防 / 最终攻势: the ‹ › pill switches the camera LEFT half / 全景 / RIGHT half ("你自己" / name / "全景"); it
//       replaces the observing pill on such a field watched with 前往查看 (a 联防 leaker, an eliminated spectator — the
//       official non-helper pill "‹ 👁 helper# ›"), with 返回战场 beside the arrows (DESIGN §20.15);
//     * there is NO view switcher during normal combat.
//   Server-run combat (legacy streaming mode): the ‹ 自己 › switcher cycling the live fields of m.public.fields.

import { html, Icon, MicroLabel } from './components.js';
import { DpCounter } from './hud.js';
import { GIcon } from './gameComponents.js';
import { switcherLabel, cycleField } from './gameLogic.js';
import { PROF_NAME } from './loadoutModel.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Damage-type labels — the same four ui/detailPanel.js uses (the words are already in every i18n pack). */
const DMG_NAME = { phys: N_('物理'), arts: N_('法术'), true: N_('真实'), heal: N_('治疗'), none: N_('无') };

/**
 * 指令之意 / 指令之意·改: **which** profession / damage type the card rolled for me in this battle.
 *
 * Both cards decide their effect with a coin flip when a battle starts — 「作战开始时随机指定一种职业 / 一种伤害类型」
 * (server/sim/content/hexcards/batch10.js). That roll used to be invisible: the buff landed on whoever it landed on and
 * the player had to infer the class from who hit harder. The sim now publishes it as snap.dirs (sim/battle/events.js)
 * → hud.dirs (ui/gameLogic/format.js snapHud), one row per (player, card): [playerId, hexId, kind, pick, amount].
 * This renders MY rows — both cards, if I own both.
 *
 * The label is a MicroLabel's literal HEXTECH plus the rolled name; both words come from label maps that are already
 * translated, so this adds no new UI string and no new i18n entry.
 *
 * PLACEMENT: the right edge, directly under the DP counter and sharing its horizontal split. The effects column sits at
 * right .3rem and is .5rem wide (left edge at right .8rem) while this and the counter stop at right 1.1rem, so neither
 * can cover the column however tall the window is (test/ui/effectsColumn.test.js pins the same invariant).
 */
function HexDirectives({ hud, myId }) {
  const rows = Array.isArray(hud && hud.dirs) ? hud.dirs.filter((r) => Array.isArray(r) && r[0] === myId) : [];
  if (!rows.length) return null;
  return html`<div class="hexdirs">
    ${rows.map(([, hexId, kind, pick, amount]) => {
      const name = hexId === 'hex_directive2' ? '指令之意·改' : '指令之意';
      const what = kind === 'prof' ? t(PROF_NAME[pick]) : t(DMG_NAME[pick]);
      if (!what) return null;
      const val = kind === 'prof' ? `${amount >= 0 ? '+' : ''}${amount}%` : `×${(amount / 100).toFixed(amount % 100 ? 2 : 1)}`;
      return html`<div class="hexdir" key=${hexId} title=${name}>
        <${MicroLabel}>HEXTECH</${MicroLabel}>
        <b class="hexdir__val">${name} <span>${what} ${val}</span></b>
      </div>`;
    })}
  </div>`;
}

/** Teammates' progress under the waiting pill (css/screens/game.css .chud__progress / .chud__prog). */
function ProgressList({ list }) {
  if (!Array.isArray(list) || !list.length) return null;
  return html`<div class="chud__progress" role="list" aria-label=${t('队友作战进度')}>
    ${list.map((p) => html`<span key=${p.playerId} role="listitem" class=${cx('chud__prog', p.done && 'is-done')}>
      <b>${p.name}</b>
      ${p.done
        ? html`<span class="chud__prog__ok" aria-label=${t('作战结束')}>✓</span>`
        : html`<span class="num">${(p.resolved ?? p.killed) != null && p.total != null ? `${p.resolved ?? p.killed}/${p.total}` : '•••'}</span>`}
    </span>`)}
  </div>`;
}

/**
 * @param {{ pub:any, myId:string, watching:string|null, hud:any, myDone:boolean, onWatch:(fieldId:string)=>void, spectating?: boolean,
 *   client?: null | { progress?: any[]|null, observing?: { name: string }|null, onBack?: () => void,
 *                     layers?: Array<{ key: string, label: string, self: boolean, watch: boolean }>, layer?: string, onLayer?: (k: string) => void } }} props
 */
export function CombatHud({ pub, myId, watching, hud, myDone, onWatch, spectating = false, spectator = false, client = null }) {
  // `spectator`: a spectator seat (community report #26) watches like an eliminated player, under its own caption
  if (client) return ClientHud({ hud, myId, myDone, spectating, spectator, client });
  const fields = (Array.isArray(pub?.fields) ? pub.fields : []).filter((f) => f && f.live !== false);
  // the watched field may already have finished (not live): still name it
  const label = switcherLabel(pub, watching, myId, spectating);
  const canCycle = fields.length > 1;
  return html`<div class="chud">
    <${DpCounter} dp=${hud?.dp} />
    <${HexDirectives} hud=${hud} myId=${myId} />
    <div class="chud__bottom">
      ${myDone ? html`<div class="chud__msg" role="status"><${Icon} name="hourglass" /><span>${t('作战结束，等待队友完成作战')}</span></div>` : null}
      ${spectating ? (spectator ? html`<div class="chud__msg" role="status"><${GIcon} name="eye" /><span>${t('观战中')}</span></div>`
        : html`<div class="chud__msg chud__msg--dead" role="status"><${Icon} name="close" /><span>${t('你已被淘汰，正在观战')}</span></div>`) : null}
      ${fields.length ? html`<div class=${cx('vswitch', !canCycle && 'is-single')}>
        <button type="button" class="vswitch__arrow" disabled=${!canCycle} aria-label=${t('上一个战场')}
          onClick=${() => { const n = cycleField(fields, watching, -1); if (n && n !== watching) onWatch(n); }}><${Icon} name="chevronLeft" /></button>
        <span class="vswitch__label">${label}</span>
        <button type="button" class="vswitch__arrow" disabled=${!canCycle} aria-label=${t('下一个战场')}
          onClick=${() => { const n = cycleField(fields, watching, 1); if (n && n !== watching) onWatch(n); }}><${Icon} name="chevronRight" /></button>
      </div>` : null}
    </div>
  </div>`;
}

function ClientHud({ hud, myId, myDone, spectating, spectator = false, client }) {
  const layers = Array.isArray(client.layers) ? client.layers : [];
  const idx = Math.max(0, layers.findIndex((l) => l.key === (client.layer || 'ALL')));
  const cur = layers[idx] || null;
  const step = (d) => {
    if (!layers.length || !client.onLayer) return;
    const n = Math.min(layers.length - 1, Math.max(0, idx + d));
    if (n !== idx) client.onLayer(layers[n].key);
  };
  const observing = client.observing;
  const halves = layers.length > 0;
  return html`<div class="chud">
    <${DpCounter} dp=${hud?.dp} />
    <${HexDirectives} hud=${hud} myId=${myId} />
    <div class="chud__bottom">
      ${myDone && !observing ? html`<div class="chud__msg chud__wait" role="status"><${Icon} name="hourglass" /><span>${t('作战结束，等待队友完成作战')}</span></div>
        <${ProgressList} list=${client.progress} />` : null}
      ${spectating && !observing ? (spectator ? html`<div class="chud__msg" role="status"><${GIcon} name="eye" /><span>${t('观战中，可点击左侧成员头像前往查看')}</span></div>`
        : html`<div class="chud__msg chud__msg--dead" role="status"><${Icon} name="close" /><span>${t('你已被淘汰，可点击队友头像前往查看')}</span></div>`) : null}
      ${observing && !halves ? html`<div class="vswitch chud__observe is-single" role="status">
        <span class="vswitch__label"><${GIcon} name="eye" /><span>${observing.name}</span></span>
        ${client.onBack ? html`<button type="button" class="btn btn--secondary btn--sm chud__back" onClick=${() => client.onBack()}>
          <span class="btn__label">${t('返回战场')}</span></button>` : null}
      </div>` : null}
      ${halves ? html`<div class=${cx('vswitch', 'chud__layers', observing && 'is-observing')}>
        <button type="button" class="vswitch__arrow" disabled=${idx <= 0} aria-label=${t('左侧战场')} onClick=${() => step(-1)}><${Icon} name="chevronLeft" /></button>
        <span class="vswitch__label">
          ${cur && cur.watch ? html`<${GIcon} name="eye" />` : null}<span>${cur ? cur.label : t('全景')}</span></span>
        <button type="button" class="vswitch__arrow" disabled=${idx >= layers.length - 1} aria-label=${t('右侧战场')} onClick=${() => step(1)}><${Icon} name="chevronRight" /></button>
        ${observing && client.onBack ? html`<button type="button" class="btn btn--secondary btn--sm chud__back" onClick=${() => client.onBack()}>
          <span class="btn__label">${t('返回战场')}</span></button>` : null}
      </div>` : null}
    </div>
  </div>`;
}
