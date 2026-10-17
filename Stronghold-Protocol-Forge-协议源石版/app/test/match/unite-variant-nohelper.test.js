// test/match/unite-variant-nohelper.test.js — 「没人完美」的那一队（unite100 planUniteBySquad 的 noHelper）在两条战斗模式下
// 的一致行为，以及**没人接手**的漏怪必须照旧扣 LP。
//
// 业主 2026-10-16 的接力修复（unite100.pickRelaySquad 加「接手队必须有完美者」）方向是对的，但它落在两条**没被它
// 覆盖**的既有缺口上，于是看起来「没修好、还多出问题」：
//
//   1. **服务端模式把整轮接力吃掉了**：_startUniteVariant 在没有任何队能开阶段 1 战场时直接 settle(null, null)，
//      而客户端模式（生产缺省）继续走阶段 2。同一份种子、同一批漏怪，两条战斗模式算出两套 LP。
//   2. **没人接手的漏怪被静默原谅**：只有一份接力能被接受（每个接收队每轮一次），其余队从未上过任何战场，
//      uniteSurvivors 对它们的 source 返回 0，settle() 于是分文不扣（takeUnhandled 算出来的 unhandled.settled
//      从来没有消费者）。实测 20 座里 4 队全漏、只有 1 队能接手时，17 个人一个点都没扣。
//   3. **_uniteFieldFor 按下标对齐两张长度不同的表**：unitePlans 是全部计划、this.fields 只有能上场的那些，
//      于是 noHelper 的漏怪会读到**别的队**的战场。
//
// 这个套件把三条都钉住：服务端与客户端结果必须一致、没人接手的漏怪必须扣、计划到战场的映射必须按计划本身。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

const SEATS = 12;

/** 12 座 = 3 队（seat 0-3 / 4-7 / 8-11）。leakBySeat 是每人在自己那场普通战斗里漏了几个（0 = 完美）。 */
function variant(leakBySeat, { clientCombat, survivors = () => ({}) } = {}) {
  const seats = [];
  for (let i = 0; i < SEATS; i++) seats.push({ seat: i, playerId: 'p_' + i, name: 'P' + i, isBot: false, connected: true });
  const h = makeMatch({
    mode: 'coop', difficulty: 'NORMAL', seats, seed: 11, fake: true, clientCombat,
    script: (b) => (b.kind === 'normal'
      ? { leaks: Object.fromEntries(Object.entries(leakBySeat).map(([k, v]) => ['p_' + k, v])) }
      : { survivors: survivors(b) }),
  }).start();
  const m = h.m;
  const calls = [];
  const rawStart = m.startUnite.bind(m);
  m.startUnite = (plan, round) => {
    calls.push({ kind: 'start', round: round ?? 1, shape: Array.isArray(plan) ? plan.map((q) => ({ squad: q.squad, noHelper: !!q.noHelper, helpers: (q.helpers || []).map((x) => x.playerId), leaked: (q.leaked || []).length, from: q.relayFrom })) : (plan ? 'single' : null) });
    return rawStart(plan, round);
  };
  const rawVariant = m._startUniteVariant.bind(m);
  m._startUniteVariant = (plans, round) => {
    const out = rawVariant(plans, round);
    if (Array.isArray(m.unitePlans)) {
      calls.push({
        kind: 'mapping', round: m.uniteRound,
        fields: (m.fields || []).map((f) => f.fieldId),
        map: m.unitePlans.map((q) => {
          const f = m._uniteFieldFor(q);
          return { squad: q.squad, noHelper: !!q.noHelper, fieldId: f ? f.fieldId : null, fieldPlanSquad: f && f.plan ? f.plan.squad : null };
        }),
      });
    }
    return out;
  };
  h.autoHumans();
  drive(h);
  return { h, m, calls };
}

