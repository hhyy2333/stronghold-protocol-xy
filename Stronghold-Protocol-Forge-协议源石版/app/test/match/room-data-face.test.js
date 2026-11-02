// test/match/room-data-face.test.js — 房间级数据面：**客户端与服务端这一场用的是不是同一份数据**（DESIGN §28.16, W-B/W-D）。
//
// 为什么要钉这一条：一个声明了模组子集的房间跑的是「官方 + 它点名的那些包」，而 `/data/*.json` 发的是「官方 + 全部
// 已装包」。两份数据在 bonds / garrisons / chess / assets 上确实不同（实测：`bonds` 69 222 B vs 71 066 B），而
// `bonds` / `garrisons` 直接进战斗 —— 一旦两端各拿一份，一切「集合 / 上界」类的校验就会把**诚实的**战报判成伪造
// （服务器读 room 面、客户端读全局面时：`leak key` / `coins` / `layer bound`）。所以这条链必须是：
//
//   room.modSet ──► server: roomAssets.forRoom(modSet).data ──► Match.data ──► gd / ds（备战 + 战斗 + 复算）
//                └► BattleSpec.mods.digest ──► 浏览器 roomDataBase() ──► GET /room-data/<digest>/<file>.json
//                                                （同一个 forRoom 物化缓存 byDigest 答复）
//
// 本文件钉住三件事：
//   1. `roomDataBase`：声明了子集的房间 → 房间面；进程级集合（含「没声明」）→ `/data/`（逐字节与从前相同）；
//   2. `forRoom(modSet)` 与 `/room-data/<digest>/…` 答的是**同一个对象**（对象身份，`server/roomAssets.js` 的承诺）；
//   3. 一个真实 Match 建出来的 BattleSpec 带的是**它自己那一份**数据的摘要，而那个摘要在这台服务器上真的可答 ——
//      也就是「客户端按 spec 取到的那份 == 服务端跑的那份」。
//
// 若哪天有人把客户端改回全局面（或把 spec 的摘要换成进程摘要），第 1 / 3 条会立刻红：这就是它存在的理由。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roomDataBase, DATA_PREFIX, ROOM_DATA_PREFIX } from '../../public/js/mods/align.js';
import { createRoomAssets } from '../../server/roomAssets.js';
import { loadData } from '../../server/data.js';
import { applyWorkshop } from '../../shared/workshop.js';
import { startServer } from '../../server/index.js';
import { makeMatch } from './harness.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const APP = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const DIGEST = 'a'.repeat(64);
const PROCESS = 'b'.repeat(64);

test('roomDataBase: a room that declared a subset simulates on /room-data/<digest>/; the process set on /data/', () => {
  // 声明了子集：房间面
  assert.equal(roomDataBase({ digest: DIGEST }, { digest: PROCESS }), `${ROOM_DATA_PREFIX}${DIGEST}/`);
  // 没声明集合（room.modSet = null）⇒ 服务端把进程集合当这一局的数据，客户端也必须走进程面
  assert.equal(roomDataBase(null, { digest: PROCESS }), DATA_PREFIX);
  // 声明了全部（房间摘要就是进程摘要）⇒ 同一份数据，走进程面
  assert.equal(roomDataBase({ digest: PROCESS }, { digest: PROCESS }), DATA_PREFIX);
  // 干净安装（welcome 没有 mods）
  assert.equal(roomDataBase(null, null), DATA_PREFIX);
  assert.equal(roomDataBase({ digest: DIGEST }, null), `${ROOM_DATA_PREFIX}${DIGEST}/`);
  // 形态不对的摘要不能拼进 URL（否则客户端会去要一个服务器永远不会答的路径 → 战场起不来）
  assert.equal(roomDataBase({ digest: '../../etc/passwd' }, { digest: PROCESS }), DATA_PREFIX);
});

/** The real workshop packs + the official data, as `server/index.js` builds them. */
function fixtures() {
  const dir = path.join(APP, 'data');
  const workshopDir = path.join(APP, 'workshop');
  const official = loadData(dir, { log: quiet, workshopDir: null });
  const processData = loadData(dir, { log: quiet });
  const packs = readdirSync(workshopDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => ({ id: d.name, dir: path.join(workshopDir, d.name), data: JSON.parse(readFileSync(path.join(workshopDir, d.name, 'pack.json'), 'utf8')) }));
  const withContent = packs.filter((p) => Array.isArray(p.data.content) && p.data.content.length);
  const roomAssets = createRoomAssets({ official, processData, packs, kits: {}, modules: [], log: quiet });
  return { official, processData, packs, withContent, roomAssets };
}

