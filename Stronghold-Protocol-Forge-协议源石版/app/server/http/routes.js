// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD`, unless a lane claimed that method for that path;
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, sockets, sessions,
//     rooms, matches), never cached;
//   * GET /api/rooms → 公开房间数，**一个整数，不是列表**（见下「房间目录」）；
//   * GET /api/records/<CODE> → the latest finished match of that 4-letter room code;
//   * GET /api/records/account/<NAME> → that account's OWN row from its latest finished match (name → playerId → row);
//     404 when the server runs without accounts (`SP_ACCOUNTS` unset) — an absent feature, not an empty one;
//   * a path inside a host-registered request lane (DESIGN §28.45, httpLanes.js) → that lane, for a method the lane
//     claimed. No lanes (the default, and the only thing a plain `npm start` has) ⇒ every rule below is exactly as it
//     was: any method but GET / HEAD 405, everything else the static files;
//   * everything else → the static files (static.js).
// A route that throws is logged and answers 500.
//
// ## What these two routes are allowed to say (业主裁令)
// **Both are read-only and unauthenticated**, and neither reveals more than the caller already proved it knows:
//
//   * `/api/records/<CODE>` — the PUBLIC view: per player, a seat number and whether it is the caller's own seat.
//     Nicknames, bond layers and the per-round purchase ledger are **not** here. The room code is therefore *not* a
//     secret and this file does not pretend it is: anyone who knows 4 letters gets 4 seat numbers.
//   * `/api/records/account/<NAME>` — **only the named account's own row**, never a teammate's nickname and never the
//     purchase ledger (server/matchRecords.js `ownAccountSummary`). The account name is the queried key, so this
//     endpoint is deliberately **narrower than the owner's own view**: the full ledger for yourself arrives over the
//     authenticated `records.mine` message, not here.
//
// Both are rate-limited per remote address (below), and the account name is matched through the SAME key as login —
// NFC-normalised, lower-cased, **exact** — so there is no prefix or fuzzy search to walk a name space with. An unknown
// account and a known account with no finished match answer **identically** (404 + the same body): telling those two
// apart would make this endpoint an account-existence probe.
//
// ## There is deliberately no write route
// The submission that proposed this feature shipped `POST /api/account/password` guarded by a shared `SP_ADMIN_TOKEN`.
// That route is **not implemented here**: a site-wide admin secret shared with a chat bot is not a player's password,
// and "change a password knowing only the account name" would make the old password decorative. Password changes are
// an operator action on the account file until a per-account reset-ticket design exists (docs/RECORDS.md §5).

// ## 房间目录（公开面）：只报数，不枚举（业主裁令）
// 这一格来自投稿 7ca51de6f346「服务器房间目录与活跃人数」的**收窄**。原投稿要的是 C2S `room.list` + `user.activity`
// 与 S2C `room.list`：整张房间列表，含**房号、房主代号、真人与 AI 人数、在线及近期操作人数、招募状态**，以及加入 /
// 观战入口。**那个形状本批不采纳** —— 它必须先有一整套「公开 / 私有」的房间属性（`room.setInviteOnly`）、一个
// 网络心跳口径（`lastInputAt`）和一套限流，而且会把 4 字母房号变成可枚举的东西（房号进列表就等于公开）。
//
// 业主裁令把它收窄成**一个数**：「我们做成不枚举所有全服房间，我们枚举公开房间数，管理员可以查看所有房间数，
// 这样就行了」。所以公开面**只有** `publicRooms` 一个整数字段，**永远**不回答房号、房主名、人数或任何明细：
// 任何一个这样的字段都能把「数」变成对某一个房间的**侧写**。
//
// 维护口径（`Lobby.roomCounts`）：**今天** `publicRooms` 与 `/healthz` 的 `rooms` **恒等**，因为引擎今天**没有**
// 「公开 / 私有」这个属性（`inviteOnly` 不存在，本批**不预埋**）。「公开房间数」因此暂时就是「房间数」——
// 如实返回同一个计数，而不是假装有一个筛选。solo 房算数（与 `stats().rooms` 同口径）。`inviteOnly` 落地后，
// 改 `Lobby.roomCounts` 一处即可。
//
// **管理员面不在这里**：`/healthz` 的 `rooms` **就是**「全部房间数」（运维口径），无需新端点、无需任何令牌。
// 本批**不引入** `SP_ADMIN_TOKEN` 这类共享管理员秘密（见 routes.js 头部对投稿 `POST /api/account/password` 的
// 拒绝理由，那是同一个东西）。
//
// **本刀不动协议面**：`shared/protocol.js` 的 C2S / S2C 一字不改，`server/net.js` 的 `HEAVY_TYPES` 不加任何东西
// （尤其**不引入** `ACTIVITY_TYPES` / `user.activity` / `lastInputAt`），`PROTOCOL_VERSION` / `MOD_API_VERSION`
// 不抬。将来的 `room.list` 若真要做，HTTP 面与协议面互不干扰。

import { existsSync } from 'node:fs';
import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { buildTag } from './buildTag.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl, readJsonBody } from './common.js';
import { MODS_CATALOG_URL } from './mods.js';
import { VIEW } from '../matchRecords.js';
import { TokenBucket } from '../net.js';
import { clientAddress, isLocalIp } from '../net.js';
import { validateHttpLanes, resolveHttpLane } from './httpLanes.js';
import { ANNOUNCE_MAX_LEN } from '../../shared/announce.js';
// The player-feedback body cap (server/feedback.js). The ported POST /api/feedback uses the store's own limit rather
// than a second constant, so the wire cap and the store's cap can never drift apart.
import { BODY_MAX } from '../feedback.js';

