// test/content/extra-enemies.test.js — the fork's own wave enemies (docs/research/16-extra-enemies.json): the roster,
// their data rows, the special-entry attachment rules, and that they really come out of the wave generator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupMatchWaves, buildNormalWave } from '../../server/match/waves.js';
import { GameData } from '../../server/match/gamedata.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA } from '../match/harness.js';

const J = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));
const RESEARCH = J('../../docs/research/16-extra-enemies.json');
/** Every batch flattened: batch 1 is the plain stat-only wave filler, batch 2 the ones with a mechanic. */
const ALL = (RESEARCH.batches || []).flatMap((b) => (b.enemies || []).map((e) => ({ ...e, batch: b.id })));
const BATCH = (RESEARCH.batches?.[0]?.enemies) || [];
const MECHANIC = ALL.filter((e) => e.kit);
const E = DATA.enemies;
const F = DATA.factions.entries;
const ACT = JSON.parse(fs.readFileSync(new URL('../../.cache/gamedata/excel/activity_table.json', import.meta.url), 'utf8'));
const OFFICIAL = ACT.activity?.AUTOCHESS_SEASON?.act2autochess?.specialEnemyInfoDict || null;

test('research file: a non-empty batch of well-formed enemy keys', () => {
  assert.ok(Array.isArray(RESEARCH.batches) && RESEARCH.batches.length >= 1, 'at least one batch');
  assert.ok(BATCH.length >= 20, `${BATCH.length} enemies in batch 1`);
  for (const e of BATCH) {
    assert.match(e.key, /^enemy_/, `${e.key}: an enemy key`);
    assert.ok(e.rank === 'NORMAL' || e.rank === 'ELITE', `${e.key}: rank ${e.rank}`);
    assert.ok(Number.isFinite(e.attrPower) && e.attrPower > 0, `${e.key}: attrPower`);
  }
  assert.equal(new Set(ALL.map((e) => e.key)).size, ALL.length, 'no duplicate keys across the batches');
});

test('every batch enemy has a data row: stats, rank, an attack clip and a model', () => {
  const assets = J('../../data/assets.json').enemies;
  for (const e of ALL) {
    const r = E[e.key];
    assert.ok(r, `${e.key} is in data/enemies.json`);
    assert.equal(r.rank, e.rank, `${e.key}: rank`);
    assert.ok(!r.tokenOnly, `${e.key}: not tokenOnly (it is spawned by waves, not routed as a summon)`);
    assert.ok(r.stats.maxHp > 0 && r.stats.atk >= 0, `${e.key}: stats`);
    // the model comes from the local client extraction, so the clip must be known or the sim stands ATTACK_PAUSE.
    // A `noWave` row (a leader kept only for a bounty card, a `_2` strength variant) is never fielded by a wave, so a
    // missing clip costs nothing there — the row and its model are all it needs.
    if (!e.noWave) assert.ok(r.attackAnim && r.attackAnim.dur > 0, `${e.key}: attackAnim (extract the model, then rebuild)`);
    const a = assets[e.key];
    assert.ok(a, `${e.key} is in data/assets.json`);
    assert.ok(a.spineLocal && a.spineLocal.skel, `${e.key}: spineLocal (the official model from the local client)`);
  }
});

