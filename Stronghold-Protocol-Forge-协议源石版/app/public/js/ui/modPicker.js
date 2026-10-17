// public/js/ui/modPicker.js — the room-mod picker (W-A/G3, DESIGN §28.9/§28.16) and the mod row it is built from.
//
// Two screens show the same choice: the lobby (the host ticks the packs THIS room will declare, `room.create.modIds`)
// and the room (the host edits the set after creation, `room.mods`). `ModPicker` is the lobby's block; `ModList` is the
// rows alone, which is what the room's edit panel renders inside its own panel.
//
// ▸ The wire (`welcome.mods.packs`) carries an IDENTITY, not a display name: `{ id, hash, layer, combat, api? }`.
//   The human name lives in the catalogue (`GET /mods/catalog.json`, server/modCatalog.js), so this module asks
//   `mods/align.js loadCatalog()` once for the names and falls back to the pack id whenever that answer is not there
//   yet (or at all). A picker that waited on the catalogue would be a picker that never renders offline; a picker that
//   showed only ids would hide what the author actually called the pack.
//
// ▸ Nothing here decides which ids are legal: `roomMods.js` is that one truth (`availableMods` / `setSelectedModIds`
//   drop unknown ids), and the server refuses MOD_UNKNOWN regardless. This module only renders and reports clicks.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel } from './components.js';
import { t, N_ } from '../../../shared/i18n.js';
import { useStore, shallowEqual } from '../store.js';
import { loadCatalog } from '../mods/align.js';

/** One-line name of a pack's layer (DESIGN §28.1): what kind of content the pack brings. */
export const LAYER_TEXT = { A: N_('数据'), B: N_('逻辑'), C: N_('客户端') };

/**
 * @typedef {{ id: string, layer?: string, combat?: boolean, name?: string }} ModPack
 * @typedef {(id: string) => void} ModToggle
 */

/**
 * Display names for the packs on screen, from the server's catalogue.
 *
 * The catalogue is cached per page (`mods/align.js`), so opening a room afterwards sees the same request. Until it
 * arrives — or when it cannot be read at all — every row renders its pack id, which is still a perfectly valid label.
 * @param {ModPack[]} packs the entries to name
 * @returns {Record<string, string>} pack id → name (possibly empty)
 */
export function useModNames(packs) {
  const idsKey = (Array.isArray(packs) ? packs : [])
    .map((p) => (p && typeof p.id === 'string' ? p.id : ''))
    .filter(Boolean)
    .join('|');
  /** @type {[Record<string, string>, (next: Record<string, string>) => void]} */
  const [names, setNames] = useState({});
  useEffect(() => {
    if (!idsKey) return undefined;
    let live = true;
    loadCatalog().then((catalog) => {
      if (!live || !catalog || !Array.isArray(catalog.packs)) return;
      /** @type {Record<string, string>} */
      const next = {};
      for (const pack of catalog.packs) {
        if (pack && typeof pack.id === 'string' && typeof pack.name === 'string' && pack.name) next[pack.id] = pack.name;
      }
      if (Object.keys(next).length) setNames(next);
    }).catch(() => {
      // A name is a convenience. The id below it is the identity the server actually keys on, so a failed catalogue
      // leaves a readable row rather than an error state.
    });
    return () => { live = false; };
  }, [idsKey]);
  return names;
}

/**
 * Split an author's catalogue name at its trailing parenthetical: 「克莱门莎 addition（5星干员 + 驻守特质）」 becomes the
 * pack's short name plus its own description. The row then keeps the short name on one line (the part a player scans)
 * and the parenthetical as a dim second line, instead of wrapping the whole string in the middle of a word.
 * @param {string} label
 * @returns {{ head: string, detail: string }}
 */
export function splitModName(label) {
  const m = /^(.*?)[（(]([^（）()]*)[）)]\s*$/.exec(typeof label === 'string' ? label : '');
  const head = m && m[1].trim() ? m[1].trim() : (label || '');
  return { head, detail: m ? m[2].trim() : '' };
}

/**
 * One selectable pack: a checkbox row with the author's name, the pack id, the layer and the combat warning.
 *
 * The whole row is the control. `role="checkbox"` (rather than `aria-pressed`) is what a multi-select list means, and
 * it keeps Space / Enter working for free because the element is a real <button>.
 * @param {{ pack: ModPack, name?: string, selected: boolean, onToggle?: ModToggle }} props
 */
