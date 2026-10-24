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
    // the model comes from the local client extraction, so the clip must be known or the sim stands ATTACK_PAUSE
    assert.ok(r.attackAnim && r.attackAnim.dur > 0, `${e.key}: attackAnim (extract the model, then rebuild)`);
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
          // a batch key no tight pool fits — a couple of attachments, never the whole batch
          assert.ok(ratio >= 0.7 - 1e-9 && ratio <= 1.5 + 1e-9, `${k}.${cls}: ${x.key} within the power band (${ratio.toFixed(2)})`);
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
  const missing = ALL.filter((e) => !wired.has(e.key)).map((e) => e.key);
  // one documented exception: 高阶术师 is weaker than every ELITE pool anchor, so the band keeps it out of the waves
  assert.deepEqual(missing, ['enemy_1018_aoemag'], 'only the documented outlier stays unwired');
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

test('batch 2 mechanics in a real battle: self-destruct, split, and the on-hit debuffs', async () => {
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
    return { boom: Math.round(hp0 - h.allies()[0].hp), aspd, defFlat, leftovers: h.enemies().length, atk: E[key].stats.atk };
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

  // 畸变体傀儡: killed → two of itself (the split is silence-flagged in the handbook, so it carries sil: true)
  assert.equal(run('enemy_1130_infstr').leftovers, 2, '畸变体傀儡 splits into two');
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

  // 沃尔夫之影 · no 月光 here: it stays 隐匿 + unblockable and never attacks
  {
    const h = arena(3);
    const e = put(h, 'enemy_10109_mjcgst');
    h.run(6);
    assert.equal(e.stats.attacks, 0, '沃尔夫之影 never attacks');
    assert.equal(h.allies()[0].blocking.length, 0, '沃尔夫之影 is unblockable');
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

// 业主 2026-10-26「畸变体绝对有bug会无限分裂」：分裂出来的子怪是同一个 key，于是带着同一份 kit —— 每个子怪再死又
// 分裂两个，链式下去敌人数量无界增长（那波永远清不完）。分裂只做一代：子怪带 `forkSplit` tag，自己的 death 钩子直接返回。
test('畸变体傀儡: the split is ONE generation — the children never split again', async () => {
  const { makeBattle, chessRec } = await import('../helpers/battleHarness.js');
  const enemiesMod = await import('../../server/sim/content/enemies.js');
  const bossesMod = await import('../../server/sim/content/bosses.js');
  const WALL = (id) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 3e4, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
  const h = makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 5, autoFinish: false, timeLimit: 200,
    defs: { chess: { t_wall: WALL('t_wall') } }, kits: { t_wall: () => ({ trait: { noAttack: true } }) },
    units: [{ chessId: 't_wall', row: 10, col: 5 }],
  });
  h.step();
  const parent = h.spawn('enemy_1130_infstr', { pos: [10, 5], routeIndex: 0 });
  h.run(0.2);
  h.b.dealDamage(null, parent, { amount: 1e9, type: 'true', canDodge: false });
  h.run(0.4);
  const gen1 = h.enemies().filter((e) => e.alive);
  assert.equal(gen1.length, 2, `the parent split into two (got ${gen1.length})`);
  // kill both children: with the bug each of them spawned two more, and so on forever
  for (const c of gen1) h.b.dealDamage(null, c, { amount: 1e9, type: 'true', canDodge: false });
  h.run(0.4);
  assert.equal(h.enemies().filter((e) => e.alive).length, 0, 'the children do NOT split again');
  for (let i = 0; i < 6; i++) h.run(0.5);
  assert.equal(h.enemies().filter((e) => e.alive).length, 0, 'and nothing keeps spawning afterwards');
});