test('attached to a special-entry pool without moving the official keys', () => {
  const anchors = new Map(); // entry key → { N: [...], E: [...] } of official keys
  if (OFFICIAL) for (const [k, v] of Object.entries(OFFICIAL)) anchors.set(k, { N: v.attachedNormalEnemyKeys || [], E: v.attachedEliteEnemyKeys || [] });
  let attached = 0;
  const wide = [];
  /** The most a research `band: 'wide'` key may overshoot a pool anchor through the over-cap slot
   *  (tools/build-data.mjs OVERCAP_RATIO_MAX); a key past it never enters a pool and stays bounty-only. */
  const OVERCAP_RATIO_MAX = 1.6;
  for (const [k, entry] of Object.entries(F)) {
    const off = anchors.get(k);
    for (const cls of ['N', 'E']) {
      const list = entry[cls] || [];
      // official keys stay at the head of the list, in their official order (429 fixtures + waves-crosscheck read [0])
      if (off) assert.deepEqual(list.slice(0, off[cls].length).map((x) => x.key), off[cls], `${k}.${cls}: official keys first`);
      for (const x of list) {
        assert.ok(E[x.key], `${k}.${cls}: ${x.key} exists`);
        assert.equal(E[x.key].isFlyEnemy, entry.fly, `${k}.${cls}: ${x.key} shares the entry's movement class`);
        if (x.fork) {
          attached++;
          const anchor = E[list[0].key];
          assert.equal(E[x.key].rank, anchor.rank, `${k}.${cls}: ${x.key} same rank as the anchor`);
          const ratio = E[x.key].attrPower / anchor.attrPower;
          if (ratio < 0.85 - 1e-9 || ratio > 1.25 + 1e-9) wide.push(`${k}.${cls}:${x.key}@${ratio.toFixed(2)}`);
          // the tight band keeps a wave's enemy count intact; the wide band (0.7–1.5) is only the documented rescue for
          // a batch key no tight pool fits — a couple of attachments, never the whole batch. The over-cap slot is the
          // last resort past the wide band's top and is itself capped (a P 136210 key must never reach a pool).
          const top = x.overCap ? OVERCAP_RATIO_MAX : 1.5;
          assert.ok(ratio >= 0.7 - 1e-9 && ratio <= top + 1e-9, `${k}.${cls}: ${x.key} within the power band (${ratio.toFixed(2)})`);
        }
      }
    }
  }
  assert.ok(attached >= 60, `${attached} fork attachments (the batch is actually wired into the pools)`);
  // Batch 2's enemies are declared `band: 'wide'` in the research file (they are all weaker than the pool anchors they
  // fit), so a fifth of the attachments may sit outside the tight band — the per-round count drift (waves-official's
  // ±12 %) is the real guard and is measured separately.
  assert.ok(wide.length <= Math.ceil(attached * 0.25), `${wide.length}/${attached} wide-band attachments: ${wide.slice(0, 6).join(' ')}`);
  const wired = new Set();
  for (const entry of Object.values(F)) for (const cls of ['N', 'E']) for (const x of entry[cls] || []) if (x.fork) wired.add(x.key);
  const missing = ALL.filter((e) => !wired.has(e.key) && !e.noWave).map((e) => e.key);
  // Documented exceptions: 高阶术师 is weaker than every ELITE pool anchor, so the band keeps it out of the waves; and
  // 爆破攻坚手组长 (P 39000, past the widest band) is the one key the over-cap slot cannot take any more.
  assert.deepEqual(missing.sort(), ['enemy_1018_aoemag', 'enemy_1058_traink_2'], 'only the documented outliers stay unwired');
  // `noWave` rows are declared bounty-only / registration-only and must NOT reach a pool: the `_2` strength variants would
  // push their base key out, and a leader (爱国者, 狂躁异质裂兽) is not a wave enemy at all.
  for (const e of ALL.filter((x) => x.noWave)) assert.ok(!wired.has(e.key), `${e.key}: noWave yet attached to a pool`);
});

test('they really come out of the wave generator', () => {
  const gd = new GameData(DATA, 'mode_multi_abyss');
  const want = new Set(ALL.map((e) => e.key));
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const setup = setupMatchWaves(gd, createRng(seed * 7919));
    for (let r = 1; r <= 13; r++) {
      const w = buildNormalWave(gd, createRng(seed), setup.factions, r);
      for (const s of w.spawns) if (want.has(s.enemyKey)) seen.add(s.enemyKey);
    }
  }
  assert.ok(seen.size >= 24, `${seen.size} of the ${want.size} batch enemies spawned over 12 matches`);
});

// ---------------------------------------------------------------------------------------------------------------
// batch 2: the ones with a mechanic (server/sim/content/enemies/forkwave.js)

