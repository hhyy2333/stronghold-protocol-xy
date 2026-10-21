// 协议源石禁用 (业主 2026-10-21) — the fourth tab of the 干员调配 overlay: pick up to 3 protocol-originium cards that
// must NOT be offered in THIS player's own drafts. An out-of-match setting like 干员持有 / 自选编队: the picks live in
// ui/hexBanModel.js (localStorage `sp.pref.hexBans`) and reach the server through ui/loadoutSync.js (`room.hexBans`).
//
// The panel is deliberately a simple searchable list of cards (name, tier, effect text) rather than another card deck:
// the overlay's deck machinery belongs to 干员调配, and this tab's only job is picking at most three ids.

import { useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Icon, TextField } from '../ui/components.js';
import { data, useData } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { HEX_BANS_LIMIT } from '../../../shared/protocol.js';
import { rarityName } from '../ui/hexOverlay.js';

/** One row of the list: the card's tier label (data/hextech.json rarities) + its name and effect. */
function TierLabel({ rarity }) {
  return html`<span class="hxb__tier hxb__tier--${rarity || 'silver'}">${t(rarityName(rarity || 'silver'))}</span>`;
}

/**
 * 协议源石禁用 panel.
 * @param {{ m: any, ids: string[], onToggle: (id: string) => void }} props `onToggle` decides the cap (toast) and edits
 *   the stored list; the panel itself only renders.
 */
export function HexBanPanel({ m, ids = [], onToggle }) {
  void m;
  const ready = useData('hextech');
  const [query, setQuery] = useState('');
  const all = useMemo(() => {
    const map = data.get('hextech')?.playerHexes || {};
    return Object.values(map).filter((h) => h && typeof h.id === 'string');
  }, [data.locale(), ready]);
  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    const rows = all.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
    if (!q) return rows;
    return rows.filter((h) => `${t(h.name || '')} ${t(h.desc || '')} ${h.id}`.toLowerCase().includes(q));
  }, [all, q]);
  const banned = new Set(ids);
  const full = ids.length >= HEX_BANS_LIMIT;
  return html`<main class="lo-body hxb">
    <section class="hxb__list" aria-label=${t('协议源石列表')}>
      <div class="hxb__search">
        <${TextField} value=${query} onInput=${(v) => setQuery(v)} placeholder=${t('搜索协议源石（名称或效果）')} />
        <span class="hxb__count num" data-testid="hexbans-count">${t('已禁用')} <b>${ids.length}</b><span class="t-dim">/${HEX_BANS_LIMIT}</span></span>
      </div>
      <div class="hxb__grid">
        ${list.length ? list.map((h) => {
          const on = banned.has(h.id);
          return html`<button key=${h.id} type="button" data-testid=${`hexban-${h.id}`} aria-pressed=${on ? 'true' : 'false'}
              class=${`hxb__card${on ? ' is-on' : ''}${!on && full ? ' is-full' : ''}`} onClick=${() => onToggle(h.id)}
              title=${t(h.desc || '')}>
            <span class="hxb__head"><${TierLabel} rarity=${h.rarity} /><b class="hxb__name">${t(h.name || h.id)}</b>
              <span class="hxb__mark" aria-hidden="true">${on ? html`<${Icon} name="check" />` : null}</span></span>
            <span class="hxb__desc">${t(h.desc || '')}</span>
          </button>`;
        }) : html`<p class="lo-empty t-dim">${t('没有符合条件的协议源石')}</p>`}
      </div>
    </section>
    <aside class="hxb__side" aria-label=${t('已禁用的协议源石')}>
      <p class="hxb__lead"><${Icon} name="info" />${t('局外设置：下一局生效，只影响你自己的协议源石抽取')}</p>
      <p class="hxb__help">${t('最多禁用 {n} 张。被禁用的卡不会出现在你自己的抽取、刷新与随机获得中。', { n: HEX_BANS_LIMIT })}</p>
      <ol class="hxb__picked">
        ${Array.from({ length: HEX_BANS_LIMIT }, (_, i) => {
          const id = ids[i] || null;
          const rec = id ? all.find((h) => h.id === id) : null;
          return html`<li key=${i} class=${`hxb__slot${rec ? ' is-filled' : ''}`}>
            ${rec ? html`<${TierLabel} rarity=${rec.rarity} /><span class="hxb__slotname">${t(rec.name || id)}</span>
              <button type="button" class="hxb__remove" title=${t('取消禁用')} aria-label=${t('取消禁用')} onClick=${() => onToggle(id)}><${Icon} name="close" /></button>`
              : html`<span class="hxb__slotempty">${t('未选择')}</span>`}
          </li>`;
        })}
      </ol>
    </aside>
  </main>`;
}
