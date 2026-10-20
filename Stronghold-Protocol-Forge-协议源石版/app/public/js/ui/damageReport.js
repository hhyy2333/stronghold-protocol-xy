// In-battle DAMAGE REPORT (伤害统计): the floating panel the HUD's 📊 button opens — what every operator of the battle
// on screen has done, biggest first, with its share of the total (the official 干员 / 伤害占比 · 实际伤害 layout).
// Read-only: it never touches the sim, and the numbers are the sim's own (`unit.stats`, damage.js applyHpLoss / heal).
//
// THREE METRICS, one row shape. The panel's own 伤害 / 承伤 / 治疗 buttons switch which column the list is ranked and
// totalled by (REPORT_METRICS):
//   dmg   造成的伤害 — `unit.stats.dmg`: the HP actually removed from the OTHER side, so shields, overkill, dodges, a
//         cancelled 限伤 hit and the unit's own 流失 count nothing; 无来源 element bursts credit the unit that filled
//         the gauge (PRTS 元素). The player's `damageDealt` is the sum of these rows.
//   taken 承受的伤害 — `unit.stats.taken`: every HP the unit lost to a damage instance, whoever dealt it.
//   heal  治疗量 — `unit.stats.heal`: HP actually restored (治疗加成 / 禁疗 applied; a `regen` tick is not a 治疗).
//
// TWO DATA SOURCES, one row shape:
//   * client-side combat (DESIGN §14, the default): the game screen calls `battleRunner.damageReport()` (the browser
//     runner's live Battle through server/sim/spec.js damageReport) — summon numbers folded into the operator that
//     deployed it, the board uid kept;
//   * server-run combat (the legacy streaming mode): the newest b.snap `dmg` list (snapshot.js damageView) joined with
//     the field meta's UnitInfo (`snapshotDamageRows`), which carries the same per-unit rows at 20 Hz.
//   * 修整期 (PREP and the other non-combat phases) has no battle to read: the panel shows the match-long totals the
//     server accumulates per operator (`cumulativeRows` over m.private `cumStats`), under its own 本局累计 caption.
// Either way a row that acted on its own (an ownerless summon, a “双眼皮” turret) is listed, so no number is lost.
//
// 随当前视角同步 (the panel's own line): a battle report follows the battle ON SCREEN. A 联防 / 最终攻势 field holds
// several players' units, so `players` filters the rows to the halves in the current camera view; without it every player
// of the field is listed (a solo field: one player). 实时 shows the live total as the battle runs; freezing it keeps the
// last numbers on screen (the official 实时 toggle). The cumulative view is never live: it only moves between rounds.
//
// The footer's 统计口径 spells out what the selected number is, because a panel nobody can explain is worse than none.

import { html, Icon, MicroLabel } from './components.js';
import { UnitThumb, GIcon } from './gameComponents.js';
import { standInOf, diyRecordFor } from './gameLogic.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Rows the panel lists at most (a board holds a dozen units; a wider list scrolls). */
export const REPORT_MAX_ROWS = 12;

/**
 * The metrics the panel switches between, in button order: the row field, its label and the two captions the header
 * uses (the total's caption and the column header). Module level, so the strings are N_() and translated where shown.
 */
export const REPORT_METRICS = Object.freeze([
  { id: 'dmg', field: 'dmg', label: N_('伤害'), total: N_('累计伤害'), column: N_('干员 / 伤害占比'), value: N_('实际伤害') },
  { id: 'taken', field: 'taken', label: N_('承伤'), total: N_('累计承伤'), column: N_('干员 / 承伤占比'), value: N_('承受伤害') },
  { id: 'heal', field: 'heal', label: N_('治疗'), total: N_('累计治疗'), column: N_('干员 / 治疗占比'), value: N_('治疗量') },
]);

/** The metric record of an id (unknown / absent → 伤害, the panel's default). */
export function metricOf(id) {
  return REPORT_METRICS.find((m) => m.id === id) || REPORT_METRICS[0];
}

/** Thousands-separated number — the panel's own digits (the HUD's fmtNum compacts to 万 and would hide them). */
export function fmtDamage(v) {
  return Math.round(Number(v) || 0).toLocaleString('en-US');
}