test('forRoom and /room-data/<digest>/ are the SAME object (identity, not a copy)', () => {
  const { official, withContent, roomAssets } = fixtures();
  assert.ok(withContent.length, 'this checkout ships at least one pack with data content');
  const ids = [withContent[0].id];
  const modSet = { digest: DIGEST, packs: ids.map((id) => ({ id })) };
  const assets = roomAssets.forRoom(modSet);
  // the HTTP face answers from the same materialised set (server/http/static.js `/room-data/` → byDigest)
  const face = roomAssets.byDigest(DIGEST);
  assert.ok(face, 'a digest a room really declared is answerable');
  assert.equal(face.data, assets.data, 'one materialisation, two faces');
  assert.notEqual(assets.data, official, 'a declared subset is NOT the official-only set... unless it has nothing to add');
  // ...and the subset really is the official set + exactly the declared packs
  const { data: expected } = applyWorkshop(official, withContent.filter((p) => ids.includes(p.id)));
  assert.deepEqual(assets.data.enemies, expected.enemies, 'the room face is official + the declared packs');
});

let srv = null;
after(async () => { if (srv) await srv.close(); });

test('end-to-end: a room-declared match names the digest whose /room-data/ face serves the data it runs', async () => {
  srv = srv || await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const own = srv.lobby && srv.lobby.workshop && srv.lobby.workshop.roomAssets;
  assert.ok(own, 'this checkout ships packs, so the server has a room-assets face');
  const declared = (srv.lobby.workshop.mods || []).map((m) => m && m.id).filter(Boolean);
  assert.ok(declared.length, 'this server declares at least one pack');
  const modSet = { digest: DIGEST, packs: [declared[0]].map((id) => ({ id })) };
  // the SERVER materialises the set the way a room declaring it does (the same call `startMatch` makes)
  const assets = own.forRoom(modSet);
  const face = own.byDigest(DIGEST);
  assert.ok(face && face.data === assets.data, 'one materialisation, two faces');

  // 1) the match runs on the room face and its spec names the ROOM digest (what the browser turns into a URL)
  const h = makeMatch({ mode: 'coop', humans: 1, seed: 1, data: assets.data, fake: true, clientCombat: true, clients: false });
  assert.equal(h.m.data, assets.data, 'the match reads the room face, not the process one');
  h.m.mods = modSet;
  h.start(); h.toPrep(1);
  h.m.handle('p_0', { t: 'g.ready', ready: true });
  h.runToPhase('COMBAT', 1);
  const start = h.lastTo('p_0', 'b.start');
  assert.ok(start, 'the field started and the authority got its spec');
  assert.equal(start.spec.mods.digest, DIGEST, 'the spec carries the ROOM digest, not the process one');
  assert.equal(roomDataBase(start.spec.mods, { digest: PROCESS }), `${ROOM_DATA_PREFIX}${DIGEST}/`, 'so the browser asks for the room face');
  h.m.dispose();

  // 2) the URL the browser fetches answers with exactly the data the server just ran its battle on
  const res = await fetch(`http://127.0.0.1:${srv.port}${ROOM_DATA_PREFIX}${DIGEST}/enemies.json`);
  assert.equal(res.status, 200, 'the declared digest is answerable (a 404 here = the client cannot start the battle)');
  assert.deepEqual(await res.json(), assets.data.enemies, 'the room face serves the room own data, byte for byte');

  // 3) an invented digest is never materialised (a client cannot make the server merge an arbitrary combination)
  const bogus = await fetch(`http://127.0.0.1:${srv.port}${ROOM_DATA_PREFIX}${'c'.repeat(64)}/enemies.json`);
  assert.equal(bogus.status, 404);
  // 4) ...and neither is a file outside the whitelist
  const notADataFile = await fetch(`http://127.0.0.1:${srv.port}${ROOM_DATA_PREFIX}${DIGEST}/../server/lobby.js`);
  assert.notEqual(notADataFile.status, 200);
});
