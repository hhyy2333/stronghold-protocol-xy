// server/sim/content/hexcards/batch16.js — 第十六批（业主 2026-10-24）新卡的战斗脚本 + 两张老卡的新增战斗半边。
//
// 业主原文（逐字照抄；每张卡在各自函数的注释里再抄一遍）：
//   1. 自适应成长（3阶）：根据敌人源石协议的总阶数获得攻击力防御力生命值的对应加成，一阶对应8%
//   2. 亮剑（3阶）：所有远程干员盟约增加突袭，攻击力变为150%，防御力和生命值变为300%，获得20%吸血
//   3. 高压锅（3阶）：所有地面干员每秒对周围敌人造成50%最大生命值的法术伤害并附带该伤害30%的灼燃损伤
//   4. 神射法师（2阶）：干员在造成法术伤害时造成等额的物理伤害
//   5. 灵魂炸弹（3阶）：累计统计本局游戏内医疗干员造成的治疗量，每10s对所有敌人造成一次该记录数值的法术伤害
//                        并给全体干员回复一次该记录值
//   6. 惊惧（1阶）：所有敌人第一次受到地面干员攻击后战栗2s
//   7. 炼狱导管（3阶）：干员攻击额外附加一层每秒造成100点法术伤害持续5s的灼烧（无限叠加）同时造成该伤害30%的灼燃损伤
//   8. 回响形态（老卡新增）：技力消耗-30%
//
// 与 batch14a / batch15a 同一个 `hexHooks(battle)` 契约（见 hooks.js）：installX(hooks) 只注册 hook / 计时器，安装时
// 不改战斗状态；每段都先用 ownersOf(<hexId>) 判断「谁拥有这张卡」，再只对拥有者自己的干员 / 全场敌人生效。
//
// 确定性：随机一律走 battle.rng()，没有 Math.random / Date / Node API；计时器走 battle.every()。

import { makeDamageInfo, isChained, isHpLoss, isRetaliation } from '../../damage.js';
import { passiveBuff, isGroundOp, gameData, unitBonds } from '../support/index.js';

/** 共用的「卡片存在 + 包形状对」守卫：没有卡（或 hooks 不是 hexHooks 的返回对象）时是个 no-op。 */
function ownersOfCard(hooks, hexId) {
  if (!hooks || typeof hooks !== 'object') return null;
  const { battle, ownersOf } = hooks;
  if (!battle || typeof battle.on !== 'function') return null;
  if (typeof ownersOf !== 'function') return null;
  const owners = ownersOf(hexId);
  return owners && owners.length ? owners : null;
}

/** 一个干员是不是这张卡拥有者的己方干员（多玩家场上只认自己的 ownerId）。 */
const isOwnOpOf = (u, owned) => !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId);
/** 数值读取：正数才算数，否则用 fallback。 */
const pos = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : fallback; };
/** 场上活着的敌人（「全场敌人」）：引擎的敌人列表是 battle.enemies。 */
const livingEnemies = (battle) => battle.enemies.filter((e) => e && e.alive && e.deployed && !e.hidden);

/**
 * 敌方协议源石的总阶数（自适应成长的乘数）。
 *
 * 两个来源，优先权威的那一个：
 *   * `battle.flags.enemyHexTiers` —— 对局侧在**建战斗时**算好的总阶位（`server/match/hextech.js adaptiveTierTotalOf`
 *     → `battleOpts.withEnemyHexes`，三条建战斗的路径共用这一处）。这是唯一能看见敌方**全部**卡的来源：`mods` 数值卡
 *     不需要 flag，所以 `enemyHexIds` 里只有 `verb` 卡。
 *   * 没有那个 flag 时（单机测试、手搓 battle、旧存档）退回按 `enemyHexIds` 现算：那条路只数得到 verb 卡，但至少不会崩。
 * @param {any} battle
 * @returns {number}
 */
