// test/data-packs.test.js — content packs of type "data" (docs/PACKS.md): the manifest fields, the record rules, the
// merge (a pack adds records, replaces an official record only when `overrides` names it, and is all-or-nothing), the
// handshake digest, and the server end to end — the merged body is what /data/<role>.json answers while the files on
// disk stay untouched, and a browser therefore needs no change at all.

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATA_ROLES, DATA_STRUCTURED_FILES, NO_PACKS_DIGEST, RECORD_ID_RE,
  applyDataPacks, canonicalJson, contentDigestOf, normalizeContent, normalizeDataManifest, normalizeOverrides,
  packContentDigest, packsDigest, recordsDigest, sha256Hex,
} from '../shared/dataPacks.js';
import { PACK_TYPES, normalizeManifest, readPackIndex } from '../shared/packs.js';
import { createPackRegistry, dataPacksOf, scanPacks } from '../server/packs.js';
import { loadData, resetData, dataPackReport } from '../server/data.js';
import { createStaticHandler } from '../server/http/static.js';
import { TestClient } from './helpers/wsClient.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-datapacks-${tag}-`));
const put = (dir, rel, body) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
};
const dirsOf = (root) => ({
  publicDir: path.join(root, 'public'),
  dataDir: path.join(root, 'data'),
  sharedDir: path.join(ROOT, 'shared'),
  packsDir: path.join(root, 'packs'),
});

afterEach(() => { resetData(); });

// ---------------------------------------------------------------------------------------------------
// the digest: no node builtin (shared/ is browser code), so it has to agree with one
// ---------------------------------------------------------------------------------------------------

test('digest: the hand-written sha256 agrees with node:crypto, and canonicalJson is order- and undefined-proof', () => {
  const cases = ['', 'abc', 'hello world', '中文测试 · 协议源石', 'a'.repeat(1000), JSON.stringify({ a: 1, b: [1, 2, 3] })];
  for (const c of cases) {
    assert.equal(sha256Hex(c), crypto.createHash('sha256').update(c, 'utf8').digest('hex'), `sha256(${c.slice(0, 16)})`);
  }
  assert.equal(canonicalJson({ b: undefined, a: [1, { z: 1, y: [2, 3] }] }), '{"a":[1,{"y":[2,3],"z":1}]}', 'keys sorted, no spaces, undefined dropped');
  assert.equal(canonicalJson([undefined]), '[null]');
  assert.equal(canonicalJson('x'), '"x"');
  // the digests are stable and differ when the records do
  assert.equal(recordsDigest({ a: { id: 'a' } }), recordsDigest({ a: { id: 'a' } }));
  assert.notEqual(recordsDigest({ a: { id: 'a' } }), recordsDigest({ a: { id: 'a', n: 1 } }));
  assert.equal(packsDigest([]), NO_PACKS_DIGEST, 'no packs is a constant, so both sides can name it');
  assert.equal(packContentDigest({ chess: { a: { id: 'a' } } }), packContentDigest({ chess: { a: { id: 'a' } } }));
  assert.equal(contentDigestOf({ chess: { a: { id: 'a' } }, bonds: { b: {} } }, ['chess']), contentDigestOf({ chess: { a: { id: 'a' } }, bonds: { b: {} } }, ['chess']));
});

// ---------------------------------------------------------------------------------------------------
// the record rules
// ---------------------------------------------------------------------------------------------------

