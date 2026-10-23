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
const BATCH = (RESEARCH.batches?.[0]?.enemies) || [];
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
  assert.equal(new Set(BATCH.map((e) => e.key)).size, BATCH.length, 'no duplicate keys');
});

test('every batch enemy has a data row: stats, rank, an attack clip and a model', () => {
  const assets = J('../../data/assets.json').enemies;
  for (const e of BATCH) {
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
  assert.ok(wide.length <= 4, `${wide.length} wide-band rescues: ${wide.join(' ')}`);
  const wired = new Set();
  for (const entry of Object.values(F)) for (const cls of ['N', 'E']) for (const x of entry[cls] || []) if (x.fork) wired.add(x.key);
  const missing = BATCH.filter((e) => !wired.has(e.key)).map((e) => e.key);
  // one documented exception: 高阶术师 is weaker than every ELITE pool anchor, so the band keeps it out of the waves
  assert.deepEqual(missing, ['enemy_1018_aoemag'], 'only the documented outlier stays unwired');
});

test('they really come out of the wave generator', () => {
  const gd = new GameData(DATA, 'mode_multi_abyss');
  const want = new Set(BATCH.map((e) => e.key));
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const setup = setupMatchWaves(gd, createRng(seed * 7919));
    for (let r = 1; r <= 13; r++) {
      const w = buildNormalWave(gd, createRng(seed), setup.factions, r);
      for (const s of w.spawns) if (want.has(s.enemyKey)) seen.add(s.enemyKey);
    }
  }
  assert.ok(seen.size >= 12, `${seen.size} of the ${want.size} batch enemies spawned over 12 matches`);
});
