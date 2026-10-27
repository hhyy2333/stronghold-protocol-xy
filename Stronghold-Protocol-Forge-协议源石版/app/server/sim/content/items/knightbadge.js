// server/sim/content/items/knightbadge.js — 【骑士徽章】(data/items.json `chess_item_9_98_e_a`, tools/build-data.mjs
// CUSTOM_ITEMS): the equipment 协议源石【骑士】(`hex_kazimierz_knight`, tools/hextech/roster.mjs) hands out.
//
// 业主原文（04-文档/协议源石-盟约专属协议-第7回合-设计稿-20261026.md §3.7）：「【骑士徽章】：装备者（下称「骑士」）获得：
// 【卡西米尔】干员受到伤害时，伤害转移给骑士（100%）；【卡西米尔】干员造成的真实伤害 ×2；装备者受到致命伤害时，
// +5 层【不屈】，并锁血 5 秒（期间不会死亡）」。
//
// 三条都读**装备自己的 params**（data/items.json：{ transferPct: 100, trueMul: 2, indomLayers: 5, lockSec: 5 }），
// 所以调数只改数据、不改这里；记录缺字段时用同一组值兜底（协议源石那批装备的惯例，见 items/protocol.js）。
//
// 这是一件 **ITEM 行为**，不是卡的行为：装备在谁身上就在谁身上生效，与「玩家有没有那张协议源石」无关
// （业主 2026-10-26「所有协议装备都依靠对应的协议源石生效的bug这个还没修」；同批的 残光 / 加护 / 万物归虚 / 尸山 /
// 心之钢 / 恶魔之契 在 items/protocol.js，本条单开一个文件因为它有三个互相独立的半边）。
//
// 口径（逐条 [ASSUMED]，官方文本没写死的地方）：
//   * 「己方」= **同一玩家**（`ownerId` 相同）的干员。联防 / boss 双人场上队友的卡西米尔干员不享受（与 尸山 同一条口径）；
//   * 「骑士」= 装着这件装备的干员本身，不需要是卡西米尔干员；一名玩家同时有两枚徽章时，**转移**由「场上第一个」骑士承担
//     （第一个倒下后由下一名接手），×2 与锁血按「有这件装备」计一次（两条都用 DamageInfo 标记 / 每单位一个窗口去重，
//     不会 2×2 或 +5+5 叠加）；
//   * 转移：100% ⇒ 被转移者**一点血都不掉**，那一份走**真实伤害**落在骑士身上（与被转移者自己的护盾结算顺序：
//     先由被转移者吃护盾，护盾之后的 HP 伤害才转移 [ASSUMED]）。转移伤害带 `transfer` 标记，因此不被 ×2 再放大、
//     也不会被别的转移内容（坚守 / 浊心斯卡蒂 S1）二次转移；
//   * 真实伤害 ×2 只放大**对敌**的真伤实例（对友军的真伤不放大 [ASSUMED]），且**不**放大转移过来的那一份；
//   * 致命伤害：**锁血窗口内**再次致命只免死、不重复加层（否则骑士在 1 点血上会被每一击续成几十层）；
//     锁血期间 HP 由引擎留在 1 点（damage.js applyHpLoss：`c.prevented` ⇒ hp = min(1, maxHp)）；
//   * 转移与锁血都要求骑士**在场**（`alive && deployed && !hidden`）：骑士倒下时转移不生效，被转移者自己吃伤害
//     （否则卡西米尔干员会在骑士倒下期间变成无敌）；
//   * 只有装备者自己的装备算：借出（lendItemEffects）期间借入方的徽章同样算骑士 [ASSUMED: 借入的装备就是装备]。
//
// 挂载：items/battle.js 的 BY_ITEM['chess_item_9_98_e'] = knightBadge（Lead 接线）。`installKnightBadge(battle)` 是给
// 测试 / 内容侧的同源安装入口（与 items.install 同形状），按单位幂等 —— 生产路径已经装过时它什么都不做。
//
// 确定性：没有 Math.random / Date / Node API；伤害走 battle.dealDamage，定时窗口用 battle.time 比较。

import { num, itemRecord, itemKeyOf, itemsOf, isOp, isMember, battleStore } from '../support/index.js';