test('records: ids, one object per record, and the id field inside must agree with the key', () => {
  assert.ok(RECORD_ID_RE.test('chess_char_1001') && RECORD_ID_RE.test('act1autochess_m01') && RECORD_ID_RE.test('enemy_1001_x.y'));
  assert.ok(!RECORD_ID_RE.test('') && !RECORD_ID_RE.test('a b') && !RECORD_ID_RE.test('a/b') && !RECORD_ID_RE.test('x'.repeat(65)));
  assert.deepEqual(normalizeContent('chess', { chess_char_1: { chessId: 'chess_char_1' } }), { records: { chess_char_1: { chessId: 'chess_char_1' } }, problems: [] });
  assert.match(normalizeContent('chess', { 'bad id!': {} }).problems.join(), /"bad id!" is not a record id/);
  assert.match(normalizeContent('chess', { chess_char_1: 3 }).problems.join(), /record "chess_char_1" is not an object/);
  assert.match(normalizeContent('chess', { chess_char_1: { chessId: 'other' } }).problems.join(), /record "chess_char_1" says chessId "other"/);
  assert.match(normalizeContent('chess', []).problems.join(), /not a JSON object of records/);
  // the id field per role — enemies use `key`, stages and waves `id`
  assert.deepEqual(normalizeContent('enemies', { enemy_1: { key: 'enemy_1' } }).problems, []);
  assert.match(normalizeContent('enemies', { enemy_1: { key: 'enemy_2' } }).problems.join(), /says key "enemy_2"/);
  assert.match(normalizeContent('nope', {}).problems.join(), /unknown role "nope"/);
  // a file that is not an id → record map is refused BY NAME, with the reason, rather than silently half-read
  for (const [role, why] of Object.entries(DATA_STRUCTURED_FILES)) {
    assert.match(normalizeContent(role, {}).problems.join(), new RegExp(`"${role}" is not a data role`), role);
    assert.ok(why.length > 10, `${role} carries a reason`);
  }
  assert.ok(!('config' in DATA_ROLES) && !('assets' in DATA_ROLES) && !('hextech' in DATA_ROLES), 'the rules file and the art manifest are never pack roles');
  assert.ok(Object.keys(DATA_ROLES).length >= 11);
});

test('records: an override list is "<role>:<id>", and a data manifest refuses unknown fields by name', () => {
  assert.deepEqual([...normalizeOverrides(['chess:a', 'bonds:b']).keys], ['chess:a', 'bonds:b']);
  assert.deepEqual(normalizeOverrides(null).keys.size, 0, 'absent is fine');
  assert.match(normalizeOverrides(['chess:a', 'nope:b']).problems.join(), /names an unknown role "nope"/);
  assert.match(normalizeOverrides(['a b']).problems.join(), /is not "<role>:<id>"/);
  assert.match(normalizeOverrides('chess:a').problems.join(), /not an array/);

  const manifest = { id: 'demo', type: 'data', name: 'Demo', files: { chess: 'chess.json' } };
  assert.deepEqual(normalizeDataManifest({ ...manifest, overrides: ['chess:chess_char_1'] }, manifest).manifest.overrides, ['chess:chess_char_1']);
  assert.match(normalizeDataManifest({ ...manifest, layer: 'core' }, manifest).problems.join(), /unknown field "layer" for a data pack/);
  assert.match(normalizeDataManifest({ id: 'demo', type: 'data', name: 'Demo' }, { id: 'demo', type: 'data', name: 'Demo', files: {} }).problems.join(), /no files/);
  // through the shared manifest normalizer, as server/packs.js calls it
  const { manifest: m, problems, warnings } = normalizeManifest({ ...manifest, overrides: ['chess:chess_char_1'] }, { id: 'demo', type: 'data', folder: true });
  assert.deepEqual([problems, warnings, m.type, m.overrides], [[], [], 'data', ['chess:chess_char_1']]);
  assert.deepEqual(Object.keys(PACK_TYPES.data.files).sort(), Object.keys(DATA_ROLES).sort(), 'the type lists exactly the roles the loader knows');
  assert.equal(PACK_TYPES.data.live, false, 'server-side: applied at start, never per request');
  assert.ok(!('config' in PACK_TYPES.data.files), 'a pack cannot contribute the rules file');
  const bad = normalizeManifest({ ...manifest, files: { chess: 'chess.json', nope: 'x.json' } }, { id: 'demo', type: 'data', folder: true });
  assert.deepEqual(bad.problems, [], 'an unknown role is a warning, not a refusal');
  assert.ok(bad.warnings.some((w) => /files\.nope/.test(w)));
  assert.match(normalizeManifest({ ...manifest, files: { chess: 'chess.txt' } }, { id: 'demo', type: 'data', folder: true }).problems.join(), /\.json/);
});

