// tools/asset-pack-doctor.mjs — 判断「已经发出去的素材包，对现在这台服务器还能不能用」。
//
// 为什么需要它：素材包是**按内容哈希**导入的（`public/js/assetPack.js`：只有 sha256[0:16] 等于 URL 里那一段
// 才收下）。所以「包还能不能用」不是一个是非题，而是一个**覆盖率**：素材变了的那些文件会自动改走网络，其余的
// 照旧从玩家浏览器的缓存里出。发版的人需要知道的正是这个比例 —— 全对就不用管，错了一批才值得重打一份。
//
// 两件事这个工具**不做**，因为它们是错的判据：
//   * 不看 `APP_VERSION` / `UPSTREAM_VERSION`：版本号可以变而美术一字不动（那时包完全没事）；
//   * 不看 `data/assets.json` 的 `version` 字段：那是**清单格式**版本，不是素材版本，客户端根本不读它。
// 唯一算数的判据是逐文件的哈希，与 URL 里的内容段一致。
//
// 哈希怎么比（两个坑，都是实测踩出来的）：
//   1. 普通文件的 URL 带它**自己**的哈希；
//   2. Spine 模型的三个成员（`.skel` / `.atlas` / 贴图）的 URL 带的是**整个模型**的哈希 ——
//      `assetIndex.js modelHashOf()` = sha256(成员哈希用 \n 拼接)[0:16]。拿成员自己的哈希去比，
//      会得到 2141 条假阳性「变化」（这正是本工具第一次跑出来的结果）。
//   所以快照存的是**每个 rel 可接受的哈希集合**，而不是「一个文件一个哈希」。
//
// 用法：
//   node tools/asset-pack-doctor.mjs make  --live https://game.xyys.fun --out .cache/asset-pack-snapshot.json
//   node tools/asset-pack-doctor.mjs check --snapshot <快照.json> [--live <base>] [--json]
//        [--max-drift 5]   容忍的「要走网络」百分比（缺省 5），超过则退出码 3
//
// 退出码：0 = 包仍然可用（漂移在阈值内）；3 = 漂移过大，该重打了；1 = 参数/网络/格式错误。
//
// `make` 从**线上清单**取（那是唯一的真相：玩家会拿到的就是它）。`check` 也默认取线上，
// 所以它既能在这台服务器上跑（`--live http://127.0.0.1`），也能在任意机器上对着公网跑。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** 与服务端 `assetIndex.js hash16()` 同一个截断：SHA-256 的前 16 位小写十六进制。 */
const sha256_16 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

/** 会被改写成带内容哈希 URL 的清单（与 server/http/assetViews.js 的 VIEW_MANIFESTS 同一批）。 */
export const MANIFESTS = Object.freeze(['assets.json', 'local-assets.json', 'emotes.json', 'local-fx.json']);

/** 快照格式版本。改字段含义时抬它，`check` 遇到不认识的就拒绝而不是猜。 */
export const SNAPSHOT_FORMAT = 1;

const USAGE = `usage:
  node tools/asset-pack-doctor.mjs make  --live <base> --out <file>
  node tools/asset-pack-doctor.mjs check --pack <zip> [--live <base>] [--json] [--max-drift <pct>]
  node tools/asset-pack-doctor.mjs check --snapshot <file> [--live <base>] [--json] [--max-drift <pct>]

  --live <base>      清单从哪取（缺省 http://127.0.0.1：在这台服务器上是线上槽，不走网络）
  --pack <zip>       要检查的素材包（推荐：直接对着包本身判，不需要事先存快照）
  --snapshot <file>  或者对着一份快照判（make 的产物；保留给没有包的场景）
  --out <file>       make 写到哪里（缺省 .cache/asset-pack-snapshot.json）
  --max-drift <pct>  check 容忍的「要走网络」百分比，缺省 5；超过退出码 3
  --timeout <ms>     单次取清单的超时，缺省 300000（清单 2 MB，跨公网慢）
  --attempts <n>     每份清单最多取几次，缺省 3
  --json             机器可读输出（给发版脚本用）
`;