/** 走到第 1 轮的 SETTLE（把人类的确认 / 抽卡 / 准备都答掉）。 */
function drive(h) {
  const m = h.m;
  for (let i = 0; i < 600000 && !h.ended && m.round <= 1; i++) {
    for (const ps of m.players.values()) {
      if (ps.isBot || ps.left) continue;
      if (m.phase === 'INFO_CHECK' && !ps.infoReady) m.handle(ps.playerId, { t: 'g.infoReady' });
      if (m.phase === 'BAND_DRAFT' && m.draftTurn() === ps.playerId) m.handle(ps.playerId, { t: 'g.band', bandId: 'band_bldsk' });
      if (m.phase === 'SP_DRAFT' && m.spTurn() === ps.playerId) { const idx = m.sp.cards.map((c) => c.idx).find((k) => m.sp.taken[k] == null); if (idx != null) m.handle(ps.playerId, { t: 'g.choice', idx }); }
      if (m.phase === 'HEX_DRAFT' && m.hex && m.hex.picks[ps.playerId] == null) { const off = m.hexOfferOf(ps.playerId); if (off.length) m.handle(ps.playerId, { t: 'g.hex', idx: 0 }); }
      if (m.phase === 'PREP' && ps.alive && !ps.ready) { if (ps.personalChoice) m.handle(ps.playerId, { t: 'g.choice', idx: 0, choiceId: ps.personalChoice.id }); if (!ps.tempEmpty) ps.resolveTemp(); m.handle(ps.playerId, { t: 'g.ready', ready: true }); }
    }
    if (!h.sched.runNext()) break;
  }
}

const lpLost = (m, i) => m.players.get('p_' + i).stats.lpLost;

test('没人完美的那一队：服务端与客户端两条战斗模式给出同一套 LP（都走阶段 2 接力）', () => {
  // 队 0（seat 0-3）全漏 2，队 1 / 队 2 全完美 ⇒ 只有队 0 的计划（noHelper），接手队是队 1。
  const leaks = { 0: 2, 1: 2, 2: 2, 3: 2 };
  const run = (clientCombat) => {
    const { m, calls } = variant(leaks, { clientCombat });
    const relay = calls.filter((c) => c.kind === 'start' && c.round === 2);
    const out = { relay: relay.map((c) => c.shape), lost: Array.from({ length: SEATS }, (_, i) => lpLost(m, i)) };
    m.dispose();
    return out;
  };
  const server = run(false);
  const client = run(true);
  assert.ok(server.relay.length >= 1, '服务端模式必须也开阶段 2 的接力球场（实际 startUnite 记录：' + JSON.stringify(server.relay) + '）');
  assert.equal(server.relay[0][0].from, 0, '接力从全漏的队 0 传出');
  assert.ok(server.relay[0][0].helpers.length > 0, '接手队有完美成员上场');
  assert.deepEqual(server.lost, client.lost, '两条战斗模式的 LP 必须一致（服务端 ' + JSON.stringify(server.lost) + ' vs 客户端 ' + JSON.stringify(client.lost) + '）');
  assert.deepEqual(server.lost.slice(0, 4), [0, 0, 0, 0], '漏怪被接手队全部守住 ⇒ 那 4 个人不扣');
  assert.deepEqual(client.lost.slice(0, 4), [0, 0, 0, 0], '客户端同样不扣');
});

test('没人接手的漏怪照旧扣 LP：3 队全漏、只有 1 队能接手时，另外 2 队不能白嫖', () => {
  // 队 0 / 1 / 2 全漏 2；队 3 不存在（12 座 = 3 队）。接收队是队 2？—— 这里让队 0/1 全漏、队 2 全完美。
  const leaks = { 0: 2, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2 };
  const { m } = variant(leaks, { clientCombat: true });
  const lost = Array.from({ length: SEATS }, (_, i) => lpLost(m, i));
  const relayed = [0, 1, 2, 3].every((i) => lost[i] === 0) || [4, 5, 6, 7].every((i) => lost[i] === 0);
  const forgiven = [4, 5, 6, 7].every((i) => lost[i] === 0) && [0, 1, 2, 3].every((i) => lost[i] === 0);
  assert.ok(relayed, '被接走并守住的那一队不扣（实际 ' + JSON.stringify(lost) + '）');
  assert.ok(!forgiven, '没人接手的那一队必须照扣自己的 2 —— 全 0 就是「白嫖」（实际 ' + JSON.stringify(lost) + '）');
  m.dispose();
});

