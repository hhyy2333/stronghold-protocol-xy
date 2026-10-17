// test/sim/browser-data.test.js — the BROWSER's simulation data is complete (DESIGN §14, §29).
//
// The server serves `server/sim/**` read-only at `/sim/` and the page loads the battle data itself with
// `/js/battle/runner.js` `loadBrowserSim` → `setSimData(raw)`. Everything the sim resolves through `gameData()` therefore
// has to be in `SIM_DATA_FILES`: the browser has no Node fallback (`server/sim/nodeData.js` reads `data/*.json` from disk
// and is *never* served — the static handler denies it), so a file missing from the list is simply ABSENT in the page.
//
// That asymmetry is exactly what hid the worst instance of this bug (user report 2026-10-11, 「回响不生效敌人直接死」
// 「隐匿也不生效」): `hextech` was not in the list, so `gameData().hextech` was undefined in the browser while every
// Node test still read the file off disk. `sim/content/hextech.js installEnemyVerbs` looks the enemy verb cards up in
// that roster and `continue`s when the record is null, so all 10 verb cards (亡语 / 破甲弹 / 淬毒 / 铁壁 / 腐蚀领域 /
// 嗜血 / 狂化 / 隐匿 / 回响 / 军旗) did nothing in a browser-simulated battle — only the enemy's `mods` cards worked,
// because those ride the spawn list and need no lookup. The two halves of one match (the browser's field and the server's
// SP_VERIFY re-simulation) then disagreed.
//
// These tests pin the RULE, not just the one file: every id the sim resolves through gameData() must be listed, and the
// list must survive the loader round-trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_SHIM_JS } from '../../server/http/static.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const { SIM_DATA_FILES } = await import('../../public/js/battle/runner.js');

/** Every `gameData().<key>` / `hexData()`-style read of a data file inside server/sim (the browser-side readers). */
function gameDataReads() {
  const out = new Set();
  const walk = (rel) => {
    for (const name of readdirSync(join(ROOT, rel)).sort()) {
      const r = `${rel}/${name}`;
      const abs = join(ROOT, r);
      if (readdirSync(join(ROOT, rel)).includes(name) && existsSync(abs)) {
        if (!/\.js$/.test(name)) continue;
        const src = read(r);
        for (const m of src.matchAll(/gameData\(\)\.([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
      }
    }
  };
  walk('server/sim/content');
  walk('server/sim');
  return out;
}

test('the browser loader fetches the 协议源石 roster (the file the enemy verb cards are resolved from)', () => {
  assert.ok(SIM_DATA_FILES.includes('hextech'),
    'hextech MUST be in SIM_DATA_FILES: installEnemyVerbs resolves every enemy verb card through gameData().hextech');
  // and the file is really there to fetch
  const roster = JSON.parse(read('data/hextech.json'));
  assert.ok(Object.keys(roster.enemyHexes || {}).length > 0, 'data/hextech.json carries the enemy roster');
  // the cards that were silently dead are verb cards — pin that there are some (so this test cannot pass vacuously)
  const verbs = Object.values(roster.enemyHexes).filter((h) => h && typeof h.verb === 'string');
  assert.ok(verbs.length >= 10, `the roster has ${verbs.length} verb cards`);
  for (const id of ['ehex_echo', 'ehex_stealth', 'ehex_deathrattle']) {
    const rec = roster.enemyHexes[id];
    assert.ok(rec && rec.verb, `${id} is a verb card (the reported ones: 回响 / 隐匿)`);
    assert.ok(SIM_DATA_FILES.includes('hextech'), `${id} needs the roster in the browser`);
  }
});

test('every data file server/sim reads through gameData() is listed in SIM_DATA_FILES', () => {
  const reads = gameDataReads();
  assert.ok(reads.size > 0, `found ${reads.size} gameData() reads — is the scan broken?`);
  // The keys the sim resolves through gameData() (server/sim/content/**). A key with no data/<key>.json is a non-file
  // accessor (e.g. a config object) — those are skipped, the rule only covers real files.
  const missing = [];
  for (const key of reads) {
    if (!existsSync(join(ROOT, 'data', `${key}.json`))) continue;
    if (!SIM_DATA_FILES.includes(key)) missing.push(key);
  }
  assert.deepEqual(missing, [],
    `server/sim reads these data files through gameData() but the browser loader never fetches them: ${missing.join(', ')}`);
});

test('the browser data path resolves the enemy verb records the way installEnemyVerbs does', () => {
  // The page's getData() is the shim over getSimData() — so what the loader injects IS what the sim sees.
  assert.match(DATA_SHIM_JS, /getSimData\(\)/, 'getData() proxies to getSimData()');
  assert.match(read('public/js/battle/runner.js'), /setSimData\(raw\)/, 'the loader injects raw');
  const runner = read('public/js/battle/runner.js');
  // the injected object is built from SIM_DATA_FILES only: every listed name becomes a key, and nothing else does
  assert.match(runner, /SIM_DATA_FILES\.forEach\(\(n, i\) => \{ raw\[n\] = deepFreeze\(files\[i\]\); \}\)/);
  // …so listing hextech is BOTH necessary and sufficient for gameData().hextech to exist in the browser
  const roster = JSON.parse(read('data/hextech.json'));
  for (const [id, rec] of Object.entries(roster.enemyHexes)) {
    if (typeof rec?.verb !== 'string') continue;
    // the record carries what the script needs
    assert.equal(typeof rec.verb, 'string', `${id}.verb`);
    assert.ok(rec.params === undefined || typeof rec.params === 'object', `${id}.params`);
  }
});

test('a battle gets the same verbs on both sides: the flag and the roster agree', async () => {
  // The server and the browser both build the battle from one BattleSpec + one data set. The verb ids travel on
  // `flags.enemyHexIds`; the SCRIPTS come from the roster. So a flag naming a card the roster cannot resolve is the bug —
  // assert every id the match can put on that flag is resolvable from data/hextech.json.
  const { enemyVerbIds } = await import('../../server/match/hextech.js');
  const roster = JSON.parse(read('data/hextech.json'));
  const all = Object.keys(roster.enemyHexes);
  const fake = { gd: { hex: (id) => roster.enemyHexes[id] || null }, enemyHexes: all.map((id) => ({ id, round: 1 })) };
  const ids = enemyVerbIds(fake);
  assert.equal(ids.length, all.filter((id) => roster.enemyHexes[id].verb).length, 'every verb card reaches the flag');
  for (const id of ids) {
    const rec = roster.enemyHexes[id];
    assert.ok(rec && typeof rec.verb === 'string', `${id} resolves to a verb record`);
    assert.ok(SIM_DATA_FILES.includes('hextech'), `${id} needs the roster in the browser to run`);
  }
});
