// server/http/assetJump.js — **本机没有的**素材，302 到镜像（做在游戏进程内）。
//
// 移植自下游 fork 的 server/http/asset-jump.js（同一项目，GPL-3.0-or-later）。这里刻意**只保留「兜底」语义**：
//
//   static.js 先按磁盘发文件；**只有本机确实没有这个文件（404）时**才问这里一句
//   「这个路径该 302 到哪个镜像」。本机有的文件一个字节都不改由本机发 —— 所以没配置镜像时，
//   这个模块整个不启动，行为与没有它时**逐字节相同**。
//
// 为什么不做「清单改写」（把 data/assets.json 里的 URL 直接换成 CDN 绝对地址）：2026-10-13 在另一条
// 部署线上踩过 —— 客户端对 Spine 模型记录的 URL 形状有硬判据（validSpine 要求根相对路径且以 .skel 结尾，
// .atlas/.png 由后缀替换推出），把清单 URL 改成绝对地址会让**所有**模型记录被静默丢弃。302 不改任何 URL
// 形状，风险面只有这一条路由。
//
// 语义与规则（全部在下面这一处实现，别处不再抄一份）：
//   * 只分流 `/assets/**` 与 `/fonts/**`，且只分流**静态素材扩展名**（清单/代码留在本机：它们可能和客户端
//     构建产物版本不同）；
//   * 路径逐段校验：`..` / `.` / 空段 / 尾点 / 控制字符一律拒；
//   * 源表只来自配置（环境变量或 JSON 文件），**永不**接受请求里给的任意 URL；
//   * 客户端可用 `?sp_source=<id>` 点名一个**已配置**的源（未配置的 id 当没写）；
//   * 源健康：固定路径 HEAD —— HTTP 应答（含 403/404）都算「活着」，只有 5xx / 超时 / 网络错才顺延到下一源；
//   * 存在性：302 选中的源顺手 HEAD 一次，404 记 10 分钟「这个源没有这个文件」，后续请求自动避开；
//   * 请求路径上**永不等待网络**：健康 / 存在性 / 测速全在后台，302 是同步决定。
//
// 配置（全部可选；都没有 = 关闭）：
//   SP_ASSET_CDN=https://cdn-a.example,https://cdn-b.example   逗号分隔，按序回退；CSP 也从这同一个变量
//                                                              取 origin（server/http/csp.js）
//   SP_ASSET_SOURCES=/path/to/sources.json                     可带例外表 / 前缀规避的完整源表（优先于 SP_ASSET_CDN）
//   SP_ASSET_JUMP=0                                            关掉（即便配置了源）
//   SP_ASSET_JUMP_CACHE_SEC=60                                 302 的 Cache-Control max-age
//   SP_ASSET_HEALTH=0 / SP_ASSET_HEALTH_INTERVAL_MS=60000 / SP_ASSET_HEALTH_TTL_MS=180000
//   SP_ASSET_HEALTH_STRIKES=1                                  连续几次 5xx 才判 down（防抖）
//   SP_PROBE=0 / SP_PROBE_INTERVAL_MS=300000 / SP_PROBE_TIMEOUT_MS=20000
//   SP_PROBE_LEADS=1                                           让容器实测序掌舵（默认只报告，不掌舵）
//   SP_EDGE_SNAPSHOT=/tmp/sp-asset-state.json                  写一份状态快照给边缘侧车（默认不写）
//
// 源表 JSON 形状（与下游那份 sources.json 兼容）：
//   { "order": ["a"], "sources": [{ "id": "a", "base": "https://…" }],
//     "exceptions": { "/assets/x.png": "a" },
//     "prefixRules": [{ "prefix": "/assets/voice/", "skip": ["a"] }] }
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, noopLog } from './config.js';
import { createMirrorProbe, samplerPool } from '../mirrorProbe.js';

/** 只分流确实可重定向的扩展名。清单 / 代码（js/css/json）留在游戏本体，因为它们可能与本地构建产物不同版本。 */
export const ALLOWED_EXT = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif',
  'atlas', 'skel', 'obj', 'mtl', 'bin',
  'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav',
  'ttf', 'otf', 'woff', 'woff2',
]);

