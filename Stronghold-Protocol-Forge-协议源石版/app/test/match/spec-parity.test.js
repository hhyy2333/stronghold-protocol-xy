// test/match/spec-parity.test.js — a battle rebuilt from its BattleSpec is BIT-IDENTICAL to the one the server
// constructs directly.
//
// WHY THIS TEST EXISTS. Moving a battle onto a worker thread (to use a second core) requires sending it as JSON:
// the server builds battles as `new Battle(opts)` (server/match/match/combat.js newBattle), but a worker can only
// receive `buildBattleSpec(opts)` → `createBattleFromSpec(spec, data)`. If those two paths gave even slightly
// different battles, offloading would silently change gameplay and move the golden results.
//
// IT ALSO PINS A REAL PITFALL. `_normalOpts(ps)` alone does NOT carry `flags.enemyHexIds`; `newBattle` adds it via
// `battleOptsWithEnemyHexes`. A spec built without that flag fights without the enemy's 协议源石 verbs — combat.js
// documents the same trap for `_ccField` ("a client-run field would fight without the enemy's verbs while the
// server-run field it is verified against fought with them"). Measured 2026-10-13: skipping the flag made 2 of 5
// seeded battles diverge (killed 25 vs 26); applying it made all 5 identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { getData } from '../../server/data.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Run a battle to completion; return its tick count and the JSON of its result. */
function run(battle, cap = 200000) {
  let ticks = 0;
  while (!battle.finished && ticks < cap) { battle.step(); ticks++; }
  return { ticks, digest: JSON.stringify(battle.result()) };
}

test('a battle from its BattleSpec is bit-identical to the directly constructed one', () => {
  const data = getData();
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 3, seed: 8080, fake: false }).start();
  const m = h.m;

  let compared = 0;
  for (let round = 0; round < 4; round++) {
    h.drive(() => m.phase === PHASE.PREP && m.round >= 5 + round, { maxSteps: 3000000 });
    if (m.ended) break;
    const ps = [...m.players.values()].find((p) => p.botControlled) || [...m.players.values()][0];

    // exactly what newBattle receives (including the enemy-hex flag)
    const base = clone(m._normalOpts(ps));
    base.fieldId = `parity-${round}`;
    const withHex = clone(m.battleOptsWithEnemyHexes({ ...base, data: m.ds, content: m.battleContent, logger: m.log }));

    const direct = m.newBattle({ ...clone(base), data: m.ds, content: m.battleContent, logger: m.log });
    const viaSpec = createBattleFromSpec(buildBattleSpec(withHex), data, { logger: null });

    const a = run(direct);
    const b = run(viaSpec);
    assert.equal(b.ticks, a.ticks, `round ${round}: tick count`);
    assert.equal(b.digest, a.digest, `round ${round}: battle result`);
    compared++;
  }
  assert.ok(compared >= 3, `compared ${compared} seeded battles`);
});

test('omitting the enemy-hex flag is what breaks parity (the pitfall combat.js documents)', () => {
  const data = getData();
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 3, seed: 8080, fake: false }).start();
  const m = h.m;
  // reach a round where the enemy owns a verb card (seed 8080 draws one by round 6)
  h.drive(() => m.phase === PHASE.PREP && m.round >= 6, { maxSteps: 3000000 });
  const ps = [...m.players.values()].find((p) => p.botControlled) || [...m.players.values()][0];

  const base = clone(m._normalOpts(ps));
  base.fieldId = 'pitfall';
  const bare = clone({ ...base, data: m.ds, content: m.battleContent, logger: m.log });
  const flagged = clone(m.battleOptsWithEnemyHexes({ ...base, data: m.ds, content: m.battleContent, logger: m.log }));

  const ids = flagged.flags && flagged.flags.enemyHexIds;
  // if this seed's enemy owns no verb card the two paths coincide and the pitfall is not exercised
  if (!Array.isArray(ids) || !ids.length) return;

  const a = run(m.newBattle(clone(flagged)));
  const b = run(createBattleFromSpec(buildBattleSpec(bare), data, { logger: null }));
  assert.notEqual(b.digest, a.digest,
    'a spec without flags.enemyHexIds must fight differently — that is why the flag has to travel');
});