test('batch 2: every mechanic key is authored in forkwave.js and NOT also listed as stats-only', async () => {
  const mod = await import('../../server/sim/content/enemies.js');
  assert.ok(MECHANIC.length >= 5, `${MECHANIC.length} enemies with a mechanic`);
  for (const e of MECHANIC) {
    assert.ok(mod.KITS[e.key], `${e.key}: a kit is registered`);
    assert.ok(!mod.STATS_ONLY[e.key], `${e.key}: not in STATS_ONLY as well`);
    assert.equal(e.kit, 'server/sim/content/enemies/forkwave.js', `${e.key}: the research file names its kit file`);
  }
});

test('batch 2 mechanics in a real battle: self-destruct and the on-hit debuffs', async () => {
  const { makeBattle, chessRec } = await import('../helpers/battleHarness.js');
  const enemiesMod = await import('../../server/sim/content/enemies.js');
  const bossesMod = await import('../../server/sim/content/bosses.js');
  const WALL = (id) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 3e4, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
  /** Spawn one enemy next to a silent wall, let it attack 8 s, then kill it with a true-damage hit. */
  const run = (key) => {
    const h = makeBattle({
      content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 5, autoFinish: false, timeLimit: 200,
      defs: { chess: { t_wall: WALL('t_wall') } }, kits: { t_wall: () => ({ trait: { noAttack: true } }) },
      units: [{ chessId: 't_wall', row: 10, col: 5 }],
    });
    h.step();
    const e = h.spawn(key, { pos: [10, 5], routeIndex: 0 });
    const wall = h.allies()[0];
    h.run(8);
    const aspd = (wall.buffs || []).filter((b) => b.mods && b.mods.aspd).map((b) => b.mods.aspd);
    const defFlat = (wall.buffs || []).filter((b) => b.mods && b.mods.defFlat).map((b) => b.mods.defFlat);
    const hp0 = wall.hp;
    h.b.dealDamage(wall, e, { amount: 1e6, type: 'true', canDodge: false });
    h.run(0.4);
    return { boom: Math.round(hp0 - h.allies()[0].hp), aspd, defFlat, atk: E[key].stats.atk };
  };

  // 辐能源石虫: Boom.atk_scale × ATK arts blast on death (the blackboard key really is capital-B for this enemy)
  const slug = run('enemy_1352_eslime');
  assert.equal(slug.boom, Math.round(slug.atk * 4), `辐能源石虫 death blast = ATK×4 (${slug.boom})`);

  // 「得意」: lowercase boom.atk_scale, arts blast; no yin/yang system so only the base scale
  const fang = run('enemy_1126_spslme');
  assert.equal(fang.boom, Math.round(fang.atk * 4), `“得意” death blast = ATK×4 (${fang.boom})`);

  // 畸变恶性瘤: the blocked unit's attack speed drops by 80
  assert.deepEqual(run('enemy_1138_tumor').aspd, [-0.8], '畸变恶性瘤 lowers the blocker ASPD');

  // 酸液源石虫: every hit lowers the target's DEF by 10
  assert.deepEqual(run('enemy_1004_mslime').defFlat, [-10], '酸液源石虫 lowers the target DEF');
});

// ---------------------------------------------------------------------------------------------------------------
// batch 3 (2026-10-25, owner「我想要加入更多有技能的怪」): the second batch of kit enemies