/** 每段必须是 [A-Za-z0-9_[-] 开头、之后允许 . —— 于是 ".."、尾点段、控制字符全部被拒。 */
const SEGMENT = /^[A-Za-z0-9_[-][A-Za-z0-9_.[\]-]*$/;
export const MAX_PATH = 2048;
export const MAX_TARGET = 8192;

export function splittable(pathname) {
  return typeof pathname === 'string' && (pathname.startsWith('/assets/') || pathname.startsWith('/fonts/'));
}

export function extensionOf(pathname) {
  const i = String(pathname).lastIndexOf('.');
  return i < 0 ? '' : String(pathname).slice(i + 1).toLowerCase();
}

/**
 * 扩展名闸门：白名单之外只放两个例外 —— `/fonts/fonts.css`（官方客户端唯一的字体清单，它属于字体集）
 * 与 `/assets/local/**` 下的 json / bin（本地美术的清单本身就是「素材」，没有版本不一致的问题）。
 */
export function allowedExt(pathname) {
  const ext = extensionOf(pathname);
  if (ALLOWED_EXT.has(ext)) return true;
  if (ext === 'css' && pathname.startsWith('/fonts/')) return true;
  return (ext === 'json' || ext === 'bin') && pathname.startsWith('/assets/local/');
}

export function validPath(pathname) {
  if (typeof pathname !== 'string' || pathname.length < 2 || pathname.length > MAX_PATH) return false;
  if (pathname.includes('//') || pathname.includes('\\') || pathname.includes('\0')) return false;
  for (const seg of pathname.split('/')) {
    if (seg === '') continue; // 前导 '/'
    if (!SEGMENT.test(seg) || seg.endsWith('.')) return false;
  }
  return true;
}

/** Drop only the `sp_source` key; every other query byte is forwarded verbatim. */
export function stripSourceParam(query) {
  if (!query) return '';
  return String(query)
    .split('&')
    .filter((part) => part !== '' && part.split('=')[0] !== 'sp_source')
    .join('&');
}

/** A usable http(s) base: scheme + host (+ optional path prefix), no credentials, no `..`, trailing slash dropped. */
function normalizeBase(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 2048 || s.includes('..') || s.includes('\\')) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

/**
 * Parse and validate a sources.json. Throws on anything that would turn the jump layer into an open redirect:
 * the file is an operator artifact, but a hand edit must not get that far.
 */
export function parseSources(raw) {
  const doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.sources)) {
    throw new Error('sources.json: expected { sources: [], order: [] }');
  }
  const byId = new Map();
  for (const src of doc.sources) {
    if (!src || typeof src.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(src.id)) continue;
    const base = normalizeBase(src.base);
    if (!base || byId.has(src.id)) continue;
    byId.set(src.id, base);
  }
  if (byId.size === 0) throw new Error('sources.json: no usable source');
  const order = (Array.isArray(doc.order) ? doc.order : [...byId.keys()]).filter((id) => byId.has(id));
  if (order.length === 0) throw new Error('sources.json: order names no usable source');
  // 个别路径任何一个源都供不了时，点名改道。只接受指向已知源的 id：例外表也不能变成任意 URL。
  const exceptions = new Map();
  if (doc.exceptions && typeof doc.exceptions === 'object') {
    for (const [p, id] of Object.entries(doc.exceptions)) {
      if (typeof p === 'string' && p.startsWith('/') && typeof id === 'string' && byId.has(id)) exceptions.set(p, byId.get(id));
    }
  }
  // 前缀级规避：「这个前缀在这些源上是目录级缺件」——第一次请求就避开，别拿玩家的请求去试错。
  const prefixRules = [];
  if (Array.isArray(doc.prefixRules)) {
    for (const rule of doc.prefixRules) {
      if (!rule || typeof rule.prefix !== 'string' || !rule.prefix.startsWith('/')) continue;
      const skip = new Set((Array.isArray(rule.skip) ? rule.skip : []).filter((id) => typeof id === 'string' && byId.has(id)));
      if (skip.size) prefixRules.push({ prefix: rule.prefix, skip });
    }
  }
  return { byId, order, exceptions, prefixRules };
}

