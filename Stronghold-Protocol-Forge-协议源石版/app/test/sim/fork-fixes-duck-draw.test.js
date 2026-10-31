// 上游 Forge 0.3.2 §37.26 / GitHub #839 —— 鸭爵「神秘顾客」每回合只抽一次（四人替换的数量、敌人、换成的种类完全相同），
// 从**本回合自身波次**（不含各自悬赏敌人）里选，领袖及其部件不计入时段比例，抽签走一条独立随机流
// (ctx.seedFor('duck:<round>'))：与商店 / 出怪 / 抽卡的流无关，所以预览与 bot 排练看到的与实战一致。
// 我方原状：bands/meta.js duckReplace 直接读 ctx.rng（= m.rngMeta，全房一条、按派发顺序推进）⇒ 每人各抽一份、四人不同步。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../server/sim/rng.js';
import { duckPicks, applyDuckPicks, duckReplace } from '../../server/sim/content/bands/meta.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { DATA, makeMatch } from '../match/harness.js';

const QUIET = { warn() {}, error() {}, info() {} };
const REG = createRegistry({ log: QUIET });
const PARAMS = (() => { const b = DATA.bands.band_ducklord.buffs[0]; return { ...b.bb, ...b.bbStr }; })();
const DUCKS = PARAMS.enemylist.split(',');
const GD = { enemy: (k) => DATA.enemies[k] || null };
const NORMAL = Object.values(DATA.enemies).find((e) => e.rank === 'NORMAL' && e.stats.motion === 'WALK').key;
/** 10 own wave units, one action each, 2 s apart. */
const wave = () => Array.from({ length: 10 }, (_, i) => ({ time: i * 2, enemyKey: NORMAL, routeIndex: 0, count: 1, actionIndex: i }));
const sig = (picks) => picks.map((p) => `${p.action}:${p.k}:${p.enemyKey}`);

test('鸭爵 #839: one draw per round — the same stream on the same wave yields the same count, units and enemies', () => {
  const base = wave();
  const a = duckPicks(GD, createRng(777), base, PARAMS);
  const b = duckPicks(GD, createRng(777), base, PARAMS);
  assert.ok(a.length <= PARAMS.max, `${a.length} swaps ≤ ${PARAMS.max}`);
  assert.deepEqual(sig(a), sig(b), 'same seed ⇒ identical swaps (count, units AND the enemy each one becomes)');
  // every swap names one of the four, and no unit is picked twice
  for (const pick of a) assert.ok(DUCKS.includes(pick.enemyKey), pick.enemyKey);
  assert.equal(new Set(a.map((x) => `${x.action}:${x.k}`)).size, a.length, 'no unit swapped twice');
  // a different stream draws a different set of units over 40 seeds (it is a draw, not a fixed answer)
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) seen.add(sig(duckPicks(GD, createRng(seed), base, PARAMS)).join(','));
  assert.ok(seen.size > 1, 'the draw varies with the match seed');
});

test('鸭爵 #839: the draw is taken over the round\'s OWN wave — bounty units are not candidates and never shift it', () => {
  const base = wave();
  const bounties = [0, 1, 2].map((i) => ({ time: i * 3 + 0.5, enemyKey: NORMAL, routeIndex: 0, count: 1, tag: 'bounty', actionIndex: 7 }));
  const withoutBounties = duckPicks(GD, createRng(99), base, PARAMS);
  // the same wave with one player's bounty units inserted (a different player inserts different ones) draws the same
  const withBounties = duckPicks(GD, createRng(99), [...base, ...bounties], PARAMS);
  assert.deepEqual(sig(withBounties), sig(withoutBounties), 'bounty units are not part of the share');
  // … and duckReplace's own default base filters them out: a bounty unit is never a candidate, never replaced
  const spawns = [...base.slice(0, 9), ...bounties];
  const replaced = duckReplace({ gd: GD, rng: createRng(99) }, spawns, PARAMS, 'p_0');
  for (const s of spawns) if (s.tag === 'bounty') assert.ok(!replaced.includes(s), 'a bounty unit is never replaced');
  for (const d of replaced) assert.equal(d.tag, 'duck');
  assert.ok(replaced.length <= PARAMS.max, `${replaced.length} ≤ max`);
});

