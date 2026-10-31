// tools/local-assets-groups.mjs — 本机素材清单（`data/local-assets.json`）必须覆盖 `public/assets/local/` 上
// **真实存在的 group**。这道体检就是 0.19.36 那次事故的守卫。
//
// 为什么需要它：客户端所有「本机素材」（干员/敌人 spine、战场场景、协议源石阶位图与装备图标、首页主题……）的 URL
// 都走 `public/js/data.js` 的 `localAsset(group, name)`：读 `data.get('local').groups[group][name].path`，拿不到
// 就返回 null，**调用方退回画字/画形状**。所以清单里少一个 group 不会报错、不会打日志、Playwright 也不红 ——
// 它只是让那一批素材在客户端眼里不存在。0.19.36 发出去的那份清单只有 1803 条 / 130 group（线上旧版 0.19.35 是
// 1955 条 / 153 group），少了 23 个 group（`hextech/tier`、`scene/*`、`char/<charId>`、`ui/homeicon`、
// `spine/enemy/*` …），而这些文件在两台服务器和本机的 `public/assets/local/` 下**全都还在**。结果是协议源石卡片
// 退回画「战/共/均」首字、装备图标、战场 3D 场景背景、自定义干员立绘、首页主题一起退回兜底。
//
// 这不是一次性意外：`data/local-assets.json` 是**每台机器的状态**（git-ignored，由本机的提取工具写），它会漂 ——
// 重新提取一次、手动删一批、从别的机器拷一份旧的过来，都会让它与磁盘上的 `public/assets/local/` 对不上。0.19.24
// 已经是同一类事故（阿里云 `admin` 家目录里还留着 `backup-b-local-assets.json.01924-bad`：1853 条 / 130 group，
// 2026-10-25），当时靠手工拷回好清单修好。所以判据必须是**可重复跑的体检**，而不是「下次小心点」。
//
// 判据只有一条：**磁盘上有文件的目录就是一个 group**，`data/local-assets.json` 的 `groups` 必须把它列上。
//   * 目录 → group 名：取它相对 `public/assets/local/` 的路径（`guide`、`scene/tex`、`ui/homeicon`、
//     `spine/enemy/enemy_10004_trdiam`、`char/char_4182_oblvns` …）。
//   * 只有**直接**含文件的目录才算 group；已经是 group 的目录不再往下走（`char/<charId>/spine/front/*.png`
//     属于 `char/<charId>` 这个 group 的文件，不是一个新 group）。这条规则同时自动定下了深度：
//     `spine/`、`spine/enemy/`、`char/` 这些只装子目录的中间层不是 group。
//   * 目录里没有任何文件（空目录、只有子目录）算不存在。
//   * `fx` / `fx/*` 例外，见 `isExcludedGroup()`。
//
// 两个方向都要报，但分量不同：
//   * **磁盘有、清单没有** —— 致命：客户端静默退回兜底。出包时必须失败（任何场合）。
//   * **清单有、磁盘没有** —— 警告：清单指向空处（目录被撤下/这台机器没提取）。它会让客户端去取不存在的文件，
//     所以在**服务器**上体检要带 `--strict`（那时也算失败）；出包工作区上它经常是正常的（包本来就不带全套素材）。
//
// 用法（纯函数给测试与出包用，命令行入口在 `tools/asset-pack-doctor.mjs check-groups`）：
//   node tools/asset-pack-doctor.mjs check-groups [--root <dir>] [--json] [--strict]
//   node tools/package.mjs --dry-run        # 全量包/更新包在 plan() 里跑同一道检查
import fs from 'node:fs';
import path from 'node:path';

/** 本机提取清单（每台机器自己生成，git-ignored；`tools/local-extract/extract.py` 写出）。 */
export const LOCAL_MANIFEST = 'data/local-assets.json';
/** 本机提取出来的素材根目录（同样 git-ignored）。 */
export const LOCAL_DIR = 'public/assets/local';
/** 官方特效的 group 名。 */
export const FX_GROUP = 'fx';

/**
 * `fx` / `fx/*` 为什么不算缺口：官方特效**有自己的一份清单** `data/local-fx.json`
 * （`public/js/assetPack.js mergeLocalManifests` 把两份合起来看），而 `tools/local-extract/extract.py`
 * 是**故意**把 `fx` group 从 `local-assets.json` 里丢掉的（见 `extract.py` 头部说明与 `fx.py` 的
 * `FX_GROUPS` / `ran_groups` 注释）。所以 `public/assets/local/fx/` 再多的目录都不该出现在
 * `data/local-assets.json` 里，体检必须把它整个排除，否则每次都是假警报。
 * @param {string} group
 */