const MAX_URL_LENGTH = 4096;

// =====================================================================================================================
// 管理后台 (the operator console) — 协议源石版 port.
//
// PORT NOTE: the upstream tree this was ported from routes its whole admin surface here. THIS tree had none of it: no
// /api/admin/* route, no public/admin/ panel and — deliberately — no site-wide admin secret (the header above records
// the ruling that a shared secret with a chat bot is not a player's password). Porting the panel means adopting that
// surface, so the security posture is the upstream one and unchanged: the token comes from ADMIN_SECRET only, there is
// no code default, and with no secret every /api/admin/* path answers 404 rather than 401 — a stock deployment has no
// console for a scanner to find.
//
// The method gate below is what keeps this surface from widening access: only 公告 / 更新公告 / 封禁 / 人数上限 / 删除
// 反馈 take POST, and each of those is drawn as narrowly as its feature allows (server/admin.js carries the detail).
// =====================================================================================================================

/** The admin paths answered by GET / HEAD. Anything else under /api/admin/ is a 404. */
const ADMIN_PATHS = new Set(['/api/admin/overview', '/api/admin/rooms', '/api/admin/logs', '/api/admin/feedback', '/api/admin/announcements', '/api/admin/notes', '/api/admin/bans', '/api/admin/slots', '/api/admin/limits']);

/** POST /api/admin/announce — publish the 全体公告 (shared/announce.js) to every connected session. */
const ADMIN_ANNOUNCE_PATH = '/api/admin/announce';
const ADMIN_ANNOUNCE_WITHDRAW_PATH = '/api/admin/announce/withdraw';
/** The 更新公告 writes: save the live revision, or clear it (the built-in copy applies again). */
const ADMIN_NOTES_PATH = '/api/admin/notes';
const ADMIN_NOTES_CLEAR_PATH = '/api/admin/notes/clear';
/**
 * The 封禁 writes: add one address/CIDR, or lift one (server/bans.js). Narrow in the same way the announcement is —
 * no room, no match and no seat is touched — but unlike it, a ban also closes the sockets the address already holds
 * (network.dropBanned), which is the whole point of the action.
 */
const ADMIN_BANS_PATH = '/api/admin/bans';
const ADMIN_BANS_REMOVE_PATH = '/api/admin/bans/remove';
/**
 * The 服务器人数上限 writes (server/limits.js + server/limitsStore.js). This is the one admin write that does NOT
 * reach a player's screen: it only lowers or raises the ceiling `net.js admission()` compares new sockets against.
 * Nothing is disconnected when it goes down — the count drifts down as people leave.
 */
const ADMIN_LIMITS_PATH = '/api/admin/limits';
/** Removing ONE player report (server/feedback.js `remove`): an operator action, as narrow as it can be. */
const ADMIN_FEEDBACK_REMOVE_PATH = '/api/admin/feedback/remove';
const ADMIN_FEEDBACK_BODY_MAX = 4 * 1024;
/** Cap of the limits request body: `{ "maxConnections": 400 }` and nothing else. */
const ADMIN_LIMITS_BODY_MAX = 1024;
/** Cap of the announcement request body (the text itself is capped at ANNOUNCE_MAX_LEN characters). */
const ANNOUNCE_BODY_MAX = 8 * 1024;
/** Cap of a notes save: one free-form text capped at NOTES_LIMITS.text, refused before it is parsed. */
const NOTES_BODY_MAX = 64 * 1024;
/** Cap of a ban request body: a rule, a short note and a duration. */
const BAN_BODY_MAX = 8 * 1024;
/**
 * `GET /api/notes` — the live 更新公告 every client reads at boot. Public and unauthenticated on purpose: the notes
 * are shown to every player, so gating the read would only add a round trip and a way to break the panel. It carries no
 * secret — just the document an operator wrote, which the whole server displays.
 */
const NOTES_PATH = '/api/notes';
/** 账号名按**码点**算长度（`[...s].length`），与昵称那条 `NAME_MAX_LEN` 是同一条思路；这里只防一条超长 URL。 */
const ACCOUNT_NAME_MAX = 64;
const ACCOUNT_PATH_RE = /^\/api\/records\/account\/([^/]{1,256})$/;
/**
 * 房间号：`server/lobby.js` 的 `CODE_ALPHABET`（无 I / O）**只生成大写**，所以这里大小写不敏感地**归一到大写**再查
 * —— 手打小写的人不该得到一个「没有这个房间」的空答复，而 `latestRoom` 也只认大写。
 */
const ROOM_CODE_PATH_RE = /^\/api\/records\/([A-HJ-NP-Za-hj-np-z]{4})$/;
/**
 * 这两条只读路由的限流：**每客户端地址**一只桶，照 `server/net.js` 的既有做法（`TokenBucket`）。
 *
 * 为什么 HTTP 面也要限流：`server/net.js` 的桶只保护 WebSocket 帧，而这两条路由**不需要会话**就能打 —— 没有桶
 * 的话，一个循环就能把服务端拖进「每次请求都遍历索引 + 序列化一份记录」里，而 `/account/<NAME>` 还会被拿来
 * **枚举账号名**。1/s 重填 + 10 突发对「人点按钮」绰绰有余（客户端一条 `records.mine` 走 WebSocket，根本不碰
 * 这两条），对扫名字则很紧。
 *
 * **已知边界**（明写，不假装）：键取 `req.socket.remoteAddress`。直接暴露在公网时它不可伪造；但若前面挂了反向
 * 代理且没在代理侧限流，所有人会共用一个地址、共享同一只桶（宁可漏限流也不按可伪造的 `X-Forwarded-For` 分桶
 * —— 后者会让攻击者换一个头就重置额度）。运维文档里要写「代理后面请自行限流」。
 */
