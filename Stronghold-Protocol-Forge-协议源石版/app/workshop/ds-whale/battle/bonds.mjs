// workshop/ds-whale/battle/bonds.mjs — 盟约「前文明」（precivShip）的战斗逻辑。
// (i18n-ignore-file: 工坊包的服务端 / 浏览器共用逻辑与作者说明，不是客户端界面文案)
//
// 载荷形状与官方内容模块逐字同形：export function install(battle)（DESIGN §28.17）。服务端与浏览器加载**同一份字节**，
// 所以这里只用 @battle/ 白名单里的导出，且全程确定性（不读时钟、不掷骰子、不碰网络）。
//
// 四条效果（数值全部从 bonds.json 的 bb 读，改数据即生效；缺键时用下面的 DEFAULTS）：
//   1. layer_per_dp                  每消耗 N 点部署费用，本盟约层数 +1
//   2. cascade_every / cascade_add   层数每跨过 E 的倍数，使玩家**所有已激活盟约**（含本盟约）层数 +A
//   3. range_at / range_extend       本盟约层数首次到达 R 时，大肥鱼的攻击范围 +X
//   4. foresight_at / foresight_add  首次到达 F 时，获得 A 层【远见】（visiShip）
//
// 为什么「消耗部署费用」走每 tick 的账本差额，而不是 hook 再部署事件：本引擎里 DP 有三处消耗 —— 手动的
// `redeploy()`（再部署）、自动再部署（`_checkRedeploys`，倒计时走完自动回来）、以及内容自己的 `addDp(负数)`
// （大肥鱼天赋「吃白饭」每秒 -1、部分卡牌的 DP 扣减）。deploy 事件在这三处都会发，却分不清这一次**付没付钱**
// （免费再部署的存在让「看事件数」必然多算）。所以这里每一 tick 用引擎自己的 DP 公式
// `min(dpMax, dp + dpPerSec × dt)` 还原「这一 tick 本该有多少 DP」，与实际值的差额就是**真的被消耗掉**的部署费用：
// 一条判据覆盖三处，对「增加部署费用」类的正向补充也免疫（DP 变多时只更新账本，不记账）。
//
// 层数的「一次性阈值」是**推导**出来的，不额外存状态：开局读一次当前层数（整局保留），算出下一个 10 层档位；
// 之后只处理「跨过」的那一个瞬间。于是同一局的第 2、3 场战斗不会重复发 50/150 的奖励，而 150 层在第 149 层
// 结束的那一场之后照样会补上。

import { num, bondRecord, bondLayers } from '@battle/index.js';

/** 本模块服务的盟约（与 bonds.json 的键逐字一致）。 */
const BOND = 'precivShip';
/** 大肥鱼：普通 / 精锐的 baseId 都归一到这一条（`_b` 的 baseId 是 `_a`）。 */
const WHALE_BASE = 'chess_ws_ds_whale_a';
/** 「获得 20 层远见」里的那条盟约。 */
const FORESIGHT_BOND = 'visiShip';
/** 攻击范围 +1 的 buff key（同名 buff 是替换，所以重复施加是幂等的）。 */
const RANGE_KEY = 'preciv:range';

const DEFAULTS = Object.freeze({
  layer_per_dp: 20,
  cascade_every: 10,
  cascade_add: 2,
  range_at: 50,
  range_extend: 1,
  foresight_at: 150,
  foresight_add: 20,
});

/**
 * 本盟约的黑板数值：只读 `bb`，缺键 / 写歪 / 非正数都退回 DEFAULTS（一条写歪的数字不该让整个盟约沉默）。
 * @returns {Record<string, number>}
 */
function readConfig() {
  const rec = bondRecord(BOND);
  const bb = rec && typeof rec.bb === 'object' && rec.bb ? rec.bb : {};
  const cfg = {};
  for (const key of Object.keys(DEFAULTS)) {
    const v = num(bb[key], DEFAULTS[key]);
    cfg[key] = v > 0 ? v : DEFAULTS[key];
  }
  cfg.cascade_every = Math.max(1, Math.floor(cfg.cascade_every));
  cfg.layer_per_dp = Math.max(1, cfg.layer_per_dp);
  return cfg;
}

/** 这个单位是不是大肥鱼（`_a` 与 `_b` 都算）。 */
function isWhale(unit) {
  const id = String((unit && unit.def && (unit.def.baseId || unit.def.id)) || (unit && unit.defId) || '');
  return id.replace(/_b$/, '_a') === WHALE_BASE;
}

/**
 * 装上本包的战斗逻辑。每个战场一次（与官方 content/bonds/*.js 的 install 同一个位置），
 * 一个包抛异常只记一条内容错误，不会让战场起不来。
 * @param {any} battle
 */