export function isExcludedGroup(group) {
  return group === FX_GROUP || String(group).startsWith(`${FX_GROUP}/`);
}

/**
 * 磁盘上的 group 表：`group 名 → 该目录里的直接文件数`。纯函数：只读 `dirRoot`，不碰任何别的路径。
 * @param {string} dirRoot `public/assets/local` 的绝对路径（不存在时返回空表）
 * @returns {Record<string, number>}
 */
export function diskGroups(dirRoot) {
  /** @type {Record<string, number>} */
  const out = {};
  /** @param {string} abs @param {string} rel */
  const walk = (abs, rel) => {
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    const files = entries.filter((e) => e.isFile());
    if (files.length) {
      // 这一层就是 group（它的子目录是这个 group 的文件，不是新 group），所以不再往下走
      if (rel && !isExcludedGroup(rel)) out[rel] = files.length;
      return;
    }
    for (const e of entries) if (e.isDirectory()) walk(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
  };
  if (dirRoot) walk(dirRoot, '');
  return out;
}

/**
 * 清单 vs 磁盘。纯函数：对任意一份清单对象和任意一个目录根求值（测试就是这么用的，不依赖本机有没有素材）。
 *
 * @param {{ groups?: Record<string, unknown> } | null} manifest `data/local-assets.json` 解析后的对象
 * @param {string} dirRoot `public/assets/local` 的绝对路径
 * @returns {{
 *   unlisted: string[],  // 磁盘有、清单没有（致命：客户端静默退回兜底）
 *   dangling: string[],  // 清单有、磁盘没有目录（警告：指向空处）
 *   groups: number,      // 磁盘上的 group 数（已排除 fx）
 *   listed: number,      // 清单里的 group 数（已排除 fx）
 *   files: number,       // unlisted 那些 group 里的直接文件数合计
 * }}
 */
export function groupGaps(manifest, dirRoot) {
  const disk = diskGroups(dirRoot);
  const groups = manifest && typeof manifest.groups === 'object' && manifest.groups ? manifest.groups : {};
  const listed = Object.keys(groups).filter((g) => !isExcludedGroup(g));
  const listedSet = new Set(listed);
  const diskSet = new Set(Object.keys(disk));
  const unlisted = Object.keys(disk).filter((g) => !listedSet.has(g)).sort();
  const dangling = listed.filter((g) => !diskSet.has(g)).sort();
  return {
    unlisted,
    dangling,
    groups: diskSet.size,
    listed: listed.length,
    files: unlisted.reduce((n, g) => n + disk[g], 0),
  };
}

const isDirectory = (abs) => { try { return fs.statSync(abs).isDirectory(); } catch { return false; } };
const isFile = (abs) => { try { return fs.statSync(abs).isFile(); } catch { return false; } };

/**
 * 读一台真实 checkout 的两样东西（`<root>/data/local-assets.json` 与 `<root>/public/assets/local`）后求值。
 *
 * `skipped` 非空 = 这台机器没有本机客户端素材，调用方应当**跳过而不是失败**（它们都是 git-ignored 的，
 * 干净 checkout、CI、只开服务器的主机都没有）。`error` 只在清单读不成 JSON 时出现 —— 那是一份坏清单，
 * 客户端连 `groups` 都拿不到，确实该失败。
 * @param {string} root 仓库根
 * @returns {{ skipped: string, error: string, dir: boolean, manifest: boolean,
 *   unlisted: string[], dangling: string[], groups: number, listed: number, files: number }}
 */
export function localGroupGaps(root) {
  const dirRoot = path.join(root, LOCAL_DIR);
  const manifestPath = path.join(root, LOCAL_MANIFEST);
  /** @type {any} */
  const empty = { skipped: '', error: '', dir: false, manifest: false, unlisted: [], dangling: [], groups: 0, listed: 0, files: 0 };
  if (!isDirectory(dirRoot)) return { ...empty, skipped: `没有 ${LOCAL_DIR}/（这台机器没有本机客户端素材）` };
  if (!isFile(manifestPath)) return { ...empty, dir: true, skipped: `没有 ${LOCAL_MANIFEST}（这台机器没有提取本机素材）` };
  /** @type {any} */
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (err) {
    return { ...empty, dir: true, manifest: true, error: `${LOCAL_MANIFEST} 读不成 JSON：${err.message}` };
  }
  return { skipped: '', error: '', dir: true, manifest: true, ...groupGaps(manifest, dirRoot) };
}