/**
 * Rows of a b.snap `dmg` list joined with a field meta's UnitInfo — the server-run combat path.
 *
 * `dmg` = `[[id, dealt, taken, heal, kills, foldId]]` (snapshot.js damageView): a summon's `foldId` names the operator
 * its numbers are credited to. The join gives each row its name / defId / kind / uid / 补位 / 自选 marks from the meta
 * (`field.units`, the same UnitInfo the renderer draws). A row whose unit the meta does not name keeps its id as its
 * name (a unit that spawned after the meta was taken) — never dropped.
 *
 * @param {any[]|null|undefined} units m.field.units (UnitInfo[])
 * @param {any[]|null|undefined} dmg the latest snapshot's `dmg` list
 * @param {{ max?: number }} [o]
 */
export function snapshotDamageRows(units, dmg, o = {}) {
  const byId = new Map();
  for (const u of Array.isArray(units) ? units : []) if (u && Number.isInteger(u.id)) byId.set(u.id, u);
  const raw = [];
  for (const tuple of Array.isArray(dmg) ? dmg : []) {
    if (!Array.isArray(tuple) || !Number.isInteger(tuple[0])) continue;
    const info = byId.get(tuple[0]) || null;
    const foldId = Number.isInteger(tuple[5]) ? tuple[5] : null;
    const owner = foldId != null ? byId.get(foldId) || null : null;
    // fold onto the owner's row when the meta names it, so a summon and its owner read as one row here too. The key is
    // the board uid whenever there is one — the same key the unit's OWN row takes — or the engine id for a unit with no
    // board piece (a summon, a device); both rows of a fold must land on one key.
    const src = owner || info;
    const key = src && Number.isInteger(src.uid) ? `u${src.uid}` : `i${tuple[0]}`;
    raw.push({
      key, uid: info && Number.isInteger(info.uid) ? info.uid : null,
      defId: src?.defId ?? null, name: src?.name ?? '', kind: src?.kind ?? 'op', ownerId: src?.ownerId ?? null,
      dmg: Number(tuple[1]) || 0, taken: Number(tuple[2]) || 0, heal: Number(tuple[3]) || 0,
      kills: Math.max(0, Math.trunc(Number(tuple[4]) || 0)), folded: owner ? 1 : 0,
      standInFor: src?.standInFor ?? null, diy: src?.diy ?? null,
      golden: !!src?.golden, tier: Number.isInteger(src?.tier) ? src.tier : 1,
    });
  }
  return normalizeRows(raw, o);
}

/**
 * The rows of m.private `cumStats` (server/player/round.js cumStatsView) — the 修整期 view: one per operator that has
 * fought in any battle of the match so far, its totals over the whole match. The server already keys and folds them
 * (by chess id, a summon onto its owner), so this only normalises: `key` stays the server's, `ownerId` is null (the
 * rows belong to this one player, so the camera filter does not apply), and `folded` is 0 (the fold already happened).
 * @param {any[]|null|undefined} cum m.private.cumStats
 * @param {{ max?: number }} [o]
 */
export function cumulativeRows(cum, o = {}) {
  const raw = [];
  for (const r of Array.isArray(cum) ? cum : []) {
    if (!r || typeof r.defId !== 'string') continue;
    raw.push({
      key: typeof r.key === 'string' ? r.key : `def:${r.defId}`,
      uid: null, defId: r.defId, name: typeof r.name === 'string' ? r.name : '', kind: r.kind === 'token' ? 'token' : 'op',
      ownerId: null, dmg: Number(r.dmg) || 0, taken: Number(r.taken) || 0, heal: Number(r.heal) || 0,
      kills: Math.max(0, Math.trunc(Number(r.kills) || 0)), folded: 0,
      standInFor: null, diy: null, golden: !!r.golden, tier: Number.isInteger(r.tier) ? r.tier : 1,
    });
  }
  return normalizeRows(raw, o);
}

/**
 * Fold raw rows onto one row per key (spec.js damageReport is already folded; the snapshot path is not when the meta
 * lacks the summon), round for display, drop the rows with nothing in ANY metric, and order by damage → knock-outs →
 * board uid. NOT capped here: the cap belongs to `rankRows`, which runs after the metric is known — capping by damage
 * first would drop the very rows a 治疗 / 承伤 view exists to show.
 * @param {any[]} raw
 */