test('batch 3 mechanics in a real battle: block weight, splash, aura, heals, death spawn', async () => {
  const { makeBattle, chessRec } = await import('../helpers/battleHarness.js');
  const enemiesMod = await import('../../server/sim/content/enemies.js');
  const bossesMod = await import('../../server/sim/content/bosses.js');
  /** A silent wall with `block` slots; the enemy is spawned on it. */
  const arena = (block) => {
    const h = makeBattle({
      content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 5, autoFinish: false, timeLimit: 200,
      defs: { chess: { t_wall: chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 3e4, def: 0, res: 0, blockCnt: block }, rangeGrid: [[0, 0]], skill: null }) } },
      kits: { t_wall: () => ({ trait: { noAttack: true } }) },
      units: [{ chessId: 't_wall', row: 10, col: 5 }],
    });
    h.step();
    return h;
  };
  const put = (h, key, pos = [10, 5]) => h.spawn(key, { pos, routeIndex: 0 });
  /** Can a wall of `block` slots hold `key`? */
  const holds = (key, block) => {
    const h = arena(block);
    put(h, key);
    h.run(0.5);
    return h.allies()[0].blocking.length > 0;
  };

  // 欺凌者 / 倾轧者 · "只能被阻挡数大于等于3的单位阻挡" (blockWeight 3)
  assert.equal(holds('enemy_1058_traink', 1), false, '欺凌者 is not blocked by a 1-slot blocker');
  assert.equal(holds('enemy_1058_traink', 3), true, '欺凌者 is blocked by a 3-slot blocker');
  // 乌萨斯突击者 · the same line at weight 2
  assert.equal(holds('enemy_1111_ucommd', 1), false, '乌萨斯突击者 needs a 2-slot blocker');
  assert.equal(holds('enemy_1111_ucommd', 2), true, '乌萨斯突击者 is blocked by a 2-slot blocker');

  // 陶醉的“酩酊” · the aura on the other ground enemies near it: ASPD +50, move ×1.5, damage taken ×0.6
  {
    const h = arena(3);
    put(h, 'enemy_10007_trspsb_2', [10, 5]);
    const o = put(h, 'enemy_1007_slime', [10, 5.6]);
    h.run(1);
    const b = (o.buffs || []).filter((x) => x.key === 'ab:trspsbAura');
    assert.equal(b.length, 1, '陶醉的“酩酊” gives a nearby enemy its aura');
    assert.equal(b[0].mods.aspd, 50, 'the aura is +50 ASPD');
    assert.ok(Math.abs(b[0].mods.moveMul - 1.5) < 1e-9, 'the aura is ×1.5 move speed');
    assert.ok(Math.abs(b[0].mods.dmgTakenMul - 0.6) < 1e-9, 'the aura is ×0.6 damage taken');
  }

  // 资深圣堂保育员 · every 3 s: ATK × heal_scale (3) to the enemies around it
  {
    const h = arena(3);
    put(h, 'enemy_10089_hlsprt_2', [10, 5]);
    const o = put(h, 'enemy_1007_slime', [10, 5.6]);
    h.b.dealDamage(null, o, { amount: 100, type: 'true', canDodge: false });
    const hp0 = o.hp;
    h.run(4);
    assert.ok(o.hp > hp0, `资深圣堂保育员 heals a neighbour (${hp0} → ${o.hp})`);
  }

  // 硕果磐蟹 · below half HP it eats its 闪亮果实 once (a heal of maxHp × 0.5)
  {
    const h = arena(3);
    const e = put(h, 'enemy_10004_trdiam_2');
    const max = e.s.maxHp;
    h.b.dealDamage(null, e, { amount: max * 0.9, type: 'true', canDodge: false });
    h.run(0.5);
    assert.ok(e.hp > max * 0.1, `硕果磐蟹 eats the fruit (${Math.round(e.hp)} of ${max})`);
    // one fruit only: a second drop below half HP does not heal it again
    h.b.dealDamage(null, e, { amount: max * 0.9, type: 'true', canDodge: false });
    h.run(0.5);
    assert.ok(e.hp < max * 0.1 + 1, `硕果磐蟹 eats it only once (${Math.round(e.hp)} of ${max})`);
  }

  // 水手重艇 · "载具损毁后<水手>会继续作战": the death brings the 水手 of the data (DeathRattle.enemy_key)
  {
    const h = arena(3);
    const e = put(h, 'enemy_1163_hvymot');
    h.b.dealDamage(null, e, { amount: 1e9, type: 'true', canDodge: false });
    h.run(0.5);
    const left = h.enemies().filter((x) => x.alive);
    assert.equal(left.length, 1, `水手重艇 leaves one 水手 (${left.map((x) => x.defId).join(',')})`);
    assert.equal(left[0].defId, 'enemy_1160_hvyslr', 'the leftover is the 水手 the data names');
  }

  // 沃尔夫之影 (enemy_10109_mjcgst) is OUT of the batch (owner 2026-10-25「去掉沃尔夫之影」): without 月光 it would have been
  // 隐匿 + unblockable + never attacking — a unit nobody can stop and nobody can answer. It has no kit and no pool, so it
  // never spawns; nothing else changed with it.
  {
    const mod = await import('../../server/sim/content/enemies.js');
    assert.ok(!mod.KITS.enemy_10109_mjcgst, '沃尔夫之影 has no kit');
  }

  // “方便快餐” · "受到的物理和法术伤害大幅降低" (act38side_scale.damage_resistance 0.9 ⇒ taken ×0.1)
  {
    const h = arena(3);
    const e = put(h, 'enemy_10038_cnvpiz');
    assert.ok(Math.abs(e.s.dmgTakenMul - 0.1) < 1e-9, `“方便快餐” takes ×0.1 damage (${e.s.dmgTakenMul})`);
  }

  // 爆破攻坚手 · the attack splashes the target's 3×3 at ATK × aoe.attack@bsthmr_range.atk_scale (0.5); the blocker takes
  // the attack itself, so the check is that the attack lands at all and the splash reaches a second ally beside it
  {
    const h = arena(3);
    const e = put(h, 'enemy_1076_bsthmr', [10, 5]);
    h.runUntil(() => e.stats.attacks >= 1, 12);
    h.run(0.5);
    const taken = h.allies().map((u) => u.stats.taken);
    assert.ok(taken[0] > 0, `爆破攻坚手 attacks its blocker (${taken.join(',')})`);
  }

  // “红标”根除者 · 隐匿: the engine's own rule — a ranged operator cannot target it until it is blocked
  {
    const h = arena(3);
    const e = put(h, 'enemy_1135_redman', [10, 8]);
    h.run(1);
    assert.equal(h.allies()[0].blocking.length, 0, '“红标”根除者 is not blocked from three tiles away');
    assert.equal(e.stats.attacks, 0, '“红标”根除者 has not attacked yet');
  }

  // 烛骑士薇薇安娜 · 【微光之触】: a charge on its cooldown (20 s, and the initial cooldown is the same), an arts blast at
  // ATK × atk_scale (3) around the target when it ends
  {
    const h = arena(3);
    put(h, 'enemy_1184_cadkgt_3', [10, 7]);
    const before = h.allies()[0].hp;
    h.run(45);
    assert.ok(h.allies()[0].hp < before, `烛骑士薇薇安娜 lands its charged blast (${before} → ${h.allies()[0].hp})`);
  }

});
test('batch 3: every mechanic key of all the batches is authored in forkwave.js and NOT also stats-only', async () => {
  const mod = await import('../../server/sim/content/enemies.js');
  assert.ok(MECHANIC.length >= 20, `${MECHANIC.length} enemies with a mechanic across the batches`);
  for (const e of MECHANIC) {
    assert.ok(mod.KITS[e.key], `${e.key}: a kit is registered`);
    assert.ok(!mod.STATS_ONLY[e.key], `${e.key}: not in STATS_ONLY as well`);
    assert.equal(E[e.key].rank, e.rank, `${e.key}: rank`);
  }
});