// ---------------------------------------------------------------------------------------------------
// the merge
// ---------------------------------------------------------------------------------------------------

/** A pack as server/packs.js hands it to the merge. */
const packOf = (id, files, content, overrides = []) => ({ id, manifest: { id, type: 'data', name: id, files, overrides }, content });

const BASE = {
  chess: { chess_char_1: { chessId: 'chess_char_1', name: 'A', tags: ['x'], nested: { k: 1, keep: 2 } } },
  stages: { act1: { id: 'act1', modes: ['mode_single_normal'] } },
  config: { modes: { mode_single_normal: { stages: ['act1'] } } },
};

test('merge: no packs returns the same object, so a server without packs is byte for byte the one it always was', () => {
  const { data, report } = applyDataPacks(BASE, []);
  assert.equal(data, BASE, 'the same reference — nothing was copied');
  assert.deepEqual([report.applied, report.touched, report.digest, report.contentDigest], [[], [], NO_PACKS_DIGEST, NO_PACKS_DIGEST]);
  assert.equal(applyDataPacks(BASE, null).data, BASE);
});

test('merge: a new record is added, an official one only with `overrides`, and the field merge is recursive', () => {
  const add = applyDataPacks(BASE, [packOf('p1', { chess: 'chess.json' }, { chess: { chess_char_new: { chessId: 'chess_char_new', name: 'New' } } })]);
  assert.equal(add.report.applied.length, 1);
  assert.deepEqual(add.report.applied[0].added, { chess: 1 });
  assert.equal(add.data.chess.chess_char_new.name, 'New');
  assert.equal(add.data.chess.chess_char_1, BASE.chess.chess_char_1, 'the official record is untouched');
  assert.deepEqual(add.report.touched, ['chess']);
  assert.equal(BASE.chess.chess_char_new, undefined, 'the base object is never mutated');

  // replacing official content without naming it: the whole pack is dropped
  const sneaky = applyDataPacks(BASE, [packOf('p1', { chess: 'chess.json' }, { chess: { chess_char_1: { name: 'B' } } })]);
  assert.equal(sneaky.data, BASE, 'nothing applied');
  assert.deepEqual(sneaky.report.applied, []);
  assert.match(sneaky.report.skipped[0].problems.join(), /"chess:chess_char_1" replaces official content without being named in "overrides"/);

  // named: the patch merges into the official record, field by field
  const ov = applyDataPacks(BASE, [packOf('p1', { chess: 'chess.json' }, { chess: { chess_char_1: { name: 'B', nested: { k: 9 } } } }, ['chess:chess_char_1'])]);
  assert.deepEqual(ov.data.chess.chess_char_1, { chessId: 'chess_char_1', name: 'B', tags: ['x'], nested: { k: 9, keep: 2 } }, 'arrays replace, objects merge');
  assert.deepEqual([ov.report.applied[0].overridden, ov.report.applied[0].added], [['chess:chess_char_1'], {}]);

  // a field the official record does not have is refused — an override must not invent content
  const invent = applyDataPacks(BASE, [packOf('p1', { chess: 'chess.json' }, { chess: { chess_char_1: { brandNew: 1 } } }, ['chess:chess_char_1'])]);
  assert.equal(invent.data, BASE);
  assert.match(invent.report.skipped[0].problems.join(), /override names "brandNew", which the official record does not have/);
  const shape = applyDataPacks(BASE, [packOf('p1', { chess: 'chess.json' }, { chess: { chess_char_1: { nested: 3 } } }, ['chess:chess_char_1'])]);
  assert.match(shape.report.skipped[0].problems.join(), /override changes the shape of "nested"/);
  // an override named but never used is a warning, not a failure
  const unused = applyDataPacks(BASE, [packOf('p1', { chess: 'chess.json' }, { chess: { chess_char_new: { chessId: 'chess_char_new' } } }, ['chess:chess_char_1'])]);
  assert.equal(unused.report.applied.length, 1);
  assert.match(unused.report.warnings.join(), /"overrides" names "chess:chess_char_1", which no role file provides/);
});

