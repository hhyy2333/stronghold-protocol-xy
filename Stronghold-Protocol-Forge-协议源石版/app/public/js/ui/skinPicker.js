// public/js/ui/skinPicker.js —— 干员调配详情里的「皮肤」区（DESIGN §28.28）。
//
// 三件事故意拆在三个文件里，因为它们的失败方向不同：
//   * `ui/skins.js` —— **清单 + 选择 + 发帧**（纯数据，能在 Node 里直接测）；
//   * `ui/skinProvider.js` —— **把选择交回解析链**（回答 `portraitChain` 步骤 0 的那一问）；
//   * 本文件 —— **只是那一块界面**：读前两者，画一排可点的格子，别的一个字都不改。
// 于是上游（或者我们）以后重写 `screens/loadout.js` 时，代价是一行组件而不是一场合并冲突。
//
// 行的来源是 `assets.skins[<charId>]`（`shared/workshop.js mergeWorkshopSkins` 的落点），不读任何
// `data/skins.json`：本仓没有那个文件（`screens/loadout.js:778` 那段注释讲的就是这件事）。
//
// **显示的判据（与融合版 0.3.3 故意不同，这里说明为什么）**：融合版把「皮肤」区的显示做成**全局**规则
// （任何干员有可选外观 ⇒ 每个干员都显示这一区，没有的干员只画一格「默认」），理由是「一个只对某些干员出现的区
// 分不清『这个干员没有时装』和『插件没加载』」。那是**插件**的语境：面板要替一个可能加载失败的插件说话。
// 本树的内置提供者是引擎的一部分（不是可装可卸的包），「插件没加载」这个歧义不存在，所以这里用**逐干员**的判据：
// 这个干员没有可选外观 ⇒ 整块不画（`skinSectionModel` 返回 null）。好处是干员调配的详情面板不会被一格
// 「默认」塞满 258 位干员 —— 而那正是业主抱怨过的噪声。哪天真要显示「装着时装但这位没有」，把这里换成
// `hasAnySkinChoices` 即可（`ui/skins.js` 已经导出了它）。
//
// 样式：`css/screens/loadout.css` 的 `.lo-skin*` 一组（垂直单行列表，左侧头像 / 中间名称与系列 / 右侧状态标签）
// 是**本仓早就写好、一直没有组件用**的那一份 —— 这里照着它的类名画，不新增 CSS。

import { html, MicroLabel } from './components.js';
import { Img } from './gameComponents.js';
import { useStore } from '../store.js';
import { data, useData } from '../data.js';
import {
  SKINS_KEY, skinsStore, availableSkins, hasSkinChoices, chosenSkin, setSkin, clearSkin,
  installAppearanceSync,
} from './skins.js';
import { appearanceFirstEnabled } from './portraitChain.js';
import { installBuiltinSkinProvider } from './skinProvider.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const str = (v) => (typeof v === 'string' && v ? v : null);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 「默认」那一格：这个干员自己的立绘（**不**回落占位图 —— 它有官方美术，清单里就在 `chars[charId]` 上）。
 * 点它 = `clearSkin`，也就是「不使用时装」。
 * @param {string} charId @param {any} manifest
 */
function ownRow(charId, manifest) {
  const rec = isObj(manifest) && isObj(manifest.chars) ? manifest.chars[charId] : null;
  const art = rec ? str(rec.portrait) || str(rec.avatar) : null;
  return { id: '', own: true, name: '', series: null, pack: '', art };
}

/**
 * 「皮肤」区的**全部判断**（组件只画它的结果）—— 于是这块界面的行为能在 Node 里直接测，不需要浏览器。
 *
 * 返回 null 的四种情形，每一种都等于「与今天逐字相同」（今天 `SkinSection` 就是 `return null`）：
 *   1. 没有 chess / 没有 charId（自选格、召唤物…）；
 *   2. `enabled === false`（设置里「工坊外观」关掉了 ⇒ 解析链那一步整段不存在，这里也不该卖时装）；
 *   3. 清单没到（`data.get('assets')` 是 null）；
 *   4. 这个干员**一套可选外观都没有**（见文件头「显示的判据」）。
 * @param {any} chess chess.json 的记录（或任何带 `charId` 的东西）
 * @param {{ manifest?: any, entries?: Record<string, string>|null, enabled?: boolean }} [opts]
 * @returns {{ charId: string, count: number, chosenId: string|null,
 *   rows: { id: string, own: boolean, name: string, series: string|null, pack: string, art: string|null }[] } | null}
 */
export function skinSectionModel(chess, { manifest = null, entries = null, enabled = true } = {}) {
  const charId = str(chess && chess.charId);
  if (!charId) return null;
  if (enabled === false) return null;
  if (!manifest) return null;
  if (!hasSkinChoices(charId, { manifest })) return null;
  const picked = chosenSkin(charId, entries || {}, { manifest });
  return {
    charId,
    count: availableSkins(charId, { manifest }).length,
    chosenId: picked,
    rows: [
      ownRow(charId, manifest),
      ...availableSkins(charId, { manifest }).map((s) => ({
        id: s.id, own: false, name: s.name, series: s.series, pack: s.pack,
        // 格子的图优先立绘（`.lo-skin__art` 是个 1:1 小方框，两边都能裁），其次头像
        art: s.portrait || s.avatar,
      })),
    ],
  };
}