/**
 * `SP_ASSET_CDN=a=https://a.example,https://b.example` → 源表。列表位置就是顺序。
 * 允许 `id=url` 形式给源起名（客户端 `?sp_source=<id>` 用）；否则 id = cdn1 / cdn2 …
 */
export function parseMirrors(raw) {
  const sources = [];
  const order = [];
  const parts = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const eq = part.indexOf('=');
    let id = '';
    let baseRaw = part;
    if (eq > 0 && /^[A-Za-z0-9_-]{1,32}$/.test(part.slice(0, eq)) && /^https?:\/\//i.test(part.slice(eq + 1))) {
      id = part.slice(0, eq);
      baseRaw = part.slice(eq + 1);
    }
    const base = normalizeBase(baseRaw);
    if (!base) continue;
    id = id || `cdn${i + 1}`;
    // 同一个基址写两遍没有意义（第二遍只会是死条目），同 id 也不行。
    if (sources.some((s) => s.id === id || s.base === base)) continue;
    sources.push({ id, base });
    order.push(id);
  }
  if (!sources.length) return null;
  return { byId: new Map(sources.map((s) => [s.id, s.base])), order, exceptions: new Map(), prefixRules: [] };
}

/** Default path of the optional sources file kept next to the deployment (absent on a plain install). */
export const DEFAULT_SOURCES_PATH = path.join(ROOT, 'deploy', 'asset-sources.json');

/**
 * 抽样池 = 随服务发布的素材清单里的相对路径（`data/assets.json`）。读不到就退回一个内置路径，
 * 保证探测器至少还能量出「小文件延迟」这一项；**绝不**从网络或调用方取路径。
 */
export function loadProbePaths({ fsImpl = fs, root = ROOT, log = noopLog } = {}) {
  const fallback = ['/assets/char/avatar/char_003_kalts.png'];
  try {
    const manifest = JSON.parse(fsImpl.readFileSync(path.join(root, 'data', 'assets.json'), 'utf8'));
    const urls = [];
    (function walk(o) {
      if (typeof o === 'string') urls.push(o);
      else if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') Object.values(o).forEach(walk);
    })(manifest);
    const rel = samplerPool(urls.filter((u) => !u.includes('?')));
    return rel.length ? rel.slice(0, 500) : fallback;
  } catch (e) {
    log.warn?.(`[http] asset jump: cannot read data/assets.json (${e?.message || e}) — probe uses the built-in sample`);
    return fallback;
  }
}

/** 配置从调用方选项 → 源表文件 → SP_ASSET_CDN 依次取；一个都没有就返回 null（= 这个模块不启动）。 */
function resolveSources({ sources, sourcesPath, env, log }) {
  if (Array.isArray(sources) && sources.length) {
    try {
      return { config: parseSources({ sources, order: sources.map((s) => s.id) }), source: 'options' };
    } catch (e) {
      log?.warn?.(`[http] asset jump: off — bad sources option: ${e?.message || e}`);
      return null;
    }
  }
  const file = sourcesPath || (env.SP_ASSET_SOURCES ? String(env.SP_ASSET_SOURCES).trim() : '');
  const candidate = file || DEFAULT_SOURCES_PATH;
  // 显式指定的文件读不到 = 明确失败（关掉并留下日志）；缺省路径不存在 = 正常安装，静默关闭。
  if (file || fs.existsSync(candidate)) {
    try {
      return { config: parseSources(fs.readFileSync(candidate, 'utf8')), source: candidate };
    } catch (e) {
      log?.warn?.(`[http] asset jump: off — cannot read ${candidate}: ${e?.message || e}`);
      return null;
    }
  }
  const parsed = parseMirrors(env.SP_ASSET_CDN);
  // 设了变量却一个可用基址都没有：明确说出来，别让「我明明配了 CDN」变成一个只能靠猜的问题。
  if (!parsed) {
    if (String(env.SP_ASSET_CDN ?? '').trim()) log?.warn?.(`[http] asset jump: off — SP_ASSET_CDN has no usable origin: "${String(env.SP_ASSET_CDN).slice(0, 120)}"`);
    return null;
  }
  return { config: parsed, source: 'SP_ASSET_CDN' };
}

