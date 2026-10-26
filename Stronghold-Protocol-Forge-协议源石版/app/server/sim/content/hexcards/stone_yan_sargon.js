// server/sim/content/hexcards/stone_yan_sargon.js — 第 7 回合（盟约专属协议）的两张卡战斗半边：
// 炎【燎原】(hex_yan_ember) 与 萨尔贡【绿洲】(hex_sargon_oasis)。
//
// 设计稿：04-文档/协议源石-盟约专属协议-第7回合-设计稿-20261026.md §3.1 / §3.2。备战半段（+2 部署位、60/325 层里程碑）
// 在 applySpec（server/sim/content/hextech.js 的 deployCap / layerGift）；这里只做作战中的三段。
//
// 确定性：无 Math.random / Date / Node API；本模块不需要随机。

import { isMember, bondLayers } from '../support/index.js';
import { applyRedirectCut, redirectShare, isChained, isHpLoss, isRetaliation } from '../../damage.js';

const CARD_YAN = 'hex_yan_ember';
const SPEC_YAN = 'yanEmber';
const BOND_YAN = 'yanShip';
const CARD_SARGON = 'hex_sargon_oasis';
const SPEC_SARGON = 'sargonOasis';
const BOND_SARGON = 'sargonShip';
const SARGON_SHIELD_KEY = 'hex:sargon:oasis';

const pos = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

function ownersOfCard(hooks, hexId) {
  if (!hooks || typeof hooks !== 'object') return null;
  const { battle, ownersOf } = hooks;
  if (!battle || typeof battle.on !== 'function' || typeof ownersOf !== 'function') return null;
  const owners = ownersOf(hexId);
  return owners && owners.length ? owners : null;
}
const isOwnOp = (u, owned) => !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId);

// =====================================================================================================================
// 炎 ·【燎原】
// =====================================================================================================================

/**
 * 【燎原】hex_yan_ember（3 阶，requiresBond: yanShip）。
 * 原文（§3.1）：「获得时：可部署人数 +2。作战中：己方干员造成伤害时，附加相当于攻击力 2% 的灼燃损伤（每名干员每秒至多
 * 1 次）。【炎】≥200 层：灼燃爆发伤害翻倍。【炎】≥300 层：【炎】干员视为【坚守】干员。」
 * 口径见实现注释；[ASSUMED: 1)「翻倍」只翻爆发的元素伤害；2)「炎干员获得坚守」按「炎干员视为坚守成员」读；
 * 3) 灼燃附加认非元素 / 非流失 / 非反伤 / 非链式。]
 */
export function installYanEmber(hooks) {
  const owners = ownersOfCard(hooks, CARD_YAN);
  if (!owners) return 0;
  const { battle, specOf, optNumber } = hooks;
  const owned = new Set(owners);
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD_YAN, SPEC_YAN) : {};
    const num = (k, fb) => (typeof optNumber === 'function' ? optNumber(spec, k, fb) : fb);
    plan.set(pid, {
      burnPct: num('burnPct', 2) / 100,
      burstLayer: num('burstLayer', 200),
      steadLayer: num('steadLayer', 300),
      steadRatio: Math.min(1, Math.max(0, num('steadRatio', 40) / 100)),
      thorn: num('thorn', 850),
      thornPerLayer: num('thornPerLayer', 10),
      fragile: Math.min(1, Math.max(0, num('fragile', 40) / 100)),
      fragileSec: num('fragileSec', 5),
      cd: num('cd', 0.2),
    });
  }
  const isYan = (u) => isOwnOp(u, owned) && isMember(battle, u, BOND_YAN);
  const onField = (u) => !!u && u.alive && u.deployed && !u.hidden;
  let burns = 0, bursts = 0, shares = 0;

  // 灼燃附加 + 灼燃爆发翻倍
  battle.on('hit', (c) => {
    const dmg = c && c.dmg;
    const tgt = c && c.target;
    if (!dmg || !tgt || tgt.side !== 'enemy') return;
    if (dmg.element === 'burn' && Array.isArray(dmg.tags) && dmg.tags.includes('burst')) {
      const credit = c.credit;
      const pid = credit && credit.ownerId;
      if (pid && owned.has(pid) && bondLayers(battle, pid, BOND_YAN) >= plan.get(pid).burstLayer) { dmg.mul *= 2; bursts++; }
      return;
    }
    if (dmg.type === 'element' || isHpLoss(dmg) || isRetaliation(dmg) || isChained(dmg)) return;
    const src = c.source;
    if (!isOwnOp(src, owned) || !src.alive || src.hidden) return;
    const p = plan.get(src.ownerId);
    if (!p) return;
    const last = src.mem.yanEmberBurn ?? -Infinity;
    if (battle.time - last < 1 - 1e-9) return;
    src.mem.yanEmberBurn = battle.time;
    const amount = (src.s && src.s.atk ? src.s.atk : 0) * p.burnPct;
    if (amount > 0) {
      burns++;
      battle.dealDamage(src, tgt, { type: 'element', element: 'burn', amount, ignoreSelect: true, tags: ['hex', 'hex:yanember'] });
    }
  });

  // 300 层：炎干员视为坚守 —— 非炎友方受伤 40% 由炎干员均摊
  battle.on('hit', (c) => {
    const dmg = c && c.dmg;
    const tgt = c && c.target;
    if (!dmg || !tgt || dmg.cancel) return;
    if (tgt.side !== 'ally' || tgt.kind !== 'op') return;
    if (dmg.type === 'element' || dmg.yanEmberCut || (Array.isArray(dmg.redirectCuts) && dmg.redirectCuts.length)) return;
    const pid = tgt.ownerId;
    const p = plan.get(pid);
    if (!p || bondLayers(battle, pid, BOND_YAN) < p.steadLayer) return;
    if (isMember(battle, tgt, BOND_YAN)) return;
    const any = battle.allyUnits.some((u) => isYan(u) && onField(u));
    if (!any || !(p.steadRatio > 0)) return;
    applyRedirectCut(dmg, p.steadRatio);
    dmg.yanEmberCut = p.steadRatio;
  }, { priority: -20 });

  battle.on('damaged', (c) => {
    const dmg = c && c.dmg;
    const tgt = c && c.target;
    if (!dmg || !tgt) return;
    if (tgt.side === 'ally' && tgt.kind === 'op' && dmg.yanEmberCut) {
      const ratio = dmg.yanEmberCut;
      dmg.yanEmberCut = 0;
      shares++;
      const share = redirectShare(Number(c.amount) || 0, ratio, dmg.redirectCuts);
      if (!(share > 0)) return;
      const on = battle.allyUnits.filter((u) => isYan(u) && onField(u));
      if (!on.length) return;
      for (const m of on) {
        const info = battle.makeDamage({ amount: share / on.length, type: 'true', canDodge: false, tags: ['hex', 'hex:yanember:share'] });
        info.yanEmberShare = true;
        battle.dealDamage(null, m, info);
      }
      return;
    }
    if (tgt.side !== 'ally' || tgt.kind !== 'op' || dmg.yanEmberShare || dmg.yanEmberThorn) return;
    if (dmg.type === 'element' || isHpLoss(dmg) || isRetaliation(dmg) || !isMember(battle, tgt, BOND_YAN)) return;
    const pid = tgt.ownerId;
    const p = plan.get(pid);
    if (!p || bondLayers(battle, pid, BOND_YAN) < p.steadLayer) return;
    const last = tgt.mem.yanEmberThornCd ?? -Infinity;
    if (battle.time - last < p.cd - 1e-9) return;
    tgt.mem.yanEmberThornCd = battle.time;
    const src = c.source;
    if (!src || src.side !== 'enemy' || !src.alive) return;
    const amount = p.thorn + p.thornPerLayer * bondLayers(battle, pid, BOND_YAN);
    const info = battle.makeDamage({ amount, type: 'arts', canDodge: false, sourceless: true, tags: ['hex', 'hex:yanember:thorn'] });
    info.yanEmberThorn = true;
    battle.dealDamage(tgt, src, info);
    if (src.alive && p.fragile > 0) battle.applyStatus(src, 'fragile', { duration: p.fragileSec, value: p.fragile, source: tgt });
  });

  return { get owners() { return owners.length; }, get burns() { return burns; }, get bursts() { return bursts; }, get shares() { return shares; } };
}