export function enemyHexTierSum(battle) {
  const stamped = battle && battle.flags ? Number(battle.flags.enemyHexTiers) : NaN;
  if (Number.isFinite(stamped) && stamped > 0) return stamped;
  const ids = battle && battle.flags && Array.isArray(battle.flags.enemyHexIds) ? battle.flags.enemyHexIds : [];
  if (!ids.length) return 0;
  const ht = (() => {
    try { return gameData()?.hextech || null; } catch { return null; }
  })() || (battle.data && battle.data.hextech) || null;
  if (!ht) return 0;
  const tierOf = new Map();
  for (const r of Array.isArray(ht.rarities) ? ht.rarities : []) if (r && r.id) tierOf.set(r.id, Number(r.tier) || 0);
  let sum = 0;
  for (const id of ids) {
    const rec = ht.enemyHexes ? ht.enemyHexes[id] : null;
    if (!rec) continue;
    sum += tierOf.get(rec.rarity) || 0;
  }
  return sum;
}

/**
 * 自适应成长: 己方所有干员攻击力 / 防御力 / 生命值上限按敌方协议源石的总阶数加成，每阶 +8%。
 *
 * 业主原文（逐字）：「根据敌人源石协议的总阶数获得攻击力防御力生命值的对应加成，一阶对应8%」
 *
 * 口径：`enemyHexTierSum(battle)` 把敌方每一枚协议源石的阶位（1 / 2 / 3）相加，再乘卡片的 `pctPerTier`（8）——
 * 例如 1 枚 3阶 + 2 枚 1阶 ⇒ 5 阶 ⇒ 攻 / 防 / 生命上限各 +40%。三个都是 `passiveBuff` 上的加算百分比
 * （atkPct / defPct / hpPct），与其它加算 mod 同栈，死亡 / 重部署不丢；战斗中途部署的干员在 `deploy` 时补装。
 *
 * [ASSUMED: 1)「总阶数」= 敌方拥有的每一枚卡的阶位之和（不是「最高阶」）；2) 敌人没有协议源石时这张卡不提供任何
 *   加成（0 阶 = 0%）；3) 只有拥有者的己方干员受益，召唤物不算。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent, else the number of operators it covered
 */
export function installAdaptiveGrowth(hooks) {
  const owners = ownersOfCard(hooks, 'hex_adaptivegrowth');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  const spec = specOf(owners[0], 'hex_adaptivegrowth', 'adaptiveGrowth');
  const per = pos(spec.pctPerTier, 8) / 100;
  const tiers = enemyHexTierSum(battle);
  const value = per * tiers;
  if (!(value > 0)) return 0;
  let n = 0;
  const apply = (u) => {
    if (!isOwnOpOf(u, owned)) return;
    passiveBuff(battle, u, 'hex:adaptivegrowth', { atkPct: value, defPct: value, hpPct: value }, { tags: ['hex'] });
    n++;
  };
  for (const u of battle.allyUnits) apply(u);
  battle.on('deploy', (c) => { if (c && c.unit) apply(c.unit); });
  return n;
}

/**
 * 亮剑: 己方所有远程干员视为【突袭】盟约成员，攻击力 150%，防御力与生命值 300%，并获得 20% 吸血。
 *
 * 业主原文（逐字）：「所有远程干员盟约增加突袭，攻击力变为150%，防御力和生命值变为300%，获得20%吸血」
 *
 * 口径：
 *   * 「远程干员」= 数据 `def.position === 'RANGED'`（与 火力延伸 / 精准穿透 同一条轴）；
 *   * 「盟约增加突袭」——`u.extraBonds` 是引擎里「借来的盟约」那条腿（盟约共鸣在准备期写 `unit.bonds`，战斗创建时
 *     落到 `extraBonds`，`unitBonds` 把它并进成员资格）。这里在 battleStart 里补上 `raidShip`，并在准备期
 *     `server/match/bondsMeta.js membership` 里同样把远程干员算成突袭成员 —— 两处同源，条带上的 突袭 才会真的亮。
 *   * 「攻击力变为 150%」= 造成伤害 / 攻击面板的加算 axel：`atkPct: 50`（基数是 100%）；
 *   * 「防御力和生命值变为 300%」= `defPct: 200` / `hpPct: 200`；
 *   * 「20% 吸血」= 该干员对敌人实际打掉的血量 × 20% 回给自己（`damaged` 钩子，与 不祥契约 同一读法）。
 *
 * [ASSUMED: 1)「变为 150% / 300%」按乘区读（不是 +150% / +300%）；2) 吸血只算自己打出的伤害，不含 流失 / 元素损伤 /
 *   反伤；3) 召唤物与队友的远程干员不算（这是「你」的卡）。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent, else the number of ranged operators covered
 */
