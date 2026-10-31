# fix-client-render · 上游 0.3.3 两条客户端热修复（§38.3 贴图缓存 / §38.1 商店装备位）

> 任务：task-10（原派单写 task-8，不存在，已作废）。
> 依据：`04-文档/上游0.3.3对比/D-0.3.3与热修复试移植.md` §1.a / §1.c，以及上游 `docs/history/0.3.3.md`、
> `CHANGELOG.md:17-37`。上游参照包只读，未改动。
> 改动范围：`app/public/js/render/units.js`、`app/public/js/render/textures.js`、`app/public/js/render/app/host.js`、
> `app/server/match/player/views.js`、`app/public/js/ui/shopBar.js`；测试：新增 `app/test/render/content-set-cache.test.js`、
> `app/test/ui/shop-columns.test.js`，扩展 `app/test/match/feedback5-shop-levelslots.test.js`。
> 未碰 `app/data/*.json`、`PROTOCOL_VERSION`、golden、`server/sim/`；未 commit、未 npm install。

---

## 1. 改了什么

### 1.1 第 1 项：贴图 / 查表缓存按「解析出来的图 URL」存（上游 §38.3）

| 文件:行 | 改动 |
|---|---|
| `public/js/render/units.js:2515` | `new P.Sprite(itemTexture(String(info.defId \|\| 'item'), null, color))` → `itemTexture('none', null, color)`（占位底板与 id 解耦，上游同款 `'none'`） |
| `public/js/render/units.js:2527` | `setIcon` 加载完成后 `itemTexture(String(this.info.defId), img, color)` → `itemTexture(url, img, color)`（**这是主修复**：同 id 换内容集后不再命中旧 canvas） |
| `public/js/render/textures.js:1270-1276` | `itemTexture(key, …)` → `itemTexture(url, …)`；缓存键表达式不变（`url|有无图|边框色`），改的是**语义**与文档：模块级 `_items` 缓存跨页存活，因此它的键必须是解析后的图地址，不能是 item id |
| `public/js/render/app/host.js:52-59` | 补位记录缓存 `standIns: chess → rec` 改成 `chess → { backups, rec }`，`cached?.backups === b` 才复用（上游 host.js:48-58 同形） |
| `public/js/render/app/host.js:70-79` | 自选编队记录缓存 `diys: key → rec` 改成 `key → { chess, backups, rec }`，`cached?.chess === chess && cached?.backups === b` 才复用（上游 host.js:65-76 同形）；`chessMap()` 提到 try 之前只取一次，合成与记录用同一个对象 |

判"在我方是否成立"：我方没有 `data/versions/`、没有 `shared/versions.js`（`UPSTREAM_VERSION` 单值），所以上游那个
「第一期↔第二期切换」画面我方不存在；但同一类通道我方是开的 —— `public/js/data.js:359 setContent({ id, values })`
按文件名整体替换 `entries`（内容集切换 / 热数据），而 `render/*` 与页面同生共死，`_items` 是模块级 Map。
所以这是「把缓存键从身份改成内容」，不是修一个现网画面。`host.js` 那两个 Map 每代渲染器重建（`render/app.js makeData(opts.data)`），
但它俩仍会跨一次内容集切换存活，顺手对齐上游同一条审计结论。

### 1.2 第 2 项：第一期商店的装备位（上游 §38.1）