// =====================================================================================================================
// 萨尔贡 ·【绿洲】
// =====================================================================================================================

/**
 * 【绿洲】hex_sargon_oasis（3 阶，requiresBond: sargonShip）。
 * 原文（§3.2）：释放技能时获得 100% 攻击力护盾，下一次攻击额外造成等同护盾值的法术伤害。60/325 层里程碑在备战侧。
 * [ASSUMED: 1) 护盾同名刷新到 max(当前, 新值)，不无限叠加；2)「下一次攻击」只结算一次；3) 附伤按攻击时的剩余护盾。]
 */
export function installSargonOasis(hooks) {
  const owners = ownersOfCard(hooks, CARD_SARGON);
  if (!owners) return 0;
  const { battle, specOf, optNumber } = hooks;
  const owned = new Set(owners);
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD_SARGON, SPEC_SARGON) : {};
    plan.set(pid, { shieldPct: (typeof optNumber === 'function' ? optNumber(spec, 'shieldPct', 100) : 100) / 100 });
  }
  const isSargon = (u) => isOwnOp(u, owned) && isMember(battle, u, BOND_SARGON);
  let shields = 0, bonuses = 0;
  const shieldOf = (u) => {
    const b = typeof u.findBuff === 'function' ? u.findBuff(SARGON_SHIELD_KEY) : null;
    return b && b.shield > 0 ? b.shield : 0;
  };
  battle.on('skillStart', (c) => {
    const u = c && c.unit;
    if (!isSargon(u) || !u.alive) return;
    const p = plan.get(u.ownerId);
    const value = (u.s && u.s.atk ? u.s.atk : 0) * p.shieldPct;
    if (!(value > 0)) return;
    shields++;
    const prev = shieldOf(u);
    battle.addBuff(u, { key: SARGON_SHIELD_KEY, shield: Math.max(prev, value), persist: true, visible: true, refresh: 'replace', tags: ['hex'] });
    u.mem.sargonOasisPending = 1;
  });
  battle.on('attack', (c) => {
    const u = c && c.attacker;
    if (!isSargon(u) || !(u.mem.sargonOasisPending > 0)) return;
    u.mem.sargonOasisPending = 0;
    const bonus = shieldOf(u);
    if (!(bonus > 0)) return;
    const tgt = Array.isArray(c.targets) ? c.targets.find((t) => t && t.alive) : null;
    if (!tgt) return;
    bonuses++;
    battle.dealDamage(u, tgt, { amount: bonus, type: 'arts', canDodge: false, tags: ['hex', 'hex:sargonoasis'] });
  });
  return { get owners() { return owners.length; }, get shields() { return shields; }, get bonuses() { return bonuses; } };
}
