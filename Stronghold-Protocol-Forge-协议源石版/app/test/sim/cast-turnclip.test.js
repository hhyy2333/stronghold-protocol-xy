// test/sim/cast-turnclip.test.js — the `cast` event's optional fifth field (turnClip, s): an attack-class skill that took
// the normal attack's turn names its official clip so the client plays that clip instead of the attack animation
// (upstream 0.3.2 §37.57; server/sim/content/enemies/helpers.js castSlot, render/units.js castHoldSeconds).
//
// Run: node test/sim/cast-turnclip.test.js (node --test cannot bind a socket in this sandbox).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { attach } from '../../server/sim/content/enemies.js';
import { castHoldSeconds } from '../../public/js/render/units.js';

const OP = 'chess_char_1_01_a';

test('a cast that does not take the attack’s turn keeps its old shape (no fifth field)', () => {
  const h = makeBattle({
    units: [{ chessId: OP, row: 10, col: 5 }],
    enemies: [{ key: 'enemy_1000_gopro_2', time: 0, route: 0, pos: [10, 6] }],
    timeLimit: 40,
    extraContent: [{
      install(b) {
        b.on('enemySpawn', ({ enemy }) => {
          b.addBuff(enemy, { key: 'test:tank', persist: true, flags: { invulnerable: true } });
          attach(b, enemy, [
            { cd: 5, icd: 0, sk: { slot: 0, bb: {} }, fire() {} },                       // no blackboard duration
            { cd: 7, icd: 2, sk: { slot: 1, bb: { duration: 2 } }, fire() {} },           // with one
          ]);
        });
      },
    }],
  });
  h.run(20);
  const casts = h.eventsOf('cast');
  assert.ok(casts.length >= 2, `casts happen (${casts.length})`);
  for (const c of casts) assert.ok(c.length === 3 || c.length === 4, `unchanged shape (length ${c.length})`);
  assert.equal(casts[0][4], undefined, 'no fifth field');
  assert.ok(casts.some((c) => c.length === 4 && c[3] === 2), 'the blackboard duration is still the fourth field');
});

test('an attack-slot cast names its clip in the fifth field', () => {
  const h = makeBattle({
    units: [{ chessId: OP, row: 10, col: 6 }],
    enemies: [{ key: 'enemy_1521_dslily', time: 0, pos: [10, 9] }],
    timeLimit: 200,
    setup(b) { b.on('deploy', ({ unit }) => { if (unit.side === 'ally') b.addBuff(unit, { key: 'test:immortal', persist: true, flags: { invulnerable: true } }); }); },
  });
  h.step(2);
  const e = h.enemy('enemy_1521_dslily');
  e.hp = e.s.maxHp * 0.3;          // third form: all four skills are attack-class
  h.step(10);
  h.run(80);
  const casts = h.eventsOf('cast');
  assert.ok(casts.length >= 3, `the third form casts (${casts.length})`);
  for (const c of casts) assert.equal(c.length, 5, 'every attack-slot cast carries the fifth field');
  const clips = new Set(casts.map((c) => c[4]));
  assert.ok(clips.has(1.667), `大潮's clip (${[...clips].join(', ')})`);
  for (const v of clips) assert.ok(v === 0 || v > 0, 'a clip is a number of seconds');
});

test('castHoldSeconds: the client holds the declared clip and nothing else', () => {
  assert.equal(castHoldSeconds(1.667), 1.667);
  assert.equal(castHoldSeconds(4.467), 4.467);
  assert.equal(castHoldSeconds(0), 0, 'an ability with no official clip holds nothing (the attack animation plays)');
  assert.equal(castHoldSeconds(undefined), 0, 'no fifth field ⇒ no hold');
  assert.equal(castHoldSeconds(null), 0);
  assert.equal(castHoldSeconds('2'), 0, 'a malformed field is ignored, not coerced');
  assert.equal(castHoldSeconds(-1), 0);
  assert.equal(castHoldSeconds(NaN), 0);
  assert.equal(castHoldSeconds(99), 8, 'clamped, so a bad frame cannot freeze a unit for a whole fight');
});
