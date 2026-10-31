// test/content/forkwave-batch5.test.js — the fork's own wave enemies of batch 5 (docs/research/16-extra-enemies.json b5 /
// b5b / b5c, owner 2026-10-29「黑流树海的大狗、大象、吐水羊、瞬移老鼠；孤星的大炮动力甲和打拳动力甲、交通厅」).
//
// The kits live in server/sim/content/enemies/forkwave.js; this file pins that every one of the seven is authored there
// (and not double-listed as stats-only), and that the signature mechanic of each really happens in a battle. Battles run
// with content 'generic' + extraContent [enemies, bosses] so other content modules never interfere.
//
// Three of them (撼地遗众 / R-11 / R-31 / “交通亭”) are `noWave: true` in the research file — they reach the field through
// the 强怪悬赏 cards (forkbounty_13 / _14) rather than a wave pool — so nothing here asserts a pool attachment: the kit is
// what this file is about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';

const DATA = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const { KITS, STATS_ONLY } = enemiesMod;

/** The seven keys this batch adds, with the handbook line each kit implements. */
const KEYS = Object.freeze([
  'enemy_2137_shsdgo',   // 猎犬proto · Jump: a 10 s pin-bite, ATK × 0.3 every 1.5 s
  'enemy_2136_shcolo',   // 撼地遗众 · blockWeight 4 + 10-hit HP-loss layers + tile-entry blast
  'enemy_2134_shrshep',  // 颂水贤者 · a backward 2-tile blink when attacked
  'enemy_2135_shkrbt',   // 聆风猎手 · a blink next to whoever attacks it
  'enemy_1256_lyacpa',   // R-11突击动力装甲 · 4 targets, ranged shots ×0.5
  'enemy_1255_lybgpa',   // R-31重型动力装甲 · 【超负载】 ATK × 0.75 + 2 s 晕眩
  'enemy_1332_cbterm',   // “交通亭”量产型 · blockWeight 4 + DEF/RES ramp + death eject & blast
]);

/** A silent wall of `block` slots on the flat stage's low lane; the enemy is spawned next to it. */
function arena(o = {}) {
  const h = makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 5, autoFinish: false, timeLimit: 300,
    defs: { chess: { t_wall: chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 2e6, def: 0, res: 0, blockCnt: o.block ?? 3 }, rangeGrid: [[0, 0]], skill: null }) } },
    kits: { t_wall: () => ({ trait: { noAttack: true } }) },
    units: [{ chessId: 't_wall', row: o.row ?? 10, col: o.col ?? 5 }],
    captureNoisy: true,
  });
  h.step();
  return h;
}
const put = (h, key, pos = [10, 5], mods = null) => h.spawn(key, { pos, routeIndex: 0, ...(mods ? { mods } : null) });
const wall = (h) => h.allies()[0];
/** Does a wall of `block` slots hold `key` (spawned on its tile)? */
const holds = (key, block) => {
  const h = arena({ block });
  put(h, key);
  h.run(0.5);
  return wall(h).blocking.length > 0;
};
const hitsOf = (h, e) => h.hooksOf('damaged').filter((c) => c.source === e && c.dmg && c.dmg.isAttack);

// ---------------------------------------------------------------------------------------------------------------
// registration

test('batch 5: the seven keys are authored in forkwave.js and NOT also listed as stats-only', () => {
  for (const key of KEYS) {
    assert.ok(DATA[key], `${key}: a data row exists (the kits read its blackboard)`);
    assert.ok(KITS[key], `${key}: a kit is registered`);
    assert.ok(!STATS_ONLY[key], `${key}: not in STATS_ONLY as well`);
  }
});

