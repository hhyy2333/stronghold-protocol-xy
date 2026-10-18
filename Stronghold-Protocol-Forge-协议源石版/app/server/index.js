// server/index.js — process entry & boot (DESIGN §1, §2). Plain node:http + ws, no framework: startServer() below
// wires the modules under server/http/, in this order —
//
//   http/config.js     ROOT, the served directories, the environment (PORT 3000, HOST '::' dual-stack, TRUST_PROXY auto, DEBUG),
//                      which startServer() options go to net.js / lobby.js, the console logger
//   http/websocket.js  session wiring (SessionRegistry → Lobby → Network) and the WebSocket at /ws (maxPayload 64 KB;
//                      refused at upgrade with 404 / 429 per network / 503)
//   http/static.js     the static mounts (/ → public/, /data/, /shared/, /sim/ `.js` only), the /data.js browser stand-in,
//                      the language packs (/packs/index.json, /packs/<id>/<file>) and the plugin catalogue
//                      (/plugins/index.json — the registry is plugins/registry.js), the vanilla content set's manifest
//                      (/cs/<cs16>/index.json — plugins/identity.js), the visual sets of cosmetic plugins
//                      (/vs/<vs16>/…, plugins/visualSet.js), their files (/p/<id>/<hash8>/…) and the content sets of
//                      gameplay plugins (/cs/<cs16>/…, plugins/contentSets.js)
//   http/csp.js        the site CSP of the served pages (SP_CSP=off leaves it out; routes.js)
//   http/media.js      /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 (audio addressed without its extension)
//   http/files.js      one file → response: MIME, brotli / gzip + memory cache, ETag / Last-Modified / 304, Cache-Control, ranges
//   http/assetIndex.js the content hashes of public/assets and public/fonts (built in the background, cached in
//                      .cache/asset-hashes.json by path + size + mtime; Spine models share one hash)
//   http/assetViews.js the served /data/assets.json and /data/local-assets.json: every art URL with its hash segment
//                      (/assets/~<hash>/…, immutable when the hash matches); the committed files stay unchanged
//   http/buildTag.js   the build tag of the served browser runtime (/healthz `build`, public/js/ui/buildGuard.js)
//   http/routes.js     the request listener: security headers, 414 / 400, the plugin studio (/studio/, studio/index.js —
//                      this machine and the local network only), 405, GET /healthz → JSON status, else static
//   http/traffic.js    the traffic counters: bytes sent per category (assets / audio / code / data) and on the
//                      WebSocket, since the start (GET /healthz?traffic=1)
//   http/common.js     what every answer shares: security headers, URL split, error page, JSON replies, bare 400
//   http/boot.js       a pending update package first (update.js: old files deleted, the install verified against
//                      MANIFEST.json), banner (Local / LAN / tunnel URLs), port-in-use hint, graceful shutdown on SIGINT /
//                      SIGTERM
//
// Per-network limits for internet clients (see net.js clientAddress; local/LAN peers are exempt): open sockets
// (maxConnectionsPerAddr, refused at upgrade with 429), rooms and running matches (lobby.js).
//
// Programmatic use (tests): `const srv = await startServer({ port: 0, quiet: true }); … await srv.close();`
// The server only auto-listens when this file is the process entry point.

import http from 'node:http';
import path from 'node:path';
import { getData, loadData } from './data.js';
import { loadWorkshop, loadWorkshopKits, loadWorkshopHooks, loadWorkshopPanels, workshopThemeFor, dropUnavailablePreDispatchPacks, adjudicatePackGraph, WORKSHOP_DIR } from './workshop.js';
import { readModRegistry, applyModRegistry } from './modRegistry.js';
import { loadMetaModules } from './match/metaPack.js';
import { loadBattleInstallers } from './battlePack.js';
import { loadRoomInstallers } from './roomPack.js';
import { loadServerModules, mountServerModules, stateRootFor, bootConfigSnapshot } from './modModules.js';
import { materializeVoiceCdn, dropFailedVoiceCdnFiles } from './voiceCdn.js';
import { workshopNotices } from './notices.js';
import { createRoomAssets } from './roomAssets.js';
import { Match as DefaultMatch } from './match/Match.js';
import {
  buildWorkshopDataFiles, workshopKitFilesFor, workshopKitDirsFor, workshopPanelFilesFor, workshopAssetsFor, workshopRoutesFor,
  workshopResourceFilesFor, workshopModAssetsFrom, buildWorkshopI18nFiles, resourceServerPolicy, WORKSHOP_ASSET_PREFIX, WORKSHOP_ASSET_TYPES, workshopBattleFilesFor,
} from './http/workshop.js';
import { ROOT, listenAddress, bindCandidates, serveDirs, makeLogger, parseTrustProxy, assetIndexOptionsFrom } from './http/config.js';
import { WS_MAX_PAYLOAD, createSessionStack, attachWebSocket, transportPolicy } from './http/websocket.js';
import { DATA_SHIM_JS, createStaticHandler } from './http/static.js';
import { createPackRegistry } from './packs.js';
// 0.3.0（上游 DESIGN §34）的插件面：包注册表并进插件注册表（`server/packs.js` 现在只是它的别名再导出），
// 加原生内容集、视觉集、仅服务端生效的插件策略 / 房间集合、以及「一局一进程」的对局宿主与可信脚本运行器。
import { createPluginRegistry } from './plugins/registry.js';
import { computeVanillaContent } from './plugins/identity.js';
import { createVisualSets } from './plugins/visualSet.js';
import { createContentSets } from './plugins/contentSets.js';
import { createPluginPolicy } from './plugins/policy.js';
import { createRoomSets } from './plugins/roomSets.js';
import { createMatchHosts } from './match/host/index.js';
import { createTrustedRuntime } from './plugins/trustedRuntime.js';
import { trustedHostAllowed } from './plugins/trusted.js';
import { createStudio } from './studio/index.js';
import { siteCsp } from './http/csp.js';
import { MIME, COMPRESSIBLE, acceptsGzip, pickEncoding, parseRange } from './http/files.js';
import { BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag } from './http/buildTag.js';
import { createRequestHandler } from './http/routes.js';
import { createTrafficCounter } from './http/traffic.js';
import { createAssetIndex } from './http/assetIndex.js';
import { createManifestViews } from './http/assetViews.js';
import { AccountStore } from './accounts.js';
import { MatchRecords } from './matchRecords.js';
import { resolveAccountConfig } from './accountConfig.js';
// 保留表只此一处真相（DESIGN §28.35）：核心挂载目录与「核心先吃」判据都来自 routeMount.js。
import { coreMounts } from './http/routeMount.js';
import { createModsRoute, serveMods, MODS_CATALOG_URL, MOD_FILE_PREFIX } from './http/mods.js';
import { buildModCatalog } from './modCatalog.js';
import { answerClientError } from './http/common.js';
import { lanUrls, displayHost, isProcessEntry, runMain } from './http/boot.js';
// 管理后台 (the operator console) — 协议源石版 port. Each module is self-contained; none of them is reachable unless
// ADMIN_SECRET is set, because AdminService.enabled is false without a secret and routes.js then answers 404 for the
// whole /api/admin/* surface. Everything below is wired exactly as the upstream tree wires it.
import { AdminService, recordAdminLog } from './admin.js';
import { createFeedbackStore } from './feedback.js';
import { createAnnounceStore, ANNOUNCE_POLL_MS } from './announceStore.js';
import { createNotesStore } from './notesStore.js';
import { createBanStore, BAN_POLL_MS } from './banStore.js';
import { createLimitsStore, LIMITS_POLL_MS } from './limitsStore.js';
import { BanList } from './bans.js';
import { LiveLimits } from './limits.js';
import { createSlotProbe, slotFromEnv } from './peer.js';