test('计划到战场的映射按计划本身：noHelper 的队不会读到别人的战场', () => {
  // 队 0 全漏（noHelper）、队 1 只漏 1 人（能开自己的阶段 1 战场）、队 2 全完美。
  const { m, calls } = variant({ 0: 1, 1: 1, 2: 1, 3: 1, 4: 1 }, { clientCombat: true });
  const phase1 = calls.filter((c) => c.kind === 'mapping' && c.round === 1).pop();
  assert.ok(phase1, '记录到了阶段 1 的映射');
  const nh = phase1.map.find((x) => x.noHelper);
  const nf = phase1.map.find((x) => !x.noHelper);
  assert.equal(nh.fieldId, null, 'noHelper 的队没有战场（实际 ' + JSON.stringify(phase1) + '）');
  assert.ok(nf && nf.fieldId, '能上场的队有自己的战场（实际 ' + JSON.stringify(phase1) + '）');
  assert.equal(nf.fieldPlanSquad, nf.squad, '战场归属与计划一致');
  m.dispose();
});

test('阶段 1 一场战场都开不出来时，仍然把漏怪交给阶段 2（而不是直接结算）', () => {
  const leaks = { 0: 2, 1: 2, 2: 2, 3: 2 };
  for (const clientCombat of [false, true]) {
    const { m, calls } = variant(leaks, { clientCombat });
    const started = calls.filter((c) => c.kind === 'start');
    const relay = started.find((c) => c.round === 2);
    assert.ok(relay, 'clientCombat=' + clientCombat + '：必须进入阶段 2（实际记录 ' + JSON.stringify(started) + '）');
    assert.equal(relay.shape[0].from, 0);
    assert.deepEqual(Array.from({ length: SEATS }, (_, i) => lpLost(m, i)), Array(SEATS).fill(0), '接力守住 ⇒ 全员 0');
    m.dispose();
  }
});

test('阶段 1 漏掉、阶段 2 又守住的敌人不再重复扣分（第二波兜住了就不扣）', () => {
  // 队 0：p_0 漏 2、p_1–p_3 完美 ⇒ 它自己开阶段 1 的战场，p_0 的 2 只从那里漏出去。
  // 阶段 2 的接力球场把它们全部守住 ⇒ p_0 最终应当是 0：接力的意义就是「第二波兜住了」。
  // 修前：两份战果的 leaked 被串在一起，同一只敌人在两波各扣一次（p_0 = 2 甚至 4）。
  const run = (relayHolds) => {
    const seats = [];
    for (let i = 0; i < SEATS; i++) seats.push({ seat: i, playerId: 'p_' + i, name: 'P' + i, isBot: false, connected: true });
    const h = makeMatch({
      mode: 'coop', difficulty: 'NORMAL', seats, seed: 11, fake: true, clientCombat: true,
      script: (b) => {
        if (b.kind !== 'unite') return { leaks: b.fieldId === 'n:p_0' ? { p_0: 2 } : {} };
        if (String(b.fieldId).startsWith('r')) {
          if (relayHolds) return { survivors: {} };
          const out = {};
          for (const sp of b.spawns) { const src = sp.sourcePlayerId; if (src) out[src] = (out[src] || 0) + Math.max(1, sp.count || 1); }
          return { survivors: out };
        }
        const srcs = new Set(b.spawns.map((sp) => sp.sourcePlayerId));
        return srcs.has('p_0') ? { survivors: { p_0: 2 } } : { survivors: {} };
      },
    }).start();
    const m = h.m;
    h.autoHumans();
    drive(h);
    const lost = lpLost(m, 0);
    m.dispose();
    return lost;
  };
  assert.equal(run(true), 0, '阶段 2 全部守住 ⇒ p_0 不扣（多扣就是两波各算一次）');
  assert.equal(run(false), 2, '阶段 2 也没守住 ⇒ 只扣这 2 只，不是 4 只');
});