/** 清单里一个带内容哈希的 URL：`/assets/~<16 hex>/…` 或 `/fonts/~<16 hex>/…`。 */
const HASHED_URL = /^\/(assets|fonts)\/~([0-9a-f]{16})\/(.+)$/;
/** 台账里出现的安全的相对路径（不做解码，只挡穿越与怪字节）。 */
const SAFE_REL = /^(assets|fonts)\/[A-Za-z0-9._@%\-\/ ]+$/;

/**
 * 把「URL 里的那一段哈希」与 plain rel 拆开。
 * @param {unknown} url
 * @returns {{ rel: string, hash: string } | null}
 */
export function splitHashed(url) {
  if (typeof url !== 'string') return null;
  const m = HASHED_URL.exec(url);
  if (!m) return null;
  let rel;
  try { rel = decodeURIComponent(url.slice(1).replace(/\/~[0-9a-f]{16}\//, '/')); } catch { return null; }
  if (!SAFE_REL.test(rel) || rel.includes('..') || rel.includes('\\')) return null;
  return { rel, hash: m[2] };
}

/** 递归走一个清单文档，把每个带哈希的 URL 交给 `fn`。`fn` 返回 undefined 表示「这一条丢掉」。 */
function mapHashedUrls(value, fn) {
  if (typeof value === 'string') {
    const hit = splitHashed(value);
    return hit ? (fn(value, hit) ?? value) : value;
  }
  if (Array.isArray(value)) return value.map((x) => mapHashedUrls(x, fn)).filter((x) => x !== undefined);
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, child] of Object.entries(value)) {
      const r = mapHashedUrls(child, fn);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return value;
}

/**
 * 一个清单文档里每个 rel 的**可接受哈希**。
 *
 * Spine 的判据在 `planFrom()`（public/js/assetPack.js）：同一模型的三条 URL 哈希必须一致，收下时按**模型哈希**
 * 记；所以给成员记下模型哈希、给普通文件记下自己的哈希 —— 这正是导入器认得的东西，不是我们发明的规则。
 * @param {any} doc
 * @param {Map<string, Set<string>>} into
 */
export function collectAcceptable(doc, into = new Map()) {
  const add = (rel, hash) => {
    let set = into.get(rel);
    if (!set) into.set(rel, (set = new Set()));
    set.add(hash);
  };
  /** 一个 Spine 对象：三个成员共用一个模型哈希，遇到不一致就退回按文件各算各的。 */
  const spine = (urls) => {
    const hits = urls.map(splitHashed);
    if (hits.some((h) => !h)) return;
    const hashes = new Set(hits.map((h) => h.hash));
    if (hashes.size !== 1) { for (const h of hits) add(h.rel, h.hash); return; }
    const [model] = hashes;
    for (const h of hits) add(h.rel, model);
  };
  const isSpine = (v) => v && typeof v === 'object' && !Array.isArray(v)
    && typeof v.skel === 'string' && /\.skel$/.test(v.skel);

  const walk = (value) => {
    if (typeof value === 'string') {
      const hit = splitHashed(value);
      if (hit) add(hit.rel, hit.hash);
      return;
    }
    if (Array.isArray(value)) { for (const x of value) walk(x); return; }
    if (!value || typeof value !== 'object') return;
    if (isSpine(value)) {
      const pages = Array.isArray(value.textures) ? value.textures.filter((u) => typeof u === 'string' && u) : [];
      spine([value.skel, ...(typeof value.atlas === 'string' && value.atlas ? [value.atlas] : []),
        ...(pages.length ? pages : [String(value.skel).replace(/\.skel$/, '.png')])]);
      // skel / atlas / textures 已经消费掉了；其余键（例如 local-assets 的 groups 里那种包装）继续走
      for (const [k, child] of Object.entries(value)) {
        if (k === 'skel' || k === 'atlas' || k === 'textures') continue;
        walk(child);
      }
      return;
    }
    for (const child of Object.values(value)) walk(child);
  };
  walk(doc);
  return into;
}

/**
 * 从若干份清单文档拼出一张「rel → 可接受哈希集合」的表。
 * @param {Record<string, any>} docs 文件名 → 解析后的 JSON
 * @returns {Map<string, Set<string>>}
 */
export function acceptableFromDocs(docs) {
  const out = new Map();
  for (const doc of Object.values(docs)) if (doc) collectAcceptable(doc, out);
  return out;
}

/**
 * 快照对象：`make` 写的那种形状。
 * @param {Map<string, Set<string>>} table
 * @param {{ live?: string, appVersion?: string }} [meta]
 */
export function snapshotOf(table, meta = {}) {
  /** @type {Record<string, string[]>} */
  const files = {};
  for (const rel of [...table.keys()].sort()) files[rel] = [...table.get(rel)].sort();
  return {
    format: SNAPSHOT_FORMAT,
    createdAt: new Date().toISOString(),
    ...(meta.live ? { live: meta.live } : {}),
    ...(meta.appVersion ? { appVersion: meta.appVersion } : {}),
    count: Object.keys(files).length,
    files,
  };
}

/**
 * 比一份快照与一份「现在的线上」表。
 *
 * 四类结果，正是玩家那边会发生的事：
 *   * `kept`    —— 哈希仍可接受：从素材包出，不发请求
 *   * `changed` —— 文件换了：URL 变了，缓存查不到，走网络（旧条目留在缓存里没用）
 *   * `removed` —— 清单不再提：玩家的缓存里那几条变成死数据，不影响任何东西
 *   * `added`   —— 新素材：包里没有，走网络
 * @param {Record<string, string[]>} snapshotFiles
 * @param {Map<string, Set<string>>} live
 */
export function compareSnapshot(snapshotFiles, live) {
  const kept = [];
  const changed = [];
  const removed = [];
  for (const [rel, hashes] of Object.entries(snapshotFiles)) {
    const now = live.get(rel);
    if (!now) { removed.push(rel); continue; }
    const ok = (Array.isArray(hashes) ? hashes : [hashes]).some((h) => now.has(h));
    (ok ? kept : changed).push(rel);
  }
  const added = [];
  for (const rel of live.keys()) if (!(rel in snapshotFiles)) added.push(rel);

  const liveTotal = live.size;
  const fromPack = kept.length;
  return {
    kept: kept.length, changed: changed.length, removed: removed.length, added: added.length,
    liveTotal, fromPack,
    /** 线上清单里有多少比例仍由这份包回答（0–100）。 */
    coverage: liveTotal ? (100 * fromPack) / liveTotal : 0,
    /** 有多少比例要改走网络（0–100）。 */
    drift: liveTotal ? (100 * (liveTotal - fromPack)) / liveTotal : 0,
    samples: { changed: changed.slice(0, 10), removed: removed.slice(0, 5), added: added.slice(0, 5) },
  };
}

/**
 * 从 base 把四份清单取回来。返回 `{ docs, errors }`；某一份 404 是正常的（local-fx 可能没有）。
 *
 * 清单是 2 MB 级的 JSON，而**跨公网**取它有真实的失败率（实测：同一台服务器，本机 0.2 秒、公网 35 秒，
 * 差的时候直接超时）。所以这里默认重试，且超时是可调的 —— 在服务器上跑（`--live http://127.0.0.1`）
 * 是毫秒级，那才是发版流程该用的形态；从 Windows 对着公网跑只是顺手。
 * @param {string} base
 * @param {{ doFetch?: Function, timeoutMs?: number, attempts?: number, log?: (s: string) => void }} [opts]
 */
export async function fetchManifests(base, opts = {}) {
  const doFetch = opts.doFetch || ((...a) => globalThis.fetch(...a));
  const timeoutMs = opts.timeoutMs ?? 300000;
  const attempts = Math.max(1, opts.attempts ?? 3);
  const log = opts.log || (() => {});
  /** @type {Record<string, any>} */
  const docs = {};
  const errors = [];
  for (const name of MANIFESTS) {
    const url = `${base.replace(/\/$/, '')}/data/${name}`;
    let lastError = '';
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (res.status === 404) { lastError = ''; break; } // 可选清单（没有官方特效的部署就没有 local-fx.json）
        if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
        const type = res.headers?.get?.('content-type') || '';
        if (/text\/html/i.test(type)) { lastError = '返回了 HTML（路径不对？）'; continue; }
        docs[name] = await res.json();
        lastError = '';
        break;
      } catch (err) {
        lastError = err && err.message ? err.message : String(err);
        if (attempt < attempts) {
          log(`  ${name} 第 ${attempt} 次失败（${lastError}），重试…`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
    if (lastError) errors.push(`${name}: ${lastError}`);
  }
  return { docs, errors };
}

/**
 * 读一个 .zip 的中央目录，返回 `{ name, method, compSize, uncompSize, localOff }[]`。
 *
 * **只读文件尾**：EOCD 在最后 64 KB 内，中央目录一般在最后几十 MB。整包 `readFileSync` 会把 727 MB 全拉进
 * 内存 —— 2026-10-19 就是这样把一台 1.6 GB 的服务器 OOM 掉、连带打死了线上槽。这里按偏移 `read`，
 * 无论包多大，驻留内存都是「目录 + 一条的正文」的量级。
 *
 * 读法照 `public/js/assetPack.js openZip()` 的口径（同一套字段、同样走 ZIP64 兜底），这样「这个工具说包里
 * 有什么」与「导入器认包里有什么」不会因为两套读法而分叉。
 * @param {number} fd 打开的文件描述符
 * @param {number} size 文件字节数
 */
export function readZipDirectory(fd, size) {
  const u16 = (b, o) => b.readUInt16LE(o);
  const u32 = (b, o) => b.readUInt32LE(o);
  const readAt = (pos, len) => {
    const buf = Buffer.allocUnsafe(len);
    const got = fs.readSync(fd, buf, 0, len, pos);
    return buf.subarray(0, got);
  };

  // EOCD：最后 22 字节起往前找，最多 64 KB + 22（注释长度是 u16）。
  const tailLen = Math.min(size, 22 + 0xffff);
  const tail = readAt(size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是 zip：找不到中央目录结尾（EOCD）');
  let entries = u16(tail, eocd + 10);
  let cdOff = u32(tail, eocd + 16);

  if (entries === 0xffff || cdOff === 0xffffffff) {
    // ZIP64：定位器紧挨在 EOCD 前 20 字节。
    if (eocd < 20) throw new Error('zip 损坏：EOCD 前没有 ZIP64 定位器');
    const loc = tail.subarray(eocd - 20, eocd);
    if (u32(loc, 0) !== 0x07064b50) throw new Error('zip 损坏：ZIP64 定位器签名不对');
    const z64 = readAt(Number(loc.readBigUInt64LE(8)), 56);
    entries = Number(z64.readBigUInt64LE(32));
    cdOff = Number(z64.readBigUInt64LE(48));
  }

  // 一次把中央目录读出来（它的量级是「条目数 × ~100 字节」，3 万条约 3 MB）。
  const cd = readAt(cdOff, Math.max(0, size - cdOff));
  /** @type {{ name: string, method: number, compSize: number, uncompSize: number, localOff: number }[]} */
  const out = [];
  let p = 0;
  for (let i = 0; i < entries; i++) {
    if (p + 46 > cd.length || u32(cd, p) !== 0x02014b50) throw new Error(`zip 中央目录损坏（第 ${i} 条）`);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    out.push({
      name: cd.toString('utf8', p + 46, p + 46 + nameLen),
      method: u16(cd, p + 10),
      compSize: u32(cd, p + 20),
      uncompSize: u32(cd, p + 24),
      localOff: u32(cd, p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * 单条正文的硬上限（256 MiB，与 `public/js/assetPack.js MAX_ENTRY_BYTES` 同一个数）。
 * 一个损坏的中央目录可以让 `compSize` 是个天文数字，而按它 `allocUnsafe` 一样能把机器打死 ——
 * 2026-10-19 那次事故之后，凡是「文件里读出来的长度」先过一遍这个闸门。
 */
export const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

/**
 * 解出一个 zip 条目的正文（只支持 stored / deflate —— 导入器也只认这两种）。
 * 只读这一条需要的字节，不为别的条目占内存。
 * @param {number} fd
 * @param {{ name: string, method: number, compSize: number, uncompSize: number, localOff: number }} entry
 */
export function readZipEntry(fd, entry) {
  const u16 = (b, o) => b.readUInt16LE(o);
  const u32 = (b, o) => b.readUInt32LE(o);
  if (entry.compSize > MAX_ENTRY_BYTES || entry.uncompSize > MAX_ENTRY_BYTES) {
    throw new Error(`条目超过上限（压缩 ${entry.compSize} / 原始 ${entry.uncompSize}）：${entry.name}`);
  }
  const head = Buffer.allocUnsafe(30);
  fs.readSync(fd, head, 0, 30, entry.localOff);
  if (u32(head, 0) !== 0x04034b50) throw new Error(`zip 条目头损坏：${entry.name}`);
  const start = entry.localOff + 30 + u16(head, 26) + u16(head, 28);
  const raw = Buffer.allocUnsafe(entry.compSize);
  fs.readSync(fd, raw, 0, entry.compSize, start);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: entry.uncompSize || MAX_ENTRY_BYTES });
  throw new Error(`不支持的压缩方式 ${entry.method}：${entry.name}`);
}

export function hashesFromPack(zipPath, opts = {}) {
  const log = opts.log || (() => {});
  const stat = fs.statSync(zipPath);
  const fd = fs.openSync(zipPath, 'r');
  try {
    const entries = readZipDirectory(fd, stat.size);
    /** @type {Map<string, string>} */
    const own = new Map();
    let bytes = 0;
    for (const e of entries) {
      const rel = String(e.name).replace(/^public\//, '');
      if (!SAFE_REL.test(rel)) { log(`  跳过（不是素材路径）：${e.name}`); continue; }
      const body = readZipEntry(fd, e);
      bytes += body.length;
      own.set(rel, sha256_16(body));
    }
    return { own, files: own.size, bytes };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 线上清单 → `{ files: Map<rel, Set<hash>>, groups: { hash, members }[] }`。
 *
 * 与 `collectAcceptable()` 的区别：这里**保留 Spine 分组**（成员顺序 + 那一个模型哈希）。比对一个包时
 * 必须按清单的顺序重算模型哈希才能得到正确的判据 —— 顺序错一位结果就不同。
 * @param {Record<string, any>} docs
 */
export function planFromDocs(docs) {
  /** @type {Map<string, Set<string>>} */
  const files = new Map();
  /** @type {{ hash: string, members: string[] }[]} */
  const groups = [];
  const addFile = (rel, hash) => {
    let s = files.get(rel);
    if (!s) files.set(rel, (s = new Set()));
    s.add(hash);
  };
  const isSpine = (v) => v && typeof v === 'object' && !Array.isArray(v)
    && typeof v.skel === 'string' && /\.skel$/.test(v.skel);
  const spineMembers = (obj) => {
    const urls = [obj.skel];
    if (typeof obj.atlas === 'string' && obj.atlas) urls.push(obj.atlas);
    const pages = Array.isArray(obj.textures) ? obj.textures.filter((u) => typeof u === 'string' && u) : [];
    urls.push(...(pages.length ? pages : [String(obj.skel).replace(/\.skel$/, '.png')]));
    return urls;
  };
  const walk = (value) => {
    if (typeof value === 'string') {
      const hit = splitHashed(value);
      if (hit) addFile(hit.rel, hit.hash);
      return;
    }
    if (Array.isArray(value)) { for (const x of value) walk(x); return; }
    if (!value || typeof value !== 'object') return;
    if (isSpine(value)) {
      const members = spineMembers(value).map(splitHashed);
      if (members.every(Boolean)) {
        const hashes = new Set(members.map((m) => m.hash));
        if (hashes.size === 1) groups.push({ hash: [...hashes][0], members: members.map((m) => m.rel) });
        else for (const m of members) addFile(m.rel, m.hash); // 清单本身不一致：退回按文件判
      }
      for (const [k, child] of Object.entries(value)) {
        if (k === 'skel' || k === 'atlas' || k === 'textures') continue;
        walk(child);
      }
      return;
    }
    for (const child of Object.values(value)) walk(child);
  };
  for (const doc of Object.values(docs)) if (doc) walk(doc);
  return { files, groups };
}

/**
 * 一个包 vs 现在线上的清单。
 *
 * 判据与导入器逐条对齐（`public/js/assetPack.js` 的 `planFrom` + 收下判据）：
 *   * 普通文件：包里那个文件的 sha256[0:16] 必须等于清单 URL 里的哈希；
 *   * Spine 模型：按**清单给出的成员顺序**把包里各成员的哈希拼起来再取 sha256[0:16]，必须等于模型哈希
 *     —— 这正是 `assetIndex.js modelHashOf()` 的算法。
 * @param {Map<string, string>} own 包里的 rel → 该文件自己的哈希（hashesFromPack）
 * @param {{ files: Map<string, Set<string>>, groups: { hash: string, members: string[] }[] }} plan
 */
export function comparePackToPlan(own, plan) {
  /** @type {string[]} */ const kept = [];
  /** @type {string[]} */ const changed = [];
  /** @type {string[]} */ const absent = [];
  const decided = new Set();

  for (const group of plan.groups) {
    for (const rel of group.members) decided.add(rel);
    const missing = group.members.filter((rel) => !own.has(rel));
    if (missing.length) { absent.push(...missing); continue; }
    const model = sha256_16(Buffer.from(group.members.map((rel) => own.get(rel)).join('\n'), 'utf8'));
    (model === group.hash ? kept : changed).push(...group.members);
  }
  for (const [rel, hashes] of plan.files) {
    if (decided.has(rel)) continue;
    if (!own.has(rel)) { absent.push(rel); continue; }
    (hashes.has(own.get(rel)) ? kept : changed).push(rel);
  }

  // 包里剩下、清单已不再提的：玩家的缓存里会留着，无害
  const liveRels = new Set([...plan.files.keys(), ...plan.groups.flatMap((g) => g.members)]);
  const orphan = [...own.keys()].filter((rel) => !liveRels.has(rel));

  const liveTotal = liveRels.size;
  const fromPack = kept.length;
  return {
    kept: kept.length, changed: changed.length, absent: absent.length, orphan: orphan.length,
    liveTotal, fromPack,
    coverage: liveTotal ? (100 * fromPack) / liveTotal : 0,
    drift: liveTotal ? (100 * (liveTotal - fromPack)) / liveTotal : 0,
    samples: { changed: changed.slice(0, 10), absent: absent.slice(0, 5), orphan: orphan.slice(0, 5) },
  };
}

/**
 * 读一台服务器上的 app 版本（只用于给人看的报告，不参与判定）。
 * @param {string} base
 */
async function appVersionOf(base) {
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/healthz`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.app === 'string' ? `${body.app}${body.build ? ` / ${body.build}` : ''}` : null;
  } catch { return null; }
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** 报告一行。 */
function say(line = '') { process.stdout.write(`${line}\n`); }

export async function main(argv) {
  const args = {};
  const mode = argv[0];
  // `--help` / `-h` 可以出现在任何位置，包括**第一个**参数（那时它不是子命令）。
  if (mode === '-h' || mode === '--help') { say(USAGE); return 0; }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { args.json = true; continue; }
    if (a === '-h' || a === '--help') { say(USAGE); return 0; }
    if (!a.startsWith('--')) { say(`未知参数：${a}\n${USAGE}`); return 1; }
    const v = argv[++i];
    if (v === undefined) { say(`${a} 需要值\n${USAGE}`); return 1; }
    args[a.slice(2)] = v;
  }
  const live = String(args.live || 'http://127.0.0.1');
  const netOpts = {
    timeoutMs: Number(args.timeout ?? 300000),
    attempts: Number(args.attempts ?? 3),
    log: (s) => say(s),
  };

  if (mode === 'make') {
    const { docs, errors } = await fetchManifests(live, netOpts);
    if (!docs['assets.json']) { say(`取不到 ${live}/data/assets.json${errors.length ? `（${errors.join('; ')}）` : ''}`); return 1; }
    if (errors.length) say(`警告：${errors.join('; ')}`);
    const table = acceptableFromDocs(docs);
    const snap = snapshotOf(table, { live, appVersion: (await appVersionOf(live)) || undefined });
    const out = path.resolve(String(args.out || '.cache/asset-pack-snapshot.json'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(snap)}\n`, 'utf8');
    const bytes = fs.statSync(out).size;
    say(`快照已写出 ${out}`);
    say(`  ${snap.count} 个文件 · ${Object.keys(docs).length} 份清单 · ${mb(bytes)}`);
    if (snap.appVersion) say(`  对应当前线上版本 ${snap.appVersion}`);
    return 0;
  }

  if (mode === 'check') {
    // 先确认本地输入存在：拿不到快照/包时不该先去拉 2 MB 的清单。
    if (!args.pack && !args.snapshot) { say(`--pack 或 --snapshot 必须给一个\n${USAGE}`); return 1; }
    if (args.pack && !fs.existsSync(path.resolve(String(args.pack)))) {
      say(`找不到素材包：${path.resolve(String(args.pack))}`);
      return 1;
    }
    if (!args.pack && !fs.existsSync(path.resolve(String(args.snapshot)))) {
      say(`找不到快照：${path.resolve(String(args.snapshot))}`);
      return 1;
    }
    // 快照的形状也在拉清单之前验：格式不对就不该去动网络。
    /** @type {any} */
    let snap = null;
    if (!args.pack) {
      try { snap = JSON.parse(fs.readFileSync(path.resolve(String(args.snapshot)), 'utf8')); }
      catch (err) { say(`快照不是合法 JSON：${err.message}`); return 1; }
      if (snap.format !== SNAPSHOT_FORMAT) { say(`快照格式是 ${snap.format}，本工具只认 ${SNAPSHOT_FORMAT}`); return 1; }
      if (!snap.files || typeof snap.files !== 'object') { say('快照里没有 files 表'); return 1; }
    }
    const { docs, errors } = await fetchManifests(live, netOpts);
    if (!docs['assets.json']) { say(`取不到 ${live}/data/assets.json${errors.length ? `（${errors.join('; ')}）` : ''}`); return 1; }
    const nowVersion = (await appVersionOf(live)) || '(读不到)';
    const maxDrift = Number(args['max-drift'] ?? 5);

    /** 两种判据：对着**包本身**（推荐，不需要事先存快照），或对着**快照**（旧接口，保留兼容）。 */
    let result;
    let header;
    if (args.pack) {
      const packPath = path.resolve(String(args.pack));
      if (!fs.existsSync(packPath)) { say(`找不到素材包：${packPath}`); return 1; }
      const t0 = Date.now();
      const { own, files, bytes } = hashesFromPack(packPath, { log: (s) => say(s) });
      const plan = planFromDocs(docs);
      result = comparePackToPlan(own, plan);
      header = `素材包      ${path.basename(packPath)} · ${files} 个文件 · ${mb(bytes)}`
        + `（读完 ${((Date.now() - t0) / 1000).toFixed(0)}s）`;
    } else {
      const liveTable = acceptableFromDocs(docs);
      result = compareSnapshot(snap.files, liveTable);
      header = `素材包快照  ${snap.createdAt || '?'}${snap.appVersion ? ` · ${snap.appVersion}` : ''} · ${snap.count} 个文件`;
    }

    const over = Number.isFinite(maxDrift) && result.drift > maxDrift;

    if (args.json) {
      say(JSON.stringify({ ok: !over, maxDrift, live: { appVersion: nowVersion }, ...result, errors }));
      return over ? 3 : 0;
    }

    say(header);
    say(`当前线上    ${nowVersion}`);
    if (errors.length) say(`  警告：${errors.join('; ')}`);
    say('');
    say(`  线上清单共 ${result.liveTotal} 个文件`);
    say(`  仍由素材包回答   ${String(result.fromPack).padStart(6)}  (${result.coverage.toFixed(1)}%)`);
    say(`  需要改走网络     ${String(result.liveTotal - result.fromPack).padStart(6)}  (${result.drift.toFixed(1)}%)`);
    say('');
    const absent = result.absent ?? 0;
    const added = result.added ?? 0;
    say(`  其中：文件变了 ${result.changed} · 包里没有（新增）${args.pack ? absent : added}`
      + ` · 已删除 ${result.removed ?? result.orphan ?? 0}`);
    if (result.samples.changed.length) {
      say('  变了的例子：');
      for (const rel of result.samples.changed) say(`    ${rel}`);
    }
    const missingSamples = result.samples.absent || result.samples.added || [];
    if (missingSamples.length) {
      say('  包里没有的例子：');
      for (const rel of missingSamples) say(`    ${rel}`);
    }
    say('');
    if (!over) {
      say(`结论：素材包仍然可用（走网络 ${result.drift.toFixed(1)}% ≤ 阈值 ${maxDrift}%，不必重打）`);
      return 0;
    }
    say(`结论：漂移 ${result.drift.toFixed(1)}% 超过阈值 ${maxDrift}% —— 该重打一份素材包了`);
    return 3;
  }

  say(USAGE);
  return 1;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) process.exit(await main(process.argv.slice(2)));