export function installDrawBlade(hooks) {
  const owners = ownersOfCard(hooks, 'hex_drawblade');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  const spec = specOf(owners[0], 'hex_drawblade', 'drawBlade');
  const atkPct = pos(spec.atkPct, 50) / 100;
  const defPct = pos(spec.defPct, 200) / 100;
  const hpPct = pos(spec.hpPct, 200) / 100;
  const steal = Math.max(0, Number(spec.lifestealPct) || 0) / 100;
  const bond = typeof spec.bond === 'string' && spec.bond ? spec.bond : 'raidShip';
  /** 远程 + 拥有者的己方干员。 */
  const isCarrier = (u) => isOwnOpOf(u, owned) && !!u.def && u.def.position === 'RANGED';
  let n = 0;
  const apply = (u) => {
    if (!isCarrier(u)) return;
    passiveBuff(battle, u, 'hex:drawblade', { atkPct, defPct, hpPct }, { tags: ['hex'] });
    // 借来的盟约：extraBonds 是不可变的，换一个新数组（unitBonds 的缓存键含它，会自然重算）
    const cur = Array.isArray(u.extraBonds) ? u.extraBonds : [];
    if (!cur.includes(bond) && !unitBonds(u).includes(bond)) u.extraBonds = Object.freeze([...cur, bond]);
    n++;
  };
  // 先挂属性：bond 半边要在别的 bond 内容读成员资格之前写好，所以 priority 高于常规（默认 0）——
  // 这里与其它卡一样在 battleStart 默认槽执行即可（bond 内容自己也是 battleStart，成员资格按需读取）。
  for (const u of battle.allyUnits) apply(u);
  battle.on('deploy', (c) => { if (c && c.unit) apply(c.unit); });
  if (steal > 0) {
    battle.on('damaged', (c) => {
      if (!c || !c.dmg) return;
      const dmg = c.dmg;
      if (isHpLoss(dmg) || isRetaliation(dmg) || dmg.type === 'element') return;
      const src = c.source;
      if (!isCarrier(src) || !src.alive || !src.deployed || src.hidden) return;
      if (!c.target || c.target.side !== 'enemy') return;
      if (!(c.amount > 0)) return;
      battle.heal(src, src, c.amount * steal, { self: true });
    });
  }
  return n;
}

/**
 * 高压锅: 己方所有地面干员每秒对周围敌人造成自身最大生命值 50% 的法术伤害，并附加该伤害 30% 的灼燃损伤。
 *
 * 业主原文（逐字）：「所有地面干员每秒对周围敌人造成50%最大生命值的法术伤害并附带该伤害30%的灼燃损伤」
 *
 * 口径：`battle.every(1)`（第一个脉冲在 t = 1s）遍历拥有者的地面干员（`def.position === 'MELEE'`，引擎的
 * `isGroundOp`），对每个干员周围 `radius` 内的每个活着的敌人：
 *   1. 一发 `maxHp × hpPct%` 的**法术伤害**（卡片伤害：`isSkill: false`、不可闪避，来源是该干员，击杀统计归它）；
 *   2. 该伤害 `elemPct%` 的**灼燃损伤**（`type: 'element'`, `element: 'burn'` —— 只灌元素槽，不直接掉血；槽满
 *      才由引擎自己的灼燃爆发结算）。
 *
 * [ASSUMED: 1)「周围」= 以干员所在格为中心的半径（默认 1.25，覆盖周围八格：格心距 1.414 也算在内）；2) 每秒结算
 *   一次、按干员各自的最大生命计算（是「每个地面干员」，不是全场共用一份）；3) 元素损伤按「该伤害的 30%」取，
 *   即 hpPct × 30%；4) 召唤物不算地面干员。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number,pulses:number}} 0 when the card is absent
 */