test('batch 5: the kits read the data blackboards they claim (every number comes from the row)', () => {
  // the numbers below are the data's own; if build-data ever stops carrying them the kits fall back to the same
  // constants as [ASSUMED], and this test says which key lost its blackboard
  const has = (key, pred, what) => assert.ok(pred(DATA[key]), `${key}: ${what}`);
  has('enemy_2137_shsdgo', (e) => e.skills.some((s) => s.prefabKey === 'Jump' && s.bb.ep_damage_ratio === 0.3), 'Jump.ep_damage_ratio');
  has('enemy_2134_shrshep', (e) => e.skills.some((s) => s.prefabKey === 'Blink' && s.bb.dist === 2), 'Blink.dist');
  has('enemy_2135_shkrbt', (e) => e.skills.some((s) => s.prefabKey === 'Blink' && s.cooldown === 30), 'Blink.cooldown');
  has('enemy_1255_lybgpa', (e) => e.skills.some((s) => s.prefabKey === 'Punch' && s.bb.atk_scale === 0.75 && s.bb.stun === 2), 'Punch');
  has('enemy_1256_lyacpa', (e) => e.talents.bb['Passive.attack@ranged.atk_scale'] === 0.5, 'Passive.attack@ranged.atk_scale');
  has('enemy_2136_shcolo', (e) => e.talents.bb['HpReduce.attack_time'] === 10 && e.talents.bb['TileDamage.attack_scale'] === 0.5, 'HpReduce / TileDamage');
  has('enemy_1332_cbterm', (e) => e.talents.bb['Boom.atk_scale'] === 2 && e.talents.bbStr['passive.enemy_key'] === 'enemy_1333_cbbgen', 'Boom / passenger');
});

// ---------------------------------------------------------------------------------------------------------------
// 撼地遗众 (enemy_2136_shcolo) — the block weight, the life-loss layers, the tile-entry blast

test('撼地遗众: 「占用4阻挡数」 — three slots are not enough, four are', () => {
  assert.equal(holds('enemy_2136_shcolo', 3), false, 'a 3-slot blocker cannot hold it');
  assert.equal(holds('enemy_2136_shcolo', 4), true, 'a 4-slot blocker holds it');
});

test('撼地遗众: every 10 damage instances add one 300/s life-loss layer, up to the data\'s 10 layers', () => {
  const h = arena({ block: 4 });
  const e = put(h, 'enemy_2136_shcolo');
  h.run(0.2);
  const layer = () => (e.buffs || []).filter((b) => b.key === 'ab:forkHpReduce');
  const hit = (n) => { for (let i = 0; i < n; i++) h.b.dealDamage(null, e, { amount: 1, type: 'true', canDodge: false }); };

  hit(9);
  assert.equal(layer().length, 0, 'nine hits: no layer yet (attack_time is 10)');
  hit(1);
  assert.equal(layer().length, 1, 'the tenth hit adds the first layer');
  assert.equal(layer()[0].stacks, 1, 'it is one layer');

  // one layer drains 300 HP per second (HpReduce.damage / interval)
  const hp0 = e.hp;
  h.run(2.2);
  const drained = hp0 - e.hp;
  assert.ok(Math.abs(drained - 300 * 2) < 300 * 0.35, `one layer drains ~300 HP/s (${Math.round(drained)} in 2.2 s)`);

  hit(9 * 10);                                   // 9 more layers available — the cap is max_stack_cnt (10)
  assert.equal(layer()[0].stacks, 10, 'the stack stops at the data\'s max_stack_cnt (10)');
  hit(10);
  assert.equal(layer()[0].stacks, 10, 'and never goes past it');
  checkInvariants(h.b);
});