test('merge: two packs accumulate (the second adds to the first instead of replacing the role), and a shared key is refused', () => {
  const p1 = packOf('p1', { chess: 'a.json' }, { chess: { c1: { id: 'c1' }, c2: { id: 'c2' } } });
  const p2 = packOf('p2', { chess: 'b.json' }, { chess: { c3: { id: 'c3' } } });
  const { data, report } = applyDataPacks({}, [p1, p2]);
  assert.deepEqual(Object.keys(data.chess).sort(), ['c1', 'c2', 'c3'], 'both packs are in');
  assert.deepEqual(report.applied.map((a) => a.id), ['p1', 'p2']);
  assert.deepEqual([report.applied[0].added, report.applied[1].added], [{ chess: 2 }, { chess: 1 }]);

  // the same id from two packs: the later one is refused, and named
  const clash = applyDataPacks({}, [p1, packOf('p2', { chess: 'b.json' }, { chess: { c1: { id: 'c1' } } })]);
  assert.deepEqual(Object.keys(clash.data.chess), ['c1', 'c2'], 'the first pack keeps it');
  assert.match(clash.report.skipped[0].problems.join(), /"chess:c1" is already contributed by pack "p1"/);

  // a manifest that names a role its content does not provide
  const missing = applyDataPacks({}, [packOf('p1', { chess: 'a.json', bonds: 'b.json' }, { chess: { c1: { id: 'c1' } } })]);
  assert.equal(missing.data, BASE === missing.data ? missing.data : missing.data, 'no crash');
  assert.match(missing.report.skipped[0].problems.join(), /p1\/b\.json: the manifest names it but the pack does not provide it/);
});

test('merge: a stage a pack adds is linked into the modes its own record names, and config is written by the merge alone', () => {
  const withStage = applyDataPacks(BASE, [packOf('p1', { stages: 'stages.json' }, { stages: { my_stage: { id: 'my_stage', modes: ['mode_single_normal'] } } })]);
  assert.deepEqual(withStage.data.config.modes.mode_single_normal.stages, ['act1', 'my_stage']);
  assert.deepEqual(withStage.report.applied[0].linkedStages, ['my_stage']);
  assert.deepEqual(withStage.report.touched, ['config', 'stages'], 'the rules file is touched by the link, never by the pack');
  assert.deepEqual(BASE.config.modes.mode_single_normal.stages, ['act1'], 'the base config is untouched');

  const orphan = applyDataPacks(BASE, [packOf('p1', { stages: 'stages.json' }, { stages: { nowhere: { id: 'nowhere', modes: ['mode_that_does_not_exist'] } } })]);
  assert.match(orphan.report.warnings.join(), /stage "nowhere" names no mode that exists, so nothing plays it/);
  assert.deepEqual(orphan.report.applied[0].linkedStages, []);
  // two packs, each with its own stage: each is reported against its own pack
  const both = applyDataPacks(BASE, [
    packOf('p1', { stages: 'a.json' }, { stages: { s1: { id: 's1', modes: ['mode_single_normal'] } } }),
    packOf('p2', { stages: 'b.json' }, { stages: { s2: { id: 's2', modes: ['mode_single_normal'] } } }),
  ]);
  assert.deepEqual(both.report.applied.map((a) => a.linkedStages), [['s1'], ['s2']]);
  assert.deepEqual(both.data.config.modes.mode_single_normal.stages, ['act1', 's1', 's2']);
});

test('merge: all-or-nothing per pack — one bad record drops that pack and leaves the others applied', () => {
  const good = packOf('good', { chess: 'a.json' }, { chess: { c1: { id: 'c1' } } });
  const bad = packOf('bad', { chess: 'b.json' }, { chess: { 'bad id!': { id: 'bad id!' } } });
  const { data, report } = applyDataPacks({}, [bad, good]);
  assert.deepEqual(Object.keys(data.chess), ['c1'], 'the good pack is in');
  assert.deepEqual(report.applied.map((a) => a.id), ['good']);
  assert.match(report.skipped[0].problems.join(), /"bad id!" is not a record id/);
});