export function installPressureCooker(hooks) {
  const owners = ownersOfCard(hooks, 'hex_pressurecooker');
  if (!owners) return 0;
  const { battle, opsOf, specOf, onField } = hooks;
  if (typeof battle.every !== 'function' || typeof opsOf !== 'function') return 0;
  const plans = [];
  for (const pid of owners) {
    const spec = specOf(pid, 'hex_pressurecooker', 'pressureCooker');
    plans.push({
      pid,
      hpPct: pos(spec.hpPct, 50) / 100,
      elemPct: pos(spec.elemPct, 30) / 100,
      radius: pos(spec.radius, 1.25),
    });
  }
  let pulses = 0;
  for (const p of plans) {
    battle.every(1, () => {
      const ops = opsOf(p.pid).filter((u) => onField(u) && isGroundOp(u));
      if (!ops.length) return;
      for (const u of ops) {
        if (!u.alive || !(u.s.maxHp > 0)) continue;
        const amount = u.s.maxHp * p.hpPct;
        if (!(amount > 0)) continue;
        const targets = battle.enemiesInRadius(u.x, u.y, p.radius);
        if (!targets.length) continue;
        pulses++;
        for (const e of targets) {
          if (!e.alive) continue;
          battle.dealDamage(u, e, makeDamageInfo({
            amount, type: 'arts', canDodge: false, isSkill: false, tags: ['hex', 'pressurecooker'],
          }));
          if (!e.alive) continue;
          const gauge = amount * p.elemPct;
          if (gauge > 0) {
            battle.dealDamage(u, e, {
              type: 'element', element: 'burn', amount: gauge, ignoreSelect: true, tags: ['hex', 'pressurecooker'],
            });
          }
        }
      }
    });
  }
  return { get owners() { return owners.length; }, get pulses() { return pulses; } };
}

/**
 * 神射法师: 己方干员造成法术伤害时，额外造成等额的物理伤害。
 *
 * 业主原文（逐字）：「干员在造成法术伤害时造成等额的物理伤害」
 *
 * 口径：`damaged`（伤害已经结算完，`amount` 是真实打掉的血量）里，若来源是拥有者的干员、目标是敌人、这一次是
 * **法术**伤害且真的掉了血，就打一发 `amount × pct%` 的**独立物理伤害**（`pct` 默认 100 = 等额）。
 * 这一发带 `hex:spellarcher` 标记，且只认 `arts`，所以它自己（`phys`）不会再触发本卡 —— 不会成环；
 * `isChained` 把「在另一次伤害结算中打出来的伤害」也挡在外面（与 身负重担 同一条发动机规则）。
 *
 * [ASSUMED: 1)「等额」= 主伤害**实际结算后**的血量（吃减伤后的数值，不是面板）；2) 附加的物理伤害走普通物理减伤、
 *   可以被格挡/闪避取消（`canDodge: false` 只有卡片伤害才用 —— 这里用可闪避的普通实例，[ASSUMED] 与「额外造成伤害」
 *   的既有读法一致：走 400 点法术那一类实例的写法，但类型是物理）；3) 流失 / 元素损伤 / 反伤不算「造成法术伤害」。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent
 */
export function installSpellArcher(hooks) {
  const owners = ownersOfCard(hooks, 'hex_spellarcher');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  const spec = specOf(owners[0], 'hex_spellarcher', 'spellArcher');
  const ratio = pos(spec.pct, 100) / 100;
  if (!(ratio > 0)) return 0;
  let hits = 0;
  battle.on('damaged', (c) => {
    if (!c || !c.dmg) return;
    const dmg = c.dmg;
    if (isHpLoss(dmg) || isRetaliation(dmg) || isChained(dmg)) return;
    if (dmg.type !== 'arts') return;
    if (dmg.spellArcher) return;
    const src = c.source;
    if (!isOwnOpOf(src, owned) || !src.alive) return;
    const tgt = c.target;
    if (!tgt || tgt.side !== 'enemy' || !tgt.alive) return;
    if (!(c.amount > 0)) return;
    const amount = c.amount * ratio;
    if (!(amount > 0)) return;
    hits++;
    const info = makeDamageInfo({ amount, type: 'phys', canDodge: true, isSkill: false, tags: ['hex', 'spellarcher'] });
    info.spellArcher = true;
    battle.dealDamage(src, tgt, info);
  });
  return { get owners() { return owners.length; }, get hits() { return hits; } };
}