export function ModChip({ pack, name, selected, onToggle }) {
  const label = (name && name !== pack.id ? name : '') || pack.id;
  const { head, detail } = splitModName(label);
  return html`<button type="button" class=${`mod-chip${selected ? ' is-on' : ''}`}
    role="checkbox" aria-checked=${selected ? 'true' : 'false'}
    title=${name && name !== pack.id ? `${name} · ${pack.id}` : pack.id}
    onClick=${() => onToggle && onToggle(pack.id)}>
    <span class="mod-chip__box" aria-hidden="true"><${Icon} name="check" /></span>
    <span class="mod-chip__body">
      <span class="mod-chip__name">${head}</span>
      ${detail ? html`<span class="mod-chip__sub">（${detail}）</span>` : null}
      <span class="mod-chip__meta">
        ${name && name !== pack.id ? html`<span class="mod-chip__id">${pack.id}</span>` : null}
        ${pack.layer ? html`<span class="mod-chip__tag">${t(LAYER_TEXT[pack.layer] || pack.layer)}</span>` : null}
        ${pack.combat ? html`<span class="mod-chip__tag mod-chip__tag--combat"><${Icon} name="warn" />${t('会改动战斗结果')}</span>` : null}
      </span>
    </span>
  </button>`;
}

/**
 * The rows alone: one `ModChip` per pack, in the server's order (id-sorted, so two clients see the same list).
 * @param {{ packs: ModPack[], selected: string[], onToggle?: ModToggle, names?: Record<string, string> }} props
 */
export function ModList({ packs, selected, onToggle, names = {} }) {
  const on = Array.isArray(selected) ? selected : [];
  return html`<ul class="mod-list">
    ${(Array.isArray(packs) ? packs : []).map((pack) => html`<li key=${pack.id}>
      <${ModChip} pack=${pack} name=${names[pack.id]} selected=${on.includes(pack.id)} onToggle=${onToggle} />
    </li>`)}
  </ul>`;
}

/**
 * 本房间使用 mod (W-A, DESIGN §28.9): the host ticks the packs THIS server declared, and the pick travels as
 * `room.create.modIds`. The list comes from `welcome.mods.packs` (main.js writes it into store.roomMods), so it can only
 * ever offer content the server has — the server refuses an unknown id with MOD_UNKNOWN rather than guessing.
 *
 * Rendered only when the server declared at least one pack; on a plain install this component returns nothing and the
 * create button sends exactly what it always did.
 * @param {{ selected: string[], onToggle?: ModToggle, onSelect?: (ids: string[]) => void }} props
 *   `onSelect` sets the WHOLE list in one write (the 全选 / 清空 buttons); without it those buttons fall back to
 *   individual `onToggle` calls, so the component is still usable on its own.
 */
export function ModPicker({ selected, onToggle, onSelect }) {
  const { available } = useStore((s) => s.roomMods, shallowEqual);
  const names = useModNames(available);
  if (!available.length) return null;
  const on = Array.isArray(selected) ? selected : [];
  const total = available.length;
  const count = available.reduce((n, p) => n + (on.includes(p.id) ? 1 : 0), 0);
  const allOn = count === total;
  const ids = available.map((p) => p.id);
  const emit = (next) => {
    if (typeof onSelect === 'function') { onSelect(next); return; }
    for (const id of next) if (!on.includes(id)) onToggle && onToggle(id);
    for (const id of on) if (!next.includes(id)) onToggle && onToggle(id);
  };
  const selectAll = () => emit(allOn ? [] : ids);
  const clearAll = () => emit([]);
  return html`<section class="mod-picker" aria-label=${t('本房间使用的模组')}>
    <div class="mod-picker__head">
      <${MicroLabel} tone="mint">ROOM MODS<//>
      <h3 class="mod-picker__title">${t('本房间使用的模组')}</h3>
      <span class="mod-picker__count num" aria-label=${t('已选 {n} / {m}', { n: count, m: total })}>
        <b>${count}</b><i>/${total}</i>
      </span>
    </div>
    <${ModList} packs=${available} selected=${on} onToggle=${onToggle} names=${names} />
    <div class="mod-picker__foot">
      <p class="mod-picker__status" role="status" aria-live="polite">
        <${Icon} name="info" />
        ${count
          ? html`<span>${t('本房间将声明 {n} 个模组：只运行勾选的模组', { n: count })}</span>`
          : html`<span>${t('不勾选 = 本房间不声明模组（模拟仍按服务器加载的全部模组运行）')}</span>`}
      </p>
      ${total > 1 ? html`<span class="mod-picker__acts">
        <button type="button" class="mod-act" disabled=${allOn} onClick=${selectAll}>${t('全选')}</button>
        <button type="button" class="mod-act" disabled=${count === 0} onClick=${clearAll}>${t('清空')}</button>
      </span>` : null}
    </div>
  </section>`;
}
