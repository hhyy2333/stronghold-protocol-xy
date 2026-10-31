// server/sim/content/kits/ops/chess_char_6_22-oblvns.js — 丰川祥子 (char_4182_oblvns) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.
//
// 6★ 近卫·领主 (lord)。数值全部来自官方表（character_table / skill_table / uniequip_table），商店行由
// tools/custom-ops.mjs 补进活动表后照常构建。
//
// 特性「可以进行远程攻击，但此时攻击力降低至80%」—— 她的**普通攻击被关掉**（音符就是她的攻击，见下），
// 所以 100%/80% 这条在 kit 里按官方备注落地：音符的攻击力倍率「因自身发射音符时的阻挡状况决定」
// （正挡着人 = 100%，否则 80%）。
//
// 天赋 1 颂乐音符（**官方备注的完整实现**，PRTS 干员页备注）：
//   * 「可以持续攻击」：攻击范围内没有敌人时也每隔一个攻击间隔演奏音符；但「若自身朝向的前方一格地块的通行
//     类型为无，持续攻击无法发射音符」（battle.tileInfo(...).pass === 'NONE' 就不发射）。
//   * 发射时若攻击范围内有目标 ⇒ 该目标成为这个音符的**追踪目标**；否则音符初始没有追踪目标。
//   * 音符有三种状态：
//       自由移动（free）：产生时进入；首次进入有**最短自由移动时间**（0.1 s）。每 0.4 s 更新一次：
//         没有追踪目标 ⇒ 在自身 1.0 格内找最近的可选目标设为追踪目标；有有效目标且已过最短自由移动时间 ⇒ 追踪移动。
//       追踪移动（chase）：每 0.4 s 校验目标，无效 ⇒ 以当前方向回到自由移动。
//       已命中（hit）：命中后立刻以当前方向进入、固定时长后消失 —— 天赋音符**没有**这个状态，命中即消失。
//   * 运动参数（按发射时是否有目标）：
//       无目标：自由移动 = 扩张正弦（基础振幅 0.3、x 方向速度 1.3，第 n 周期振幅 ×n、最多 3 倍）；追踪 = 2.0 速度、转向速度 7/30 每帧；
//       有目标：自由移动 = 2.0 速度沿当前方向；追踪 = 2.0 速度、转向速度 1/6 每帧。
//     初始方向永远是「朝向左 20° ~ 右 20° 内随机一个角度」。
//   * 消失：在自身攻击范围外且连续 1 s 没有追踪目标 ⇒ 消失；自身退场时清掉所有不在追踪移动的音符。
//   * 穿透：每个 Ave Mujica 干员**造成伤害前**按「当前音符数量」临时获得物理/法术穿透（直接加算，上限 max_cnt 层），
//     命中目标的那个音符也算一层（见 syncPenetration / hitNote）。
//
// 天赋 2 毋畏遗忘：对敌人造成伤害时 Fever +cnt（**本模式没有 Fever 体系**，不做）；E1 起其它 Ave Mujica 成员的
// 攻击范围与自身原本攻击范围重合时视作延伸，且攻击范围内干员攻击速度 +attack_speed（攻击范围延伸没有对应机制，
// 只做攻速）。
//
// 模组 LOR-Y「无言的约定」：攻击范围内存在 2 名及以上敌人时攻击速度 +attack_speed —— 引擎 traitMods.js 直接生效。
//
// S1 新月的苏醒（可充能 2 次）：对攻击范围内一名敌人依次演奏 8 个音符，倍率 atk_scale…atk_scale_8 递减，
//   音符合法飞行 / 命中都用同一套官方音符逻辑，扇面角用技能自己的 angle（15°）。
// S2 满月的舞会（切换）：钢琴 = 攻击力 +attack@atk、音符物理；风琴 = 攻击速度 +attack@attack_speed、音符法术。
//   引擎侧 spec.recast（skills.js）让「开着的时候再点一次」= 换模式，不重复花技力、技能不中断。
// S3 残月的余响（持续 25 s，攻击范围扩大）：攻击就是钢琴 + 风琴各 2 个音符（乘 atk_scale，物理/法术各 2），
//   分别追踪防御最高 / 法抗最高的敌人；技能期间引擎的普通攻击关掉，技力按「攻击回复」由 kit 补。