| 文件:行 | 改动 |
|---|---|
| `server/match/player/views.js:143-148` | 私有视图 `shop` 增发 `layout: { ...(this.shop.layout || this.gd.shopSlots(this.shop.level)) }`（与上游逐字相同；浅拷贝，不把服务端内部对象漏给序列化）。服务端内部 `this.shop.layout` 早就有（`economy.js:256/265/289/296`），本项目只缺"发布"这一步 |
| `public/js/ui/shopBar.js:78-114` | 新增纯函数 `export function shopColumns(slots, layout)`：有 `layout`（两个整数、非负）时前 `chess` 格为干员列、其后 `item` 格为装备列；没有/畸形 `layout` 时退回按卡片 `kind` 推断（[ASSUMED] 旧帧兼容）。另回报 `itemOpen`（本等级到底有没有装备位：true / false / null=未知） |
| `public/js/ui/shopBar.js:385-389` | `ShopBar` 改用 `shopColumns(slots, shop.layout)`，不再自己按 kind 分栏 |
| `public/js/ui/shopBar.js:474-478` | 装备列里 `!s`（升级新开、或装备池抽干）画 `EmptyCard item`，不再落到 `s.sold` 之后的售罄分支 |
| `public/js/ui/shopBar.js:484-488` | 装备列整列没有卡时的兜底：`SoldCard item`（SOLD OUT / 已购买）→ `EmptyCard item`（裸框）。**列本身不消失** |

**关于上游 402 行那处自相矛盾（D 报告 1.a ⚠️）**：上游在 `layout.item === 0` 时仍然画 SOLD OUT / 已购买，与它自己
CHANGELOG「未开放的装备位不画售罄卡」和 e2e 断言冲突；D 报告建议别抄。按 lead 的裁定（2026-10-30）落地为：
**空装备位画 `EmptyCard`，且不照抄上游「整列消失」那段** —— 装备列容器永远保留（`.shopbar__item` 的虚线与间距不变），
1–4 级没有装备位时它是一张裸框，绝不谎报「已购买」；真实买过的装备仍是 `SoldCard`（已购买），行为不变。
副作用（已知，见 §4）：这张裸框的 title/aria 仍是「空栏位：刷新或下回合开始时补满」，在"本等级没有装备位"时略乐观；
要区分就得给 `EmptyCard` 一个新文案，那是四个语言包的事，不在本任务的改动面内。

不改 `PROTOCOL_VERSION`：`m.private.shop` 只会**增**一个可选字段，旧客户端忽略，旧帧没有就按 kind 兜底
（与上游同口径；`shared/protocol.js` 不逐字段登记 `m.private.shop` 子字段）。

---

## 2. 依据（官方口径 → 落地）

| 官方说法 | 落地 |
|---|---|
| 「同一颗道具棋的 id 在不同版本里指不同道具…渲染层的贴图缓存原来按 item id 存」 | `ItemView` 的底板键换成 `info.icon`（图 URL）；占位用 `'none'` |
| 「改成按解析出来的图 URL 存（含图片就绪状态与边框色）」 | `itemTexture(url, img, color)`，键 `url|img?1:0|color` 原样保留 |
| 「补位 / 自选编队的合成记录缓存也改成校验源 chess / backups 对象后再复用」 | `host.js` 两处 `{ backups, rec }` / `{ chess, backups, rec }` |
| 「服务端 m.private.shop.layout = { chess, item } 如实报实际位数」 | `views.js privateView().shop.layout`，值取 `this.shop.layout`（真实位数，含冻结态） |
| 「客户端据此定位空栏；未开放的装备位不画售罄卡。已购买的真实装备仍显示「已购买」」 | `shopColumns` 分栏 + `EmptyCard`；`sold` 仍 `SoldCard` |

我方既有决定不受影响：装备位数量、抽取、库存、价格、升级后"只开空位不送卡"（`economy.js _openLevelSlots`，
业主 2026-10-07 决定）一行未动。琳琅诗怀雅 S3 一类业主决定未触及。

---

## 3. [ASSUMED]（代码里已标）

1. `ui/shopBar.js shopColumns`：**没有 layout 的帧按卡片 `kind` 推断**，与上游 0.3.3 的 `[ASSUMED]` 同口径（旧服务端 / dev mock）。
2. `layout.item === 0` 时装备列画一张 `EmptyCard`（保留列、不谎报已购买）—— 上游此处代码与它自己的 changelog 矛盾，
   我方的选择见 §1.2；这是本次唯一一处**有意偏离上游代码**的地方。