export function install(battle) {
  if (!battle || typeof battle.on !== 'function') return;
  if (!bondRecord(BOND)) return; // 这个包没有 bonds.json：本模块什么也不做

  const cfg = readConfig();
  /** @type {Map<any, { dp: number, acc: number, next: number, range: boolean, foresight: boolean }>} */
  const state = new Map();

  for (const ps of battle.players) {
    if (!ps || ps.playerId == null) continue;
    const layers = bondLayers(battle, ps.playerId, BOND);
    state.set(ps.playerId, {
      dp: num(ps.dp, 0), // 上一 tick 结束时的 DP（账本的基准）
      acc: 0, // 还没攒够一层的「已消耗部署费用」
      next: Math.floor(layers / cfg.cascade_every) * cfg.cascade_every + cfg.cascade_every,
      range: layers >= cfg.range_at,
      foresight: layers >= cfg.foresight_at,
    });
  }
  if (!state.size) return;

  const layersOf = (pid) => bondLayers(battle, pid, BOND);

  /** 给这名玩家的大肥鱼挂上「攻击范围 +1」（persist buff：阵亡不掉、再部署后 `_refreshRange` 仍算进初始范围）。 */
  function applyRange(pid) {
    for (const unit of battle.allyUnits) {
      if (!unit || unit.ownerId !== pid || unit.kind !== 'op' || !isWhale(unit)) continue;
      battle.addBuff(unit, { key: RANGE_KEY, mods: { rangeExtend: cfg.range_extend }, persist: true, allowDead: true });
      if (unit.alive && unit.deployed && typeof battle.refreshRange === 'function') battle.refreshRange(unit);
    }
  }

  /** 每跨过一个 10 层档位：这名玩家所有**已激活**盟约（含本盟约）各 +A 层。 */
  function cascade(pid) {
    const ps = battle.getPlayer(pid);
    const bonds = ps && ps.bonds;
    if (!bonds || typeof bonds !== 'object') return;
    for (const id of Object.keys(bonds)) {
      const b = bonds[id];
      if (!b || !b.active) continue;
      battle.addLayers(pid, id, cfg.cascade_add, 'preciv:cascade');
    }
  }

  /** 层数变化之后：补开所有已跨过的档位，再看 50 / 150 两个一次性奖励。 */
  function settle(pid) {
    const st = state.get(pid);
    if (!st) return;
    let layers = layersOf(pid);
    // 档位可能一次跨过多个（一次 +N 层、或 cascade 把本盟约也推过下一档），所以是循环而不是 if
    for (let guard = 0; layers >= st.next && guard < 100; guard++) {
      cascade(pid);
      st.next += cfg.cascade_every;
      layers = layersOf(pid);
    }
    if (!st.range && layers >= cfg.range_at) {
      st.range = true;
      applyRange(pid);
    }
    if (!st.foresight && layers >= cfg.foresight_at) {
      st.foresight = true;
      battle.addLayers(pid, FORESIGHT_BOND, cfg.foresight_add, 'preciv:foresight');
    }
  }

  // 开局：整局已经攒到 50 层的（上一场跨过的那一次），这一场的大肥鱼照样有 +1 攻击范围。
  battle.on('battleStart', () => {
    for (const [pid, st] of state) if (st.range) applyRange(pid);
  });

  // 再部署（阵亡后回来 / 技能送回场）：已经解锁的，新身体也带上。
  battle.on('deploy', (ctx) => {
    const unit = ctx && ctx.unit;
    if (!unit || unit.ownerId == null) return;
    const st = state.get(unit.ownerId);
    if (!st || !st.range) return;
    if (unit.kind !== 'op' || !isWhale(unit)) return;
    applyRange(unit.ownerId);
  });

  // IN_BATTLE 的层数增益在 联防 / boss / 隐藏关里是关掉的（battle.flags.layerGainsEnabled）：
  // 那几类战场本来就不发层数，账也不用记（记了也落不了地）。
  if (battle.flags && battle.flags.layerGainsEnabled === false) return;

  battle.on('tick', (ctx) => {
    const dt = num(ctx && ctx.dt, 0);
    if (!(dt > 0)) return;
    const maxDp = num(battle.flags && battle.flags.dpMax, 99);
    const perSec = num(battle.flags && battle.flags.dpPerSec, 0);
    const spent = [];
    for (const ps of battle.players) {
      const st = state.get(ps && ps.playerId);
      if (!st) continue;
      // 这一 tick 若一分 DP 都没花，本该有多少 —— 与 engine 的 DP 阶段逐字同一条公式
      const would = Math.min(maxDp, st.dp + perSec * dt);
      if (ps.dp < would - 1e-9) {
        st.acc += would - ps.dp;
        spent.push(ps.playerId);
      }
      st.dp = ps.dp;
    }
    for (const pid of spent) {
      const st = state.get(pid);
      if (!st) continue;
      const whole = Math.floor(st.acc / cfg.layer_per_dp);
      if (!(whole > 0)) continue;
      st.acc -= whole * cfg.layer_per_dp;
      if (battle.addLayers(pid, BOND, whole, 'preciv:dp') > 0) settle(pid);
    }
  });
}