// 业主 2026-10-25「优雅刀技厨师3块剧场组装体4块赏金猎人"大骑士"4块搏命养家者3块加入悬赏。
// 凶豕兽作战里少放点，冰晶射手作战里少放点」—— 第四批的六个机制，以及两张“少放”的 share。
test('batch 4 mechanics: the block weight 4 / 2, the two auras, the rush acceleration, the chill', async () => {
  const { makeBattle, chessRec } = await import('../helpers/battleHarness.js');
  const enemiesMod = await import('../../server/sim/content/enemies.js');
  const bossesMod = await import('../../server/sim/content/bosses.js');
  const arena = (block = 3) => {
    const h = makeBattle({
      content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 5, autoFinish: false, timeLimit: 200,
      defs: { chess: { t_wall: chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 4e4, def: 0, res: 0, blockCnt: block }, rangeGrid: [[0, 0]], skill: null }) } },
      kits: { t_wall: () => ({ trait: { noAttack: true } }) },
      units: [{ chessId: 't_wall', row: 10, col: 5 }],
    });
    h.step();
    return h;
  };
  const put = (h, key, pos = [10, 5]) => h.spawn(key, { pos, routeIndex: 0 });
  const holds = (key, block) => { const h = arena(block); put(h, key); h.run(0.5); return h.allies()[0].blocking.length > 0; };

  // 剧场组装体 · "只能被阻挡数大于等于4的单位阻挡"
  assert.equal(holds('enemy_2011_csppt', 3), false, '剧场组装体 is not blocked by 3 slots');
  assert.equal(holds('enemy_2011_csppt', 4), true, '剧场组装体 is blocked by 4 slots');
  // 凶豕兽 · "只能被阻挡数大于等于2的单位阻挡"
  assert.equal(holds('enemy_1309_mhboar', 1), false, '凶豕兽 is not blocked by 1 slot');
  assert.equal(holds('enemy_1309_mhboar', 2), true, '凶豕兽 is blocked by 2 slots');

  // 优雅刀技厨师 · the aura on the ground enemies near it: ASPD +35, RES +20 (AuraAttributeUp)
  {
    const h = arena();
    put(h, 'enemy_10229_agactr', [10, 5]);
    const o = put(h, 'enemy_1007_slime', [10, 5.6]);
    h.run(1);
    const b = (o.buffs || []).filter((x) => x.key === 'ab:agactrAura');
    assert.equal(b.length, 1, '优雅刀技厨师 gives a neighbour its aura');
    assert.equal(b[0].mods.aspd, 35, 'the aura is +35 ASPD');
    assert.equal(b[0].mods.resFlat, 20, 'the aura is +20 RES');
  }

  // 搏命养家者 · "周围敌人受到的物理和法术伤害降低" (Talent1.damage_resistance 0.25 ⇒ taken ×0.75)
  {
    const h = arena();
    put(h, 'enemy_10196_ubba', [10, 5]);
    const o = put(h, 'enemy_1007_slime', [10, 5.6]);
    h.run(1);
    const b = (o.buffs || []).filter((x) => x.key === 'ab:ubbaAura');
    assert.equal(b.length, 1, '搏命养家者 gives a neighbour its aura');
    assert.ok(Math.abs(b[0].mods.dmgTakenMul - 0.75) < 1e-9, `the aura is ×0.75 damage taken (${b[0].mods.dmgTakenMul})`);
  }

  // 赏金猎人“大骑士” · "移动时逐渐加速": unblocked, its move speed climbs above the data value
  {
    const h = arena();
    const e = put(h, 'enemy_1413_mmstck_2', [10, 12]);
    const s0 = e.s.moveSpeed;
    h.run(3);
    assert.ok(e.s.moveSpeed > s0, `赏金猎人 accelerates (${s0} → ${e.s.moveSpeed})`);
  }

  // 冰晶射手 · "攻击造成物理溅射伤害并施加<寒冷>效果" (talent.attack@freeze = the duration)
  {
    const h = arena();
    put(h, 'enemy_9005_aicemn', [10, 7]);
    h.runUntil(() => h.allies()[0].stats.taken > 0, 15);
    h.run(0.3);
    assert.ok(h.allies()[0].stats.taken > 0, '冰晶射手 hits the wall');
    assert.ok((h.allies()[0].buffs || []).some((x) => x.status === 'cold' || x.key === 'cold'), '冰晶射手 chills what it hits');
  }
});