/**
 * 灵魂炸弹: 累计本局医疗干员造成的治疗量，每 10 秒对全体敌人造成一次该数值的法术伤害，并为全体干员回复一次该数值。
 *
 * 业主原文（逐字）：「累计统计本局游戏内医疗干员造成的治疗量，每10s对所有敌人造成一次该记录数值的法术伤害并给全体
 * 干员回复一次该记录值」
 *
 * 两段：
 *   * **本局累计**在准备期：`server/match/player/round.js _addCumStats` 把每场战斗里 MEDIC 干员的治疗量累加到
 *     玩家的 `counters['hex:hex_soulbomb:heal']`；战斗创建时 `onBattleStart.soulBombArm`（applySpec）把那个数写进
 *     ref 的 `params.soulBomb.heal`。所以「本局」跨回合累计，而不是只看这一场。
 *   * **本场新增**在这里：`heal` 钩子里，来源是拥有者的医疗干员时把「实际回血」也加进同一个计数（引擎在钩子之后
 *     才写 HP，所以按 `min(amount, maxHp - hp)` 估实际值）。
 *   * 每 `every` 秒（默认 10）一发：`总记录值` 的法术伤害打给每个活着的敌人；同时给拥有者的每个在场上干员回复
 *     同样的数值（`battle.heal`，受治疗加成 / 禁疗规则）。记录值为 0 时什么都不做。
 *
 * [ASSUMED: 1)「医疗干员」= `profession === 'MEDIC'` 的己方干员（召唤物 / 队友不算）；2) 记录值包含本场已经打出的
 *   治疗；3) 对敌人的伤害是**每个敌人各自一发**，不是分摊；4) 回复走正常治疗（能触发治疗相关钩子），不是
 *   「无视禁疗」；5) 没有医疗干员、记录值为 0 时，脉冲空转不产生任何事件。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number,pulses:number,total:number}} 0 when the card is absent
 */
export function installSoulBomb(hooks) {
  const owners = ownersOfCard(hooks, 'hex_soulbomb');
  if (!owners) return 0;
  const { battle, opsOf, specOf, onField } = hooks;
  if (typeof battle.every !== 'function' || typeof opsOf !== 'function') return 0;
  const plans = [];
  for (const pid of owners) {
    const spec = specOf(pid, 'hex_soulbomb', 'soulBomb');
    plans.push({ pid, every: pos(spec.every, 10), base: Math.max(0, Number(spec.heal) || 0), live: 0 });
  }
  const byPid = new Map(plans.map((p) => [p.pid, p]));
  // 本场医疗干员的治疗量（实际回血）
  battle.on('heal', (c) => {
    if (!c || !c.source || !c.target) return;
    const src = c.source;
    if (!src || src.kind !== 'op' || src.side !== 'ally') return;
    const p = byPid.get(src.ownerId);
    if (!p) return;
    if (!(src.def && src.def.profession === 'MEDIC')) return;
    const amt = Number(c.amount);
    if (!(amt > 0)) return;
    const room = Math.max(0, (c.target.s ? c.target.s.maxHp : 0) - c.target.hp);
    p.live += Math.min(amt, room);
  });
  let pulses = 0;
  for (const p of plans) {
    battle.every(p.every, () => {
      const total = p.base + p.live;
      if (!(total > 0)) return;
      const ops = opsOf(p.pid).filter(onField);
      pulses++;
      for (const e of livingEnemies(battle)) {
        if (!e.alive) continue;
        battle.dealDamage(null, e, makeDamageInfo({
          amount: total, type: 'arts', canDodge: false, isSkill: false, sourceless: true, tags: ['hex', 'soulbomb'],
        }));
      }
      for (const u of ops) {
        if (!u.alive) continue;
        battle.heal(null, u, total, { silent: false });
      }
    });
  }
  return {
    get owners() { return owners.length; },
    get pulses() { return pulses; },
    get total() { return plans.reduce((n, p) => n + p.base + p.live, 0); },
  };
}

