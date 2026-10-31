// 上游 Forge 0.3.2 §37.24 / §37.53 / GitHub #851 —— 「进入休整期时」的授予挂在**休整期开始**（机变 draft 之后），
// 不是回合开始：老鲤 R3 的 2/4 阶干员、松桐 / 杜宾(加练!) / 娜仁图亚 / 小贾斯汀 / 杰西卡 / 昆图斯 … 那批
// preparation_start_* 策略，以及干员特质「<进入休整期时>」（缄默德克萨斯的免费刷新、余、铃兰、白面鸮）。
// 我方原状：bands/meta.js 的五个 key 与 effectsMeta.js GARRISON_HOOK.SERVER_PREP_START 都挂 onRoundStart ⇒
// 老鲤 R3 在 R3 机变选择之前就把干员发了。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { GARRISON_HOOK, createRegistry } from '../../server/match/effectsMeta.js';
import { bandMetaHandler } from '../../server/sim/content/bands/meta.js';
import { DATA, makeMatch, give } from '../match/harness.js';

const QUIET = { warn() {}, error() {}, info() {} };
const REG = createRegistry({ log: QUIET });
const A = (k) => `chess_item_${k}_e_a`;

/** Round-scoped prep harness (same shape as test/content/bands.test.js): a clean solo match at PREP 1. */
function setup({ band, seed = 41 } = {}) {
  const h = makeMatch({ mode: 'solo', humans: 1, seed, registry: REG, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0;
  ps.funds = 50; ps.layers = {}; ps.pendingFunds = 0; ps.shop.freeRefreshes = 0; ps.counters = {};
  ps.bandId = band || null;
  ps.recompute();
  const at = (r) => { m.round = r; };
  const roundStart = (r) => { at(r); m.dispatch(ps, 'onRoundStart', { round: r }); };
  const prepStart = (r) => { at(r); m.dispatch(ps, 'onPrepStart', { round: r }); };
  const handIds = (kind) => [...ps.hand, ...ps.temp].filter((p) => p && (!kind || p.kind === kind)).map((p) => p.id);
  return { h, m, ps, at, roundStart, prepStart, handIds };
}

test('「进入休整期时」的映射：SERVER_PREP_START 走 onPrepStart，五个 band key 也挂在 onPrepStart 上', () => {
  assert.equal(GARRISON_HOOK.SERVER_GAIN, 'onGain', '获得时 keeps its hook');
  assert.equal(GARRISON_HOOK.SERVER_PREP_FIN, 'onPrepEnd', '休整期结束时 keeps its hook');
  assert.equal(GARRISON_HOOK.SERVER_PREP_START, 'onPrepStart', '进入休整期时 = the PREP start, not the round start');
  for (const [band, key] of [
    ['band_lmlee', 'prep_start_gain_chess_from_pool_in_round'],
    ['band_doberm', 'preparation_start_gain_chess_every_n_round'],
    ['band_makiri', 'round_start_gain_char_chess_in_shop_every_n_round'],
    ['band_narant', 'preparation_start_add_special_goods_every_n_round'],
    ['band_quintus', 'preparation_start_gain_chess_from_round'],
  ]) {
    const handler = bandMetaHandler(band);
    assert.ok(handler && typeof handler[key] !== 'function', `${band} has no handler named after its key (assembled)`);
    assert.equal(typeof handler.onPrepStart, 'function', `${band} (${key}) runs at the PREP start`);
    assert.equal(handler.onRoundStart, undefined, `${band} (${key}) no longer runs at the round start`);
  }
  // 回合开始时 stays put: 余 / 铃兰 / 哈洛德
  for (const band of ['band_yu', 'band_lisa', 'band_harold']) {
    const handler = bandMetaHandler(band);
    assert.equal(typeof handler.onRoundStart, 'function', `${band}: 回合开始时`);
  }
});

test('老鲤 R3 「第3回合进入休整期时」: nothing at the round start, 1 tier-II + 1 tier-IV operator at the PREP start', () => {
  const s = setup({ band: 'band_lmlee', seed: 14 });
  const got = [];
  const orig = s.ps.acquireChess.bind(s.ps);
  s.ps.acquireChess = (id, o = {}) => { const p = orig(id, o); if (p && /band/.test(String(o.source || ''))) got.push(id); return p; };
  s.roundStart(3);
  assert.deepEqual(got, [], 'the R3 draft comes first: no operator at the round start');
  s.prepStart(3);
  assert.deepEqual(got.map((id) => DATA.chess[id].tier).sort(), [2, 4], 'R3 PREP start: one tier-II and one tier-IV');
  s.roundStart(4);
  s.prepStart(4);
  assert.equal(got.length, 2, 'R4 grants nothing');
});

test('fixed-round 策略: 昆图斯 R3 / 杰西卡 R4 — the round start alone grants nothing', () => {
  for (const [band, id, round] of [['band_quintus', A('5_08'), 3], ['band_jesica', A('4_01'), 4]]) {
    const s = setup({ band, seed: 5 });
    for (let r = 1; r <= round; r++) {
      s.roundStart(r);
      assert.equal(s.handIds().filter((x) => x === id).length, 0, `${band} R${r}: round start`);
      s.prepStart(r);
      assert.equal(s.handIds().filter((x) => x === id).length, r === round ? 1 : 0, `${band} R${r}`);
      s.ps.hand.fill(null); s.ps.temp.fill(null);
    }
  }
});

test('杜宾 加练! / 松桐 九流之缘 / 娜仁图亚 见者有份: even rounds, at the PREP start only', () => {
  const doberm = setup({ band: 'band_doberm' });
  for (const r of [2, 4]) {
    doberm.roundStart(r);
    assert.ok(!doberm.handIds('item').includes('chess_item_6_03_m'), `杜宾 R${r}: round start`);
    doberm.prepStart(r);
    assert.ok(doberm.handIds('item').includes('chess_item_6_03_m'), `杜宾 R${r}: prep start`);
    doberm.ps.hand.fill(null);
  }
  const makiri = setup({ band: 'band_makiri', seed: 8 });
  const slots = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === 1).slice(0, 3)
    .map((c) => ({ kind: 'chess', id: c.chessId, basePrice: 2, frozen: false, sold: false }));
  makiri.ps.shop.slots = slots.map((s) => ({ ...s }));
  makiri.roundStart(2);
  assert.equal(makiri.handIds('chess').length, 0, '松桐 R2: nothing at the round start');
  makiri.prepStart(2);
  assert.equal(makiri.handIds('chess').length, 1, '松桐 R2: one free operator at the PREP start');
  const narant = setup({ band: 'band_narant', seed: 13 });
  narant.ps.shop.level = 3;
  narant.roundStart(2);
  assert.equal(narant.ps.offers.length, 0, '娜仁图亚 R2: nothing at the round start');
  narant.prepStart(2);
  assert.equal(narant.ps.offers.length, 1, '娜仁图亚 R2: 2 items at the PREP start');
  assert.equal(narant.ps.offers[0].slots.length, 2);
});

test('干员特质「<进入休整期时>」(SERVER_PREP_START, e.g. 缄默德克萨斯): runs at the PREP start, never at the round start', () => {
  // every visible operator whose SERVER_PREP_START 特质 hands out a free refresh
  const owners = [];
  for (const [id, rec] of Object.entries(DATA.chess)) {
    for (const gid of rec.garrisonIds || []) {
      const g = DATA.garrisons[gid];
      if (g && g.eventType === 'SERVER_PREP_START' && g.effectKey === 'SERVER_GAIN_FREE_REFRESH_COUNT' && rec.visible && !rec.isGolden) owners.push(id);
    }
  }
  assert.ok(owners.length > 0, 'a 「进入休整期时」 free-refresh trait exists');
  for (const id of owners.slice(0, 2)) {
    const s = setup();
    give(s.m, s.ps, id, 'board', [10, 4]);
    s.ps.shop.freeRefreshes = 0;
    s.roundStart(2);
    assert.equal(s.ps.shop.freeRefreshes, 0, `${id}: nothing at the round start`);
    s.prepStart(2);
    assert.ok(s.ps.shop.freeRefreshes > 0, `${id}: the trait fires at the PREP start`);
  }
});

test('顺序：R3 是机变回合 —— 老鲤的干员在机变之后（进入 PREP）才出现，不在 SP_DRAFT 之前', () => {
  // 绝境模拟 (mode_single_hard): 机变 rounds 3 / 9 / 11 — R3 is the one 老鲤 pays out on
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 4242, registry: REG, fake: true }).start();
  const m = h.m;
  const ps = h.ps('p_0');
  const got = [];
  const orig = ps.acquireChess.bind(ps);
  ps.acquireChess = (id, o = {}) => { const p = orig(id, o); if (p && /band/.test(String(o.source || ''))) got.push({ id, round: m.round, phase: m.phase }); return p; };
  assert.ok(m.gd.spRounds().includes(3), 'R3 is a 机变 round in this mode');
  h.drive(() => m.phase === PHASE.SP_DRAFT && m.round === 3, { band: 'band_lmlee' });
  assert.equal(m.round, 3);
  assert.equal(got.filter((g) => g.round === 3).length, 0, 'no strategy grant while the 机变 draft is still open');
  h.drive(() => m.phase === PHASE.PREP && m.round === 3, { band: 'band_lmlee' });
  const granted = got.filter((g) => g.round === 3);
  assert.equal(granted.length, 2, 'the R3 operators arrive once PREP opens');
  for (const g of granted) assert.equal(g.phase, PHASE.PREP);
});
