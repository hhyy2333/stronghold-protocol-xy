import fs from 'node:fs';
import { makeBattle } from './test/helpers/battleHarness.js';
import * as enemies from './server/sim/content/enemies.js';
import * as bosses from './server/sim/content/bosses.js';

const B = JSON.parse(fs.readFileSync('data/backups.json', 'utf8'));
const pool = B.diy.ownedPool;
const results = [];
for (const charId of pool) {
  let err = 0, depth = 0, msg = '';
  try {
    const h = makeBattle({
      kind: 'boss', content: 'generic', extraContent: [enemies, bosses], seed: 7, autoFinish: false, timeLimit: 40,
      sharedBoss: { hp: 1e9, maxHp: 1e9, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } },
      units: [{ diy: { slot: 5, charId, skillIndex: 1, uniEquipId: null }, elite: true, row: 10, col: 5 }],
      enemies: [{ key: 'enemy_9020_actrpc', time: 0, pos: [10, 6], tag: 'part' }, { key: 'enemy_9017_achunt_2', time: 0, pos: [5, 12], tag: 'boss' }],
    });
    h.step();
    const gun = h.enemies().find((e) => e.defId.startsWith('enemy_9017'));
    if (gun) gun.profile.noAttack = true;
    h.run(20);
    err = h.b.errorCount;
    depth = h.b.errors.filter((e) => /hookDepth/.test(e.label)).length;
    msg = h.b.errors.slice(0, 2).map((e) => e.label + ' :: ' + String(e.message).slice(0, 160)).join(' || ');
  } catch (e) { err = -1; msg = 'THROW ' + e.message.slice(0, 120); }
  results.push({ charId, err, depth, msg });
}
results.sort((a, b) => b.err - a.err);
for (const r of results.slice(0, 15)) console.log(r.err, r.charId, '|', r.msg.slice(0, 300));
console.log('--- any errors:', results.filter((r) => r.err > 0).length, 'of', results.length);