// ---------------------------------------------------------------------------------------------------
// the registry and the tools
// ---------------------------------------------------------------------------------------------------

/** A checkout with one data pack (and the language files the registry always expects). */
function exampleRoot(tag = 'root') {
  const root = tmpdir(tag);
  put(root, 'public/i18n/en.json', { _meta: { name: 'English' }, 开始: 'Start' });
  put(root, 'data/chess.json', BASE.chess);
  put(root, 'data/stages.json', BASE.stages);
  put(root, 'data/config.json', BASE.config);
  put(root, 'data/bonds.json', { yanShip: { bondId: 'yanShip', name: '炎' } });
  put(root, 'data/bands.json', { band_1: { bandId: 'band_1', name: 'B' } });
  put(root, 'packs/extra/pack.json', { id: 'extra', type: 'data', name: 'Extra', version: '1.0.0', files: { chess: 'chess.json', stages: 'stages.json', bonds: 'bonds.json' }, overrides: ['bonds:yanShip'] });
  put(root, 'packs/extra/chess.json', { chess_char_new: { chessId: 'chess_char_new', name: 'New' } });
  put(root, 'packs/extra/stages.json', { extra_stage: { id: 'extra_stage', modes: ['mode_single_normal'] } });
  put(root, 'packs/extra/bonds.json', { yanShip: { name: '炎·改' } });
  put(root, 'packs/extra/notes.html', '<script>alert(1)</script>');
  return root;
}

