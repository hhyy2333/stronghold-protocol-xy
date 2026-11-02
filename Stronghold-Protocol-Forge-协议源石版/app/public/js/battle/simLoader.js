// Browser/Worker engine loader. Workers receive data and never fetch it (DESIGN §34.11).
//
// SIM_DATA_FILES is THE list: /js/battle/runner.js re-exports this very array (it used to keep a second copy, and the
// copy here had lost `hextech` — every enemy verb card 隐匿 / 回响 / 铁壁 … then did nothing in a browser-simulated
// battle while the Node tests, which read data/*.json off disk, all passed; the user reported it twice, §29.10).
export const SIM_DATA_FILES = Object.freeze([
  'chess', 'enemies', 'tokens', 'stages', 'waves', 'bonds', 'items', 'garrisons', 'bands', 'effects', 'backups',
  // 协议源石: installEnemyVerbs resolves every enemy verb card through gameData().hextech, and the player-side battle
  // scripts (hexcards/*) need the same roster paths. Without it the browser sim silently fights with no enemy verbs.
  'hextech',
  // 协议源石【特限恢复】的 3 级模组 (data/moduleLevels.json): the browser sim resolves `loadout.moduleLevel === 3` through
  // `simdata.rawModuleLevels()`, whose Node fallback (`generatedCache`) does not exist in a page — without this file the
  // client-run battle (the default, DESIGN §14) silently fought with 1 级模组 while every Node test passed.
  'moduleLevels',
]);

function deepFreeze(root) {
  const stack = [root];
  while (stack.length) {
    const o = stack.pop();
    if (o === null || typeof o !== 'object' || Object.isFrozen(o)) continue;
    Object.freeze(o);
    for (const v of Object.values(o)) if (v !== null && typeof v === 'object') stack.push(v);
  }
  return root;
}

/**
 * Browser sim loader: the /sim/ modules + the data files (own frozen copies — the server's data is frozen too, so a
 * content bug that writes into a record fails identically on both sides). `raw` is that frozen data: the rehearsal
 * worker (battle/rehearsal.js) is handed the page's official copy once instead of fetching the files again. `data`
 * (DESIGN §34.6): the files of a room's content set the page checked (public/js/content.js) instead of fetching
 * /data/; `cs` names what was loaded; `bounds` its official-bounds snapshot (installSimBounds).
 */
let loadedScripts = false;
export async function loadBrowserSim({ base = '/sim/', dataBase = '/data/', fetchFn = (...a) => globalThis.fetch(...a), data = null, cs = null, bounds = null,
  scripts = [], hashInput = null, nativeVerified = false, deferScripts = false } = {}) {
  const [spec, simdata, support] = await Promise.all([
    import(`${base}spec.js`), import(`${base}simdata.js`), import(`${base}content/support/index.js`),
  ]);
  const { files, dataBase: usedDataBase } = await loadSimData({ dataBase, fetchFn, data });
  // a battle simulated without part of the data would still produce a plausible result the server accepts: never run
  // one — the loader fails (the next b.start retries it; meanwhile the server's deadline takes the field over)
  const missing = SIM_DATA_FILES.filter((n, i) => !files[i] || typeof files[i] !== 'object');
  if (missing.length) throw new Error(`simulation data unavailable: ${missing.join(', ')}`);
  const raw = {};
  SIM_DATA_FILES.forEach((n, i) => { raw[n] = deepFreeze(files[i]); });
  simdata.setSimData(raw);
  if (typeof support.setGameData === 'function') support.setGameData(null); // re-read through the injected data
  await installSimBounds(base, raw, data ? bounds : undefined);
  if (!deferScripts && scripts.length) {
    const sdkUrl = /^file:/i.test(base) ? new URL('../../shared/plugins/sdk.js',base).href : new URL('/shared/plugins/sdk.js',globalThis.location.href).href;
    const {loadScripts} = await import(new URL('scriptLoad.js',sdkUrl).href);
    await loadScripts(scripts,{hashInput,sdkUrl,extensionsUrl:base+'content/extensions.js',cs,nativeVerified});
  } else if (loadedScripts) (await import(base+'content/extensions.js')).resetExtensions();
  loadedScripts = !deferScripts && scripts.length > 0;
  return { spec, ds: new simdata.DataSource(raw, null), cs, raw, dataBase: usedDataBase };
}