3. `itemTexture` 的键仍是 `url|img?1:0|color`（不含图片尺寸/内容哈希）：同 URL 换图（同路径不同内容）不会失效，
   与上游同口径（上游也只把 id 换成 URL，没有内容哈希）。
4. `host.js` 的 `chess` 校验用 `chessMap()` 的**对象身份**（上游同款）：内容集切换换对象才失效，原地改内容不失效。

---

## 4. 测试

### 4.1 新增 / 扩展的用例

| 文件 | 断言 |
|---|---|
| `app/test/render/content-set-cache.test.js`（新，8 例） | ① `itemTexture` 同 URL 同色 → 同一对象；异 URL 同色 → 两个对象；`'none'` 独立；有图/无图两条条目。② `ItemView` 无图时底板 = `itemTexture('none', …)`（且 ≠ 按 defId 取的那条）。③ **同 defId、两个内容集 → 两张不同的底板**（主回归）。④ 源码断言：`units.js` 不再把 `defId` 交给 `itemTexture`。⑤ `makeData().standIn`：同 backups 对象复用同一 rec，换 backups 对象必须重算。⑥ `makeData().diy`：换 chess 或 backups 都要重算。⑦ `host.js` 两处 `{…rec}` 缓存形状。 |
| `app/test/ui/shop-columns.test.js`（新，11 例） | `shopColumns`：新开的空装备位留在装备列（`[c,c,c,null]` + `{3,1}` ⇒ 装备列 `[3]` 且 `s === null`）；空干员位留在干员列；已购装备卡仍在装备列；`item 0` ⇒ 列空 + `itemOpen === false`；两装备位；无 layout / 畸形 layout 退回 kind；空 slots。源码断言：`ShopBar` 用 `shopColumns(slots, shop.layout)`、空位是 `EmptyCard item` 且在 sold 分支之前、装备列容器不被丢弃、装备列里不再有 `SoldCard item`。 |
| `app/test/match/feedback5-shop-levelslots.test.js`（扩） | 升级到 2 级后 `ps.privateView().shop.layout` = `{chess:4,item:1}`，且 `layout.chess + layout.item === slots.length`（空槽也在内）。 |

**红 → 绿**：把 `units.js` 两行、`host.js` 两处 guard、`views.js` 的 `layout` 各撤回一次重跑，确认
`content-set-cache` 由 8 绿变 6 红、`feedback5-shop-levelslots` 由 3 绿变 1 红；恢复后再次全绿。
`shop-columns` 的纯函数用例在改前是"导入失败"（`shopColumns` 不存在）。

### 4.2 跑过的测试与结果（`node test/<file>.test.js` 单文件直跑）