/**
 * 惊惧: 所有敌人第一次受到地面干员攻击后，战栗 2 秒。
 *
 * 业主原文（逐字）：「所有敌人第一次受到地面干员攻击后战栗2s」
 *
 * 口径：`hit` 钩子里，出手的是拥有者的**地面干员**（`isGroundOp`）、目标是敌人、这一发是一次**攻击**
 * （`dmg.isAttack`，技能覆盖的攻击也算），且这个敌人本场还没被记过 —— 就 `applyStatus(e, 'tremble', 2)`。
 * 「战栗」是引擎目录状态（buffs.js STATUS.tremble：被阻挡后无法进行普通攻击），免疫与抵抗由引擎负责。
 *
 * [ASSUMED: 1)「第一次」= 每名敌人整场战斗一次（不是每秒 / 每次攻击）；2) 只认地面干员的攻击，法术技能 / 卡片伤害
 *   不算；3) 已经处于战栗的敌人不重置时长（applyStatus 同名规则）；4) 召唤物不算地面干员。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number,applied:number}} 0 when the card is absent
 */
export function installDread(hooks) {
  const owners = ownersOfCard(hooks, 'hex_dread');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  const seconds = pos(specOf(owners[0], 'hex_dread', 'dread').seconds, 2);
  const seen = new Set();
  let applied = 0;
  battle.on('hit', (c) => {
    if (!c || !c.dmg || c.dmg.cancel) return;
    if (!c.dmg.isAttack) return;
    if (c.dmg.type === 'element' || isHpLoss(c.dmg) || isRetaliation(c.dmg)) return;
    const src = c.source;
    if (!isOwnOpOf(src, owned) || !isGroundOp(src)) return;
    const tgt = c.target;
    if (!tgt || tgt.side !== 'enemy' || !tgt.alive) return;
    const id = tgt.id ?? tgt;
    if (seen.has(id)) return;
    seen.add(id);
    applied++;
    battle.applyStatus(tgt, 'tremble', { duration: seconds, source: src });
  });
  return { get owners() { return owners.length; }, get applied() { return applied; } };
}

/**
 * 炼狱导管: 干员攻击额外附加一层「每秒 100 点法术伤害、持续 5 秒」的灼烧（无限叠加），并造成该伤害 30% 的灼燃损伤。
 *
 * 业主原文（逐字）：「干员攻击额外附加一层每秒造成100点法术伤害持续5s的灼烧（无限叠加）同时造成该伤害30%的灼燃损伤」
 *
 * 口径：`hit` 钩子里，拥有者的干员**攻击**命中敌人时，在目标身上挂一层 `hex:infernal`：
 *   * `refresh: 'independent'` —— 每一层是独立实例、各有自己的 5 秒计时（这就是「无限叠加」：同时挂 30 层就是每秒
 *     30 × 100 点），`maxStacks` 只是引擎的数组上限（9999，实际打不满）；
 *   * `interval: 1` 的 `onTick` 每秒打一发 100 点法术伤害，并按 `elemPct`（30%）灌灼燃损伤槽。
 * 这一发是卡片持续伤害（`isSkill: false`、不可闪避、来源是当初的出手干员），带 `infernalDot` 标记，不会再触发本卡
 * （否则每一跳都会叠新层）。
 *
 * [ASSUMED: 1)「每秒造成100点法术伤害」= 固定值，不随攻击力/层数放大（业主给的是绝对值）；2)「同时造成该伤害30%的
 *   灼燃损伤」= 每跳的 30 点灼燃；3) 出手干员阵亡后持续伤害仍在，只是没有来源（`sourceless`）；4) 只认攻击
 *   （`dmg.isAttack`），技能里的非攻击伤害不叠层；5) 流失 / 元素损伤 / 反伤 / 链式伤害不叠层。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number,stacks:number}} 0 when the card is absent
 */