/**
 * Wrap a logger so every line also lands in the admin log ring (server/admin.js) — the panel's live console shows the
 * server's own output this way.
 *
 * PORT NOTE (协议源石版): the upstream tree wraps its logger here; this tree called makeLogger directly, so the
 * panel's 日志 section would have shown only lines the admin API itself recorded (announcements, bans) and none of the
 * server's own startup / match output. The wrapper is a NEW object: the shared noopLog (http/config.js) and a
 * caller-supplied logger are never mutated (wrapping in place would nest the wrapper on every startServer of one
 * process). `debug` is forwarded console-only, so the panel shows info / warn / error.
 * @param {{ info?: Function, warn?: Function, error?: Function, debug?: Function }} base
 */
function teeLog(base) {
  const wrap = (level, fn) => (...args) => {
    // A logger is called from request paths: recording must never throw one of them off.
    try { recordAdminLog(level, args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ')); } catch { /* ignore */ }
    return fn?.(...args);
  };
  return {
    info: wrap('info', base.info?.bind(base)),
    warn: wrap('warn', base.warn?.bind(base)),
    error: wrap('error', base.error?.bind(base)),
    debug: (...args) => base.debug?.(...args),
  };
}

// The public API of this module (tests and tools import it from here); the code lives in ./http/.
export {
  ROOT, WS_MAX_PAYLOAD, DATA_SHIM_JS, MIME, COMPRESSIBLE, BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag,
  acceptsGzip, pickEncoding, parseRange, createStaticHandler, lanUrls, parseTrustProxy,
  // 创意工坊 (docs/WORKSHOP.md): the HTTP helpers live in ./http/workshop.js but stay part of this module's API
  buildWorkshopDataFiles, workshopKitFilesFor, workshopKitDirsFor, workshopPanelFilesFor, workshopAssetsFor, workshopRoutesFor,
  workshopResourceFilesFor, workshopModAssetsFrom, buildWorkshopI18nFiles, resourceServerPolicy, WORKSHOP_ASSET_PREFIX, WORKSHOP_ASSET_TYPES,
  workshopBattleFilesFor,
  // 客户端 mod 本地缓存 (W-C): the catalogue builder and the routes a browser downloads from (server/modCatalog.js,
  // server/http/mods.js) — exported here so tests reach them the way they reach the workshop helpers above.
  buildModCatalog, createModsRoute, serveMods, MODS_CATALOG_URL, MOD_FILE_PREFIX,
};

/**
 * Build and start the HTTP + WebSocket server.
 * @param {{
 *   port?: number, host?: string, quiet?: boolean, log?: object,
 *   publicDir?: string, dataDir?: string, sharedDir?: string, packsDir?: string,
 *   MatchClass?: Function, seedFn?: () => number,
 *   lobbyGraceMs?: number, reconnectWindowMs?: number, heartbeatMs?: number, helloTimeoutMs?: number,
 *   ratePerSec?: number, rateBurst?: number, maxConnections?: number, maxRooms?: number,
 *   maxConnectionsPerAddr?: number, maxRoomsPerAddr?: number, maxMatchesPerAddr?: number, resyncMinGapMs?: number,
 *   heavyPerSec?: number, heavyBurst?: number, trustProxy?: 'auto' | boolean,
 *   accounts?: boolean, accountsFile?: string, recordsFile?: string,
 *   wsLanes?: readonly import('./http/wsLanes.js').WsLane[],
 *   httpLanes?: readonly import('./http/httpLanes.js').HttpLane[],
 *   assetIndex?: boolean | { cacheFile?: string | null, delayMs?: number },
 * }} [opts]
 *   assetIndex: the content-hash index (default on; false or SP_ASSET_INDEX=0: off — config.js assetIndexOptionsFrom)
 * @returns {Promise<{ port: number, host: string, url: string, server: http.Server, wss: import('ws').WebSocketServer,
 *                     lobby: import('./lobby.js').Lobby, network: import('./net.js').Network,
 *                     registry: import('./net.js').SessionRegistry, packs: ReturnType<typeof createPackRegistry>,
 *                     accounts: import('./accounts.js').AccountStore|null,
 *                     records: import('./matchRecords.js').MatchRecords|null,
 *                     traffic: ReturnType<typeof createTrafficCounter>,
 *                     assetIndex: ReturnType<typeof createAssetIndex> | null,
 *                     views: ReturnType<typeof createManifestViews> | null,
 *                     close: () => Promise<void> }>}
 */
export async function startServer(opts = {}) {
  const { port, host } = listenAddress(opts);
  // Every line the server logs also lands in the admin log ring, so the panel's 日志 section shows the server's own
  // output rather than only what the admin API recorded itself (协议源石版 port; see teeLog above).
  const log = teeLog(opts.log || makeLogger(!!opts.quiet));
  const { publicDir, dataDir, sharedDir, packsDir, pluginsDir } = serveDirs(opts);
  // `createStaticHandler` 的 `/sim/` 默认值，这里显式取同一个 —— 「核心先吃」要看到引擎真正会读的那个目录。
  const simDir = opts.simDir || path.join(ROOT, 'server', 'sim');

  // 原生内容哈希 `cs`（DESIGN §34，上游 0.3.0）：**现在**把服务出去的那份 sim / shared 代码与游戏数据读一次算出
  // 摘要 —— 与对局用的数据、下面的构建标记同一条纪律（一次读、之后引用同一个值）。它进 /plugins/index.json 与
  // /cs/<cs16>/index.json，也交给 Lobby 作为「这一局的底座」。
  const content = computeVanillaContent({ simDir, sharedDir, dataDir, shim: DATA_SHIM_JS, log });
  log.info(`[content] vanilla ${content.cs.slice(0, 16)} (${Object.keys(content.simFiles).length} code files, ${Object.keys(content.data).length} data files)`);
  // 语言包与插件（docs/PACKS.md · docs/PLUGINS.md）：启动时扫一次（启动日志点名），之后文件夹一变再扫。
  // 缺省就是上游的 createPluginRegistry —— `server/packs.js` 现在只是它的别名再导出，registry.index() / servable()
  // 的语义与 0.2.x 逐字相同，所以工坊那一整层读它读到的还是同一份东西。
  const scriptMode = process.env.SP_PLUGIN_SCRIPTS;
  const packs = createPluginRegistry({ publicDir, dataDir, packsDir, pluginsDir }, { log, scriptHost: host, scriptMode });
  packs.refresh(true);

  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy. The 创意工坊 overlay
  // is applied inside the loader (server/data.js), i.e. whichever way the data is obtained, it is already merged.
  // SP_WORKSHOP (editor/playtest.mjs) lets the Forge editor's 试玩 subprocess read the workshop root the editor was
  // started with (`--workshop <dir>`) instead of the repository's own workshop/ — without it the playtest cannot see the
  // pack being edited (docs/EDITOR.md 「工坊目录」).
  const envWorkshop = process.env.SP_WORKSHOP ? path.resolve(process.env.SP_WORKSHOP) : null;
  const workshopDir = opts.workshopDir === undefined ? (envWorkshop || WORKSHOP_DIR) : opts.workshopDir;
  // 分发前钩子（`pack.json.server.preDispatch`, DESIGN §28.13）**排在最前面**，因为它的最后两种失败只能由动态
  // import 发现（模块装不上 / 没有工厂导出），而 `loadWorkshop` 与 `loadData` 都是同步的。判据一旦跑完，装配路径
  // 就把「声明了钩子却装不上」的包从已加载集合里**裁掉**（`dropUnavailablePreDispatchPacks`），再用裁剪后的数组
  // 喂给下面每一个读者：数据叠加层、身份清单、kits、面板、资源表、Lobby/Network。B1 段这里是「包照旧加载、只是
  // 钩子没装上」—— 那种结局让运维以为自己有一道不存在的闸门，而它的内容却已经并进了游戏数据。
  const stateRoot = stateRootFor(ROOT);
  const loadedOnce = loadWorkshop(workshopDir, { log });
  // 启用 / 禁用（DESIGN §28.47，`server/modRegistry.js`）：操作者的开关在这条装配流水线的**最上游**生效 ——
  // 被禁用的包连它的服务端载荷都不会被装载（没有 hook、没有订阅、没有字节），文件留在磁盘上，一条
  // `enable` 命令就回来。被禁用的 id 同时进 `excludePacks`，数据叠加层与这里是同一次裁剪。
  const modRegistry = readModRegistry(stateRoot, { log });
  const registryApplied = applyModRegistry(loadedOnce.packs, modRegistry);
  for (const d of registryApplied.disabled) log.warn(`[mod-registry] "${d.id}" disabled (${d.where}) — not loaded`);
  // 依赖 / 冲突的装载期裁决（DESIGN §28.48）：缺失依赖、版本不合、互斥、级联与循环，全部在这一步**具名拒绝**
  // —— 一个依赖链断裂的包，和它依赖的那个一样「不在」。与上一条同一个裁剪点：裁决出来的集合喂给下面每一个读者。
  const adjudicated = adjudicatePackGraph(registryApplied.packs);
  for (const r of adjudicated.refused) log.warn(`[mod-registry] "${r.id}" refused: ${r.reason}`);
  const loadedForPayloads = { ...loadedOnce, packs: adjudicated.kept };
  const workshopHooks = await loadWorkshopHooks(loadedForPayloads, { log });
  // 包声明的**对局元注册表**模块（`pack.json.server.meta`, DESIGN §29，B 段）：与钩子同一条纪律 —— 声明了却装不上
  //（源码里带非确定性的东西、没有 `registerMeta` 导出、import 失败）的包**整包移出已加载集合**，而不是「包照旧
  // 加载、只是它的效果不在」。所以它必须在**数据叠加层之前**跑完，与钩子合在同一个裁剪点上。
  const workshopMeta = await loadMetaModules(loadedForPayloads, { log });
  // 包的**服务端模块**（`server.modules`, DESIGN §28.14）：与上面两条同一个裁剪点 —— 模块文件不在、import 失败、
  // 没有 `registerServer`、或者它挂了一个自己没声明的挂载点，都让**这个包**整份移出已加载集合。
  // 账号与战绩（docs/RECORDS.md）。**开关是显式的 `SP_ACCOUNTS=1`**（业主裁令）：不能让「某个文件恰好存在」悄悄
  // 改掉握手语义。没有它时下面两件**都不构造**，`Network` 收到 `accounts: null`、`Lobby` 收到 `records: null`，
  // `hello` 与会话建立走的还是今天那条路，逐字节不变。
  //
  // 两个环境变量**刻意在 `server/accountConfig.js` 里读**，不在这里：`modModules.js` 的 `BOOT_CONFIG_ENV_KEYS`
  // 是**包能看见的**环境白名单，而 `test/packServerSurface.test.js` 用反射源码把「引擎读过的 SP_*」与它钉成
  // 一份 —— 而「这个服务器开不开账号」正是那种**不该**让包看见的运维杠杆（包据此分叉就成了「同一份摘要有两种
  // 行为」）。为什么这样切，写在 `accountConfig.js` 的文件头。
  const accountConfig = resolveAccountConfig(opts, stateRoot);
  const accounts = accountConfig.enabled ? new AccountStore(accountConfig.accountsFile) : null;
  const records = accountConfig.enabled ? new MatchRecords(accountConfig.recordsFile, log) : null;
  if (accountConfig.enabled) {
    // 生效值必须被**说出来**（与 resourcePolicy / transportPolicy 同一条纪律）：运维要能从启动日志确认
    // 「账号开着、库在哪」，而不是靠猜。
    log.info(`[accounts] enabled (SP_ACCOUNTS): ${accounts.byName.size} account(s) in ${accountConfig.accountsFile}; `
      + `match records in ${accountConfig.recordsFile}`);
  }
  const serverModules = await loadServerModules(loadedForPayloads, { log, stateRoot });
  // 包声明的**战斗逻辑**模块（`pack.json.server.battle`, DESIGN §28.17）：与上面三条同一个裁剪点 —— 源码里带非确定性
  // 的东西、import 越界、没有 `install` 导出、模块文件不在，都让**这个包**整份移出已加载集合。
  const battlePack = await loadBattleInstallers(loadedForPayloads, { log });
  // 包声明的**房间级钩子**（`pack.json.server.room`, DESIGN §28.20）：与上面四条同一个裁剪点 —— 源码里带非确定性的
  // 东西、import 越界、没有 `install` 导出、模块文件不在，都让**这个包**整份移出已加载集合。与 `server.battle` 的
  // 差别只有一处：这一层**只在服务端**跑，所以没有一份「送浏览器的 URL 清单」。
  const roomPack = await loadRoomInstallers(loadedForPayloads, { log });
  const pruned = dropUnavailablePreDispatchPacks(loadedForPayloads, [...workshopHooks.errors, ...workshopMeta.errors, ...serverModules.errors, ...battlePack.errors, ...roomPack.errors]);
  if (pruned.removed.length) {
    log.warn(`[workshop] dropped ${pruned.removed.length} pack(s) whose declared server-side payload cannot be installed: `
      + pruned.removed.map((r) => `"${r.pack}" (${r.code})`).join(', '));
  }
  // 裁剪之后才有「这一版到底装了哪些包」：被别的声明裁掉的包**也不该**留下它的 meta 处理器或服务端模块
  // （否则一个装不上的包会继续在对局里 / 在 /healthz 上说话）。
  const survivors = new Set(pruned.packs.map((p) => p.id));
  const metaModules = workshopMeta.modules.filter((m) => survivors.has(m.id));
  const serverModulesLive = serverModules.modules.filter((m) => survivors.has(m.pack));
  // 包通道的**投递面**（`server.modules[].channels`，DESIGN §28.23）：`<包 id>` → 这个包的服务端模块声明过的
  // 接收通道集合。与 Lobby 的 `packChannels`（面板清单推出来的「客户端能说什么」）成对：那张表决定消息**收不收**，
  // 这张决定消息送不送进**这一局**（`packMsg` → `Match.handlePackMsg`）。没有包声明 `channels` 时是空表 ⇒
  // `pack.msg` 的投递路径与从前**逐字节相同**（不建对象、不多一次调用、不多一行日志）。
  /** @type {Map<string, Set<string>>} */
  const serverChannelMap = new Map();
  for (const m of serverModulesLive) {
    for (const channel of (m.channels || [])) {
      if (!serverChannelMap.has(m.pack)) serverChannelMap.set(m.pack, new Set());
      serverChannelMap.get(m.pack).add(channel);
    }
  }
  // 战斗逻辑同理：被别的声明裁掉的包不该继续在战场里说话（它的 installer 与 URL 清单一起消失）。
  const battleInstallers = battlePack.installers.filter((m) => survivors.has(m.id));
  const battleModules = battlePack.modules.filter((m) => survivors.has(m.pack));
  // 房间级钩子同理：被别的声明裁掉的包不该继续在大厅里说话（它的 `install(room)` 与事件钩子一起消失）。
  const roomInstallers = roomPack.installers.filter((m) => survivors.has(m.id));
  const modMount = mountServerModules(serverModulesLive, { log });
  const excludedPacks = new Set([...pruned.removed.map((r) => r.pack), ...registryApplied.disabled.map((d) => d.id), ...adjudicated.refused.map((r) => r.id)]);
  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy. The 创意工坊 overlay
  // is applied inside the loader (server/data.js), i.e. whichever way the data is obtained, it is already merged.
  // SP_WORKSHOP (editor/playtest.mjs) lets the Forge editor's 试玩 subprocess read the workshop root the editor was
  // started with (`--workshop <dir>`) instead of the repository's own workshop/ — without it the playtest cannot see the
  // pack being edited (docs/EDITOR.md 「工坊目录」).
  // A caller that names a data dir OR a workshop root must get a FRESH load: `getData` is a process-wide singleton whose
  // first caller wins, and something in the import graph may already have created it with the default workshop/ — which
  // is exactly why SP_WORKSHOP has to take the loadData() branch, or the 试玩 subprocess would silently read the wrong
  // (empty) pack root.
  // `excludePacks` 让那一层也遵守同一次裁剪（`server/data.js`）：不这样做，被裁的包会留下一个「谁都不认识的干员」。
  const data = (opts.dataDir || opts.workshopDir !== undefined || envWorkshop)
    ? loadData(dataDir, { log, workshopDir, excludePacks: excludedPacks })
    : getData({ dir: dataDir, log, workshopDir, excludePacks: excludedPacks });
  // 创意工坊 (docs/WORKSHOP.md): 装载一次，派生运行时要的三件东西 ——
  //   * workshopJson      the /data files the browser must receive merged instead of the on-disk originals;
  //   * workshopKits.kits the behaviour layer (a per-battle kit map) for battles the server itself runs;
  //   * workshopKitFiles  the URLs serving those same kit modules to the browser, which must rebuild the identical map,
  //                       or its client-simulated battle would disagree with the server's verification.
  const workshopLoaded = { ...loadedForPayloads, packs: pruned.packs, errors: pruned.errors };
  // 作者自备 CDN 的语音素材（`pack.json.voices` / `voiceLangs` 里的 `{ url, sha256, file }` 条目，DESIGN §28.33）：
  // 在**合并语音表之前**把字节取到本地缓存并按作者声明的 sha256 核对。四条纪律见 `server/voiceCdn.js`；
  // 这里负责两件事 —— **逐条点名**（失败绝不静默）与**把取不到的那几条从语音表里摘掉**（宁可回落到默认配音，
  // 也不要留一条永远 404 的静音台词）。一条外部 CDN 不该让服务器起不来，所以失败只影响那一条素材。
  const voiceCdn = await materializeVoiceCdn(workshopLoaded.packs, { stateRoot, log });
  const voiceLoaded = voiceCdn.failed.size ? { ...workshopLoaded, packs: dropFailedVoiceCdnFiles(workshopLoaded.packs, voiceCdn.failed) } : workshopLoaded;
  const workshopJson = buildWorkshopDataFiles(data, voiceLoaded);
  // 公告 / 鸣谢的合并体（DESIGN §28.15）：引擎那一半**从更新记录生成**（单一事实源，不手写第二份），包那一半按
  // 包 id 追加。它走**既有的**合并数据通道送出（`/data/notices.json`，map 的键是 `notices`），所以既没有新路由、
  // 也没有新的静态路径；`data/notices.json` 本来就不存在，所以这纯属新增。
  const notices = workshopNotices(workshopLoaded, { changelogPath: path.join(ROOT, 'CHANGELOG.md'), log });
  workshopJson.set('notices', Buffer.from(JSON.stringify(notices.body), 'utf8'));
  // 行为层的**两个键空间**（docs/WORKSHOP.md §4.7）：一个 `kits/<id>.js` 的 id 要么是**干员键**（`kitOf`：
  // `def.charId` / `def.baseId` / `def.id`），要么是**召唤物键**（token 记录的 id：`tokens.kits?.[def.id]`）。
  // 两边都要被告知，装载器才判得出「这条 kit 到底给谁」—— 只给 chess 表的话，一个包的召唤物 kit 会被当成未知目标
  // 丢掉（而那正是「包能做数据、做不了行为」这个缺口）。
  //   干员那一半还包括各已装包 `pack.json.operators` 声明的 charId：自选池干员的 kit 就是按 charId 查的
  //   （server/sim/content/index.js isDiyDef + kitOf:85），所以那个 id 也是一个合法的 kit 目标。
  const workshopKits = await loadWorkshopKits(workshopLoaded, {
    log,
    knownIds: new Set([
      ...Object.keys(data.chess || {}),
      ...((workshopLoaded.packs || []).flatMap((p) => Object.keys(p.operators || {}))),
    ]),
    knownTokenIds: new Set(Object.keys(data.tokens || {})),
  });
  // The mod set (DESIGN §28.2): one identity per pack, one digest for the whole set. It travels in `welcome`, in
  // `/healthz` (lobby.stats) and in every BattleSpec, so the three can never disagree about what is running.
  // 口径声明（DESIGN §28.39）**随同一个 mod 条目走**：`modDigest` 只哈希 `[id, hash]` 对（shared/modIdentity.js:196），
  // 所以把 `variants` 带在这里不改任何摘要；而 `Match` 从 `mods.packs[].variants` 合成这一局的轴表，正是靠它。
  // 与 `voiceCdn` / `skins` 同一条纪律：**只在包真的声明过时才存在这个键**，没声明的包这一份与从前逐字节相同。
  // 行为开关声明（DESIGN §28.43）走**同一条路、同一个投影点**：漏掉它 = 服务端装载器读到了声明、`Match` 却读到
  // `undefined` ⇒ 开关**静默不生效**（§28.39 把这一处记成「这一层最容易做坏的地方」）。同样不进 `modDigest`
  // （它只哈希 `[id, hash]`），而它**必须**进包身份哈希 —— 那一半由 `server/workshop.js` 的 `canonicalJson(pack)` 管。
  const workshopMods = (workshopLoaded.packs || []).map((p) => ({
    id: p.id, hash: p.hash, layer: p.layer, combat: p.combat, api: p.api,
    ...(Array.isArray(p.variants) && p.variants.length ? { variants: p.variants } : {}),
    ...(Array.isArray(p.behaviour) && p.behaviour.length ? { behaviour: p.behaviour } : {}),
  }));
  const workshopKitFiles = workshopKitFilesFor(workshopKits.modules, workshopDir);
  // 行为层相对 import 的服务面（§28.18）：包 id → 它的 `kits/` 目录。`/workshop-kits/` 靠它才服务得了一个 kit
  // 用 `./lib/util.js` import 的兄弟文件 —— URL 里没有 `kits/` 这一段，所以路由要把这一段加回去（server/http/static.js
  // resolvePackRelativeKit），而**只有已装载的包**在这张表里，服务范围仍由装载器决定。
  const workshopKitDirs = workshopKitDirsFor(workshopLoaded);
  // 包声明的战斗逻辑模块送到浏览器（`/workshop-battle/<包>/<模块>`）：与 kits 逐字同一条通道 —— 只服务装载器登记过的
  // URL，客户端战斗必须跑同一段代码（否则浏览器算出的战果与服务端复算的对不上）。
  const workshopBattleFiles = workshopBattleFilesFor(battleModules, workshopDir);
  // 按房间物化（W-B，DESIGN §28.9）：房间声明的集合要真的决定这一局跑什么。只在**装了包**时建它 ——
  // 干净安装既不需要官方那一份的第二次读取，也没有任何集合会比「进程级那一份」更小。
  const roomAssets = (workshopLoaded.packs || []).length
    ? createRoomAssets({
      official: loadData(dataDir, { log, workshopDir: null }),
      processData: data,
      packs: workshopLoaded.packs,
      kits: workshopKits.kits,
      kitOwners: workshopKits.owners,
      tokenKits: workshopKits.tokenKits,
      tokenKitOwners: workshopKits.tokenOwners,
      modules: workshopKits.modules,
      log,
    })
    : null;
  // `/room-data/<摘要>/<文件>.json` 那一面（同一个物化缓存；没有装包时这一面根本不存在）。
  const roomDataFace = roomAssets ? (digest) => roomAssets.byDigest(digest) : null;
  // 上游 0.3.0 的插件流水线（DESIGN §34.6）：服务端主人的策略（plugins/config.json）·「带玩法插件的内容集」
  // （服务在 /cs/<cs16>/…）· 房间级那一层把前两者合起来 · 以及「有玩法插件的房间真的跑在哪个宿主里」。
  // 视觉集（DESIGN §34 P1a）与它同源：一套 cosmetic 插件合成的那个集合，服务在 /vs/ 与 /p/。
  const visual = createVisualSets({ registry: packs, log });
  const policy = createPluginPolicy({ pluginsDir, log });
  const contents = createContentSets({ registry: packs, vanillaData: data, log, maxSets: () => policy.get().maxSets });
  const roomSets = createRoomSets({ registry: packs, visual, contents, policy });
  // 一个内容集一个子进程；SP_MATCH_HOST=worker 改成 worker 线程（match/host/index.js 的文件头说明了取舍：
  // worker 线程里一次 out-of-memory 会带走整个服务器，所以缺省是子进程）。
  const matchHostTransport = String(process.env.SP_MATCH_HOST || '').trim().toLowerCase() === 'worker' ? 'worker' : 'process';
  const hosts = createMatchHosts({ contents, log, options: { transport: matchHostTransport, maxWorkers: Math.max(1, policy.get().maxSets), ...(opts.matchHost || {}) } });
  const workshopAssets = workshopAssetsFor(workshopLoaded, workshopDir);
  // 包声明的只读路由（`pack.json.routes`, DESIGN §28.13）：绝对路径 → 包内 `.json`，带声明的 `Cache-Control`。
  // `mount` 让「核心先吃」这条判据（DESIGN §28.35）读到**真正的**核心挂载目录：与 createStaticHandler 那份同一组
  // 目录（`coreMounts` 是它们共同的来源），所以一条声明会不会顶掉引擎自己的文件，判的就是引擎自己读的那个文件。
  const workshopRoutes = workshopRoutesFor(workshopLoaded, workshopDir, {
    log,
    mount: coreMounts({ publicDir, dataDir, sharedDir, simDir }),
  }).routes;
  // C 层注册点（`pack.json.client.panels`, DESIGN §28.8）：面板清单（随 `welcome` 推到客户端）与这些模块的服务表。
  // 没有包声明 `client` 时两者都是空的，`welcome` 不多一个字段、`/workshop-panels/` 不服务任何东西。
  const workshopPanels = loadWorkshopPanels(workshopLoaded, { log });
  const workshopPanelFiles = workshopPanelFilesFor(workshopPanels.panels, workshopDir);
  // 包写的主题变量（`pack.json.client.theme.vars`, 业主裁决 2026-10-10）：合并成**一份** `{ vars }`，随 `welcome` 送到
  // 客户端。没有包声明主题时是 `null` ⇒ `welcome` 里没有这个字段、页面不多一条自定义属性（与 `modPanels` 同一条不变量）。
  const workshopTheme = workshopThemeFor(workshopLoaded, { log });
  // 资源容器与清单（`pack.json.assets`, DESIGN §28.13）：两个注册 URL → 包内的那两个文件。容器的 sha256 是装载期
  // 已经校验过的那个（`assetsIssues` 随包带出来），服务时只进 HTTP 头、不重算。没有包声明 `assets` 时这张表是空
  // 的，`/workshop-resources/` 一个字节都不服务、也没有任何 412 策略生效。
  const workshopResourceFiles = workshopResourceFilesFor(workshopLoaded.packs, workshopDir, {
    digests: new Map((workshopLoaded.packs || []).filter((p) => p && p.assetsDigest).map((p) => [p.id, p.assetsDigest])),
  });
  // 声明清单（`welcome.modAssets`, DESIGN §28.13.5）：容器/清单的注册 URL、装载期核对过的容器摘要、以及两个归一化
  // 后的策略值。没有包声明 `assets` 时它是**空数组** ⇒ `welcome` 里没有这个字段、客户端不 import 资源流程、
  // 不注册 SW、不多一个请求（B2/B3a 同一条不变量）。
  const workshopModAssets = workshopModAssetsFrom(workshopResourceFiles, workshopLoaded.packs);
  // 包给**已有语种**补的词条（`pack.json.i18n`, fanpack G-04, docs/WORKSHOP.md §1.10）：`/i18n/<code>.json` 的合并体。
  // 没有包声明 `i18n` 时这是一张空表 ⇒ 请求落到普通静态路径，`public/i18n/*.json` 逐字节照旧送出。
  const workshopI18n = buildWorkshopI18nFiles(workshopLoaded, { log });
  // `serverPolicy` 只有 `cache-only` 一种取值会改变行为，而它**只在包显式声明时**生效（缺省 `serve` = 今天逐字节
  // 不变）。策略覆盖的是 `/assets/` 与 `/fonts/` 这两棵**全服务器共用**的树，所以是进程级的：一个包声明它，就是
  // 全服务器都不再服务那两棵树 —— 这件事必须在启动日志里说出来（`resourceServerPolicy` 负责）。
  const resourcePolicy = resourceServerPolicy(
    new Map((workshopLoaded.packs || []).filter((p) => p && p.assets).map((p) => [p.id, p.assets.serverPolicy])),
    { log },
  );
  // 声明式传输配置（`pack.json.server.transport`, DESIGN §28.30）：与 `resourcePolicy` 逐字同一条先例 —— 读声明、
  // 收敛成**一个进程级**的值（`perMessageDeflate` 是 `WebSocketServer` 的构造选项，不是某个房间的属性）、启动日志
  // 点名生效值。没有任何包声明时是 `false`（B 段之前那一个 wss，逐字节不变）。包**只能声明**，绝不能注入代码改
  // `wss`（业主裁决：声明式足够就不做）。
  const transport = transportPolicy(
    new Map((workshopLoaded.packs || []).filter((p) => p && p.server && p.server.transport).map((p) => [p.id, p.server.transport])),
    { log },
  );
  // 客户端 mod 本地缓存 (W-C): the catalogue a browser downloads to decide what it is missing. Built from the SAME
  // `workshopLoaded` that produced `workshopMods` above — which is the **裁剪后**的那一份（B4 段把装不上钩子的包移出了
  // 已加载集合），所以「不在身份清单里的包」也不会出现在目录里。Empty on a plain install, and then the two /mods
  // routes answer `{ packs: [] }` / 404 and nothing else.
  const modsJson = createModsRoute(workshopLoaded, buildModCatalog(workshopLoaded));
  // 包声明服务端模块时，它可以给对局套一层 `MatchClass` 包装器（`uses: ['matchClass']`，DESIGN §28.14）。按**包 id**
  // 次序层层套上（`mountServerModules` 已经排过序），任何一层抛异常或返回非函数都只记日志并跳过那一层 ——
  // 一个包不该让服务器起不来。没有包声明时 `MatchClass` 就是原来的那一个（连字段都不多传）。
  const matchWrappers = modMount.matchClassWrappers();
  // 包声明的动态只读端点（`server.modules[*].uses` 含 `route`，DESIGN §28.32）：解析成一张 `Map<路径, 登记项>`，
  // 空 Map = 没有包声明它 ⇒ `createStaticHandler` 那一段整块跳过（干净安装逐字节不变）。启动日志点名每一条挂上的
  // 路径（与 `resourcePolicy` / `transportPolicy` 同一条「生效值必须被说出来」的纪律）。
  const modRoutes = modMount.routes();
  let MatchClass = opts.MatchClass;
  if (matchWrappers.length) {
    let base = MatchClass || DefaultMatch;
    for (const w of matchWrappers) {
      try {
        const next = w.fn(base);
        if (typeof next !== 'function') {
          log.warn(`[workshop] ${w.pack}/${w.id}: matchClass(...) returned ${typeof next}, not a class — that layer is skipped`);
          continue;
        }
        // 「声明了 channels 却没有接收方法」是这一层最讨厌的形态（装了但没反应），所以点名一次 —— 但**不拒绝**：
        // 方法可以挂在实例上（构造器里），静态看不出来，拒绝会误伤合法写法（DESIGN §28.23）。
        const declaredChannels = (serverModulesLive.find((m) => m.pack === w.pack && m.id === w.id) || {}).channels || [];
        if (declaredChannels.length && typeof next.prototype?.handlePackMsg !== 'function') {
          log.warn(`[workshop] ${w.pack}/${w.id}: declares server channels (${declaredChannels.join(', ')}) but its MatchClass layer has no handlePackMsg method — those messages will only be relayed (DESIGN §28.23)`);
        }
        base = next;
      } catch (e) {
        log.warn(`[workshop] ${w.pack}/${w.id}: matchClass(...) threw (${e && e.message ? e.message : e}) — that layer is skipped`);
      }
    }
    MatchClass = base;
  }
  // ===================================================================================================================
  // 管理后台 state — 协议源石版 port.
  //
  // Every store defaults to the process user's HOME (`~/sp-bans/`, `~/sp-announce/` …), NOT the install tree: a
  // blue/green deploy replaces the install directory wholesale, so anything written inside it is lost on the next
  // update. Each is overridable (SP_BAN_DIR / SP_ANNOUNCE_DIR / SP_NOTES_DIR / SP_LIMITS_DIR / SP_FEEDBACK_DIR).
  //
  // WHY THESE DEFAULT TO NULL OFF A REAL ENTRY POINT (the same rule the upstream tree uses): an `import`ed
  // `startServer()` — every test, every tool — must not read or overwrite the operator's REAL files on this machine.
  // A test that wants persistence passes the Dir option explicitly. `isEntry` is computed once, above.
  //
  // It is also why the panel is off by default: with no ADMIN_SECRET the whole /api/admin/* surface answers 404.
  // ===================================================================================================================
  const isEntry = isProcessEntry(import.meta.url);

  const bans = new BanList();
  const banStore = opts.banDir === null || (opts.banDir === undefined && !isEntry)
    ? null
    : createBanStore({ dir: opts.banDir || undefined, log });
  if (banStore) {
    const saved = banStore.readState();
    if (saved.ok && saved.entries && saved.entries.length) {
      bans.adopt(saved.entries);
      log.info(`[bans] 已恢复 ${saved.entries.length} 条封禁`);
    }
  }
  const limitsStore = opts.limitsDir === null || (opts.limitsDir === undefined && !isEntry)
    ? null
    : createLimitsStore({ dir: opts.limitsDir || undefined, log });
  const limits = new LiveLimits();
  if (limitsStore) {
    const savedLimits = limitsStore.readState();
    // `{ok:true, limits:null}` (no file) = no override, the boot option decides; `{ok:false}` = unreadable, do nothing.
    if (savedLimits.ok && savedLimits.limits) {
      limits.adopt(savedLimits.limits);
      log.info(`[limits] 已恢复服务器上限 ${limits.maxConnections == null ? '（不限制）' : `= ${limits.maxConnections}`}`);
    }
  }
  const announceStore = opts.announceDir === null || (opts.announceDir === undefined && !isEntry)
    ? null
    : createAnnounceStore({ dir: opts.announceDir || undefined, log });
  const notesStore = opts.notesDir === null || (opts.notesDir === undefined && !isEntry)
    ? null
    : createNotesStore({ dir: opts.notesDir || undefined, log });
  const feedback = opts.feedbackDir === null
    ? null
    : createFeedbackStore({ dir: opts.feedbackDir || undefined, log });

  const { registry, lobby, network } = createSessionStack(
    {
      ...opts,
      // The operator console's two live objects reach net.js through the ordinary option path (config.js
      // NET_OPTION_KEYS): `bans` refuses a socket at admission, `limits` is the panel-editable ceiling.
      bans,
      limits,
      // 账号与战绩：`accounts: null` 时 `Network` / `Lobby` 都走各自那条「没有这个功能」的分支。
      accounts,
      records,
      ...(matchWrappers.length ? { MatchClass } : {}),
      workshop: { kits: workshopKits.kits, tokenKits: workshopKits.tokenKits, modules: workshopKits.modules, kitOwners: workshopKits.owners, tokenKitOwners: workshopKits.tokenOwners, kitBudgets: workshopKits.budgets, mods: workshopMods, hooks: workshopHooks.hooks, panels: workshopPanels.panels, assets: workshopModAssets, theme: workshopTheme.theme, meta: metaModules, roomAssets, battle: battleModules, battleInstallers, roomHooks: roomInstallers, transport: transport.transport, serverChannels: serverChannelMap },
    },
    { data, log, content, plugins: roomSets, hosts },
  );
  // A ban means "gone now", not "gone at the next reconnect": every accepted change (added from the panel, or adopted
  // from the other blue-green slot by the poll below) closes the sockets that address already holds. The count it
  // returns is handed back through BanList.add, which is where the admin API reads `evicted` from — one owner for the
  // sweep.
  bans.onChange = () => network.dropBanned();
  // 启动时把上一条公告读回来：进程重启（部署、崩溃）之后公告照旧挂着，而不是「重启即忘」。
  if (announceStore) {
    const restored = announceStore.read();
    if (restored) {
      lobby.announcement = restored;
      // seq 接着最大的往下走，重启后不会与旧 id 撞车（客户端靠 id 去重）。
      lobby._announceSeq = Math.max(lobby._announceSeq || 0, restored.seq || 0);
      log.info(`[announce] 已恢复公告：${restored.text}`);
    }
  }
  // 全体公告是**整个部署的一份状态**，但它住在两个进程里（蓝绿）。面板把线写进共享文件的只有收到那次 POST 的那
  // 个槽会推给它的会话，另一个槽只在自己启动时读一次 —— 于是"从哪个面板发"决定了另一半玩家收不收得到。所以轮询
  // 那份文件，把变化采纳进来。`readState()` 而不是 `read()`：文件读不动时**什么都不做**，只有明确的
  // `current: null` 才算撤回。
  const announcePollMs = opts.announcePollMs ?? ANNOUNCE_POLL_MS;
  const announcePoll = announceStore && announcePollMs > 0
    ? setInterval(() => {
      const state = announceStore.readState();
      if (!state.ok) return;
      const current = lobby.announcement;
      if (state.record) {
        if (!current || current.id !== state.record.id) lobby.adoptAnnouncement(state.record);
      } else if (current) {
        lobby.withdrawAnnouncement();
      }
    }, announcePollMs)
    : null;
  announcePoll?.unref?.(); // 一个公告轮询不该让进程活着
  // 封禁名单同样是**整个部署的一份状态**（两条槽共用一个文件），理由与上面那条公告轮询逐字相同 —— 但代价大得多：
  // 公告晚 3 秒只是一行字晚出现，封禁晚 3 秒就是那 3 秒里他还能连上来。所以这里也轮询，并让采纳本身触发
  // dropBanned（BanList.onChange，上面接的是 network.dropBanned）。
  const banPollMs = opts.banPollMs ?? BAN_POLL_MS;
  const banPoll = banStore && banPollMs > 0
    ? setInterval(() => {
      const state = banStore.readState();
      if (!state.ok) return;
      bans.adopt(state.entries);
    }, banPollMs)
    : null;
  banPoll?.unref?.();
  // 服务器上限同样是**整个部署的一份状态**。调低上限**不会**断开任何人：这个轮询只更新数字，net.js 只在**新连接
  // 的 admission** 里读它，所以已经在玩的人和对局都不受影响。
  const limitsPollMs = opts.limitsPollMs ?? LIMITS_POLL_MS;
  const limitsPoll = limitsStore && limitsPollMs > 0
    ? setInterval(() => {
      const state = limitsStore.readState();
      if (!state.ok || !state.limits) return;
      limits.adopt(state.limits);
    }, limitsPollMs)
    : null;
  limitsPoll?.unref?.();

  // 蓝绿槽位探测（server/peer.js）：面板由**一个**槽提供，所以它天生看不见另一个槽；而发布时运维真正要问的正是
  // 「另一个进程还在吗、上面还有人吗、能不能停」。探测从服务端走回环，结果缓存 5 秒、有硬超时，且**未配置对端时探测
  // 不到任何东西**：PORT 不是 3000/3001、也不是 SP_SLOT 指明的槽时，它报告「只有本进程」。
  const slotConfig = slotFromEnv({ port });
  // The probe carries this process's own ADMIN_SECRET to the peer: both slots read the same environment, so that is the
  // same token. It falls back to the public /healthz when the peer answers 401/404.
  const slots = createSlotProbe({ port, self: null, token: opts.adminSecret ?? process.env.ADMIN_SECRET ?? null });
  if (slotConfig.peerPort != null) {
    log.info(`[slots] 本槽 ${slotConfig.name}（:${slotConfig.port ?? '?'}），对端 ${slotConfig.peerName}（${slotConfig.peerHost}:${slotConfig.peerPort}，来自 ${slotConfig.source}）`);
  }

  // The read-only admin API. There is no code default for the token on purpose (see server/admin.js): without
  // ADMIN_SECRET (or the option) `admin.enabled` is false and routes.js answers 404 for every /api/admin/* path.
  const admin = new AdminService({
    lobby, network, registry, startedAt: Date.now(),
    buildTag: () => buildTag(),
    secret: opts.adminSecret ?? process.env.ADMIN_SECRET,
    feedback,
    announceStore,
    notesStore,
    bans,
    limits,
    limitsStore,
    slots,
    // 全体公告 rate limit (ms): the production gap unless a caller (a test) asks for another one.
    announceMinGapMs: opts.announceMinGapMs,
    log,
  });

  // the content hashes of the art (built in the background once listening) and the manifests served with them
  const indexOptions = assetIndexOptionsFrom(opts, publicDir);
  const assetIndex = indexOptions ? createAssetIndex({ publicDir, log, ...indexOptions }) : null;
  const views = assetIndex ? createManifestViews({ dataDir, index: assetIndex, log }) : null;
  const serveStatic = createStaticHandler({ publicDir, dataDir, sharedDir, simDir, packsDir, pluginsDir, packs, content, log, workshopJson, workshopKitFiles, workshopKitDirs, workshopPanelFiles, workshopAssets, workshopRoutes, workshopResourceFiles, resourcePolicy, workshopI18n, modsJson, roomData: roomDataFace, workshopBattleFiles, modRoutes, voiceCdn: voiceCdn.overrides, assetIndex, views, visual, contents });
  // 插件工坊（DESIGN §34.9）：它自己的页面与 API，只对本机与本地网开放（路由层另一道门）。它只在被用到之后才
  // 盯 plugins/（热重载），而「房主是作者或独自一人」的房间自己跟随插件的改动。`studio: false` 关掉它。
  const studio = opts.studio === false ? null : createStudio({ publicDir, pluginsDir, dataDir, registry: packs, lobby, sessions: registry, log, fetch: opts.fetch });
  // 可信插件脚本的运行器（上游 0.3.0）：它只在**绑到的地址确实允许**时才留着（见下面 bind 之后的 trustedHostAllowed）。
  const trustedRuntime = await createTrustedRuntime({ registry: packs, log });
  lobby.trustedRuntime = trustedRuntime;
  const startedAt = Date.now();
  // The tag is per process (see buildTag): read the browser runtime once, here, not on every /healthz.
  resetBuildTag();
  buildTag();

  const traffic = createTrafficCounter();
  const server = http.createServer(createRequestHandler({ serveStatic, csp: process.env.SP_CSP === 'off' ? null : siteCsp(publicDir), health: { startedAt, network, registry, lobby, modHealth: () => modMount.healthz(), content, traffic, assetIndex, views, trusted: trustedRuntime?.health }, log,
    records, accounts,
    // 管理后台 + 玩家反馈 + 更新公告 (协议源石版 port). `admin.enabled` is false without ADMIN_SECRET, in which case
    // routes.js answers 404 for the whole /api/admin/* surface; `feedback` / `notes` null out the two public routes.
    admin, feedback, notes: notesStore, bans,
    httpLanes: opts.httpLanes, publicDir, trustProxy: network.opts.trustProxy,
    studio, trustedRuntime,
    modsCatalog: (req, res) => serveMods(req, res, MODS_CATALOG_URL, '', modsJson) }));
  server.on('clientError', answerClientError);
  const wss = attachWebSocket(server, { network, log, lanes: opts.wsLanes, perMessageDeflate: transport.perMessageDeflate, traffic });

  // The address actually bound. The default may fall back to IPv4; the returned host and url follow that.
  let boundHost;
  try {
    // A host with IPv6 switched off refuses '::'. Fall back to IPv4 rather than not booting. Only the default is
    // retried: an explicit HOST is literal (server/http/config.js bindCandidates).
    let bound = null;
    let lastError = null;
    const candidates = bindCandidates(host);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        await new Promise((resolve, reject) => {
          const onError = (e) => { server.off('listening', onListening); reject(e); };
          const onListening = () => { server.off('error', onError); resolve(); };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(port, candidate);
        });
        bound = candidate;
        break;
      } catch (e) {
        lastError = e;
        const retry = ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(e.code) && i < candidates.length - 1;
        if (!retry) break;
        log.warn(`[boot] cannot bind ${candidate} (${e.code}) — falling back to IPv4 only`);
      }
    }
    if (bound === null) throw lastError;
    boundHost = bound;
    // Check the kernel's address too: aliases/DNS and bind fallback cannot weaken the owner gate.
    const actual = server.address();
    const scriptHost = actual && typeof actual === 'object' ? actual.address : '';
    packs.setScriptHost(scriptHost);
    if (!trustedHostAllowed(scriptHost, scriptMode)) {
      lobby.trustedRuntime = null;
      await trustedRuntime?.close();
    }
  } catch (e) {
    network.close(); // stop heartbeat/sweep timers of the half-built server
    assetIndex?.close();
    studio?.close();
    await trustedRuntime?.close();
    throw e;
  }
  server.on('error', (e) => log.error('[http] server error', e));
  // 内容哈希索引：**绑上端口之后**才在后台开跑（第一次构建等 ASSET_INDEX_DELAY_MS，只起停一次的测试什么也不读）。
  assetIndex?.start();
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  // 包的服务端模块的 `onBoot`（DESIGN §28.14）：**绑上端口之后**才跑 —— 「服务起来了」对它们是一句真话，
  // 而**真正绑到的** port / host 也才是这个快照里该有的值（包只能观察，不能设值）。
  // 每个回调单独 try（`mountServerModules.boot` 内部就是这么做的），一个包炸了不影响别的包，也不影响启动。
  modMount.boot(bootConfigSnapshot({ port: actualPort, host: boundHost, stateRoot }));

  const url = `http://${displayHost(boundHost)}:${actualPort}`;

  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      // The three deployment-wide polls (公告 / 封禁 / 上限) stop here; `unref()` already keeps them from holding the
      // process open, but a stopped server must not keep re-reading files a test then deletes.
      if (announcePoll) clearInterval(announcePoll);
      if (banPoll) clearInterval(banPoll);
      if (limitsPoll) clearInterval(limitsPoll);
      try { lobby.shutdown('shutdown'); } catch (e) { log.error('[shutdown] lobby', e); }
      // 包的服务端模块的 `onShutdown`（例如停机播报 + 快照留档）：与 `onBoot` 同一条，失败只记日志、不阻塞停机。
      try { modMount.shutdown(); } catch (e) { log.error('[shutdown] mod modules', e); }
      // 对局宿主（一个内容集一个子进程 / worker）· 插件工坊 · 可信脚本运行器：与上面两条同一条纪律，
      // 每一件单独 try —— 一件关不掉不该拖住停机。
      try { hosts.close(); } catch (e) { log.error('[shutdown] match hosts', e); }
      network.close();
      assetIndex?.close();
      studio?.close();
      await trustedRuntime?.close();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setTimeout(() => { server.closeAllConnections?.(); }, 500).unref();
      });
      try { wss.close(); } catch { /* ignore */ }
    })();
    return closing;
  }

  // `accounts` / `records` 也交出来（两份都是 `null` 时表示没开 `SP_ACCOUNTS`）：运维与测试要能确认
  // 「这个进程到底有没有账号」，而不是靠猜 `hello` 的回复。
  return { port: actualPort, host: boundHost, url, server, wss, lobby, network, registry, packs, content, visual, contents, hosts, accounts, records, traffic, assetIndex, views, studio,
    // The operator console's objects, handed back so tests and tools can assert on them instead of guessing.
    admin, feedback, bans, banStore, limits, limitsStore, announceStore, notesStore, close };
}

// Re-exports for tests and tools (协议源石版 port). The upstream tree re-exports its whole helper surface here; this
// tree had no such block, so only the console's own pieces are added — an existing import of server/index.js sees
// exactly the same module it did before.
export {
  // the read-only admin API (server/admin.js) — the panel's backend and its log ring
  AdminService, recordAdminLog,
  // 玩家反馈的落盘/读取
  createFeedbackStore,
  // 全体公告 / 更新公告的落盘
  createAnnounceStore, createNotesStore,
  // 封禁名单（规则与状态 + 落盘）
  BanList, createBanStore,
  // 服务器人数上限的实时值与落盘
  LiveLimits, createLimitsStore,
  // 蓝绿槽位探测（面板的「另一个槽」一节）
  createSlotProbe, slotFromEnv,
};

// `node server/index.js` / npm start: listen, print the banner, stop on SIGINT / SIGTERM (http/boot.js).
if (isProcessEntry(import.meta.url)) runMain(startServer);