import { num, talentBb, traitBb, skillBbOf, up } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';
import { frontOf, dirVec } from '../../../dir.js';
import { hypot, atan2, sin, cos, powi } from '../../../detmath.js';

const S1 = 'skchr_oblvns_1';
const S2 = 'skchr_oblvns_2';
const S3 = 'skchr_oblvns_3';
const K_NOTES = 'oblvns:notes';
const K_PEN = 'oblvns:penetrate';
const K_S2 = 'oblvns:s2';
const K_S3 = 'oblvns:s3';

/** 官方音符参数（PRTS 干员页备注「音符的运动参数」）。 */
const NOTE = Object.freeze({
  update: 0.4,          // 状态更新间隔
  minFree: 0.1,         // 最短自由移动时间
  speed: 2.0,           // 追踪移动 / 有目标时自由移动的速度
  seekRadius: 1.0,      // 追踪范围半径
  sineSpeed: 1.3,       // 无目标时自由移动：x 方向速度
  sineAmp: 0.3,         // 基础振幅（第 n 周期 ×n，最多 3 倍）
  steerTarget: 1 / 6,   // 转向速度（发射时有目标）
  steerNoTarget: 7 / 30,// 转向速度（发射时无目标）
  frame: 1 / 30,        // 转向速度按「每帧」给，换算成每 tick 的权重用
  initAngle: (20 * Math.PI) / 180, // 初始方向：朝向左 20° ~ 右 20°
  outsideLife: 1,       // 攻击范围外连续多久没有追踪目标就消失
  hitRadius: 0.3,       // 命中判定半径 [ASSUMED]（官方没给）
  maxLive: 64,          // 同时存在的上限（防御性，官方只有 max_cnt 的穿透层数上限）
});