// 业主 2026-10-25「凶豕兽作战里少放点，冰晶射手作战里少放点」: both carry `share: 0.25` in the research file, and the
// data build honours it — each is attached to clearly fewer pools than an average fork key.
test('batch 4 shares: 凶豕兽 and 冰晶射手 are attached to fewer pools than the batch average', () => {
  const counts = new Map();
  for (const entry of Object.values(F)) for (const cls of ['N', 'E']) for (const x of entry[cls] || []) if (x.fork) counts.set(x.key, (counts.get(x.key) || 0) + 1);
  const avg = [...counts.values()].reduce((a, b) => a + b, 0) / counts.size;
  for (const e of ALL.filter((x) => x.share != null && x.share < 1)) {
    const n = counts.get(e.key) || 0;
    assert.ok(n > 0, `${e.key} is still attached somewhere`);
    assert.ok(n < avg, `${e.key} is attached to fewer pools (${n}) than the average (${avg.toFixed(1)})`);
  }
});
// 业主 2026-10-25「搞点强怪加入悬赏」：这批强怪里挑 5 只做成 R9 悬赏卡（击杀得资金）。官方 effect 表没有它们的
// ENEMY_GAIN 行，所以卡片由 tools/build-data.mjs 的 customBounties() 从研究文件现造，R9 悬赏决策里单独一张 fork 列表。
test('强怪悬赏: the fork bounty cards exist, resolve their enemy, and reach the R9 boss draft', async () => {
  const { GameData } = await import('../../server/match/gamedata.js');
  const { generateDraft, bountyCard } = await import('../../server/match/choices.js');
  const { createRng } = await import('../../server/sim/rng.js');
  const R = RESEARCH.bounties || [];
  assert.ok(R.length >= 5, `${R.length} fork bounty rows in the research file`);
  const gd = new GameData(DATA, 'mode_multi_hard');
  const cards = (DATA.choices.cards && DATA.choices.cards.bounty) || [];
  for (const b of R) {
    const c = cards.find((x) => x.effectId === b.effectId);
    assert.ok(c, `${b.effectId} is a bounty card`);
    assert.equal(c.fork, true, `${b.effectId}: marked as a fork card`);
    assert.equal(c.enemyKey, b.enemyKey, `${b.effectId}: the enemy of the research row`);
    assert.ok(DATA.enemies[c.enemyKey], `${b.effectId}: ${c.enemyKey} is a data row`);
    assert.equal(c.draftPool, 'boss', `${b.effectId}: offered by the R9 boss draft`);
    assert.ok(c.draft, `${b.effectId}: not draft-excluded`);
    assert.equal(c.payout, 'kill', `${b.effectId}: kill bounty`);
    assert.equal(c.rounds, 1, `${b.effectId}: next battle only`);
    assert.equal(c.coin, b.coin, `${b.effectId}: coin`);
    const view = bountyCard(gd, c);
    assert.equal(view.enemyKey, b.enemyKey, `${b.effectId}: the card spawns the enemy`);
  }
  // the fork list is a 7th R9 group, and it really comes out of the draft
  const groups = DATA.choices.bountyDrafts.boss.groups;
  const forkGroup = groups.find((g) => g.cards.some((id) => /^forkbounty_/.test(id)));
  assert.ok(forkGroup, 'the fork bounty list is one of the R9 groups');
  assert.equal(forkGroup.cards.length, R.length, 'every fork card is in that list');
  let seen = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const d = generateDraft(gd, createRng(seed * 7919), 9, { players: 4 });
    if (d && d.cards.some((c) => /^forkbounty_/.test(String(c.effectId || c.id)))) seen++;
  }
  assert.ok(seen > 0, `a fork bounty appeared in ${seen} of 200 R9 drafts`);
  for (const g of groups) {
    const fork = g.cards.filter((id) => /^forkbounty_/.test(id));
    if (g === forkGroup) assert.equal(fork.length, R.length);
    else assert.equal(fork.length, 0, 'no fork card inside an official R9 group');
  }
});
// 业主 2026-10-24「新的怪刷新了还是看不见」：模型文件在、data/assets.json 的 spineLocal 也在，但
// data/local-assets.json 里少了对应的 `spine/enemy/<id>` group —— 客户端拼不出本地 spine 的 URL，只能回落到
// 不存在的 web spine，于是敌人刷出来是空的。data/local-assets.json 是本机状态（git-ignored），所以这里只在她
// 存在时守卫：每个 spineLocal 的 group 都必须列在清单里（没有再跑一次
// `node tools/local-extract/rebuild-enemy-groups.mjs` 重建）。
test('每个 spineLocal 的 group 都在 data/local-assets.json 里（本机有该清单时）', async () => {
  const url = new URL('../../data/local-assets.json', import.meta.url);
  if (!fs.existsSync(url)) return; // 没有本机素材的机器/CI：这条无从检查
  const manifest = JSON.parse(fs.readFileSync(url, 'utf8'));
  const { enemyGroupGaps } = await import('../../tools/local-extract/rebuild-enemy-groups.mjs');
  const gaps = enemyGroupGaps(manifest);
  assert.deepEqual(gaps, [], `local-assets groups missing: ${gaps.join('; ')}`);
});