/**
 * 一格外观的**标记树**（纯函数：没有 hook、不读 store）—— 于是「画出来的类名对不对」能在 Node 里直接断言，
 * 不需要浏览器（`test/ui/skins.test.js` 就是拿它钉 `.lo-skin*` 这组既有 CSS 的）。
 *
 * 类名全部来自 `css/screens/loadout.css` 的 `.lo-skin*` 那一组（本仓早就写好、一直没有组件用）：
 * `.lo-skin` / `.lo-skin.is-on`（选中）/ `.lo-skin__art`（左边那个小图）/ `.lo-skin__art--none`（没有图）/
 * `.lo-skin__text` / `.lo-skin__name` / `.lo-skin__group` / `.lo-skin__badge`（右侧状态标签）。
 * @param {{ id: string, own: boolean, name: string, series: string|null, pack: string, art: string|null }} row
 * @param {boolean} chosen
 * @param {(row: any) => void} onPick
 */
export function skinTileTree(row, chosen, onPick) {
  const label = row.own ? t('默认') : row.name;
  const title = row.own ? t('干员本体，不使用时装') : chosen ? t('点击回到默认外观') : t('点击选择这套外观');
  const meta = row.own ? 'DEFAULT' : row.series || row.pack || t('时装');
  return html`<button type="button" role="radio" aria-checked=${chosen ? 'true' : 'false'} data-skin=${row.id}
      class=${cx('lo-skin', chosen && 'is-on')} title=${title} onClick=${() => onPick(row)}>
    <span class="lo-skin__art">${row.art
      ? html`<${Img} src=${row.art} alt=${label} />`
      : html`<span class="lo-skin__art--none"></span>`}</span>
    <span class="lo-skin__text">
      <b class="lo-skin__name">${label}</b>
      <span class="lo-skin__group">${meta}</span>
    </span>
    ${chosen ? html`<span class="lo-skin__badge">${t('使用中')}</span>` : null}
  </button>`;
}

/**
 * 「皮肤」区的**标记树**（同样是纯函数，理由同上）。`onPick(row)` 由调用方给：`row.own` 时它应当
 * `clearSkin(charId)`，否则 `setSkin(charId, row.id)` —— 那一层判断留在组件里（它才知道 charId）。
 * @param {NonNullable<ReturnType<typeof skinSectionModel>>} model
 * @param {(row: any) => void} onPick
 */
export function skinSectionTree(model, onPick) {
  return html`<section class="lo-sec lo-sec--skin" data-testid="skin-section">
    <header class="lo-sec__head">
      <h3>${t('皮肤')}<${MicroLabel}>SKIN<//></h3>
      <span class="lo-sec__note">${t('{n} 套外观', { n: model.count })}</span>
    </header>
    <div class="lo-skins" role="radiogroup" aria-label=${t('选择皮肤')}>
      ${model.rows.map((row) => skinTileTree(row, row.own ? !model.chosenId : model.chosenId === row.id, onPick))}
    </div>
  </section>`;
}

/**
 * 「皮肤」区（`screens/loadout.js` 的详情里挂 `<${SkinSection} chess=${chess} />`）。
 *
 * 三个读数，各有一个理由：
 *   * `skinsStore` 的 `entries` —— 玩家点一下就重画（选择是这块界面唯一的状态）；
 *   * `useData('assets')` —— 清单是**懒加载**的：它落定时这里要重画一次，否则先开的详情永远空着；
 *   * `appearanceFirstEnabled()` —— 「工坊外观」总闸（`ui/settings.js` 是唯一写入面）。它不是 hook，
 *     所以开关在面板开着时被改不会立刻重画 —— 那时面板通常没开着，而它下一次打开一定读到新值。
 * @param {{ chess: any }} props
 */
export function SkinSection({ chess }) {
  const entries = useStore((s) => s[SKINS_KEY], Object.is, skinsStore);
  useData('assets');
  const model = skinSectionModel(chess, {
    manifest: data.get('assets'),
    entries,
    enabled: appearanceFirstEnabled(),
  });
  if (!model) return null;
  const pick = (row) => { if (row.own) clearSkin(model.charId); else setSkin(model.charId, row.id); };
  return skinSectionTree(model, pick);
}

// ---- 开机装一次（浏览器） -----------------------------------------------------------------------------------
//
// `main.js` **不需要改**：`main.js:77` 在开机时 import `screens/loadout.js`，而它 import 本模块（第一行）
// ⇒ 这两句在第一帧之前跑完。两件事都要在第一帧之前就位：
//   * **提供者**：否则首帧画的是原版、下一帧才跳过去（「闪一下再变」比不生效更难查，见 portraitChain 步骤 0）；
//   * **同步引擎**：进房间时 `room.state` 到达就要把玩家上次的选择发给服务端（服务端只把它存在会话上）。
// Node 里（测试）不装：`typeof window` 一并把「浏览器」这个前提说清，于是 `node test/ui/…` 读到的永远是「没装」
// 的那一份，测试自己决定要不要装。
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installBuiltinSkinProvider();
  installAppearanceSync();
}