export default {
  chess_char_6_22_a: (bb, chess, def) => {
    const t0 = talentBb(chess, 0);
    const t1 = talentBb(chess, 1);
    const s1 = skillBbOf(chess, S1);
    const s2 = skillBbOf(chess, S2);
    const s3 = skillBbOf(chess, S3);
    const sid = () => def?.skill?.id ?? def?.skill?.skillId ?? (chess?.skills || []).find((s) => s?.isDefault)?.skillId ?? null;
    const maxNotes = Math.max(1, Math.floor(num(t0.max_cnt, 10)));
    const penDef = num(t0.def_penetrate_ratio);
    const penRes = num(t0.magic_resist_penetrate_ratio);
    const talentAngle = Math.max(0, num(t0['attack@angle'], 20)) * Math.PI / 180;
    const s1Angle = Math.max(0, num(s1.angle, 15)) * Math.PI / 180;
    /** S1 的 8 个音符倍率（atk_scale … atk_scale_8）。 */
    const scales = () => [s1.atk_scale, s1.atk_scale_2, s1.atk_scale_3, s1.atk_scale_4, s1.atk_scale_5, s1.atk_scale_6, s1.atk_scale_7, s1.atk_scale_8].map((v) => num(v));
    /** 本人是否 Ave Mujica（穿透只给成员；祥子自己也算）。 */
    const mujica = (u) => up(u) && ((u.def?.bonds || []).includes('aveMujica') || u.def?.charId === 'char_4182_oblvns');
    const alliesOf = (battle, unit) => (battle.allyUnits || []).filter((a) => up(a) && a.ownerId === unit.ownerId);

    /** 场上的音符（kit 自己模拟：引擎的 addProjectile 表达不了自由/追踪/已命中三态）。 */
    const notesOf = (u) => (u.mem.oblvnsNotes || (u.mem.oblvnsNotes = []));
    const noteCount = (u) => Math.min(maxNotes, notesOf(u).length);

    /**
     * 天赋 1 的穿透：按**当前音符数量**给每个 Ave Mujica 成员加物理/法术穿透（直接加算）。
     * `extra` = 正在命中、需要一并计入的那一个音符（官方「命中目标的当个音符可计入」）。
     */
    const syncPenetration = (battle, unit, extra = 0) => {
      const n = Math.min(maxNotes, notesOf(unit).length + extra);
      const mods = { defIgnorePct: penDef * n, resIgnorePct: penRes * n };
      for (const a of alliesOf(battle, unit)) {
        if (!mujica(a)) continue;
        if (n > 0) battle.addBuff(a, { key: K_PEN, mods, refresh: 'replace', duration: 0.4, tags: ['talent'] });
        else battle.removeBuff(a, K_PEN);
      }
      // UI 用的层数 buff（客户端画音符层数）
      if (n > 0) battle.addBuff(unit, { key: K_NOTES, stacks: n, maxStacks: maxNotes, refresh: 'replace', duration: 0.4, tags: ['talent'] });
      else battle.removeBuff(unit, K_NOTES);
    };

    const validTarget = (t) => !!t && t.alive && t.side === 'enemy' && !t.hidden;

    /** 音符 1.0 格内最近的可选目标。 */
    const acquire = (battle, unit, note) => {
      let best = null, bestD = NOTE.seekRadius;
      for (const e of battle.enemiesInRadius(note.x, note.y, NOTE.seekRadius)) {
        if (!validTarget(e)) continue;
        const d = hypot(e.x - note.x, e.y - note.y);
        if (d <= bestD) { bestD = d; best = e; }
      }
      return best;
    };

    /**
     * 发射一个音符。`amount` 用**发射时缓存的攻击力**（官方「所有音符始终采用使用缓存攻击力」），
     * 倍率按发射时的阻挡状况给（正挡着人 100%，否则 80% —— 领主的远程衰减）。
     */
    const fireNote = (battle, unit, { target = null, scale = 1, type = 'phys', angle = talentAngle } = {}) => {
      const list = notesOf(unit);
      if (list.length >= NOTE.maxLive) return null;
      // 朝向用 dir.js 的 dirVec：与 frontOf / 移动坐标 (x = 列, y = 行) 同一套约定
      const [fdr, fdc] = dirVec(unit.dir);
      const base = atan2(fdr, fdc);
      const dir = base + (battle.rng() * 2 - 1) * angle;
      const blocking = (unit.blocking || []).length > 0;
      const note = {
        x: unit.x, y: unit.y,
        bx: unit.x, by: unit.y,
        dx: cos(dir), dy: sin(dir),
        dirAngle: dir,
        state: 'free',
        target: validTarget(target) ? target : null,
        firedWithTarget: validTarget(target),
        freeT: 0, sinceUpdate: 0, travel: 0, outsideT: 0,
        // 官方「所有音符始终采用**缓存攻击力**」：发射瞬间把攻击力与领主倍率一起冻结进这个音符，
        // 之后她自己吃到的攻击力 buff / debuff 都不再影响这颗已经在飞的音符（`atkCache`/`mul`/`scale` 只为可读性）
        atkCache: unit.s.atk,
        mul: blocking ? 1 : (unit.profile?.rangedScale ?? 0.8),
        scale: num(scale, 1),
        amount: unit.s.atk * (blocking ? 1 : unit.profile?.rangedScale ?? 0.8) * num(scale, 1),
        type,
        // 【已命中】状态的停留时长：官方参数表里她的音符这一类是「不存在」，所以默认 0（命中即消失）。
        // 机制本身留着：给 hitHold > 0 的音符会在命中后停住这么多秒再消失（S1 的 8 连都没有配这个值）。
        hitHold: 0,
        hitT: 0,
        spin: battle.rng() < 0.5 ? -1 : 1,
      };
      list.push(note);
      // 客户端表现：从她身上飞出一颗音符（客户端只会画直线/追踪，弧线以 sim 为准）
      battle.fx('note', {
        x: unit.x, y: unit.y, id: unit.id,
        ...(note.target ? { target: note.target.id } : { tx: unit.x + note.dx * 3, ty: unit.y + note.dy * 3 }),
      });
      return note;
    };

    /** 命中：先按「当前数量 + 这 1 个」刷新穿透，再结算伤害（官方：伤害计算前按数量临时增加穿透）。 */
    const hitNote = (battle, unit, note) => {
      const tgt = note.target;
      if (!validTarget(tgt)) return;
      syncPenetration(battle, unit, 1);
      if (note.amount > 0) {
        battle.dealDamage(unit, tgt, { amount: note.amount, type: note.type, isSkill: true, canDodge: false, tags: ['skill', 'oblvnsNote'] });
        battle.fx('aoe', { x: tgt.x, y: tgt.y, id: unit.id, radius: 0.4, skill: 'oblvnsHit' });
      }
    };

    /** 音符的每帧推进（三态状态机 + 官方运动参数 + 消失规则）。 */
    const stepNotes = (battle, unit, dt) => {
      const list = notesOf(unit);
      if (!list.length || !(dt > 0)) return;
      const rangeSet = unit.rangeKeySet;
      const keep = [];
      for (const n of list) {
        // 【已命中】：停住、不再移动 / 不再更新目标，固定时长后消失（官方「持续固定时长后消失」）。
        // 她的音符这一类参数是「不存在」，所以 hitHold = 0，命中即消失；这条分支留给以后有命中停留的音符。
        if (n.state === 'hit') {
          n.hitT -= dt;
          if (n.hitT > 1e-9) keep.push(n);
          continue;
        }
        n.freeT += dt;
        n.sinceUpdate += dt;
        // ---- 每 update 秒更新一次状态 ----
        if (n.sinceUpdate >= NOTE.update) {
          n.sinceUpdate = 0;
          if (n.state === 'free') {
            if (!validTarget(n.target)) n.target = acquire(battle, unit, n);
            if (validTarget(n.target) && n.freeT >= NOTE.minFree) n.state = 'chase';
          } else if (n.state === 'chase' && !validTarget(n.target)) {
            // 目标丢失 ⇒ 以当前运动方向重新自由移动
            n.state = 'free';
            n.target = null;
            n.freeT = 0;
          }
        }
        // ---- 移动 ----
        if (n.state === 'chase' && validTarget(n.target)) {
          const wx = n.target.x - n.x, wy = n.target.y - n.y;
          const d = hypot(wx, wy) || 1;
          // 转向速度「每帧」：换算成这一 tick 的权重（帧率无关）
          const steer = n.firedWithTarget ? NOTE.steerTarget : NOTE.steerNoTarget;
          const w = 1 - powi(1 - steer, Math.max(1, Math.round(dt / NOTE.frame)));
          n.dx += ((wx / d) - n.dx) * w;
          n.dy += ((wy / d) - n.dy) * w;
          const m = hypot(n.dx, n.dy) || 1;
          n.dx /= m; n.dy /= m;
          n.x += n.dx * NOTE.speed * dt;
          n.y += n.dy * NOTE.speed * dt;
          n.travel += NOTE.speed * dt;
          if (d <= NOTE.hitRadius) {
            hitNote(battle, unit, n);
            // 命中后：有【已命中】停留时长就停住（保持当前方向），否则立刻消失（她的音符属于后者）
            if (n.hitHold > 0) { n.state = 'hit'; n.hitT = n.hitHold; keep.push(n); }
            continue;
          }
        } else if (n.firedWithTarget) {
          // 发射时有目标：自由移动 = 固定 2.0 速度沿当前方向
          n.x += n.dx * NOTE.speed * dt;
          n.y += n.dy * NOTE.speed * dt;
          n.travel += NOTE.speed * dt;
        } else {
          // 发射时无目标：扩张正弦（x 方向 1.3，横向 ±振幅·sin(行程)，第 n 周期振幅 ×n、最多 3 倍）
          n.travel += NOTE.sineSpeed * dt;
          n.bx += n.dx * NOTE.sineSpeed * dt;
          n.by += n.dy * NOTE.sineSpeed * dt;
          const amp = NOTE.sineAmp * Math.min(3, Math.floor(n.travel / (2 * Math.PI)) + 1);
          const off = sin(n.travel) * amp * n.spin;
          n.x = n.bx - n.dy * off;
          n.y = n.by + n.dx * off;
        }
        // ---- 消失：攻击范围外 + 连续 outsideLife 秒没有追踪目标 ----
        const k = Math.round(n.y) * COLS + Math.round(n.x);
        if (rangeSet && !rangeSet.has(k) && !validTarget(n.target)) {
          n.outsideT += dt;
          if (n.outsideT >= NOTE.outsideLife) continue;
        } else {
          n.outsideT = 0;
        }
        keep.push(n);
      }
      unit.mem.oblvnsNotes = keep;
    };

    /** S2 的音色：钢琴 = 攻击力 +attack@atk；风琴 = 攻击速度 +attack@attack_speed。 */
    const applyTone = (battle, unit) => {
      const organ = unit.mem.oblvnsTone === 'organ';
      const mods = organ ? { aspd: num(s2['attack@attack_speed']) } : { atkPct: num(s2['attack@atk']) };
      battle.addBuff(unit, { key: K_S2, mods, refresh: 'replace', duration: Infinity, tags: ['skill'] });
    };

    /** 天赋 2 能做的那一半：攻击范围内干员攻击速度 +attack_speed（攻击范围延伸没有对应机制）。 */
    const aspdBonus = num(t1.attack_speed);
    const syncAspd = (battle, unit) => {
      if (!(aspdBonus > 0)) return;
      const inRange = new Set((battle.alliesFor(unit) || []).filter((a) => a.alive && a.deployed && unit.rangeKeySet?.has(a.tileR * COLS + a.tileC)).map((a) => a.id));
      for (const a of alliesOf(battle, unit)) {
        const want = inRange.has(a.id);
        const has = a.findBuff('oblvns:aspd');
        if (want && !has) battle.addBuff(a, { key: 'oblvns:aspd', mods: { aspd: aspdBonus }, refresh: 'replace', duration: 0.4, tags: ['talent'] });
        else if (!want && has) battle.removeBuff(a, 'oblvns:aspd');
      }
    };

    return {
      skills: {
        // S1 新月的苏醒：8 连音符，依次递减
        [S1]: {
          kind: 'charges',
          onStart({ battle, unit }) {
            const list = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true });
            const target = list && list.length ? list[0] : null;
            if (!validTarget(target)) return;
            let i = 0;
            for (const sc of scales()) {
              const j = i++;
              battle.after(j * 0.08, () => {
                if (!up(unit) || !(sc > 0)) return;
                fireNote(battle, unit, { target: validTarget(target) ? target : null, scale: sc, type: 'arts', angle: s1Angle });
              }, { owner: unit });
            }
            battle.fx('aoe', { x: target.x, y: target.y, id: unit.id, radius: 0.5, skill: 'oblvnsS1' });
          },
        },
        // S2 满月的舞会：切换音色（spec.recast 让开着的时候再点一次 = 换模式）
        [S2]: {
          kind: 'toggle',
          recast: true,
          mods: {},
          onStart({ battle, unit }) {
            unit.mem.oblvnsTone = unit.mem.oblvnsTone === 'piano' ? 'organ' : 'piano';
            applyTone(battle, unit);
            battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: unit.mem.oblvnsTone === 'organ' ? 'oblvnsOrgan' : 'oblvnsPiano' });
          },
          onEnd({ battle, unit, reason }) {
            if (reason === 'recast') return; // 换模式：音色状态留给 onStart 翻转
            unit.mem.oblvnsTone = null;
            battle.removeBuff(unit, K_S2);
          },
        },
        // S3 残月的余响
        [S3]: {
          kind: 'duration',
          mods: {},
          attack: { noAttack: true },
          targeting: { rangeExtend: 0 },
          onStart({ battle, unit }) { battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'oblvnsS3' }); },
        },
      },
      talents: [
        // 天赋 1：穿透随音符数量走（每 0.2 s 对账一次；命中时会再单独刷一次）
        { install(battle, unit) {
          battle.every(0.2, () => { if (up(unit)) syncPenetration(battle, unit); }, { owner: unit, immediate: true });
        } },
        // 天赋 2：范围内攻速
        { install(battle, unit) {
          battle.every(0.3, () => { if (up(unit)) syncAspd(battle, unit); }, { owner: unit, immediate: true });
        } },
      ],
      install(battle, unit) {
        // 她的攻击就是音符：引擎的「攻击」只保留节奏（技能触发 / 技力回复 / 动画），伤害全部由音符结算，
        // 所以把引擎那一下的伤害清零、弹道交给 kit 的 fx（避免和音符重复结算 / 重复画）。
        // 不能用 profile.noAttack：那会让 ai.js 直接跳过她，DEFAULT / SKILL_RANGE 的技能就永远不会自动开启。
        // dmgMul 是「函数倍率」（ai.js: if (prof.dmgMul) … mulT *= m），设成 0 会被当成"没有"，必须给函数
        unit.profile.dmgMul = () => 0;
        unit.profile.projectile = 'none';
        unit.mem.oblvnsCd = 0;

        battle.on('tick', ({ dt }) => {
          if (!up(unit) || !unit.deployed) return;
          const d = Number.isFinite(dt) ? dt : 0;
          stepNotes(battle, unit, d);
          if (unit.s.flags.disarm || unit.canAct === false) return;
          unit.mem.oblvnsCd = num(unit.mem.oblvnsCd) - d;
          if (unit.mem.oblvnsCd > 1e-9) return;
          unit.mem.oblvnsCd = Math.max(0.05, unit.s.interval || 1);
          fireBeat(battle, unit);
        }, { owner: unit });

        /** 一次「攻击」：S3 = 钢琴 + 风琴各 2 个音符；否则 = 一个天赋音符（范围里有目标就锁它）。 */
        const fireBeat = (battle, unit) => {
          const s3On = (unit.skill?.id ?? sid()) === S3 && !!unit.skill?.active;
          const pool = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).filter((e) => e.alive);
          if (s3On) {
            const sc = num(s3['attack@atk_scale']);
            const hiRes = pool.slice().sort((a, b) => (b.s?.res ?? 0) - (a.s?.res ?? 0))[0] || null;
            const hiDef = pool.slice().sort((a, b) => (b.s?.def ?? 0) - (a.s?.def ?? 0))[0] || null;
            for (let i = 0; i < 2; i++) {
              fireNote(battle, unit, { target: hiDef, scale: sc, type: 'phys' });
              fireNote(battle, unit, { target: hiRes, scale: sc, type: 'arts' });
            }
            // 普通攻击被关掉，攻击回复的技力在这里补
            if (typeof unit.skill?.gainSp === 'function') unit.skill.gainSp(1, 'attack');
            return;
          }
          // 技能触发：她的「攻击」就是演奏，所以 DEFAULT / SKILL_RANGE 的判定也放在这个节拍上
          // （引擎的普通攻击伤害已清零，但它仍按自己的节奏攻击；activate 自带 ready / active 守卫，不会重复开）
          const sk = unit.skill;
          if (sk && sk.ready && !sk.active && pool.length) sk.activate('note');
          const target = pool[0] || null;
          if (!target) {
            // 官方：范围外无目标时，若朝向的前方一格「通行类型为无」，持续攻击无法发射音符
            const [fr, fc] = frontOf(unit.tileR, unit.tileC, unit.dir, 1);
            const tile = battle.tileInfo ? battle.tileInfo(fr, fc) : null;
            if (!tile || tile.pass === 'NONE') return;
          }
          fireNote(battle, unit, { target });
          // 有目标时引擎自己也会「攻击」（伤害被清零），攻击技力由引擎给；没目标时引擎不出手，这里补上
          if (!target && typeof unit.skill?.gainSp === 'function') unit.skill.gainSp(1, 'attack');
        };

        // S2 的音色决定音符类型：钢琴物理、风琴法术（音符伤害在 hitter 里按 note.type 结算，这里只兜底）
        battle.on('hit', (c) => {
          if (c.source !== unit || !c.dmg || c.target?.side !== 'enemy') return;
          if ((unit.skill?.id ?? sid()) !== S2 || !unit.skill?.active) return;
          c.dmg.type = unit.mem.oblvnsTone === 'organ' ? 'arts' : 'phys';
        }, { owner: unit });

        // 自身退场：清掉所有不在追踪移动状态的音符（官方）
        battle.on('death', (c) => {
          if (c.unit !== unit) return;
          unit.mem.oblvnsNotes = notesOf(unit).filter((n) => n.state === 'chase');
        }, { owner: unit });
      },
    };
  },
};