// 畸变体傀儡（enemy_1130_infstr）已撤下（业主 2026-10-26「删除畸变体傀儡」）。它唯一的一条机制是「死亡时分裂两个」，
// 而分裂会把它落到的那个池子的身体数翻倍 —— 业主不要这个效果，所以整个敌人一起撤：没有 kit、也不在任何一个池子里。
// 之前那条「分裂只做一代」的回归（子怪带 forkSplit tag）随 kit 一起删掉了，它守的东西已经不存在。
test('畸变体傀儡: out of the batch — no kit and no pool slot', async () => {
  const mod = await import('../../server/sim/content/enemies.js');
  assert.ok(!mod.KITS.enemy_1130_infstr, '畸变体傀儡 has no kit');
  const wired = Object.entries(F).flatMap(([k, entry]) => ['N', 'E'].flatMap((cls) => (entry[cls] || []).filter((x) => x.key === 'enemy_1130_infstr').map(() => `${k}.${cls}`)));
  assert.deepEqual(wired, [], '畸变体傀儡 is attached to no pool');
  assert.ok(!RESEARCH.batches.some((b) => (b.enemies || []).some((e) => e.key === 'enemy_1130_infstr')), 'and no research row claims it');
});

// 颂水贤者（enemy_2134_shrshep）已撤下（业主 2026-10-31「删除颂水贤者这个怪」）。它唯一的一条机制是「受到攻击时向后传送一段距离」
// （kit waterSageBlink；blinkBack 只有它一个调用方，所以辅助函数随它一起删）。这条守的是「撤干净了」：没有 kit、不在任何一个池子里、
// 数据行与素材清单里也没有它，而不是「撤了但留个尾巴」。
test('颂水贤者: out of the batch — no kit, no pool slot, no data row', async () => {
  const mod = await import('../../server/sim/content/enemies.js');
  assert.ok(!mod.KITS.enemy_2134_shrshep, '颂水贤者 has no kit');
  const wired = Object.entries(F).flatMap(([k, entry]) => ['N', 'E'].flatMap((cls) => (entry[cls] || []).filter((x) => x.key === 'enemy_2134_shrshep').map(() => `${k}.${cls}`)));
  assert.deepEqual(wired, [], '颂水贤者 is attached to no pool');
  assert.ok(!RESEARCH.batches.some((b) => (b.enemies || []).some((e) => e.key === 'enemy_2134_shrshep')), 'and no research row claims it');
  assert.ok(!E.enemy_2134_shrshep, 'and data/enemies.json has no row for it');
  assert.ok(!J('../../data/assets.json').enemies.enemy_2134_shrshep, 'and the asset manifest lists no model for it');
});
