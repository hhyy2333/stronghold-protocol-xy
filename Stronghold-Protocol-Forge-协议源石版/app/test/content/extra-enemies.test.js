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