export function installInfernalConduit(hooks) {
  const owners = ownersOfCard(hooks, 'hex_infernalconduit');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  const spec = specOf(owners[0], 'hex_infernalconduit', 'infernalConduit');
  const dps = pos(spec.dps, 100);
  const seconds = pos(spec.seconds, 5);
  const elemPct = pos(spec.elemPct, 30) / 100;
  let stacks = 0;
  battle.on('hit', (c) => {
    if (!c || !c.dmg || c.dmg.cancel) return;
    const dmg = c.dmg;
    if (!dmg.isAttack) return;
    if (dmg.infernalDot) return;
    if (isHpLoss(dmg) || isRetaliation(dmg) || isChained(dmg)) return;
    if (dmg.type === 'element') return;
    const src = c.source;
    if (!isOwnOpOf(src, owned)) return;
    const tgt = c.target;
    if (!tgt || tgt.side !== 'enemy' || !tgt.alive) return;
    stacks++;
    battle.addBuff(tgt, {
      key: 'hex:infernal',
      duration: seconds,
      refresh: 'independent',
      stacks: 1,
      maxStacks: 9999,
      interval: 1,
      visible: true,
      tags: ['hex', 'infernal'],
      data: { dps, elemPct, src },
      onTick: ({ battle: b, unit: e, buff }) => {
        if (!e || !e.alive) return;
        const data = (buff && buff.data) || {};
        const source = data.src && data.src.alive ? data.src : null;
        const info = makeDamageInfo({ amount: data.dps || dps, type: 'arts', canDodge: false, isSkill: false, tags: ['hex', 'infernal'] });
        info.infernalDot = true;
        b.dealDamage(source, e, info);
        if (!e.alive) return;
        const gauge = (data.dps || dps) * (data.elemPct || elemPct);
        if (gauge > 0) {
          b.dealDamage(source, e, { type: 'element', element: 'burn', amount: gauge, ignoreSelect: true, tags: ['hex', 'infernal'] });
        }
      },
    });
  });
  return { get owners() { return owners.length; }, get stacks() { return stacks; } };
}

/**
 * 回响形态（老卡新增）: 己方所有干员的技能技力消耗 −30%。
 *
 * 业主原文（逐字）：「回响形态增加效果技力消耗-30%」
 *
 * 口径：技能消耗是 `Skill.spCostMul`（skills.js 的 accessor；绝技就是用它做 ×0.7），与 旧日之力 同一处写；
 * 每个干员只写一次（`sk.hexEchoForm` 守卫），死亡 / 重部署不会叠乘。
 *
 * [ASSUMED: 1)「−30%」= ×0.7（不是 +30% 的减）；2) 只作用于拥有者的己方干员；3) 不耗技力的技能不受影响。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent, else the number of operators it covered
 */
export function installEchoForm(hooks) {
  const owners = ownersOfCard(hooks, 'hex_echoform');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  const spec = specOf(owners[0], 'hex_echoform', 'echoForm');
  const pct = Number(spec.spCostPct);
  const mul = 1 + (Number.isFinite(pct) ? pct : -30) / 100;
  if (!(mul > 0) || mul === 1) return 0;
  let n = 0;
  const apply = (u) => {
    if (!isOwnOpOf(u, owned)) return;
    const sk = u.skill;
    if (!sk || sk.noSkill || sk.kind === 'passive') return;
    if (sk.hexEchoForm) return;
    sk.hexEchoForm = true;
    sk.spCostMul = (Number.isFinite(sk.spCostMul) ? sk.spCostMul : 1) * mul;
    n++;
  };
  for (const u of battle.allyUnits) apply(u);
  battle.on('deploy', (c) => { if (c && c.unit) apply(c.unit); });
  return n;
}