export function normalizeRows(raw) {
  const map = new Map();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r.key !== 'string') continue;
    let row = map.get(r.key);
    if (!row) {
      row = { ...r, dmg: 0, taken: 0, heal: 0, kills: 0, folded: 0 };
      map.set(r.key, row);
    }
    row.dmg += Number(r.dmg) || 0;
    row.taken += Number(r.taken) || 0;
    row.heal += Number(r.heal) || 0;
    row.kills += Math.max(0, Math.trunc(Number(r.kills) || 0));
    row.folded += Math.max(0, Math.trunc(Number(r.folded) || 0));
  }
  const out = [];
  for (const row of map.values()) if (row.dmg > 0 || row.taken > 0 || row.heal > 0) out.push(row);
  out.sort((a, b) => b.dmg - a.dmg || b.kills - a.kills || (a.uid ?? 0) - (b.uid ?? 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const row of out) { row.dmg = Math.round(row.dmg); row.taken = Math.round(row.taken); row.heal = Math.round(row.heal); }
  return out;
}

/**
 * Rows ranked by the selected metric, biggest first (the panel's list order), then knock-outs, then board uid, then key,
 * cut to `max`. The rows with nothing in that metric are dropped — an operator that only healed has no row under 伤害.
 * This is where the list is capped, so the cap follows the SELECTED metric: the 治疗 view lists the top healers even
 * when they are nowhere near the top of 伤害.
 * @param {any[]} rows @param {string} metric a REPORT_METRICS id @param {{ max?: number }} [o]
 */