| 命令 | 结果 |
|---|---|
| `node test/render/content-set-cache.test.js` | **8 pass / 0 fail** |
| `node test/ui/shop-columns.test.js` | **11 pass / 0 fail** |
| `node test/match/feedback5-shop-levelslots.test.js` | **3 pass / 0 fail** |
| `node test/render/charge-ring.test.js` | 9 / 0 |
| `node test/match/protocol-levels.test.js` | 19 / 0 |
| `node test/match/merge.test.js` | 14 / 0 |
| `node test/match/feedback1b-items.test.js` | 5 / 0 |
| `node test/ui/diy-ui.test.js` | 19 / 0 |
| `node test/ui/feedback1b-bonds.test.js` | 6 / 0 |
| `node test/ui/feedback7-orchid-freeze.test.js` | 4 / 0 |
| `node test/ui/playtest6-elite.test.js` | 9 / 0 |
| `node test/ui/playtest6-ui.test.js` | 11 / 0 |
| `node test/ui/moduleIcons.test.js` | 5 / 0 |
| `node test/ui/standin-ui.test.js` | 15 / 1（**先存失败**：断言的 `render/app.js` 正则找不到，与我改的文件无关） |
| `node test/ui/feedback1-offers.test.js` | 7 / 1（**先存失败**：`band_narant` 的 `rewardOffer` 为 null；把 `views.js` 的 layout 行撤掉重跑仍是 7/1，与本次改动无关） |
| `node test/match/economy.test.js` | 5 / 3（**先存失败**：SOLD_OUT / HAND_FULL / 冻结口径；撤掉 layout 行仍 5/3） |
| `node test/match/scroll-copy-merge.test.js` | 9 / 2（同上，撤 layout 行仍 9/2） |
| `node test/match/connection.test.js` | 12 / 1（同上） |
| `node test/match/hardening.test.js` | 21 / 1（同上） |
| `node test/docs-consistency.test.js` | 16 / 9（**先存失败**，撤 layout 行仍 16/9） |
| `node test/docs-paths.test.js` | 2 / 5（沙箱内 `spawnSync git EPERM` + 树里缺 `test/golden/`、`test/plugins/` 等目录，环境/先存问题） |
| `node test/client-static.test.js` | 318 / 252（**环境**：该文件每条模块用例都 `spawnSync(node, --check)`，沙箱 EPERM ⇒ 全树每个 `public/js/*.js` 都报 "syntax error"，含未改动的 `data.js`；改用 `node --check <file>` 直查，我改的 5 个文件全部 `ok`） |
| `npx eslint` 我改的 5 个源文件 + 3 个测试文件 | **0 error**，8 个 warning 全是改动前就有的（textures.js 的 `rgba`、units.js 的 no-useless-assignment） |

---

## 5. 没做 / 做不了的项

1. **浏览器视觉复核**（D 报告 §3 要求「改完手看一次商店布局」）：沙箱里没有浏览器（`SP_E2E=1` 需 Chrome），
   `test/ui/shop-empty-slot.e2e.test.js` 未跑。**待人工看一眼**：默认模式装备位恒 1，看不到差异；要看到差异得用
   `mode_training_1`（5 级才开装备位）或把装备池抽干。dev mock（`public/dev/game-mock.js:187`）的 `shop` 没有
   `layout`，所以 mock 页面走的是 kind 兜底路径（e2e 的既有断言不受影响）；想让 mock 也演示新路径需要给 mock 加
   `layout`，那不在我的改动面内。
2. **文档没跟着改**：我方 `docs/design/*` 与 `docs/history/*` 目前只到 §35（0.3.0 插件系统），上游 §38 在我方编号是
   §40，这个 section 还没被创建（属于 0.3.1/0.3.2/0.3.3 那一批移植的产物）。所以本次只在代码注释与这份记录里登记，
   **没有**新增 `## 40.` 之类的 heading —— 那会同时改动 `docs/DESIGN.md` 索引表与 `docs/design/*`，超出本任务的文件边界。
   建议 lead 在整批移植收尾时统一补 §40（含本两条 + §38.2「我方本来就等价」的说明）。同理 `PROTOCOL_VERSION` 未动。
3. **上游 `test/render/item-icon-cache.test.js`、`test/ui/version-equipment.e2e.test.js` 未照抄**：前者对应我方
   `test/render/content-set-cache.test.js`（已覆盖同样的问题，且不依赖版本机制）；后者要 `data/versions/` 与 e2e 环境，
   我方没有版本机制，`shopColumns` 的分栏改成纯函数后由 `test/ui/shop-columns.test.js` 覆盖。
4. **`public/js/dev/game-mock.js` 未加 `layout`**（见 5.1），未在 mock 上做视觉验证。
5. **没跑 `npm run ci` / `npm run golden`**：本改动不碰 `server/sim/`、不碰 golden、不碰 `data/*.json`；且沙箱里
   `npm run ci` 的多处子进程步骤会 EPERM（见 `client-static` 一栏）。