const RECORDS_RATE_PER_SEC = 1;
const RECORDS_RATE_BURST = 10;
/** 空闲多久回收一只桶（与 `net.js` sweep 同一条思路：不做的话这张表本身会随着见过的地址一直长）。 */
const RECORDS_BUCKET_IDLE_MS = 10 * 60_000;

/** 公开房间数的**唯一**路径（一个数，不是列表）。见文件头「房间目录（公开面）」。 */
export const PUBLIC_ROOMS_URL = '/api/rooms';

/**
 * The GET /healthz body.
 *
 * `modHealth`（可选）是包的服务端模块贡献的字段（DESIGN §28.14）：一个**函数**（每次请求现算，因为那三件要报的是
 * 内存 / 循环延迟 / 归档标签这类实时值）或一个现成的对象。返回空对象时**不加这个键** —— 干净安装的 `/healthz`
 * 与从前逐字节相同。**包的摘要**已经在 `lobby.stats()` 里（`mods` / `modPacks`，DESIGN §28.9 第 2 项），所以这里
 * 不重复放一份。
 *
 * `withTraffic`（`?traffic=1`，只对 loopback / 内网客户端）加上流量计数与内容哈希索引的状态（traffic.js /
 * assetIndex.js / assetViews.js）。
 * @param {{ startedAt: number, network: import('../net.js').Network, registry: import('../net.js').SessionRegistry,
 *           lobby: import('../lobby.js').Lobby, modHealth?: (() => Record<string, any>)|null,
 *           traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter>,
 *           assetIndex?: ReturnType<typeof import('./assetIndex.js').createAssetIndex> | null,
 *           views?: ReturnType<typeof import('./assetViews.js').createManifestViews> | null }} health
 * @param {boolean} [withTraffic]
 */
/** `{ plugins: n }` when the server has n > 0 unofficial plugins (the lobby's visual sets count them), else nothing. */
function pluginCount(lobby) {
  let n;
  try { n = Number(lobby?.plugins?.unofficial?.()) || 0; } catch { n = 0; }
  return n > 0 ? { plugins: n } : {};
}

/** The content sets with gameplay plugins rooms hold now (DESIGN **§34.6**，上游原文 `§32.6`; 0 without any). */
function contentSets(lobby) {
  try { return Number(lobby?.plugins?.contentInUse?.()) || 0; } catch { return 0; }
}

/**
 * **D19（取并集）**：上游的 `content` / `trusted` 照加法接；**我们的 `modHealth` 保留**。
 */
export function healthReport({ startedAt, network, registry, lobby, modHealth = null, content = null, traffic, assetIndex, views, trusted }, withTraffic = false) {
  /** @type {Record<string, any>} */
  const out = {
    ok: true, version: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    // the runtime the server is serving right now (public/js/ui/buildGuard.js): a page whose own build is
    // older than this reloads itself, so a deploy reaches clients that never reload
    build: buildTag(),
    // what its rooms play (DESIGN **§34**，上游原文 `§32`): the vanilla content hash, and how many content sets with
    // gameplay plugins rooms hold now (P1c, §34.6 — a room's cosmetic plugins leave its cs the vanilla one); how many
    // unofficial plugins it has, when it has some (a page's title screen says so; P1a)
    ...(content ? { content: { vanilla: content.cs, sets: contentSets(lobby), ...pluginCount(lobby) } } : {}),
    sockets: network.connectionCount, sessions: registry.size,
    // 连接上限（owner 2026-10-18）：被挡在门外的新页面读 /healthz 的这两格来区分「服务器满」与「网络断了」；
    // 没设上限时是 null。和 sockets 一起只在 /healthz 上出现，不改任何协议帧。
    maxConnections: network.maxConnectionCap ?? null,
    ...lobby.stats(),
  };
  let fields = null;
  try {
    fields = typeof modHealth === 'function' ? modHealth() : modHealth;
  } catch {
    fields = null; // 一个包的 healthz 回调炸了不该让运维拿不到 /healthz
  }
  if (fields && typeof fields === 'object' && Object.keys(fields).length) out.modHealth = fields;
  if (trusted && Object.keys(trusted).length) out.plugins = trusted;
  if (withTraffic && traffic) out.traffic = traffic.snapshot();
  // content-hashed asset URLs (assetIndex.js / assetViews.js): off, building, or ready with how many files and URLs
  if (withTraffic) out.assetHashes = assetIndex ? { ...assetIndex.stats(), views: views ? views.stats() : null } : null;
  return out;
}

/** Does the query ask for the traffic counters (`traffic`, `traffic=1`, `traffic=true`)? */
const wantsTraffic = (query) => /(?:^|&)traffic(?:=(?:1|true|yes))?(?:&|$)/i.test(query || '');