/** Registry key of the equipment (id without the `_a` / `_b` suffix) — the key items/battle.js files it under. */
export const KNIGHTBADGE_ITEM_KEY = 'chess_item_9_98_e';
/** The concrete ids the equipment exists as (only the normal form: 不可合并). */
export const KNIGHTBADGE_ITEM_IDS = Object.freeze(['chess_item_9_98_e_a']);
/** The bond whose operators the badge protects ("己方【卡西米尔】干员"). */
export const KNIGHTBADGE_BOND = 'kazimierzShip';
/** The bond a fatal hit banks (+N 层). */
export const KNIGHTBADGE_INDOM_BOND = 'indomShip';
/** The numbers this behaviour falls back to when the record carries none (the card spec's own values). */
export const KNIGHTBADGE_DEFAULTS = Object.freeze({ transferPct: 100, trueMul: 2, indomLayers: 5, lockSec: 5 });

/** Positive number, else the documented default (a 0 / a missing field means "not configured"). */
const pos = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const paramsOf = (rec) => (rec && rec.params && typeof rec.params === 'object' ? rec.params : {});
/** Proc damage dealt by the badge carries 'item'; 'transfer' is the repo-wide marker for "this is a redirected share". */
const PROC_TAGS = Object.freeze(['item', 'item:knightbadge', 'transfer']);
const TRANSFER_TAG = 'transfer';

/** Per-player runtime: the knights of this player, in install order (the first one on the field takes the transfers). */
function runtimeOf(battle, pid) {
  return battleStore(battle, `items:knightbadge:${pid == null ? '?' : pid}`, () => ({ units: [] }));
}
/** The knight on the field right now — the one that can actually take a hit — or null. */
function fieldKnight(rt) {
  for (const k of rt.units) if (k && k.alive && k.deployed && !k.hidden && !k.removed) return k;
  return null;
}
/** "己方【卡西米尔】干员": a 卡西米尔 operator of the knight's own player (a teammate's never counts). */
function ownKazimierz(battle, x, pid) {
  return isOp(x) && x.side === 'ally' && x.ownerId === pid && isMember(battle, x, KNIGHTBADGE_BOND);
}

/**
 * Install the three halves of 骑士徽章 on its carrier `u`. Idempotent per unit (one badge behaviour per operator), so the
 * production path (items/battle.js installItem) and `installKnightBadge` cannot double it.
 * @param {any} battle @param {any} u the carrier (the knight) @param {any} rec the concrete item record (null ⇒ defaults)
 * @returns {{ unit: any, dispose: () => void }|null} null when `u` is not an operator or already carries the behaviour
 */