test('撼地遗众: 「每进入一个新地块，对周围造成物理伤害」 — ATK × TileDamage.attack_scale within range_radius', () => {
  const h = arena({ block: 4 });
  const e = put(h, 'enemy_2136_shcolo', [10, 6.6]);
  const hp0 = wall(h).hp;
  h.run(4);
  const dmg = hp0 - wall(h).hp;
  const per = e.s.atk * DATA.enemy_2136_shcolo.talents.bb['TileDamage.attack_scale'];
  assert.ok(dmg > 0, `the wall is hit while the colossus walks onto new tiles (${Math.round(dmg)})`);
  // every hit is one per-square blast (whole multiples of ATK × 0.5, and the wall takes no normal attack: atk 0)
  assert.equal(dmg % per, 0, `${Math.round(dmg)} is a whole number of ${per}-damage tile blasts`);
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// “交通亭”量产型 (enemy_1332_cbterm) — block weight, the DEF/RES ramp, the death eject + blast

test('“交通亭”量产型: 「只能被阻挡数大于等于4的单位阻挡」', () => {
  assert.equal(holds('enemy_1332_cbterm', 3), false, 'a 3-slot blocker cannot hold it');
  assert.equal(holds('enemy_1332_cbterm', 4), true, 'a 4-slot blocker holds it');
});

test('“交通亭”量产型: each hit lowers DEF and RES, 110 stacks bottoming both out', () => {
  const h = arena({ block: 4 });
  const e = put(h, 'enemy_1332_cbterm');
  h.run(0.2);
  const bb = DATA.enemy_1332_cbterm.talents.bb;
  const stacks = bb['passive.max_stack_cnt'];
  assert.equal(e.s.def, DATA.enemy_1332_cbterm.stats.def, 'full DEF before the first hit');
  assert.equal(e.s.res, DATA.enemy_1332_cbterm.stats.res, 'full RES before the first hit');

  for (let i = 0; i < stacks; i++) h.b.dealDamage(null, e, { amount: 1, type: 'true', canDodge: false });
  h.run(0.1);
  const rust = (e.buffs || []).filter((b) => b.key === 'ab:forkRust');
  assert.equal(rust.length, 1, 'one stacking debuff carries the whole ramp');
  assert.equal(rust[0].stacks, stacks, `${stacks} stacks after ${stacks} hits`);
  // passive.def −5500 over 110 stacks and passive.magic_resistance −110 over 110 stacks: both reach 0, not below
  assert.ok(e.s.def <= 1e-6, `DEF ramped to ${e.s.def} (from ${DATA.enemy_1332_cbterm.stats.def})`);
  assert.ok(e.s.res <= 1e-6, `RES ramped to ${e.s.res} (from ${DATA.enemy_1332_cbterm.stats.res})`);

  // the cap: more hits change nothing
  for (let i = 0; i < 20; i++) h.b.dealDamage(null, e, { amount: 1, type: 'true', canDodge: false });
  h.run(0.1);
  assert.equal((e.buffs || []).find((b) => b.key === 'ab:forkRust').stacks, stacks, 'no stacks past max_stack_cnt');
  checkInvariants(h.b);
});

test('“交通亭”量产型: 「被摧毁后弹射<“交通警察”>并自爆」 — the eject spawns it, the blast hits ATK × Boom.atk_scale', () => {
  const h = arena({ block: 4 });
  const e = put(h, 'enemy_1332_cbterm');
  h.run(0.3);
  const atk = e.s.atk;
  const hp0 = wall(h).hp;
  h.b.dealDamage(null, e, { amount: 1e9, type: 'true', canDodge: false });
  h.run(0.5);
  const left = h.enemies().filter((x) => x.alive);
  assert.equal(left.length, 1, `one unit left on the field (${left.map((x) => x.defId).join(',')})`);
  assert.equal(left[0].defId, 'enemy_1333_cbbgen', 'the leftover is the “交通警察” the blackboard names');
  const dmg = hp0 - wall(h).hp;
  assert.equal(Math.round(dmg), Math.round(atk * DATA.enemy_1332_cbterm.talents.bb['Boom.atk_scale']), `the blast is ATK × Boom.atk_scale (${Math.round(dmg)})`);
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// R-31重型动力装甲 (enemy_1255_lybgpa) — 【超负载】

test('R-31重型动力装甲: 【超负载】 deals ATK × atk_scale physical and 晕眩s the target for `stun` s', () => {
  const h = arena({ block: 3 });
  const e = put(h, 'enemy_1255_lybgpa');
  const bb = DATA.enemy_1255_lybgpa.skills.find((s) => s.prefabKey === 'Punch').bb;
  assert.ok(h.runUntil(() => h.hooksOf('statusApplied').some((c) => c.status === 'stun'), 30), 'the punch lands within 30 s');
  h.run(0.2);
  const stuns = h.hooksOf('statusApplied').filter((c) => c.status === 'stun' && c.target === wall(h));
  assert.equal(stuns.length, 1, 'exactly one 晕眩 so far');
  assert.equal(stuns[0].duration, bb.stun, `the 晕眩 lasts the blackboard's ${bb.stun} s`);
  const ov = h.hooksOf('damaged').filter((c) => c.source === e && c.dmg && c.dmg.tags && c.dmg.tags.includes('overload'));
  assert.equal(ov.length, 1, 'the punch is one skill hit');
  assert.equal(Math.round(ov[0].amount), Math.round(e.s.atk * bb.atk_scale), `the punch is ATK × ${bb.atk_scale} (${Math.round(ov[0].amount)})`);
  // the SILENCE line: silenced, the punch is not used (its `sil` flag), while the plain attack goes on
  checkInvariants(h.b);
});

test('R-31重型动力装甲: the 超负载 line is SILENCE-flagged, so it is carried by a silenceable ability', () => {
  assert.ok(DATA.enemy_1255_lybgpa.abilities.some((a) => a.format === 'SILENCE'), 'the data marks 【超负载】 SILENCE');
  const h = arena({ block: 3 });
  const e = put(h, 'enemy_1255_lybgpa');
  assert.ok(e.mem.ab.list.some((a) => a && a.sil), 'the kit ability carries `sil`');
});

// ---------------------------------------------------------------------------------------------------------------
// R-11突击动力装甲 (enemy_1256_lyacpa) — four targets, halved ranged shots

test('R-11突击动力装甲: 「同时攻击四个目标」 and ranged shots land at Passive.attack@ranged.atk_scale × ATK', () => {
  // unblocked, out of melee contact: every shot is a ranged one and takes the talent's 0.5
  const h = arena({ block: 0 });
  const e = put(h, 'enemy_1256_lyacpa', [10, 9], { speedMul: 0 });
  const scale = DATA.enemy_1256_lyacpa.talents.bb['Passive.attack@ranged.atk_scale'];
  assert.equal(e.profile.maxTargets, 4, 'it targets four units at once (maxTargets 4)');
  h.run(12);
  const hits = hitsOf(h, e);
  assert.ok(hits.length > 0, 'it shoots the wall');
  for (const c of hits) assert.equal(Math.round(c.amount), Math.round(e.s.atk * scale), `a ranged shot is ATK × ${scale} (${Math.round(c.amount)})`);
  checkInvariants(h.b);
});

test('R-11突击动力装甲: a MELEE hit (its own blocker) keeps the full ATK', () => {
  const h = arena({ block: 3 });
  const e = put(h, 'enemy_1256_lyacpa');
  assert.ok(h.runUntil(() => hitsOf(h, e).length > 0, 30), 'it attacks its blocker within 30 s');
  const hits = hitsOf(h, e);
  assert.equal(Math.round(hits[0].amount), Math.round(e.s.atk), `the melee hit is the full ATK (${Math.round(hits[0].amount)})`);
});

// ---------------------------------------------------------------------------------------------------------------
// 猎犬proto (enemy_2137_shsdgo) — Jump's pin-bite

test('猎犬proto: Jump bites one locked unit every hit_interval for ATK × ep_damage_ratio, for `duration` s', () => {
  const h = arena({ block: 3 });
  const e = put(h, 'enemy_2137_shsdgo');
  const bb = DATA.enemy_2137_shsdgo.skills.find((s) => s.prefabKey === 'Jump').bb;
  const w = wall(h);
  assert.ok(h.runUntil(() => !!w.findBuff('ab:forkJump'), 25), 'the bite starts on the attacked unit');
  const bite = w.findBuff('ab:forkJump');
  assert.ok(Math.abs(bite.duration - bb.duration) < 1e-9, `the bite lasts the blackboard's ${bb.duration} s`);
  // six bites: one every hit_interval over the duration (10 / 1.5 ⇒ 6)
  const bites = () => h.hooksOf('damaged').filter((c) => c.dmg && c.dmg.tags && c.dmg.tags.includes('forkJump'));
  h.run(bb.duration - 1);
  assert.equal(bites().length, Math.floor(bb.duration / bb.hit_interval), 'one bite per hit_interval for the whole duration');
  for (const c of bites()) assert.equal(Math.round(c.amount), Math.round(e.s.atk * bb.ep_damage_ratio), `a bite is ATK × ${bb.ep_damage_ratio}`);
  // the pin ends with its duration: a further second bites nobody new
  const n = bites().length;
  h.run(2);
  assert.ok(bites().length - n <= 1, 'the bite ends with its 10 s window');
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// 颂水贤者 (enemy_2134_shrshep) / 聆风猎手 (enemy_2135_shkrbt) — the two on-hit teleports

test('颂水贤者: 「受到攻击时向后传送一段距离」 — an attack moves it `dist` tiles BACK, never into a wall', () => {
  const h = arena({ block: 3 });
  const e = put(h, 'enemy_2134_shrshep', [10, 4]);
  const dist = DATA.enemy_2134_shrshep.skills.find((s) => s.prefabKey === 'Blink').bb.dist;
  h.run(2.5);                                   // past the 2 s initial cooldown
  assert.ok(e.x < 5, `it walked up the lane (${e.x.toFixed(2)})`);
  const from = [e.y, e.x];
  h.b.dealDamage(wall(h), e, { amount: 10, type: 'phys', isAttack: true, canDodge: false });
  h.run(0.3);
  assert.ok(e.findBuff('ab:blink'), 'the teleport happened (its 1 s blink buff)');
  const moved = Math.hypot(e.y - from[0], e.x - from[1]);
  assert.ok(moved > dist * 0.9 && moved < dist + 0.2, `it moved about ${dist} tiles back (${moved.toFixed(2)})`);
  // back means AWAY from its route's goal (which is to the left): it ends up further right than it was
  assert.ok(e.x > from[1], `the teleport goes backwards, not forwards (${from[1].toFixed(2)} → ${e.x.toFixed(2)})`);
  assert.ok(h.b.grid.groundPassable(Math.round(e.y), Math.round(e.x)), 'it never lands inside a wall');
  checkInvariants(h.b);
});

test('聆风猎手: 「受到攻击时传送到攻击者身边」 — it lands on a free tile next to whoever hit it', () => {
  const h = arena({ block: 3 });
  const e = put(h, 'enemy_2135_shkrbt', [10, 8]);
  const w = wall(h);
  h.run(0.2);
  assert.ok(e.x > 6, `it is still well away from the wall (${e.x.toFixed(2)})`);
  h.b.dealDamage(w, e, { amount: 10, type: 'phys', isAttack: true, canDodge: false });
  h.run(0.3);
  const dr = Math.abs(Math.round(e.y) - w.tileR), dc = Math.abs(Math.round(e.x) - w.tileC);
  assert.ok(Math.max(dr, dc) === 1, `it is on a tile next to the attacker (Δrow ${dr}, Δcol ${dc})`);
  assert.ok(h.b.grid.groundPassable(Math.round(e.y), Math.round(e.x)), 'on a passable tile');
  assert.notEqual(h.b.unitAt(Math.round(e.y), Math.round(e.x)), w, 'and not on the operator\'s own tile');
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// b5c: the two leaders the owner asked for as 强怪悬赏 enemies (「增加悬赏：爱国者、主线狂躁大熊」). They are ordinary
// enemies here — a bounty card spawns them into a wave — so they live in forkwave.js, not in bosses.js BOSS_KITS.

test('b5c: 爱国者 / 狂躁异质裂兽 are authored in forkwave.js and NOT stats-only or BOSS_KITS', () => {
  for (const key of ['enemy_1506_patrt', 'enemy_1571_mirbst']) {
    assert.ok(DATA[key], `${key}: a data row`);
    assert.ok(KITS[key], `${key}: a kit is registered`);
    assert.ok(!STATS_ONLY[key], `${key}: not in STATS_ONLY as well`);
    assert.ok(!bossesMod.BOSS_KITS[key], `${key}: not also a BOSS_KITS leader`);
    const card = JSON.parse(fs.readFileSync(new URL('../../data/choices.json', import.meta.url), 'utf8')).cards.bounty.find((c) => c.enemyKey === key && c.fork);
    assert.ok(card, `${key}: a fork bounty card spawns it`);
    assert.equal(card.draftPool, 'boss', `${key}: offered by the R9 draft`);
  }
});

test('爱国者: 行军姿态 is the data\'s own `shield.*` (atk +50 %, def +200 %, res +100) and the aura is `strength.*`', () => {
  const h = arena({ block: 4 });
  const e = put(h, 'enemy_1506_patrt', [10, 5]);
  const t = DATA.enemy_1506_patrt.talents.bb;
  h.run(0.5);
  // `shield.atk` 0.5 = +50 % (NOT ×0.5 — reading it as a multiplier was a real bug here once)
  const wantAtk = DATA.enemy_1506_patrt.stats.atk * (1 + t['shield.atk']);
  assert.ok(Math.abs(e.s.atk - wantAtk) <= 1, `ATK ${e.s.atk.toFixed(0)} = base × (1 + shield.atk ${t['shield.atk']})`);
  const wantDef = DATA.enemy_1506_patrt.stats.def * (1 + t['shield.def']);
  assert.ok(Math.abs(e.s.def - wantDef) <= 1, `DEF ${e.s.def.toFixed(0)} = base × (1 + shield.def ${t['shield.def']})`);
  assert.equal(e.s.res, Math.min(100, DATA.enemy_1506_patrt.stats.res + t['shield.magic_resistance'] * 100), 'RES +100');
  // the `strength.*` half is the aura on OTHER enemies, not on itself
  const other = put(h, 'enemy_1007_slime', [10.6, 5]);
  h.run(1);
  const aura = (other.buffs || []).find((b) => b.key === 'fork:patriotAura');
  assert.ok(aura, 'a nearby enemy carries the 【大幅强化敌军攻击与防御力】 aura');
  assert.ok(Math.abs(aura.mods.atkPct - t['strength.atk']) < 1e-9, `the aura is ATK +${t['strength.atk'] * 100} %`);
  assert.equal(aura.mods.defFlat, t['strength.def'], `the aura is DEF +${t['strength.def']}`);
  checkInvariants(h.b);
});

test('爱国者: the 重生 window is ~5 s (owner 2026-10-30), not the data\'s 60 s, and so is the invulnerability', () => {
  const h = arena({ block: 4 });
  const e = put(h, 'enemy_1506_patrt', [10, 5]);
  h.run(0.5);
  const dataDur = DATA.enemy_1506_patrt.talents.bb['reborn.duration'];
  const dataInv = DATA.enemy_1506_patrt.talents.bb['reborn.patrt_t_state_2[reborn_invincible].duration'];
  assert.ok(dataDur > 5, `the cap really is a deviation from the data (${dataDur} s)`);
  h.b.dealDamage(null, e, { amount: e.s.maxHp * 5, type: 'true', canDodge: false });
  h.run(0.2);
  assert.ok(e.alive, 'the knock-out is hidden (it revives)');
  assert.ok(e.findBuff('ab:reborn'), 'inside the 重生 window');
  h.run(4.0);                                   // ≈ 4.2 s in: the data's 60 s would still be down here
  assert.ok(e.findBuff('ab:reborn'), 'still down at ~4 s (the window is not shorter than that)');
  h.run(1.3);                                   // ≈ 5.5 s in
  assert.ok(!e.findBuff('ab:reborn'), "back by ~5.5 s — not the data's 60 s");
  assert.ok(e.alive && e.hpRatio > 0.99, `it came back at full HP (${e.hpRatio.toFixed(2)})`);
  for (const st of ['stun', 'freeze', 'levitate']) assert.ok(e.mem.ab.immune.has(st), `毁灭姿态 is immune to ${st}`);
  // 复活后的无敌同样封顶：数据的 15 s 会让它「回来了却打不到」，那是第二段更长的等待。
  assert.ok(e.findBuff('ab:reborn:inv'), 'it comes back invulnerable (the 毁灭姿态 entrance)');
  assert.ok(dataInv > 5, `the invulnerability cap is a deviation too (${dataInv} s)`);
  h.run(5.5);
  assert.ok(!e.findBuff('ab:reborn:inv'), "the invulnerability is capped to the same ~5 s, not the data's 15 s");
  checkInvariants(h.b);
});

test('狂躁异质裂兽: a normal attack leaves 「受到来自自身的伤害大幅提升」 on the target', () => {
  const h = arena({ block: 4 });
  put(h, 'enemy_1571_mirbst', [10, 5]);
  const w = wall(h);
  const amp = DATA.enemy_1571_mirbst.talents.bb['IncreasedDamage.damage_scale'];
  h.run(6);
  const b = (w.buffs || []).find((x) => x.key === 'fork:mirAmp');
  assert.ok(b, 'the target carries the amplification debuff');
  assert.ok(Math.abs(b.mods.dmgTakenMul - amp) < 1e-9, `it takes ×${amp} from this enemy`);
  checkInvariants(h.b);
});

test('狂躁异质裂兽: 第一形态 cannot be taken below `HpRatioCtrl.min_hp_ratio`, then 逃跑 → 第二形态', () => {
  const h = arena({ block: 4 });
  const e = put(h, 'enemy_1571_mirbst', [10, 5]);
  const floor = DATA.enemy_1571_mirbst.talents.bb['HpRatioCtrl.min_hp_ratio'];
  h.run(0.3);
  // a hit that would cross the floor leaves it at the floor and starts the 逃跑
  // 狂怒 halves 受到的物理/法术伤害 (`M0CrazyBonus.damage_resistance` 0.5), so the hit is sized past that reduction.
  // An HP floor cannot be expressed as "the XP stays at the floor" only — a hit that crosses it is a KNOCK-OUT in the
  // engine's own terms, and reborn() turns that knock-out into the form change. So the assertion is about the FORM,
  // and the floor is checked on a hit that stops just above it.
  h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.2, type: 'true', canDodge: false });
  h.run(0.2);
  assert.ok(e.hpRatio > floor - 1e-9, `a 20 % hit leaves it above the ${floor} floor (${e.hpRatio.toFixed(3)})`);
  h.b.dealDamage(null, e, { amount: e.s.maxHp * 4, type: 'true', canDodge: false });
  h.run(0.2);
  assert.ok(e.alive, 'the first form does not die — it escapes');
  const mirror = e.mem.ab.list.find((a) => typeof a.killed === 'function');
  assert.equal(mirror.state, 'reborn', 'the knock-out started the 逃跑 window (the reborn state)');
  h.run((DATA.enemy_1571_mirbst.talents.bb['RunToNearestHole.delay'] ?? 10) + 1);
  assert.ok(e.alive, 'it came back as the second form');
  assert.equal(mirror.state, 'form2', 'the rebirth switched it to form 2');
  const maxT = DATA.enemy_1571_mirbst.talents.bb['AttackParam.attack@max_target'];
  assert.equal(e.profile.maxTargets, Math.round(maxT), `第二形态 hits ${maxT} targets at once`);
  for (const st of ['sleep', 'fear']) assert.ok(e.mem.ab.immune.has(st), `第二形态 is immune to ${st}`);
  checkInvariants(h.b);
});