export function rankRows(rows, metric = 'dmg', { max = REPORT_MAX_ROWS } = {}) {
  const field = metricOf(metric).field;
  const out = (Array.isArray(rows) ? rows : []).filter((r) => r && (Number(r[field]) || 0) > 0);
  out.sort((a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0) || b.kills - a.kills
    || (a.uid ?? 0) - (b.uid ?? 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out.slice(0, Math.max(1, max));
}

/**
 * The rows of the given players' units (null / [] = every player of the field). A row without an owner (a device, an
 * ownerless token) stays in: it acted on the field on screen.
 * @param {any[]} rows @param {string[]|null|undefined} players
 */
export function filterByPlayers(rows, players = null) {
  const list = Array.isArray(rows) ? rows : [];
  if (!Array.isArray(players) || !players.length) return list;
  const set = new Set(players.filter((p) => typeof p === 'string' && p));
  if (!set.size) return list;
  return list.filter((r) => !r || r.ownerId == null || set.has(r.ownerId));
}

/**
 * The report's total for one metric: the sum of the rows shown. `players` filters first, so the total always matches the
 * list (随当前视角同步); rows with nothing in that metric contribute 0.
 * @param {any[]} rows @param {string} metric a REPORT_METRICS id @param {string[]|null} [players]
 */
export function reportTotal(rows, metric = 'dmg', players = null) {
  const field = metricOf(metric).field;
  let n = 0;
  for (const r of filterByPlayers(rows, players)) n += Number(r && r[field]) || 0;
  return Math.round(n);
}

/**
 * A row's share of the report's total, 0–1 (0 without a total).
 * @param {number} value @param {number} total
 */
export function shareFrac(value, total) {
  const n = Number(value), d = Number(total);
  if (!(n > 0) || !(d > 0)) return 0;
  return Math.min(1, n / d);
}

/**
 * The percentage text of a share (shareFrac): whole percents from 10 % up, one decimal below (a 0.4 % contributor still
 * reads as one), '0%' for nothing. null when there is no share to show.
 * @param {number} frac
 */
export function sharePct(frac) {
  if (!Number.isFinite(frac)) return null;
  const pct = Math.max(0, Math.min(1, frac)) * 100;
  if (pct <= 0) return '0%';
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(1)}%`;
}

/**
 * The record a row draws: a 补位 stand-in's, a 自选 pick's, else null (the chess itself). The same rules as the detail
 * card's own thumbnails (gameLogic standInOf / diyRecordFor: both compose the operator's body while keeping the chess's
 * identity).
 * @param {any} row @param {(id: string) => any} getChess @param {any} backups
 * @param {{ chess?: any, backups?: any }|null} [diyData] the DIY data (the composed record needs it, ui/gameLogic/diy.js)
 */
export function rowRecord(row, getChess, backups, diyData = null) {
  const chess = row && row.kind === 'op' && typeof row.defId === 'string' ? getChess(row.defId) : null;
  if (!chess) return null;
  if (typeof row.standInFor === 'string' && row.standInFor) return standInOf({ ...chess, standInFor: row.standInFor }, backups);
  if (row.diy && diyData) return diyRecordFor(chess, row.diy, diyData) || null;
  return null;
}

/**
 * The 统计口径 lines (the footer): what the numbers are, in the sim's own terms — one list per metric, so the footer
 * explains whichever one is selected. Module level, so the strings are N_() and translated where shown.
 */
export const METHOD_LINES = Object.freeze({
  dmg: Object.freeze([
    N_('实际伤害＝该单位从敌方身上扣掉的生命值：过量伤害、闪避、被取消的限伤都不计入；被护盾吸收的部分单列在「护盾吸收」'),
    N_('伤害按 物理 / 法术 / 真实 拆成三段显示（占比条里的三段颜色）；「真实」也收下没有伤害类型的流失'),
    N_('元素损伤灌进元素槽、不扣生命值，所以不并入实际伤害，单列在「元素损伤」'),
    N_('元素爆发本身无来源，但它的伤害记在填满元素槽的那名单位头上'),
    N_('召唤物的伤害并入部署它的干员；没有归属的召唤物与场地装置单独一行'),
    N_('自身流失与友方伤害不算造成伤害'),
  ]),
  taken: Object.freeze([
    N_('承受伤害＝该单位在伤害结算中损失的生命值，来自任何一方的伤害都计入'),
    N_('友方伤害与该单位自身的流失（如源石溶剂、技能代价）同样计入'),
    N_('被护盾挡下的部分不算损失；过量伤害按实际损失计'),
    N_('召唤物与场地装置承受的伤害并入部署它的干员或单独一行，与伤害统计同一口径'),
  ]),
  heal: Object.freeze([
    N_('治疗量＝实际回复的生命值：治疗加成与禁疗都已结算，回复到生命上限之外的部分不计入'),
    N_('生命回复速度（每秒回血）不算治疗，因此不计入'),
    N_('护盾与元素损伤的回复不属于治疗'),
    N_('召唤物与场地装置的治疗并入部署它的干员或单独一行，与伤害统计同一口径'),
  ]),
});

/** The method lines of a metric (METHOD_LINES). */
export function methodLines(metric = 'dmg') {
  return METHOD_LINES[metricOf(metric).id] || METHOD_LINES.dmg;
}

/**
 * One row: rank, avatar, name (with the 含召唤 tag when the operator's row absorbed summons), the share bar, and the
 * value + share on the right (the official 干员 / 占比 · 数值 columns; the metric picks the number).
 * @param {{ row: any, rank: number, total: number, metric?: string, rec?: any }} props
 */
/** The label of every figure the detail block shows (msgids, translated where drawn). */
const TYPE_LABELS = Object.freeze({
  phys: N_('物理'), arts: N_('法术'), true: N_('真实'), elem: N_('元素损伤'), absorbed: N_('护盾吸收'),
  taken: N_('承伤'), heal: N_('治疗'), kills: N_('击杀'),
});

/**
 * 一名干员的详细伤害类型（业主 2026-10-20「点击干员头像可以看他的详细伤害类型」）。
 *
 * 列表那一行只有一根三段条；点开头像展开这一块，把**每一类**都写成「名字 + 数值 + 占实际伤害的比例」：HP 伤害的
 * 物理 / 法术 / 真实，另加两个从来不是 HP 伤害的量（元素损伤填的是元素槽、护盾吸收吃的是屏障），以及承伤 / 治疗 / 击杀。
 * 纯展示：每个数字都是那一行的字段，不在这里做任何新计算。
 * @param {{ row: any }} props
 */
export function DamageTypeDetail({ row }) {
  const dmg = Number(row.dmg) || 0;
  const items = [
    { k: 'phys', v: Number(row.phys) || 0 },
    { k: 'arts', v: Number(row.arts) || 0 },
    { k: 'true', v: Number(row.true) || 0 },
  ].filter((x) => x.v > 0);
  const extras = [
    { k: 'elem', v: Number(row.elem) || 0 },
    { k: 'absorbed', v: Number(row.absorbed) || 0 },
    { k: 'taken', v: Number(row.taken) || 0 },
    { k: 'heal', v: Number(row.heal) || 0 },
    { k: 'kills', v: Number(row.kills) || 0, count: true },
  ].filter((x) => x.v > 0);
  const pctOf = (v) => (dmg > 0 ? Math.round((v / dmg) * 1000) / 10 : 0);
  return html`<span class="dmgdet" data-testid="damage-detail" data-key=${row.key}>
    ${items.map((x) => html`<span key=${x.k} class=${`dmgdet__row dmgdet__row--${x.k}`}>
      <span class="dmgdet__k"><i class=${`dmgdet__dot dmgdet__dot--${x.k}`} aria-hidden="true"></i>${t(TYPE_LABELS[x.k])}</span>
      <span class="dmgdet__v num">${fmtDamage(x.v)}</span>
      <span class="dmgdet__p num">${`${pctOf(x.v)}%`}</span>
    </span>`)}
    ${items.length === 0 ? html`<span class="dmgdet__row"><span class="dmgdet__k t-lo">${t('没有实际伤害')}</span></span>` : null}
    ${extras.length ? html`<span class="dmgdet__sub">${extras.map((x) => html`<span key=${x.k} class=${`dmgdet__chip dmgdet__chip--${x.k}`}>
      ${t(TYPE_LABELS[x.k])} <b class="num">${x.count ? x.v : fmtDamage(x.v)}</b></span>`)}</span>` : null}
  </span>`;
}

export function DamageReportRow({ row, rank, total, metric = 'dmg', rec = null, detailOpen = false, onDetail = null }) {
  const m = metricOf(metric);
  const value = Number(row[m.field]) || 0;
  const frac = shareFrac(value, total);
  const pct = sharePct(frac);
  const name = row.name || row.defId || t('未知单位');
  // 业主 2026-10-20「伤害面板不够准确详细」: a damage row is split into 物理 / 法术 / 真实 as three coloured segments of
  // the same share bar, and 元素损伤 / 护盾吸收 / 击杀 are listed as sub-figures. The first two are NOT HP damage, so
  // before this the operator who spent the field filling an element gauge or chewing through 屏障 looked idle.
  const splitTotal = Number(row.phys) + Number(row.arts) + Number(row.true);
  const split = metric === 'dmg' && splitTotal > 0
    ? [{ k: 'phys', v: Number(row.phys) || 0 }, { k: 'arts', v: Number(row.arts) || 0 }, { k: 'true', v: Number(row.true) || 0 }]
      .filter((s) => s.v > 0)
    : null;
  // the inline sub-figures are the summary; once the detail block is open they are printed there in full, so the row
  // drops its own copies (otherwise the same three numbers appear twice in one row)
  const extra = metric === 'dmg' && !detailOpen
    ? [
      Number(row.elem) > 0 ? { k: 'elem', v: row.elem, label: t('元素损伤') } : null,
      Number(row.absorbed) > 0 ? { k: 'absorbed', v: row.absorbed, label: t('护盾吸收') } : null,
      Number(row.kills) > 0 ? { k: 'kills', v: row.kills, label: t('击杀'), raw: true } : null,
    ].filter(Boolean)
    : [];
  return html`<li class=${cx('dmgrow', `dmgrow--${m.id}`, rank === 1 && 'is-top')} data-key=${row.key} data-metric=${m.id}>
    <span class="dmgrow__rank num">${rank}</span>
    <span class="dmgrow__art">
      ${onDetail ? html`<button type="button" class=${cx('dmgrow__artbtn', detailOpen && 'is-open')}
          aria-expanded=${detailOpen ? 'true' : 'false'} aria-label=${t('查看 {name} 的详细伤害类型', { name })}
          title=${t('查看 {name} 的详细伤害类型', { name })}
          data-testid="damage-detail-toggle" data-key=${row.key}
          onClick=${(e) => { e.stopPropagation(); onDetail(detailOpen ? null : row.key); }}>
          ${row.kind === 'op' || row.kind === 'token'
            ? html`<${UnitThumb} kind=${row.kind === 'token' ? 'token' : 'chess'} id=${row.defId} golden=${row.golden} tier=${row.tier}
                size="sm" showTier=${false} rec=${rec} />`
            : html`<span class="dmgrow__dev" aria-hidden="true"><${GIcon} name="target" /></span>`}
        </button>`
        : (row.kind === 'op' || row.kind === 'token'
          ? html`<${UnitThumb} kind=${row.kind === 'token' ? 'token' : 'chess'} id=${row.defId} golden=${row.golden} tier=${row.tier}
              size="sm" showTier=${false} rec=${rec} />`
          : html`<span class="dmgrow__dev" aria-hidden="true"><${GIcon} name="target" /></span>`)}
    </span>
    <span class="dmgrow__who">
      <span class="dmgrow__name">${name}${row.folded > 0
        ? html`<span class="dmgrow__fold" title=${t('含 {n} 个召唤物的数据', { n: row.folded })}>${t('含召唤')}</span>` : null}</span>
      <span class="dmgrow__bar" aria-hidden="true"><span class="dmgrow__fill" style=${`width:${(frac * 100).toFixed(1)}%`}></span></span>
      ${split ? html`<span class="dmgrow__split" aria-hidden="true">${split.map((s) => html`<span key=${s.k}
        class=${`dmgrow__seg dmgrow__seg--${s.k}`} style=${`width:${((s.v / Math.max(1, splitTotal)) * 100).toFixed(1)}%`}></span>`)}</span>` : null}
      ${extra.length ? html`<span class="dmgrow__extra">${extra.map((x) => html`<span key=${x.k} class=${`dmgrow__tag dmgrow__tag--${x.k}`}
        title=${x.label}>${t(x.label)} <b class="num">${x.raw ? x.v : fmtDamage(x.v)}</b></span>`)}</span>` : null}
    </span>
    <span class="dmgrow__num">
      <b class="num">${fmtDamage(value)}</b>
      ${pct ? html`<span class="dmgrow__pct num">${pct}</span>` : null}
    </span>
    ${detailOpen ? html`<${DamageTypeDetail} row=${row} />` : null}
  </li>`;
}

/** "第 N 回合 · 实时累计" / "第 N 回合 · 已冻结" (no round: just the live caption). */
export function reportCaption(round, live) {
  const tail = live ? t('实时累计') : t('已冻结');
  return Number.isFinite(round) && round > 0 ? t('第 {round} 回合 · {tail}', { round, tail }) : tail;
}

/**
 * The floating panel (the HUD's 📊): header (DAMAGE REPORT · 实时 chip · ✕), the metric switch (伤害 / 承伤 / 治疗), the
 * total with the round captions, the column header, the rows, and the 统计口径 footer.
 *
 * Pure view: `rows` / `total` come from the caller (the game screen recomputes them at the HUD's cadence), so the panel
 * never reads a battle itself and a frozen report keeps the numbers it was last handed. `metric` / `onMetric` drive the
 * switch; `cumulative` swaps the captions for the 本局累计 wording (修整期, where there is no running battle).
 *
 * @param {{ rows: any[], total?: number|null, metric?: string, onMetric?: ((id: string) => void)|null,
 *   round?: number|null, live?: boolean, cumulative?: boolean, players?: string[]|null, onClose?: () => void,
 *   onToggleLive?: ((live: boolean) => void)|null, getChess?: (id: string) => any, backups?: any, diyData?: any,
 *   rowRec?: ((row: any) => any)|null, method?: string[] }} props
 */
export function DamageReportPanel({
  rows, total = null, metric = 'dmg', onMetric = null, round = null, live = true, cumulative = false, players = null,
  detailRow = null, onDetail = null,
  onClose = null, onToggleLive = null, getChess = () => null, backups = null, diyData = null, rowRec = null, method = null,
}) {
  // 业主 2026-10-20「点击干员头像可以看他的详细伤害类型」：开的是哪一行由**调用方**记（`detailRow` / `onDetail`）——
  // 面板是不持有状态的纯视图（和 metric / live 同一条规矩），这样测试可以直接把它当函数调。
  const openKey = detailRow == null ? null : detailRow;
  const m = metricOf(metric);
  const list = rankRows(filterByPlayers(rows, players), m.id);
  const sum = Number.isFinite(total) ? total : reportTotal(list, m.id);  const lines = Array.isArray(method) && method.length ? method : methodLines(m.id);
  return html`<section class="dmgrep brackets" role="dialog" aria-label=${t('伤害统计')} data-testid="damage-report" data-metric=${m.id}>
    <header class="dmgrep__head">
      <${MicroLabel} tone="mint">DAMAGE REPORT</${MicroLabel}>
      <div class="dmgrep__acts">
        ${onToggleLive && !cumulative ? html`<button type="button" class=${cx('dmgrep__live', live && 'is-on')} aria-pressed=${live ? 'true' : 'false'}
          title=${live ? t('实时统计：数值随战斗刷新') : t('已冻结：数值停在点击时的样子')} onClick=${() => onToggleLive(!live)}>
          <${Icon} name="edit" /><span>${live ? t('实时') : t('已暂停')}</span></button>` : null}
        <button type="button" class="dmgrep__x" aria-label=${t('关闭')} title=${t('关闭')} onClick=${() => onClose?.()}><${Icon} name="close" /></button>
      </div>
    </header>

    ${onMetric ? html`<div class="dmgrep__tabs" role="tablist" aria-label=${t('统计项目')}>
      ${REPORT_METRICS.map((x) => html`<button key=${x.id} type="button" role="tab" aria-selected=${x.id === m.id ? 'true' : 'false'}
        class=${cx('dmgrep__tab', `dmgrep__tab--${x.id}`, x.id === m.id && 'is-on')} data-metric=${x.id}
        onClick=${() => onMetric(x.id)}>${t(x.label)}</button>`)}
    </div>` : null}

    <div class="dmgrep__sum">
      <div class="dmgrep__sumL">
        <span class="dmgrep__cap">${t(cumulative ? '本局累计' : m.total)}</span>
        <b class="dmgrep__total num" data-testid="damage-report-total">${fmtDamage(sum)}</b>
      </div>
      <div class="dmgrep__sumR">
        <span class="dmgrep__meta">${cumulative ? t('本局至今') : reportCaption(round, live)}</span>
        <span class="dmgrep__meta t-lo">${t('随当前视角同步')}</span>
      </div>
    </div>

    <div class="dmgrep__cols">
      <span>${t(m.column)}</span>
      <span>${t(m.value)}</span>
    </div>

    ${list.length
      ? html`<ul class="dmgrep__list">${list.map((r, i) => html`<${DamageReportRow} key=${r.key} row=${r} rank=${i + 1} total=${sum}
          metric=${m.id} rec=${rowRec ? rowRec(r) : rowRecord(r, getChess, backups, diyData)}
          detailOpen=${openKey === r.key} onDetail=${m.id === 'dmg' ? onDetail : null} />`)}</ul>`
      : html`<p class="dmgrep__empty t-lo">${t(cumulative ? '本局还没有统计数据' : '本次战斗还没有统计数据')}</p>`}

    <details class="dmgrep__method">
      <summary>${t('统计口径')}</summary>
      <ul>${lines.map((s, i) => html`<li key=${i}>${t(s)}</li>`)}</ul>
    </details>
  </section>`;
}

/**
 * The HUD toggle (the corner row's 📊): a gear-sized button that opens / closes the panel. `count` (> 0) badges it with
 * the number of rows, so the player sees the report has something in it before opening it.
 * @param {{ open: boolean, onToggle?: (open: boolean) => void, count?: number, class?: string }} props
 */
export function DamageReportButton({ open, onToggle = null, count = 0, class: cls }) {
  return html`<button type="button" class=${cx('gm__gear', 'gm__dmgrep', open && 'is-on', cls)}
      aria-expanded=${open ? 'true' : 'false'} aria-label=${t('伤害统计')} title=${t('伤害统计')}
      onClick=${() => onToggle?.(!open)}>
    <${Icon} name="chart" />
    ${count > 0 ? html`<span class="gm__dmgrep__n num">${count}</span>` : null}
  </button>`;
}