test('registry: a data pack is scanned, validated and given a digest and its roles; only its own files are servable', () => {
  const root = exampleRoot('scan');
  try {
    const scan = scanPacks(dirsOf(root));
    assert.deepEqual(scan.skipped, []);
    const pack = scan.packs.find((p) => p.id === 'extra');
    assert.equal(pack.type, 'data');
    assert.equal(pack.supported, true);
    assert.deepEqual(pack.roles, ['bonds', 'chess', 'stages']);
    assert.equal(pack.digest, packContentDigest(pack.content));
    assert.equal(pack.digest.length, 64);
    assert.deepEqual(Object.keys(pack.content.chess), ['chess_char_new']);
    // the merge the server will do, and the index a client reads
    const merged = applyDataPacks(loadData(dirsOf(root).dataDir, { log: quiet() }), dataPacksOf(scan.packs));
    assert.deepEqual(merged.data.config.modes.mode_single_normal.stages, ['act1', 'extra_stage']);
    const entry = readPackIndex({ version: 1, packs: [{ id: 'extra', type: 'data', name: 'Extra', version: '1.0.0', files: { chess: '/packs/extra/chess.json' }, digest: pack.digest, roles: pack.roles, overrides: ['bonds:yanShip'] }] }, 'data')[0];
    assert.equal(entry.digest, pack.digest);
    const reg = createPackRegistry(dirsOf(root), { recheckMs: 0 });
    assert.equal(reg.servable('extra', 'chess.json'), path.join(root, 'packs/extra/chess.json'));
    assert.equal(reg.servable('extra', 'notes.html'), null, 'a file the manifest does not name is never served');
    assert.equal(reg.servable('extra', 'pack.json'), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('registry: a broken data pack is skipped with its reason, and the checkout still loads', () => {
  const root = exampleRoot('broken');
  try {
    put(root, 'packs/bad/pack.json', { id: 'bad', type: 'data', name: 'Bad', files: { chess: 'chess.json' } });
    put(root, 'packs/bad/chess.json', { 'bad id!': {} });
    put(root, 'packs/notjson/pack.json', { id: 'notjson', type: 'data', name: 'Not JSON', files: { chess: 'chess.json' } });
    put(root, 'packs/notjson/chess.json', '{ oops');
    const scan = scanPacks(dirsOf(root));
    assert.deepEqual(scan.packs.filter((p) => p.type === 'data').map((p) => p.id), ['extra']);
    const why = Object.fromEntries(scan.skipped.map((s) => [s.where, s.problems.join('; ')]));
    assert.match(why['packs/bad/'], /is not a record id/);
    assert.match(why['packs/notjson/'], /not valid JSON/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------
// the server end to end
// ---------------------------------------------------------------------------------------------------

const quiet = () => ({ warn() {}, error() {}, info() {} });

/** Serve one synthetic checkout through the real static handler. */
async function withStatic(root, fn) {
  const dirs = dirsOf(root);
  const packs = createPackRegistry(dirs, { log: quiet() });
  packs.refresh(true);
  const data = loadData(dirs.dataDir, { log: quiet(), dataPacks: dataPacksOf(packs.list('data')) });
  const serve = createStaticHandler({ ...dirs, packs, data, dataTouched: dataPackReport()?.touched ?? null, log: quiet() });
  const server = http.createServer((req, res) => serve(req, res, req.url.split('?')[0], null));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(url); } finally { await new Promise((r) => server.close(r)); }
}

test('the server: /data/<role>.json answers the MERGED body while the file on disk keeps its own content', async () => {
  const root = exampleRoot('http');
  try {
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'data/chess.json'), 'utf8'));
    assert.ok(!('chess_char_new' in onDisk), 'the pack never writes to disk');
    await withStatic(root, async (url) => {
      const res = await fetch(`${url}/data/chess.json`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.chess_char_new.name, 'New', 'the merged record is served');
      assert.equal(body.chess_char_1.name, 'A', 'the official record is still there');
      assert.equal(res.headers.get('cache-control'), 'no-cache', 'revalidated, never no-store: a page load must not refetch the whole data set');
      assert.match(res.headers.get('etag'), /^"ws-[0-9a-f]{20}"$/);
      const tag = res.headers.get('etag');
      const again = await fetch(`${url}/data/chess.json`, { headers: { 'If-None-Match': tag } });
      assert.equal(again.status, 304, 'a stable body is cached by ETag');
      // a role no pack touched is the file on disk, byte for byte
      const bands = await fetch(`${url}/data/bands.json`);
      assert.equal(bands.status, 200);
      assert.deepEqual(await bands.json(), { band_1: { bandId: 'band_1', name: 'B' } });
      const bandsStat = fs.statSync(path.join(root, 'data/bands.json'));
      assert.equal(bands.headers.get('etag'), `"${bandsStat.size.toString(16)}-${Math.floor(bandsStat.mtimeMs).toString(16)}"`);
      // an overridden record: the pack's field, the official one kept
      assert.deepEqual((await (await fetch(`${url}/data/bonds.json`)).json()).yanShip, { bondId: 'yanShip', name: '炎·改' });
      // the rules file the merge itself touched is answered merged too
      assert.deepEqual((await (await fetch(`${url}/data/config.json`)).json()).modes.mode_single_normal.stages, ['act1', 'extra_stage']);
      assert.equal((await fetch(`${url}/data/nope.json`)).status, 404);
      // HEAD works, and the pack's own files are reachable through /packs/
      const head = await fetch(`${url}/data/chess.json`, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal((await head.text()), '');
      assert.equal((await fetch(`${url}/packs/extra/chess.json`)).status, 200);
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the server: a start with a data pack reports it in welcome and /healthz; without one neither carries the field', async () => {
  const root = tmpdir('serve');
  const { startServer } = await import('../server/index.js');
  try {
    fs.mkdirSync(path.join(root, 'public'), { recursive: true });
    put(root, 'packs/extra/pack.json', { id: 'extra', type: 'data', name: 'Extra', version: '1.0.0', files: { stages: 'stages.json' } });
    put(root, 'packs/extra/stages.json', { extra_stage: { id: 'extra_stage', modes: ['mode_single_normal'] } });
    // the real data dir (so the sim boots), a synthetic packs dir
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, publicDir: path.join(root, 'public'), packsDir: path.join(root, 'packs') });
    try {
      const health = await (await fetch(`${srv.url}/healthz`)).json();
      assert.deepEqual(health.contentPacks.packs, ['extra']);
      assert.equal(health.contentPacks.digest.length, 64);
      assert.equal(health.contentPacks.contentDigest.length, 64);
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      try {
        const welcome = await c.hello('Pack');
        assert.equal(welcome.contentPacks.packs[0].id, 'extra');
        assert.equal(welcome.contentPacks.digest, health.contentPacks.digest, 'the handshake and /healthz name the same content');
        assert.equal(welcome.contentPacks.contentDigest, health.contentPacks.contentDigest);
        assert.deepEqual(welcome.contentPacks.packs[0].version, '1.0.0');
        assert.ok(Array.isArray(welcome.diyKitted), 'the other welcome field is untouched');
        // the client recomputes the content digest from what it can fetch (exactly the roles the handshake names)
        assert.deepEqual(health.contentPacks.files, ['config', 'stages']);
        const fetched = {};
        for (const role of health.contentPacks.files) fetched[role] = await (await fetch(`${srv.url}/data/${role}.json`)).json();
        assert.ok('extra_stage' in fetched.stages, 'the merged stage is what the browser downloads');
        assert.equal(contentDigestOf(fetched, health.contentPacks.files), health.contentPacks.contentDigest);
      } finally { c.close(); }
    } finally { await srv.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the server: without a data pack the welcome and /healthz are the frames they always were', async () => {
  const root = tmpdir('plain');
  const { startServer } = await import('../server/index.js');
  try {
    fs.mkdirSync(path.join(root, 'public'), { recursive: true });
    fs.mkdirSync(path.join(root, 'packs'), { recursive: true });
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, publicDir: path.join(root, 'public'), packsDir: path.join(root, 'packs') });
    try {
      const health = await (await fetch(`${srv.url}/healthz`)).json();
      assert.equal('contentPacks' in health, false, 'absent, not null: a server without packs answers what it always did');
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      try { assert.equal('contentPacks' in (await c.hello('Plain')), false); } finally { c.close(); }
    } finally { await srv.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------
// the CLI
// ---------------------------------------------------------------------------------------------------

test('tools/packs.mjs: a data pack lists with its digest and the dry-run merge, and --strict passes on a clean checkout', async () => {
  const root = exampleRoot('cli');
  const { main } = await import('../tools/packs.mjs');
  const lines = [];
  const log = console.log;
  try {
    console.log = (s) => lines.push(String(s));
    const code = await main(['list', '--root', root]);
    assert.equal(code, 0);
    const out = lines.join('\n');
    assert.match(out, /data \(supported: content the server merges into its data at start\): /);
    assert.match(out, /extra\s+Extra\s+— packs[\\/]extra[\\/]; v1\.0\.0, [0-9a-f]{12}…, chess \+1, stages \+1, 1 overrides/);
    assert.match(out, /data packs merged \(dry run\): extra [0-9a-f]{12}… → bonds, chess, config, stages/);
    assert.equal(fs.existsSync(path.join(root, 'data/chess.json')), true);
    assert.ok(!('chess_char_new' in JSON.parse(fs.readFileSync(path.join(root, 'data/chess.json'), 'utf8'))), 'the dry run writes nothing');
    lines.length = 0;
    assert.equal(await main(['check', '--strict', '--root', root]), 0, lines.join('\n'));
    // a pack that would be dropped at boot is reported by check --strict, not at boot. Packs apply in id order, so
    // `extra` (id order first) keeps the record and `zzz-dup` is the one dropped — the CLI says which.
    put(root, 'packs/zzz-dup/pack.json', { id: 'zzz-dup', type: 'data', name: 'Dup', files: { chess: 'chess.json' } });
    put(root, 'packs/zzz-dup/chess.json', { chess_char_new: { chessId: 'chess_char_new' } });
    lines.length = 0;
    assert.equal(await main(['check', '--strict', '--root', root]), 1);
    assert.match(lines.join('\n'), /is already contributed by pack "extra"/);
    lines.length = 0;
    assert.equal(await main(['list', '--json', '--root', root]), 0);
    const json = JSON.parse(lines.join('\n'));
    assert.deepEqual(json.dataPacks.map((p) => p.id), ['extra']);
    assert.deepEqual(json.skipped.map((s) => [s.where, s.id]), [['packs/zzz-dup/', 'zzz-dup']]);
  } finally { console.log = log; fs.rmSync(root, { recursive: true, force: true }); }
});