/** 一次 fetch：`<base><name>.json`，失败（非 2xx / 抛错）返回 null。 */
async function fetchOne(fetchFn, base, name) {
  try {
    const res = await fetchFn(`${base}${name}.json`, { cache: 'no-cache' });
    return res && res.ok ? await res.json() : null;
  } catch { return null; }
}

/**
 * 这一场要用的数据文件：`data`（房间内容集的结构化副本）优先，否则从 `dataBase` 取。
 *
 * **房间面取不到就回落到全局 `/data/`**（0.19.43，业主 2026-11-02「还是有人不出怪」）：
 * `/room-data/<digest>/` 是**进程内存**里的物化结果（`server/roomAssets.js` 的 `byDigest`）。服务重启、房间的模组集合
 * 在玩家打开页面之后又改过、或者那个摘要从来没被物化过，这一面就会 404；而调用方在缺文件时是**直接抛错**的 ——
 * 于是这一场**一次模拟都跑不起来**，服务端 60 秒后按 `timeout` 接管，玩家看到的就是「进对局不出怪」（战场空着、
 * 不刷敌人、计时还在走）。回落到全局数据最多是与房间声明的子集有出入（服务端自己有校验与重算兜底），比整场空白好。
 * 全局也取不到时仍然把 null 交回去，由调用方抛同一个错。
 * @param {{ dataBase?: string, fetchFn?: Function, data?: any }} [opts]
 * @returns {Promise<{ files: any[], dataBase: string, fellBack: boolean }>}
 */
export async function loadSimData({ dataBase = '/data/', fetchFn = (...a) => globalThis.fetch(...a), data = null } = {}) {
  // (a content set's data: structured copies, frozen by the caller like downloaded files)
  if (data) return { files: SIM_DATA_FILES.map((n) => (data[n] && typeof data[n] === 'object' ? structuredClone(data[n]) : null)), dataBase, fellBack: false };
  const grab = async (base) => Promise.all(SIM_DATA_FILES.map(async (n) => (await fetchOne(fetchFn, base, n)) ?? fetchOne(fetchFn, base, n)));
  let files = await grab(dataBase);
  const missing = () => SIM_DATA_FILES.filter((n, i) => !files[i] || typeof files[i] !== 'object');
  if (missing().length && dataBase !== '/data/') {
    const fallback = await grab('/data/');
    if (!SIM_DATA_FILES.filter((n, i) => !fallback[i] || typeof fallback[i] !== 'object').length) {
      files = fallback;
      try { console.warn(`[sim] simulation data at ${dataBase} is unavailable (${missing().join(', ')}) — fell back to /data/`); } catch { /* no console */ }
      return { files, dataBase: '/data/', fellBack: true };
    }
  }
  return { files, dataBase, fellBack: false };
}

/**
 * The official-bounds table of the engine's plugin caps (shared/plugins/officialBounds.js, DESIGN §34.5): the original
 * content's page scans the data it loaded (no request); a room's content set installs the snapshot its index lists
 * (public/js/content.js loads and checks it beside the data files) — the one the server validated against and its match
 * host installs too, so both simulate a modded battle with the same caps. A content set without one runs on the floor,
 * never on a scan of its own tables (a bomb would raise its own cap). `bounds` undefined: the original content.
 * @param {string} base @param {Record<string, any>} raw @param {any} [bounds]
 */
async function installSimBounds(base, raw, bounds) {
  let boundsMod;
  try {
    const spec = /^https?:|^file:/i.test(String(base))
      ? new URL('../../shared/plugins/officialBounds.js', base).href
      : '/shared/plugins/officialBounds.js';
    boundsMod = await import(spec);
  } catch { return; }
  if (bounds === undefined) boundsMod.rememberOfficialBounds(raw);
  else boundsMod.installOfficialBounds(bounds && bounds.v === 1 ? bounds : null);
}