/**
 * The request listener for `http.createServer`.
 * @param {{ serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string, query: string) => Promise<void>,
 *           health: Parameters<typeof healthReport>[0], log: object,
 *           records?: import('../matchRecords.js').MatchRecords|null,
 *           accounts?: import('../accounts.js').AccountStore|null,
 *           modsCatalog?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean,
 *           httpLanes?: readonly import('./httpLanes.js').HttpLane[], publicDir?: string,
 *           trustProxy?: 'auto' | boolean }} deps
 *   trustProxy: whose forwarding headers name the client (net.js clientAddress; the server's TRUST_PROXY)
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({
  serveStatic, health, log, records = null, accounts = null, modsCatalog, httpLanes, publicDir, trustProxy = 'auto',
  studio = null, csp = null, trustedRuntime = null,
  // 协议源石版 port: the operator console's collaborators. Every one of them defaults to null, so an install with no
  // ADMIN_SECRET behaves exactly as before the port: `admin.enabled` is false and every /api/admin/* path answers 404.
  admin = null, feedback = null, notes = null, bans = null,
}) {
  /** @type {Map<string, TokenBucket>} 客户端地址 → 只读战绩路由的桶（见文件头那条「已知边界」） */
  const recordBuckets = new Map();

  /**
   * 这两条只读路由的准入。true = 放行。超限回 429（带 `Retry-After`），而不是静默降级成空结果 —— 客户端/机器人
   * 要能分辨「限流了」与「没有这条记录」。
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  function admitRecordRead(req, res) {
    const key = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
    const now = Date.now();
    let bucket = recordBuckets.get(key);
    if (!bucket) { bucket = new TokenBucket(RECORDS_RATE_PER_SEC, RECORDS_RATE_BURST, now); recordBuckets.set(key, bucket); }
    if (bucket.take(now)) {
      // 顺手回收空闲桶（这张表本身也该有界）；只在放行路径上扫，代价摊在正常请求里。
      if (recordBuckets.size > 1) {
        for (const [other, b] of recordBuckets) if (other !== key && now - b.at > RECORDS_BUCKET_IDLE_MS) recordBuckets.delete(other);
      }
      return true;
    }
    res.setHeader('Retry-After', '1');
    sendJson(req, res, 429, { error: 'RATE' });
    return false;
  }
  // A bad table fails at boot, naming every problem — same ruling as the upgrade table (§28.44), same reason: a lane
  // that silently never answers is worse than a server that refuses to start.
  const table = validateHttpLanes(httpLanes ?? [], { publicDir, existsSync });
  if (table.problems.length) throw new Error(`bad http lane table: ${table.problems.join('; ')}`);
  if (table.lanes.length) log.info(`[http] lanes: ${table.lanes.map((l) => l.prefix + l.methods.join('|')).join(', ')}`);

  async function handleRequest(req, res) {
    const url = req.url || '/';
    // The ban gate is FIRST, and covers every path below it: the cheapest possible answer to a source the operator has
    // refused, and the one place a future route cannot forget to check. `stored` (not `size`) is the fast path — with
    // an empty list nothing can match, so a deployment that bans nobody does not pay the client-address resolution on
    // every static asset. 协议源石版 port: the 封禁 feature's HTTP half (server/bans.js), wired from server/index.js.
    if (bans && bans.stored > 0) {
      let ip = '';
      try { ip = clientAddress(req, trustProxy).ip; } catch { /* an unresolvable peer has no address to check */ }
      const hit = ip ? bans.isBanned(ip) : null;
      if (hit) {
        log.warn?.(`[http] refused banned address ${ip}${hit.reason ? ` (${hit.reason})` : ''}`);
        sendError(req, res, 403, '此地址已被服务器封禁 · This address is banned from this server');
        return;
      }
    }
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    // 受信任插件的精确路径（server/plugins/trustedApi.js，上游 §34.13）：只接 /x/<id>/…，不传活请求/套接字
    if (trustedRuntime && parts.rawPath.startsWith('/x/') && await trustedRuntime.route(req, res, parts.rawPath)) return;
    // 插件工作台（server/studio/index.js）：只给本机与局域网；其他客户端走 404 页
    if (studio && studio.handles(parts.rawPath)) { await studio.handle(req, res, parts.rawPath, parts.query); return; }
    // A lane is asked before anything else, because it is the only rule here that knows about methods the game does
    // not serve (POST). It cannot reach the engine's own paths: `validateHttpLanes` refuses any prefix that overlaps
    // them, including `/healthz` and the catalogue, so the order below is untouched for every request a lane does not
    // claim — including a POST to `/healthz`, which stays the 405 it always was.
    const lane = resolveHttpLane(req.method || 'GET', parts.rawPath, table.lanes);
    if (lane) {
      try {
        await lane.onRequest(req, res, { rawPath: parts.rawPath, query: parts.query, log, lane });
      } catch (e) {
        // Named, and never a fall-through into the game's static space: a half-written lane response stays half-written.
        log.error(`[http] lane ${lane.id} failed`, e);
        if (!res.headersSent) sendError(req, res, 500, '玩法服务出错 · Mode error');
      }
      return;
    }
    // 问题反馈 is the other mutating route, so it is checked before the GET/HEAD-only gate below.
    if (parts.rawPath === '/api/feedback') {
      await handleFeedback(req, res);
      return;
    }
    // The admin API is checked BEFORE the method gate too, and for a second reason beyond POST: an unknown admin path
    // must answer 404 here rather than fall through to the static handler, whose 404 would come only by luck (and a
    // future public file named like an admin path would then be served to an unauthenticated caller).
    if (parts.rawPath.startsWith('/api/admin/')) {
      await handleAdmin(req, res, parts);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    // The live 更新公告 every client reads at boot. Public on purpose: every player is shown it.
    if (parts.rawPath === NOTES_PATH) {
      const doc = notes?.read?.() ?? null;
      sendJson(req, res, 200, {
        ok: true,
        notes: doc ? doc.notes : null,
        at: doc ? doc.at : null,
        by: doc ? doc.by : null,
      });
      return;
    }
    if (parts.rawPath === MODS_CATALOG_URL && modsCatalog && modsCatalog(req, res)) return;
    if (parts.rawPath === PUBLIC_ROOMS_URL) {
      // **只有一个整数字段**：加任何一个别的键（房号、房主名、在局中、人数、容量）都是把「数」变成侧写，
      // 那正是这一格被收窄掉的东西。`sendJson` 自带 `Cache-Control: no-store`。
      sendJson(req, res, 200, { publicRooms: health.lobby.roomCounts().publicRooms });
      return;
    }
    // 账号名规则**先**判：它与房间号规则共用 `/api/records/` 前缀，而账号名不一定是 4 个字母。
    // 没有账号的服务器上这里回 404 —— 「功能不存在」与「这个账号没打过」是两件事，不该用同一个码回答。
    const accountPath = ACCOUNT_PATH_RE.exec(parts.rawPath);
    if (accountPath) {
      if (!records || !accounts) { sendJson(req, res, 404, { error: 'NOT_ENABLED' }); return; }
      let name;
      try { name = decodeURIComponent(accountPath[1]); } catch { sendJson(req, res, 400, { error: 'BAD_REQUEST' }); return; }
      // 「这个名字太长」与「没有这个账号」必须同答复：分开就成了存在性/长度探针。
      if ([...name].length > ACCOUNT_NAME_MAX) { sendJson(req, res, 404, { error: 'RECORD_NOT_FOUND' }); return; }
      if (!admitRecordRead(req, res)) return;
      // 形状收窄在 `matchRecords.latestByAccount` 里：只回**被查账号本人**那一行，且不含购卡明细。
      const record = records.latestByAccount(accounts, name);
      res.setHeader('Cache-Control', 'no-store');
      sendJson(req, res, record ? 200 : 404, record || { error: 'RECORD_NOT_FOUND' });
      return;
    }
    const recordPath = ROOM_CODE_PATH_RE.exec(parts.rawPath);
    if (recordPath) {
      if (!records) { sendJson(req, res, 404, { error: 'NOT_ENABLED' }); return; }
      if (!admitRecordRead(req, res)) return;
      const record = records.latestRoom(recordPath[1].toUpperCase(), VIEW.PUBLIC);
      res.setHeader('Cache-Control', 'no-store');
      sendJson(req, res, record ? 200 : 404, record || { error: 'RECORD_NOT_FOUND' });
      return;
    }
    if (parts.rawPath === '/healthz') {
      const withTraffic = wantsTraffic(parts.query) && isLocalIp(clientAddress(req, trustProxy).ip);
      sendJson(req, res, 200, healthReport(health, withTraffic));
      return;
    }
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  // ===================================================================================================================
  // 问题反馈 + 管理后台 handlers — 协议源石版 port
  //
  // PORT NOTE: these are the upstream tree's handlers, taken verbatim except where a dependency differs (see the
  // PORT NOTE comments on the few lines that changed). This tree had NO POST route at all before the port, so
  // readJsonBody (server/http/common.js) came with it.
  // ===================================================================================================================
  /**
   * POST /api/feedback — the player's 问题反馈 (server/feedback.js). No account is involved, so the body is
   * capped, the address is rate limited, and the store only keeps known fields.
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
   */
  async function handleFeedback(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    if (!feedback) {
      sendJson(req, res, 503, { ok: false, error: 'unavailable', message: '反馈功能未启用 · Feedback is not configured' });
      return;
    }
    const body = await readJsonBody(req, BODY_MAX);
    if (!body.ok) {
      if (body.reason === 'too-large') {
        sendJson(req, res, 413, { ok: false, error: body.reason, message: '反馈内容过长 · Feedback too large' });
        return;
      }
      const msg = body.reason === 'empty' ? '内容为空 · Empty body' : '内容不是合法 JSON · Malformed JSON';
      sendJson(req, res, 400, { ok: false, error: body.reason, message: msg });
      return;
    }
    if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
      sendJson(req, res, 400, { ok: false, error: 'bad-body', message: '需要一个 JSON 对象 · Expected a JSON object' });
      return;
    }
    let ip = '?';
    try { ip = clientAddress(req, trustProxy).ip || '?'; } catch { ip = '?'; }
    const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    const r = feedback.submit(body.value, { ip, ua });
    if (r.ok) { sendJson(req, res, 200, { ok: true, id: r.id }); return; }
    if (r.reason === 'rate') {
      sendJson(req, res, 429, { ok: false, error: 'RATE', message: '发送太频繁，请稍后再试 · Too many reports, try again later' });
      return;
    }
    if (r.reason === 'unwritable') {
      sendJson(req, res, 503, { ok: false, error: 'unwritable', message: '反馈暂时无法保存 · Feedback could not be stored' });
      return;
    }
    sendJson(req, res, 400, { ok: false, error: 'empty', message: '请填写说明或附上诊断信息 · Add a description or attach diagnostics' });
  }

  /**
   * The admin API. Reads are GET / HEAD; the mutations are publishing / withdrawing the 全体公告 (shared/announce.js),
   * the 更新公告 writes, 封禁 / 解封 (server/bans.js) and removing one player report (server/feedback.js). A disabled
   * service is indistinguishable from a path that was never routed.
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
   * @param {{ rawPath: string, query: string }} parts
   */
  async function handleAdmin(req, res, parts) {
    // No ADMIN_SECRET → the whole surface is off. 404 before anything else, so a stock deployment neither exposes a
    // console nor tells a scanner that a console could be switched on (the fork answered 401 here).
    if (!admin || !admin.enabled) {
      sendError(req, res, 404, '页面不存在 · Not found', parts.rawPath.length <= 200 ? parts.rawPath : '');
      return;
    }
    const isRead = req.method === 'GET' || req.method === 'HEAD';
    const isAnnounce = req.method === 'POST' && parts.rawPath === ADMIN_ANNOUNCE_PATH;
    const isWithdraw = req.method === 'POST' && parts.rawPath === ADMIN_ANNOUNCE_WITHDRAW_PATH;
    const isNotesSave = req.method === 'POST' && parts.rawPath === ADMIN_NOTES_PATH;
    const isNotesClear = req.method === 'POST' && parts.rawPath === ADMIN_NOTES_CLEAR_PATH;
    const isBanAdd = req.method === 'POST' && parts.rawPath === ADMIN_BANS_PATH;
    const isBanRemove = req.method === 'POST' && parts.rawPath === ADMIN_BANS_REMOVE_PATH;
    const isFeedbackRemove = req.method === 'POST' && parts.rawPath === ADMIN_FEEDBACK_REMOVE_PATH;
    const isLimitsSave = req.method === 'POST' && parts.rawPath === ADMIN_LIMITS_PATH;
    // The method gate, exactly as strict as the rest of the server (405 + `Allow: GET, HEAD`). It runs before the path
    // and the token, so a mutating verb is refused on its own: PUT / DELETE can never reach a view, and its answer does
    // not depend on (or reveal) the caller's token. POST is admitted for exactly the announcement, notes, ban and
    // feedback-removal paths and is a 405 everywhere else, including every other /api/admin/ path.
    if (!isRead && !isAnnounce && !isWithdraw && !isNotesSave && !isNotesClear && !isBanAdd && !isBanRemove && !isFeedbackRemove && !isLimitsSave) {
      // Those paths are the only ones that also take POST, so their refusal (a PUT, say) advertises that.
      const writable = [ADMIN_ANNOUNCE_PATH, ADMIN_ANNOUNCE_WITHDRAW_PATH, ADMIN_NOTES_PATH, ADMIN_NOTES_CLEAR_PATH, ADMIN_BANS_PATH, ADMIN_BANS_REMOVE_PATH, ADMIN_FEEDBACK_REMOVE_PATH, ADMIN_LIMITS_PATH];
      res.setHeader('Allow', writable.includes(parts.rawPath) ? 'GET, HEAD, POST' : 'GET, HEAD');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    if (isRead && !ADMIN_PATHS.has(parts.rawPath)) {
      sendError(req, res, 404, '页面不存在 · Not found', parts.rawPath.length <= 200 ? parts.rawPath : '');
      return;
    }
    if (!admin.authenticate(req)) {
      // One flat 401 for "no token", "wrong token" and "locked out" — the lockout is never confirmed to a guesser.
      sendJson(req, res, 401, { ok: false, error: 'Unauthorized' });
      return;
    }
    if (isAnnounce) { await handleAnnounce(req, res); return; }
    if (isWithdraw) { await handleAnnounceWithdraw(req, res); return; }
    if (isNotesSave) { await handleNotesSave(req, res); return; }
    if (isNotesClear) { await handleNotesClear(req, res); return; }
    if (isBanAdd) { await handleBanAdd(req, res); return; }
    if (isBanRemove) { await handleBanRemove(req, res, parts); return; }
    if (isFeedbackRemove) { await handleFeedbackRemove(req, res); return; }
    if (isLimitsSave) { await handleLimitsSave(req, res); return; }
    if (parts.rawPath === '/api/admin/limits') { sendJson(req, res, 200, admin.getLimits()); return; }
    if (parts.rawPath === '/api/admin/overview') { sendJson(req, res, 200, admin.getOverview()); return; }
    if (parts.rawPath === '/api/admin/rooms') { sendJson(req, res, 200, admin.getRooms()); return; }
    if (parts.rawPath === '/api/admin/announcements') { sendJson(req, res, 200, admin.getAnnouncements()); return; }
    if (parts.rawPath === '/api/admin/notes') { sendJson(req, res, 200, admin.getNotes()); return; }
    if (parts.rawPath === '/api/admin/bans') { sendJson(req, res, 200, admin.getBans()); return; }
    if (parts.rawPath === '/api/admin/slots') { sendJson(req, res, 200, await admin.getSlots()); return; }
    if (parts.rawPath === '/api/admin/feedback') {
      const n = Number(new URLSearchParams(parts.query).get('limit'));
      sendJson(req, res, 200, admin.getFeedback(Number.isFinite(n) && n > 0 ? n : 50));
      return;
    }
    const since = Number(new URLSearchParams(parts.query).get('since'));
    sendJson(req, res, 200, admin.getLogs(Number.isFinite(since) ? since : 0));
  }

  /**
   * POST /api/admin/announce { text } — publish a 全体公告 to every connected session (and persist it). The token was
   * already checked by the caller; the body is read with a hard cap and the text is sanitized in
   * AdminService.publishAnnouncement.
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
   */
  async function handleAnnounce(req, res) {
    const body = await readJsonBody(req, ANNOUNCE_BODY_MAX);
    if (!body.ok) {
      const status = body.reason === 'too-large' ? 413 : 400;
      const msg = body.reason === 'too-large' ? '内容过长 · Payload too large'
        : body.reason === 'empty' ? '缺少内容 · Empty body' : '内容不是合法 JSON · Malformed JSON';
      sendJson(req, res, status, { ok: false, error: body.reason, message: msg });
      return;
    }
    const value = body.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      sendJson(req, res, 400, { ok: false, error: 'bad-body', message: '需要一个 JSON 对象 · Expected a JSON object' });
      return;
    }
    const r = admin.publishAnnouncement(value.text);
    if (r.ok) { sendJson(req, res, 200, { ok: true, announcement: r.announcement }); return; }
    if (r.error === 'EMPTY') {
      sendJson(req, res, 400, { ok: false, error: 'EMPTY', message: '公告内容不能为空 · Announcement text is empty' });
      return;
    }
    if (r.error === 'RATE') {
      sendJson(req, res, 429, {
        ok: false, error: 'RATE', retryAfterMs: r.retryAfterMs,
        message: `发布太快，请等 ${Math.ceil((r.retryAfterMs || 0) / 1000)} 秒 · Too fast, retry in ${Math.ceil((r.retryAfterMs || 0) / 1000)}s`,
      });
      return;
    }
    sendJson(req, res, 503, { ok: false, error: r.error, message: '公告功能不可用 · Announcements unavailable' });
  }

  /**
   * POST /api/admin/announce/withdraw — 撤回 the standing 全体公告: every client takes the line down and the stored copy
   * is cleared. Takes no body; not rate limited (removing a notice from every screen is always safe).
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
   */
  async function handleAnnounceWithdraw(req, res) {
    const r = admin.withdrawAnnouncement();
    if (r.ok) { sendJson(req, res, 200, { ok: true, withdrawn: true, delivered: r.delivered }); return; }
    sendJson(req, res, 503, { ok: false, error: r.error, message: '公告功能不可用 · Announcements unavailable' });
  }

  /**
   * POST /api/admin/notes { text } — save the live 更新公告. The token was already checked by the caller; the body is
   * read with a hard cap and the announcement is cleaned and normalized in shared/updateNotes.js before anything is
   * written, so a bad save can never replace a working revision.
   *
   * The body may be `{ text }`, `{ notes: { text } }` or a bare JSON string, so a hand-written curl needs no envelope
   * (the shape is the operator's business, not the wire's — see normalizeNotes).
   *
   * Unlike the 全体公告 there is NO rate limit and NO broadcast: saving changes what the NEXT page load fetches
   * (`GET /api/notes`), it does not push anything to sessions already open. That is deliberate — announcing "the
   * server is going down in 5 minutes" must interrupt; a release note is read on arrival.
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
   */
  async function handleNotesSave(req, res) {
    const body = await readJsonBody(req, NOTES_BODY_MAX);
    if (!body.ok) {
      const status = body.reason === 'too-large' ? 413 : 400;
      const msg = body.reason === 'too-large' ? '内容过长 · Payload too large'
        : body.reason === 'empty' ? '缺少内容 · Empty body' : '内容不是合法 JSON · Malformed JSON';
      sendJson(req, res, status, { ok: false, error: body.reason, message: msg });
      return;
    }
    // Accept a bare string, `{ text }` or `{ notes: … }` — normalizeNotes takes it from there.
    /** @type {unknown} */
    let value = body.value;
    if (value && typeof value === 'object' && !Array.isArray(value) && 'notes' in value) value = /** @type {any} */ (value).notes;
    // Provenance: who saved it (the address, never a name — the panel has no user accounts).
    let by = null;
    try { by = clientAddress(req, trustProxy).ip || null; } catch { by = null; }
    const r = admin.saveNotes(value, { by });
    if (r.ok) {
      sendJson(req, res, 200, {
        ok: true, notes: r.notes, digest: r.digest, at: r.at, by: r.by,
        warnings: r.warnings, unwritable: r.unwritable === true,
      });
      return;
    }
    sendJson(req, res, 400, { ok: false, error: r.error, message: r.message });
  }

  /**
   * POST /api/admin/notes/clear — drop the live revision; every client falls back to the revision built into the
   * bundle. Takes no body and is not rate limited (putting the shipped notes back is always safe).
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
   */
  async function handleNotesClear(req, res) {
    const r = admin.clearNotes();
    if (r.ok) { sendJson(req, res, 200, { ok: true, cleared: true, unwritable: r.unwritable === true }); return; }
    sendJson(req, res, 503, { ok: false, error: r.error, message: '更新公告功能不可用 · Update notes unavailable' });
  }

  /**
   * POST /api/admin/bans { rule, reason?, minutes?, until?, force? } — 封禁一个地址或 CIDR（server/bans.js）。
   *
   * The caller's own address is passed in so the service can refuse to ban the operator out of their own server
   * (`force: true` overrides; DEPLOY.md §8.3 says how to recover if it happens anyway).
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
   */
  async function handleBanAdd(req, res) {
    const body = await readJsonBody(req, BAN_BODY_MAX);
    if (!body.ok) {
      const status = body.reason === 'too-large' ? 413 : 400;
      const msg = body.reason === 'too-large' ? '内容过长 · Payload too large'
        : body.reason === 'empty' ? '缺少内容 · Empty body' : '内容不是合法 JSON · Malformed JSON';
      sendJson(req, res, status, { ok: false, error: body.reason, message: msg });
      return;
    }
    if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
      sendJson(req, res, 400, { ok: false, error: 'bad-body', message: '需要一个 JSON 对象 · Expected a JSON object' });
      return;
    }
    let by = null;
    try { by = clientAddress(req, trustProxy).ip || null; } catch { by = null; }
    const r = admin.addBan(body.value, { by });
    if (r.ok) { sendJson(req, res, 200, { ok: true, ban: r.entry, added: r.added, evicted: r.evicted, size: r.size, persisted: r.persisted, bans: r.bans }); return; }
    const status = r.error === 'TOO_BROAD' || r.error === 'BAD_RULE' ? 400 : r.error === 'DISABLED' ? 503 : 409;
    sendJson(req, res, status, { ok: false, error: r.error, message: r.message, rule: r.rule });
  }

  /**
   * POST /api/admin/bans/remove { rule } — 解封。Takes no body when the rule is in the query string, so a hand-written
   * curl for the common case is `POST …/remove?rule=1.2.3.4`. Not rate limited: lifting a ban is always safe.
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
   * @param {{ rawPath: string, query: string }} parts
   */
  async function handleBanRemove(req, res, parts) {
    const query = new URLSearchParams(parts.query);
    let rule = query.get('rule') || query.get('ip');
    if (!rule) {
      const body = await readJsonBody(req, BAN_BODY_MAX);
      if (body.ok && body.value && typeof body.value === 'object' && !Array.isArray(body.value)) {
        rule = typeof body.value.rule === 'string' ? body.value.rule : (typeof body.value.ip === 'string' ? body.value.ip : null);
      } else if (body.ok && typeof body.value === 'string') {
        rule = body.value;
      }
    }
    if (!rule) { sendJson(req, res, 400, { ok: false, error: 'BAD_RULE', message: '需要 rule · A rule is required' }); return; }
    const r = admin.removeBan(rule);
    if (r.ok) { sendJson(req, res, 200, { ok: true, removed: r.removed, size: r.size, persisted: r.persisted, bans: r.bans }); return; }
    sendJson(req, res, r.error === 'DISABLED' ? 503 : 400, { ok: false, error: r.error, message: r.message });
  }

  /**
   * POST /api/admin/feedback/remove { id } — 永久删除一条玩家反馈 (server/feedback.js `remove`).
   *
   * The id is the only handle the store has (`<epoch36>-<rand>`, written when the report was accepted), so it is what
   * the panel sends back. The body is read with a small hard cap; the deletion itself rewrites that month's jsonl
   * through a temp file, leaving every other line byte-identical.
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
   */
  async function handleFeedbackRemove(req, res) {
    const body = await readJsonBody(req, ADMIN_FEEDBACK_BODY_MAX);
    if (!body.ok) {
      const status = body.reason === 'too-large' ? 413 : 400;
      const msg = body.reason === 'too-large' ? '内容过长 · Payload too large'
        : body.reason === 'empty' ? '缺少内容 · Empty body' : '内容不是合法 JSON · Malformed JSON';
      sendJson(req, res, status, { ok: false, error: body.reason, message: msg });
      return;
    }
    const value = body.value;
    const id = typeof value === 'string' ? value : (value && typeof value === 'object' && !Array.isArray(value) ? value.id : null);
    const r = admin.removeFeedback(id);
    if (r.ok) { sendJson(req, res, 200, { ok: true, removed: true, id: r.id, at: r.at, total: r.total }); return; }
    const status = r.error === 'NOT_FOUND' ? 404 : r.error === 'DISABLED' ? 503 : r.error === 'TOO_LARGE' ? 409 : 400;
    sendJson(req, res, status, { ok: false, error: r.error, message: r.message });
  }

  /**
   * POST /api/admin/limits { maxConnections } — 设置（或清除）服务器人数上限，立即在本进程生效，另一个蓝绿槽在一个
   * 轮询周期内跟上（server/limitsStore.js）。
   *
   * `maxConnections: null` 是「不限制」的写法（清除覆盖，回落到启动参数）。0 **不是**不限制而会是「谁都进不来」——
   * net.js 的判据是 `conns.size >= cap`，而任何计数都 >= 0，所以 0 由 normalizeMaxConnections 挡在下限之外（1）。
   *
   * 调低不会断开任何人（net.js `maxConnectionCap`）：应答里带 `sockets`，让面板能如实说「现在 N 个连接，上限降到
   * M 之后新人进不来，但没人会被踢」。
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
   */
  async function handleLimitsSave(req, res) {
    const body = await readJsonBody(req, ADMIN_LIMITS_BODY_MAX);
    if (!body.ok) {
      const status = body.reason === 'too-large' ? 413 : 400;
      const msg = body.reason === 'too-large' ? '内容过长 · Payload too large'
        : body.reason === 'empty' ? '缺少内容 · Empty body' : '内容不是合法 JSON · Malformed JSON';
      sendJson(req, res, status, { ok: false, error: body.reason, message: msg });
      return;
    }
    if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
      sendJson(req, res, 400, { ok: false, error: 'bad-body', message: '需要一个 JSON 对象 · Expected a JSON object' });
      return;
    }
    let by = null;
    try { by = clientAddress(req, trustProxy).ip || null; } catch { by = null; }
    const r = admin.setLimits(body.value, { by });
    if (r.ok) { sendJson(req, res, 200, r); return; }
    // OUT_OF_RANGE is a 400 (the body is well-formed, the number is not); DISABLED is a 503 like the ban list's.
    sendJson(req, res, r.error === 'DISABLED' ? 503 : 400, { ok: false, error: r.error, message: r.message });
  }

  return (req, res) => {
    setSecurityHeaders(res);
    if (csp) res.setHeader('Content-Security-Policy', csp);
    // 每一条回答的体字节都进流量计数（traffic.js），在**写出任何东西之前**接上 —— 与上游同一条纪律。
    if (health.traffic) health.traffic.meter(res, splitUrl(req.url || '/')?.rawPath || '/');
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  };
}