/**
 * Build the jump function. `null` when no source is configured or SP_ASSET_JUMP=0 — a jump layer must never take the
 * game down with it, and a plain install must behave byte for byte as before.
 * @param {{ sources?: { id: string, base: string }[], sourcesPath?: string, disabled?: boolean, log?: object,
 *           env?: Record<string, string|undefined>, fetchImpl?: Function, probePaths?: string[],
 *           healthIntervalMs?: number, healthTtlMs?: number, healthPath?: string, healthStrikes?: number,
 *           probeIntervalMs?: number, probeTimeoutMs?: number, probeLeads?: boolean, cacheSeconds?: number,
 *           snapshotPath?: string|null }} [opts]
 * @returns {(((pathname: string, query?: string, method?: string) => Promise<{ status: number, headers: Record<string, string> }|null>) & { enabled: boolean, status: Function, missing: Function, health: Function, probe: Function, checkProbe: Function, checkHealth: Function, config: Function, stop: Function }) | null}
 */
export function createAssetJump({
  sources = null, sourcesPath = '', disabled = false, log = noopLog, env = process.env, fetchImpl = globalThis.fetch,
  probePaths = null, healthIntervalMs = NaN, healthTtlMs = NaN, healthPath = '', healthStrikes = NaN,
  probeIntervalMs = NaN, probeTimeoutMs = NaN, probeLeads = null, cacheSeconds = NaN, snapshotPath = null,
} = {}) {
  const off = disabled || env.SP_ASSET_JUMP === '0';
  if (off) {
    if (sources || env.SP_ASSET_CDN || env.SP_ASSET_SOURCES) log.info?.('[http] asset jump: disabled (SP_ASSET_JUMP=0)');
    return null;
  }
  const resolved = resolveSources({ sources, sourcesPath, env, log });
  if (!resolved) return null;
  const config = resolved.config;

  log.info?.(`[http] asset jump: on — order=${config.order.join(' > ')}, exceptions=${config.exceptions.size}, prefixRules=${config.prefixRules.length} (${resolved.source})`);

  // 客户端点名的源只能是已配置的 id：请求里出现的任意 URL 一律当没写（这个端点不能变成开放重定向）。
  const byBase = new Map([...config.byId].map(([id, base]) => [base, id]));

  // ---- 源健康：这个源现在通不通 ----------------------------------------------------------------
  // 判据：**任何 HTTP 应答**都说明域名/节点活着（403/404 是「这个文件它没有」，是存在性的事）；
  // 只有 5xx / 429 / 超时 / 网络错才判 down，302 顺延到下一源。
  // 连续失败计数（SP_ASSET_HEALTH_STRIKES）：一次探测抖动不该把整源降级，否则玩家会被推到覆盖不全的镜像上。
  const HEALTH_INTERVAL_MS = Number.isFinite(healthIntervalMs) ? healthIntervalMs : (env.SP_ASSET_HEALTH === '0' ? 0 : Number(env.SP_ASSET_HEALTH_INTERVAL_MS || 60_000));
  const HEALTH_TTL_MS = Number.isFinite(healthTtlMs) ? healthTtlMs : Number(env.SP_ASSET_HEALTH_TTL_MS || 3 * 60_000);
  const HEALTH_PATH = healthPath || env.SP_ASSET_HEALTH_PATH || '/assets/char/avatar/char_003_kalts.png';
  const HEALTH_TIMEOUT_MS = 4000;
  const HEALTH_STRIKES = Math.max(1, Number.isFinite(healthStrikes) ? healthStrikes : Number(env.SP_ASSET_HEALTH_STRIKES || 1));
  const health = new Map();          // 源 id → { v: 'ok' | 'unknown' | 'down', at, ms, status|error, strikes, structural }
  const strikeCounts = new Map();
  const healthProbing = new Set();
  let healthSkips = 0;

  const knownDown = (id) => { const h = health.get(id); return !!h && h.v === 'down' && Date.now() - h.at < HEALTH_TTL_MS; };

  /** 对**固定健康路径**做一次 HEAD。可 await（诊断 / 测试），也可 fire-and-forget。 */
  const probeHealth = (id, base) => {
    if (healthProbing.has(id) || !base || !fetchImpl) return Promise.resolve(health.get(id) ?? null);
    healthProbing.add(id);
    const t0 = Date.now();
    return Promise.resolve()
      .then(() => fetchImpl(base + HEALTH_PATH, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) }))
      .then((r) => {
        const reachable = r.status < 500 && r.status !== 429;
        const strikes = reachable ? 0 : (strikeCounts.get(id) || 0) + 1;
        strikeCounts.set(id, strikes);
        const structural = r.status >= 400 && r.status < 500;
        const v = { v: reachable ? 'ok' : (strikes >= HEALTH_STRIKES ? 'down' : 'unknown'), at: Date.now(), ms: Date.now() - t0, status: r.status, strikes, structural };
        health.set(id, v);
        if (v.v === 'down') log.warn?.(`[http] asset jump: source ${id} answered ${r.status} on ${HEALTH_PATH} — the next source will be used`);
        return v;
      })
      .catch((e) => {
        const strikes = (strikeCounts.get(id) || 0) + 1;
        strikeCounts.set(id, strikes);
        const down = strikes >= HEALTH_STRIKES;
        const v = { v: down ? 'down' : 'unknown', at: Date.now(), ms: Date.now() - t0, error: String(e?.message || e).slice(0, 80), strikes, structural: false };
        health.set(id, v);
        log.warn?.(`[http] asset jump: source ${id} unreachable (${v.error}) — ${down ? 'the next source will be used' : `strike ${strikes}/${HEALTH_STRIKES}, still tried once more`}`);
        return v;
      })
      .finally(() => healthProbing.delete(id));
  };
  // 常驻循环：每轮探**所有已配置源**，一个源挂掉 / 恢复都会在一个间隔内被发现。unref() 不吊住进程退出。
  const healthTimer = HEALTH_INTERVAL_MS > 0 ? setInterval(() => { for (const id of config.order) probeHealth(id, config.byId.get(id)); }, HEALTH_INTERVAL_MS) : null;
  healthTimer?.unref?.();
  if (healthTimer) for (const id of config.order) probeHealth(id, config.byId.get(id));

  // ---- 存在性：让 302 尽量不落到「还没有这个文件」的镜像上 ------------------------------------
  // 跳转本身是同步的，所以这里不阻塞：只信缓存里已知的「缺件」，未命中就先按既有顺序跳出去，
  // 同时对刚选中的源做一次 HEAD（TTL 10 分钟）—— 第一个请求可能仍打到缺件源，后续请求自动避开；
  // 同步补齐（刚上传的素材）在一个 TTL 之后自动恢复。
  const EXIST_TTL_MS = Number(env.SP_ASSET_EXIST_TTL_MS || 10 * 60_000);
  const EXIST_MAX = 5000;
  const exists = new Map();            // key = 源 id + '\n' + 路径 → { v: 'ok' | 'miss' | null, at }
  const existProbing = new Set();
  const existKey = (id, pathname) => id + '\n' + pathname;
  const knownMiss = (id, pathname) => { const e = exists.get(existKey(id, pathname)); return !!e && e.v === 'miss' && Date.now() - e.at < EXIST_TTL_MS; };
  const noteExist = (id, pathname, v) => {
    if (exists.size >= EXIST_MAX) { const first = exists.keys().next().value; if (first !== undefined) exists.delete(first); }
    exists.set(existKey(id, pathname), { v, at: Date.now() });
  };
  /**
   * 对一个 (源, 路径) 做一次 HEAD：2xx/3xx = 有（镜像自己再跳也算能供），404 = 没有，其余 = 未知（不缓存结论）。
   * **403 不是「没有」**：Cloudflare 前置的镜像对数据中心 IP / 限速 / 机器人判定都可能回 403，
   * 而玩家的浏览器取同一个文件是 200 —— 把 403 记成缺件会让这条源在 10 分钟内被整条跳过。
   */
  const probeExist = (id, base, pathname, query) => {
    const key = existKey(id, pathname);
    if (existProbing.has(key) || !base || !fetchImpl) return;
    existProbing.add(key);
    const rest = stripSourceParam(query || '');
    const target = base + pathname + (rest ? `?${rest}` : '');
    Promise.resolve()
      .then(() => fetchImpl(target, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) }))
      .then((r) => noteExist(id, pathname, r.status < 400 ? 'ok' : (r.status === 404 ? 'miss' : null)))
      .catch(() => noteExist(id, pathname, null))
      .finally(() => existProbing.delete(key));
  };

  // ---- 容器视角的测速：实测证据，默认只报告不掌舵 ----------------------------------------------
  const PROBE_INTERVAL_MS = Number.isFinite(probeIntervalMs) ? probeIntervalMs : (env.SP_PROBE === '0' ? 0 : Number(env.SP_PROBE_INTERVAL_MS || 300_000));
  const PROBE_TIMEOUT_MS = Number.isFinite(probeTimeoutMs) ? probeTimeoutMs : Number(env.SP_PROBE_TIMEOUT_MS || 20_000);
  const LEADS = probeLeads == null ? env.SP_PROBE_LEADS === '1' : probeLeads === true;
  const paths = probePaths || loadProbePaths({ log });
  const speedProbe = createMirrorProbe({
    sources: config.order.map((id) => ({ id, base: config.byId.get(id) })),
    paths, fetchImpl, log, intervalMs: PROBE_INTERVAL_MS, timeoutMs: PROBE_TIMEOUT_MS,
  });
  log.info?.(`[http] asset jump: speed probe — ${speedProbe.poolSize()} sample paths${LEADS ? ' (steering the order: SP_PROBE_LEADS=1)' : ' (report only)'}`);

  const CACHE_SECONDS = Number.isFinite(cacheSeconds) ? cacheSeconds : Number(env.SP_ASSET_JUMP_CACHE_SEC || 60);
  let jumps = 0, misses = 0;

  /** 生效顺序：容器实测序（至少两个源测成功才有意义）插到最前，其余保持原相对顺序。 */
  const effectiveOrder = () => {
    if (!LEADS) return config.order.slice();
    const measured = speedProbe.measuredOrder().filter((id) => config.byId.has(id));
    return measured.length > 1 ? [...measured, ...config.order.filter((id) => !measured.includes(id))] : config.order.slice();
  };

  /** 首个命中的前缀规则所屏蔽的源 id；无命中返回 null。 */
  const prefixBlocked = (pathname) => {
    for (const rule of config.prefixRules) if (pathname.startsWith(rule.prefix)) return rule.skip;
    return null;
  };

  /**
   * The whole decision, as a pure-ish function: no sockets, no timers it awaits.
   * @returns {{ status: number, location?: string, source?: string, headers: Record<string, string> }}
   */
  const decide = (pathname, query, method, order, skip) => {
    if (method !== 'GET' && method !== 'HEAD') return { status: 405, headers: { Allow: 'GET, HEAD' } };
    if (!splittable(pathname) || !validPath(pathname) || !allowedExt(pathname)) return { status: 404, headers: {} };
    const forcedId = query ? new URLSearchParams(query).get('sp_source') : null;
    const blocked = prefixBlocked(pathname);
    const unusable = (id) => (skip && skip.has(id)) || (blocked && blocked.has(id)) || knownDown(id) || knownMiss(id, pathname);
    /** @type {string|null} */
    let chosen = null;
    // 例外表点名的那个源（exceptions 存的是 base，反查回 id 才能与 skip / blocked 对齐）。
    const forcedBase = config.exceptions.get(pathname);
    if (forcedBase) {
      const id = byBase.get(forcedBase);
      if (id && !(skip && skip.has(id)) && !(blocked && blocked.has(id)) && !knownDown(id) && !knownMiss(id, pathname)) chosen = id;
    }
    if (!chosen && forcedId && config.byId.has(forcedId) && !unusable(forcedId)) chosen = forcedId;
    if (!chosen) chosen = order.find((id) => !unusable(id)) || null;
    if (!chosen) return { status: 404, headers: {} };
    const base = config.byId.get(chosen);
    const rest = stripSourceParam(query || '');
    const target = base + pathname + (rest ? `?${rest}` : '');
    if (target.length > MAX_TARGET) return { status: 414, headers: {} };
    return { status: 302, location: target, source: chosen, headers: {} };
  };

  /** 后备清单：生效顺序里除已选中、已知不可达之外的，最多 3 条。标准 Link + 一个傻瓜头，两个都给。 */
  const altUrls = (pathname, query, order, chosen, down) => {
    const out = [];
    for (const id of order) {
      if (id === chosen || down.includes(id) || !config.byId.has(id)) continue;
      const q = new URLSearchParams(query || '');
      q.set('sp_source', id);
      const alt = decide(pathname, q.toString(), 'GET', order, null);
      if (alt.status === 302 && alt.location) out.push({ id, url: alt.location });
      if (out.length >= 3) break;
    }
    return out;
  };

  /**
   * 本机缺这个文件时问一句：该 302 到哪。`null` = 不归这一层管（路径/扩展名不在分流面）或没有可用源。
   * @param {string} pathname 已解码的请求路径（static.js 传进来的就是它）
   * @param {string} [query] 不带 '?'
   * @param {string} [method]
   */
  const jump = async (pathname, query = '', method = 'GET') => {
    if (method !== 'GET' && method !== 'HEAD') return null;
    if (!splittable(pathname) || !validPath(pathname) || !allowedExt(pathname)) return null;
    const order = effectiveOrder();
    const down = order.filter((id) => knownDown(id));
    const skip = new Set(order.filter((id) => knownMiss(id, pathname)));
    for (const id of down) skip.add(id);
    // 点名一个**已知不可达**的源等于点名到死链：把点名降级成「偏好」，按顺序顺延，而不是照办给玩家一个打不开的地址。
    let q = query;
    if (query && down.length) {
      const named = new URLSearchParams(query).get('sp_source');
      if (named && down.includes(named)) {
        q = stripSourceParam(query);
        log.info?.(`[http] asset jump: named source ${named} is unreachable — falling through by order`);
      }
    }
    let out = decide(pathname, q, method, order, skip.size ? skip : null);
    // 全部候选都被剔除（缺件 / 不可达）→ 退回不带 skip 的兜底（给客户端 302 比给 404 好），并让缓存继续刷新。
    if (out.status !== 302 && skip.size) out = decide(pathname, q, method, order, null);
    if (out.status !== 302) { misses += 1; return null; }
    jumps += 1;
    if (out.source) probeExist(out.source, config.byId.get(out.source), pathname, query);
    if (down.length) {
      healthSkips += down.length;
      log.info?.(`[http] asset jump: skip(health) ${down.join(',')} → ${out.source}`);
    }
    /** @type {Record<string, string>} */
    const headers = {
      Location: out.location,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD',
      'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
      'X-SP-Asset-Jump': '1',
    };
    if (out.source) headers['X-SP-Asset-Source'] = out.source;
    const alts = altUrls(pathname, query, order, out.source, down);
    if (alts.length) {
      headers.Link = alts.map((a) => `<${a.url}>; rel="alternate"`).join(', ');
      headers['X-SP-Fallbacks'] = alts.map((a) => a.url).join(',');
    }
    return { status: 302, headers };
  };

  // ---- 状态快照（可选）：给边缘侧车 / 外部监控读，不给就别写盘 --------------------------------
  const SNAPSHOT_PATH = snapshotPath || env.SP_EDGE_SNAPSHOT || '';
  const publishSnapshot = () => {
    if (!SNAPSHOT_PATH) return;
    try {
      const down = [], dead = [], miss = [];
      for (const [id, v] of health) {
        if (v && v.v === 'down' && Date.now() - v.at < HEALTH_TTL_MS) { down.push(id); if (v.structural === true) dead.push(id); }
      }
      for (const [key, e] of exists) if (e && e.v === 'miss' && Date.now() - e.at < EXIST_TTL_MS) miss.push(key);
      const tmp = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ down, dead, miss, at: Date.now() }));
      fs.renameSync(tmp, SNAPSHOT_PATH);
    } catch { /* 快照不可写不影响进程内跳转 */ }
  };
  const snapshotTimer = SNAPSHOT_PATH ? setInterval(publishSnapshot, 5000) : null;
  snapshotTimer?.unref?.();
  if (snapshotTimer) publishSnapshot();

  /** 诊断用：存在性缓存的规模与其中「已判缺件」的条数。 */
  jump.exists = () => ({ size: exists.size, known: [...exists.values()].filter((e) => e.v === 'miss').length });
  /** 诊断用：每个源的健康判定 + 因为健康被顺延掉的次数。 */
  jump.health = () => ({
    sources: Object.fromEntries([...health].map(([id, v]) => [id, { ...v }])),
    byHealth: healthSkips,
    cfg: { intervalMs: HEALTH_INTERVAL_MS, ttlMs: HEALTH_TTL_MS, path: HEALTH_PATH, strikes: HEALTH_STRIKES },
  });
  /** 缺失表：本机缺、镜像也没有的路径（存在性缓存 + 测速抽样两条来源，去重合并）。 */
  jump.missing = () => {
    const map = new Map();
    for (const [key, e] of exists) {
      if (!e || e.v !== 'miss' || Date.now() - e.at >= EXIST_TTL_MS) continue;
      const nl = key.indexOf('\n');
      const id = key.slice(0, nl), pathname = key.slice(nl + 1);
      const row = map.get(pathname) ?? { path: pathname, sources: [], at: null };
      row.sources.push(id);
      if (!row.at || e.at > Date.parse(row.at)) row.at = new Date(e.at).toISOString();
      map.set(pathname, row);
    }
    for (const row of speedProbe.state().missing) {
      const hit = map.get(row.path) ?? { path: row.path, sources: [], at: row.at };
      hit.sources = [...new Set([...hit.sources, ...row.sources])];
      map.set(row.path, hit);
    }
    return [...map.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  };
  jump.probe = () => ({ ...speedProbe.state(), leads: LEADS });
  jump.checkProbe = () => speedProbe.refresh();
  jump.checkHealth = async () => {
    await Promise.all(config.order.map((id) => probeHealth(id, config.byId.get(id))));
    return jump.health();
  };
  jump.enabled = true;
  jump.config = () => ({ sourcesPath: resolved.source, order: effectiveOrder(), staticOrder: config.order.slice(), byId: Object.fromEntries(config.byId), exceptions: config.exceptions.size, prefixRules: config.prefixRules.length, cacheSeconds: CACHE_SECONDS });
  jump.status = () => {
    const missing = jump.missing();
    return {
      enabled: true,
      sourcesPath: resolved.source,
      order: effectiveOrder(),
      staticOrder: config.order.slice(),
      sources: config.order.map((id) => ({ id, base: config.byId.get(id) })),
      cacheSeconds: CACHE_SECONDS,
      jumps,
      misses,
      health: jump.health(),
      exists: jump.exists(),
      probe: { ...speedProbe.state(), leads: LEADS },
      missing: missing.slice(0, 50),
      missingTotal: missing.length,
    };
  };
  jump.stop = () => { healthTimer && clearInterval(healthTimer); snapshotTimer && clearInterval(snapshotTimer); speedProbe.stop(); };
  return jump;
}
