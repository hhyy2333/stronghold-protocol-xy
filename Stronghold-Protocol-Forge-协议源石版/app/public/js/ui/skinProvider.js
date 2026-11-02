// public/js/ui/skinProvider.js —— **内置的外观提供者**：把「这位玩家给这个干员选的那套工坊时装」交回解析链。
//
// 它回答 `public/js/ui/portraitChain.js` 步骤 0 的那一问（`lookup(kind, charId, id)`，见
// `docs/design/mod-layer.md` §28.28 第 2b / 3 条）：链把**这一条 kind**（`'portrait'` / `'avatar'`）连同干员 id
// 与它手里的官方 id 一起交过来，这里回一个「这一条 kind 有哪张图」的对象，或者 null（= 交给链自己回落原版）。
//
// ⚠️ **这条通道上最重要的一个取舍（有意的，别当成 bug 修）：外观只走一条通道 = 工坊包。**
//
// `public/js/ui/extensions.js` 的 `registerAppearance` 有一条不变量：**一个进程里最多只有一个外观提供者**，
// 后注册者被 `CLIENT_APPEARANCE_TAKEN` 点名拒绝（理由写在那边：`which operator's art it answers must not depend
// on import order`）。内置提供者在开机时先注册（`screens/loadout.js` → `skinPicker.js` 的 import 链，见
// `main.js:77`），所以**从这一版起，一个插件面板再导出 `appearance(ctx)` 会被拒**。
//
// 后果（写清，因为它会真的发生）：
//   * 插件面板的作者会看到一条 `CLIENT_APPEARANCE_TAKEN` 的 refuse 日志，面板本身照旧挂载、只是它画不了外观；
//   * 「哪一套时装生效」这件事从此**只有一条路**：工坊包的 `pack.json.skins`（`shared/workshop.js` →
//     `assets.skins[<charId>]`）＋ 这里＋ 玩家在选择器里的选择。插件 overlay 那条路（`official-skins-273` 那种
//     `plugin.json` + `assets.json` 叠层）在**本树**本来就没有实现（`shared/plugins/visual.js` 的 overlay 差 11 个
//     hunk），所以这不是「把一条能用的路堵上」，而是「不让第二条半成品路在将来悄悄抢走同一个槽位」。
//   * 这是**符合** §6.3 那条纪律的：两套包系统（工坊包 + 插件）并行已经够了，外观再加一层，玩家排障会有三个原因。
//
// 回退办法（三条，从轻到重）：
//   1. 玩家：设置 →「工坊外观」关掉（`settings.workshopSkins`，默认开）⇒ 链的步骤 0 整段不存在，画面与不装逐字相同；
//   2. 维护者：删掉 `skinPicker.js` 末尾那次 `installBuiltinSkinProvider()`（或让它不注册）⇒ 槽位空出来，插件
//      面板重新拿得到它，且选择器仍然只影响它自己那个「皮肤」区（选择照旧落地、照旧发帧）；
//   3. 彻底：`public/js/ui/skinProvider.js` 整个删掉 + 两个 import —— 这一层回到 0.19.41 的 15 行 shim 行为。
//
// 另一件必须说清的事：**这套提供者只画头像 / 立绘**。局内 Spine 换装（`assets.js` 的 `spineEntry(m, id, {skin})`）
// 是另一刀，今天不存在，所以一套只有模型的时装在 `skins.js availableSkins` 里就不算可选（那里是唯一判据）。

import { setAppearanceLookup, currentAppearanceLookup } from './portraitChain.js';
import { chosenSkin, skinById } from './skins.js';

/** 解析链按 kind 只认自己那一支的字段（`portrait` / `portraitE2` 与 `avatar` / `avatarE2`）。 */
const KIND_FIELDS = {
  portrait: ['portrait', 'portraitE2'],
  avatar: ['avatar', 'avatarE2'],
};
/** 步骤 4 那条历史口（`lookup('chars', charId, id)`，「这个 id 认不认识」）答整套 —— 它不带 kind。 */
const ALL_FIELDS = [...KIND_FIELDS.portrait, ...KIND_FIELDS.avatar];

const str = (v) => (typeof v === 'string' && v ? v : null);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = (art, fields) => {
  const out = {};
  for (const f of fields) { const v = str(art[f]); if (v) out[f] = v; }
  return Object.keys(out).length ? out : null;
};

/**
 * 链问一次，这里答一次。答的是**这位玩家给这个干员选的那一套**的图（不是「有哪些套」——那是选择器的事）。
 *
 * 三条判据，与 `skins.js` 一个字节都不重复：
 *   * 没选 / 选了不存在的 / 那套今天没有图 ⇒ `chosenSkin` 给 null ⇒ 这里也 null（链回落原版）；
 *   * 只答**被问的那一条 kind** 的字段：一套只有立绘的时装不该把头像位也画成立绘（§28.28 第 2b 条第 2 点）；
 *   * 这一条 kind 那套时装没有图 ⇒ null（链继续走官方回落，而不是拿另一条 kind 的图顶上）。
 * @param {'portrait'|'avatar'|'chars'} kind
 * @param {string} charId 干员 id（`char_498_inside`）
 * @param {string} id 链手里的官方外观 id（本提供者不用它：它按 charId 归属一套外观，见 §28.28）
 * @returns {Record<string, string>|null}
 */
export function builtinSkinLookup(kind, charId, id) {
  // `id` 不参与判断是**有意的**：链送来的可能是 `char_x_1`、`char_x_2` 或裸 `char_x`，它是「链现在手里那张官方图」，
  // 不是「哪一套时装」。谁被选中只由 (charId, 这台机器的选择) 决定。
  void id;
  const fields = kind === 'chars' ? ALL_FIELDS : KIND_FIELDS[kind];
  if (!fields || !str(charId)) return null;
  const want = chosenSkin(charId);
  if (!want) return null;
  const skin = skinById(charId, want);
  if (!skin || !isObj(skin.art)) return null;
  return pick(skin.art, fields);
}

/**
 * 把内置提供者接进解析链（开机一次）。返回**这次**有没有接上：已经有提供者时返回 false
 * —— 那正是 `extensions.js` 的 `CLIENT_APPEARANCE_TAKEN` 那一条在客户端引擎侧的样子（链的
 * `setAppearanceLookup` 只认第一个）。
 * @returns {boolean}
 */
export function installBuiltinSkinProvider() {
  return setAppearanceLookup(builtinSkinLookup);
}

/** 现在链里生效的是不是**我们这个**内置提供者（诊断 / 测试；不要用它代替「有没有提供者」那一问）。 */
export const skinProviderInstalled = () => currentAppearanceLookup() === builtinSkinLookup;