function installOn(battle, u, rec) {
  if (!battle || !isOp(u)) return null;
  const rt = runtimeOf(battle, u.ownerId);
  if (rt.units.includes(u)) return null;
  const p = paramsOf(rec);
  const ratio = Math.max(0, Math.min(100, num(p.transferPct, KNIGHTBADGE_DEFAULTS.transferPct))) / 100;
  const trueMul = pos(p.trueMul, KNIGHTBADGE_DEFAULTS.trueMul);
  const indomLayers = Math.max(1, Math.floor(pos(p.indomLayers, KNIGHTBADGE_DEFAULTS.indomLayers)));
  const lockSec = pos(p.lockSec, KNIGHTBADGE_DEFAULTS.lockSec);
  /** End of the running 锁血 window (battle time); `lockUsed` = this badge already spent its ONE window. */
  let lockUntil = -Infinity;
  let lockUsed = false;
  const hooks = [];
  const on = (name, fn, priority = 0) => { const h = battle.on(name, fn, { owner: u, priority }); if (h) hooks.push(h); return h; };
  rt.units.push(u);

  // 1) 伤害转移: every HP-damage instance that would land on one of this player's 卡西米尔 operators is taken by the knight
  //    instead, as true damage. The hook sits at 'hpDamage' (after the victim's shields, before applyHpLoss) because a 100 %
  //    transfer has to move the HP loss itself: applyRedirectCut + redirectShare (坚守 / 浊心斯卡蒂) derive the share from
  //    what reached the victim, and at 100 % that is 0 — the hit would simply vanish.
  on('hpDamage', (c) => {
    if (!(ratio > 0) || !c || !(c.amount > 0)) return;
    const t = c.target;
    if (!t || t === u || t.side !== 'ally' || !isOp(t) || t.ownerId !== u.ownerId) return;
    if (!ownKazimierz(battle, t, u.ownerId)) return;
    if (c.dmg && (c.dmg.knightShare || c.dmg.knightTransfer)) return;   // already transferred once
    if (fieldKnight(rt) !== u || !u.alive || !u.deployed || u.hidden) return;
    const share = c.amount * ratio;
    if (!(share > 0)) return;
    if (c.dmg) c.dmg.knightShare = true;
    c.amount = Math.max(0, c.amount - share);
    const info = battle.makeDamage({ amount: share, type: 'true', canDodge: false, tags: [...PROC_TAGS] });
    info.knightTransfer = true;   // never scaled by the ×2 below, never redirected again
    battle.dealDamage(c.source ?? null, u, info);
  });

  // 2) 【卡西米尔】干员造成的真实伤害 ×2 — a multiplier on the instance itself, marked so two badges never multiply twice.
  on('hit', (c) => {
    const d = c && c.dmg;
    if (!d || d.cancel || d.knightTransfer) return;
    if (d.type !== 'true') return;
    const src = c.source;
    if (!ownKazimierz(battle, src, u.ownerId)) return;
    if (d.tags && d.tags.indexOf(TRANSFER_TAG) >= 0) return;   // the transferred share is already the attacker's damage
    if (!c.target || c.target.side !== 'enemy') return;
    if (d.knightTrue) return;
    d.knightTrue = true;
    // `d.mul` may be absent on a hand-built DamageInfo (tests / other content); treat it as 1 rather than NaN.
    d.mul = (Number.isFinite(Number(d.mul)) ? Number(d.mul) : 1) * trueMul;
  });

  // 3) 致命伤害: +N 层【不屈】and ONE lockSec 锁血 window per battle. A fatal INSIDE the running window only prevents the
  //    death (it never extends the window); once the window is over the knight dies normally — the first version kept
  //    preventing every fatal, i.e. an infinite 锁血 (业主 2026-10-27「锁血时间没正确生效，无限时间锁血了」).
  on('fatal', (c) => {
    if (!c || c.prevented) return;
    const t = c.unit;
    if (!t || t !== u) return;                 // 「装备者受到致命伤害时」——不是队友，也不是替队友挡死
    if (battle.time < lockUntil) { c.prevented = true; return; }
    if (lockUsed) return;                      // 窗口已过：正常阵亡，不再开第二个窗口
    lockUsed = true;
    lockUntil = battle.time + lockSec;
    battle.addLayers(u.ownerId, KNIGHTBADGE_INDOM_BOND, indomLayers, 'item', { source: u });
    c.prevented = true;
  });

  return {
    unit: u,
    dispose() {
      for (const h of hooks) battle.off(h);
      hooks.length = 0;
      const i = rt.units.indexOf(u);
      if (i >= 0) rt.units.splice(i, 1);
    },
  };
}

/**
 * The battle half of 骑士徽章, in the BY_ITEM shape (items/battle.js installItem): `(battle, u, rec, S, grant)`. The
 * behaviour belongs to the equipment, so it is installed on the carrier and removed with the grant's Scope.
 * @param {any} battle @param {any} u the carrier @param {any} rec its item record @param {any} S the grant Scope
 */
export function knightBadge(battle, u, rec, S) {
  const h = installOn(battle, u, rec);
  if (h && S && typeof S.onDispose === 'function') S.onDispose(h.dispose);
}

/**
 * The operators that carry a live 骑士徽章 grant in this battle, in install order (per player: the first one on the
 * field is the knight that takes the transfers). For tests / UI.
 * @param {any} battle
 * @returns {any[]}
 */
export function knightBadgeUnits(battle) {
  const out = [];
  if (!battle || !Array.isArray(battle.players)) return out;
  for (const ps of battle.players) {
    const pid = ps ? ps.playerId : null;
    const rt = battleStore(battle, `items:knightbadge:${pid == null ? '?' : pid}`, () => null);
    if (rt) out.push(...rt.units);
  }
  return out;
}

/**
 * Install 骑士徽章 on every operator carrying it (the shape of items.install(battle)) — the same code path the BY_ITEM
 * wrapper runs, for tests and content that has not wired the key yet. Idempotent: units already carrying the behaviour
 * are skipped, so calling it on a battle where the production path installed the equipment changes nothing.
 * @param {any} battle
 * @returns {{ unit: any, dispose: () => void }[]} the grants this call created (empty when nobody carries it)
 */
export function installKnightBadge(battle) {
  const out = [];
  if (!battle || !Array.isArray(battle.allyUnits)) return out;
  for (const a of battle.allyUnits) {
    if (!isOp(a)) continue;
    for (const id of itemsOf(a)) {
      if (itemKeyOf(id) !== KNIGHTBADGE_ITEM_KEY) continue;
      const h = installOn(battle, a, itemRecord(id));
      if (h) out.push(h);
      break;
    }
  }
  return out;
}