test('鸭爵 #839: the leader and its parts are outside the time share (they move no unit\'s fraction)', () => {
  const base = wave();
  const leader = { time: 0, enemyKey: DATA.enemies[Object.keys(DATA.enemies).find((k) => DATA.enemies[k].rank === 'BOSS')].key, routeIndex: 0, count: 1, tag: 'boss', actionIndex: 99 };
  const part = { ...leader, tag: 'part', actionIndex: 98, time: 1 };
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
    const plain = sig(duckPicks(GD, createRng(seed), base, PARAMS));
    const withLeader = sig(duckPicks(GD, createRng(seed), [leader, part, ...base], PARAMS));
    assert.deepEqual(withLeader, plain, `seed ${seed}: the leader / parts shift nobody\'s share`);
    assert.ok(!withLeader.some((x) => x.startsWith('99:') || x.startsWith('98:')), 'never a leader or a part');
  }
});

test('鸭爵 #839: a swap finds its unit by ACTION, so a bounty-re-timed wave (several specs of one action) still matches', () => {
  // one wave action of 5 own units, re-timed around an inserted bounty unit: 3 units, the bounty, then 2 units
  const spawns = [
    { actionIndex: 0, time: 0, enemyKey: NORMAL, routeIndex: 0, count: 3, interval: 1 },
    { actionIndex: 0, time: 1.5, enemyKey: NORMAL, routeIndex: 0, count: 1, tag: 'bounty' },
    { actionIndex: 0, time: 3, enemyKey: NORMAL, routeIndex: 0, count: 2, interval: 1 },
  ];
  const out = applyDuckPicks(spawns, [{ action: 0, k: 4, enemyKey: DUCKS[0] }], 'p_0');
  assert.equal(out.length, 1);
  assert.equal(out[0].time, 4, 'the 5th own unit of the action — the second unit of the third spec');
  assert.equal(out[0].tag, 'duck');
  assert.deepEqual(out[0].bounty, { coins: 1, ownerPlayerId: 'p_0' });
  assert.equal(spawns.reduce((n, s) => n + (s.count || 1), 0), 6, 'every enemy is still on the list (the bounty included)');
});

test('鸭爵 #839: every player of a round gets the SAME swaps, and the draw consumes no match randomness', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 4242, registry: REG, fake: true }).start();
  h.toPrep(1, { band: 'band_ducklord' });
  const m = h.m;
  m.round = 5;
  const before = m.rngMeta.state();
  const lists = ['p_0', 'p_1'].map((pid) => {
    const ps = h.ps(pid);
    const ev = { input: ps.battleInput({ side: 'L', colOffset: 0 }), kind: 'normal', round: 5, spawns: wave() };
    m.dispatch(ps, 'onBattleStart', ev);
    return ev.spawns;
  });
  assert.equal(m.rngMeta.state(), before, 'the swap draw runs on its own stream (ctx.seedFor), not the match\'s meta stream');
  const swaps = (list, pid) => list.filter((s) => DUCKS.includes(s.enemyKey)).map((s) => `${s.time}:${s.enemyKey}`);
  assert.deepEqual(swaps(lists[1]), swaps(lists[0]), 'both players: same count, same units, same enemies');
  for (const list of lists) for (const s of list) if (s.tag === 'duck') assert.equal(s.bounty.coins, 1);
  // the same match, same round: a second look (the stats preview runs the same handler) draws the same again
  const again = { input: h.ps('p_0').battleInput({ side: 'L', colOffset: 0 }), kind: 'normal', round: 5, spawns: wave() };
  m.dispatch(h.ps('p_0'), 'onBattleStart', again);
  assert.deepEqual(swaps(again.spawns), swaps(lists[0]), 'the preview and the battle agree');
});
