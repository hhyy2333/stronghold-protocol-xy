# 战地商店 · field-store

一个纯工坊包 + 引擎一格 `Match.grantHex`：每局的**休整期**开一家商店，卖**全部装备**（协议源石专属的那几件除外）
和**协议源石抽取**。

## 这是什么

业主 2026-10-23 的三条口径：

1. **装备：每回合上架全部装备** —— 不轮换、不抽 3 件、没有「换一批」。装备范畴 = 引擎自己的可上架装备
   （`itemType = EQUIP`、非金卡、非 `hideInShop`、非 `shopExcluded`，共 **51 件**，1~6 阶）。
   那 7 件**只由协议源石发放**的特殊装备（幽魂 / 恶魔之契 / 残光 / 加护 / 万物归虚 / 尸山 / 心之钢）因此天然
   不在货架上 —— 它们 `hideInShop` 且 `price = 0`，与引擎 `isShopItem` 是**同一条判据**，本包不另写一份。
2. **装备价格 = 原价 ×3**：原价 1~5 块 ⇒ 本店 3~15 块（整数，四舍五入不做）。**卡上只写价格本身**
   （业主 2026-10-23「直接显示价格不要显示原价1-3」）—— 3 倍仍然是规则，只是不把算式写在卡上。
3. **抽取协议源石 = 12 块一次**：付 12 块抽 **1 张随机**的我方协议源石，按 1 阶 46 % / 2 阶 38 % / 3 阶 16 %
   加权、档内均匀；跳过**已拥有**的与本局你自己**禁用**的（≤3 张）。抽到的那张走引擎的**正式发放路径**
   （即时 `onPick` 生效、持久 `hex:<id>` 生效、战斗半边与镜像协议等 extras 全在），不是「只加个图标」。

## 规则

| 项 | 值 | 说明 |
|---|---|---|
| 装备价格 | 原价 ×3 | 原价来自 `data/items.json` 的 `price` |
| 装备范围 | 全部 51 件 | 不按调度中心等级筛选（业主原话「每回合都是全部装备」）；想恢复「只开到调度中心等级的阶级」，在 `server/store.mjs` 的 `_fsBuy` 闸门里加一条 `row.tier > ps.shop.level` 即可（一行） |
| 装备成交 | 进手牌 / 整备区，重复即合并成金卡 | 共享库存说话（`itemPool.canGain`），默认数据是无限库存 |
| 抽卡价 | 12 块 / 次 | 不设每回合 / 每局次数上限（12 块的定价 + 每回合 ≤12 的收入就是闸门） |
| 抽卡池 | 我方协议源石 − 已拥有 − 本局自己禁用的 | 抽干之后拒绝（`noHex`），**不扣钱** |
| 相位 | 只有休整期 | 机变 / 协议源石抽取 / 战斗 / 结算一律不营业 |
| 座位 | 只有真人 | AI 与观战者不进商店 |

**拒绝时一分钱都不扣**，理由逐条具名：`item`（货架没有这件）/ `stock`（共享库存见底）/ `funds`（还差 N 块）/
`hand`（整备区已满）/ `phase` / `dead` / `seat` / `closed` / `noHex` / `grant`。

## 安装 / 启用 / 卸载

* **安装**：把本目录放进服务器的 `workshop/`（或把导出的 `field-store-1.0.0.zip` 在工坊页里装），重开
  `启动游戏.bat`。包声明 `combat: true`，所以它会进房间摘要：**服务端与客户端必须装同一份字节**。
* **只给部分房间用**：建带 mod 集合的房间时把 `field-store` 列进去即可（与交易所同一条）。
* **卸载**：删掉 `workshop/field-store/`（或用 `enabled: false` 停用）—— 引擎侧唯一新增的是
  `Match.grantHex`，**没有任何基础对局调用它**，所以卸载后对局逐字节回到原样。

## 界面

入口在**商店栏的按钮行里、`冻结` 的左边**：一颗横排的「商店」按钮（与冻结 / 刷新同高，有买得起的东西时右上角
亮一个红点）。它挂在新槽位 `screen.game.shopTools`（DESIGN §28.8）上，所以位置是引擎给的、跟着 HUD 的 rem
缩放走，不用量像素。点开后是**从商店栏上方弹出的抽屉**（右对齐，宽 344 px，交易所占上半屏右侧，互不打架）：

* 头部：资金 + 收起；
* **装备**页：阶级过滤（全部 / I~VI，带各档件数）+ 搜索框 + 51 张紧凑卡（图标 / 名字 / 阶级 / 一行描述 /
  价格数字）；点「购买」第一下变成「确认 · n」，第二下才真的下单（防手滑），4 秒不点自动撤回；
* **协议源石**页：一张金边卡「抽取协议源石 · 12 块 / 次 · 随机一张」，显示还有几张没抽到、上一次抽到了谁；
  同样两段确认；
* 每次成交 / 拒绝都会在底部回执行留一句话，5 秒淡出。

商店栏被玩家「✕ 收起」时按钮跟着一起消失（它就长在那一行里）—— 展开商店它就回来，而且**立刻**回来：
宿主 `[data-mod-slot]` 一被 Preact 渲染出来，注册点就接住它（`public/js/ui/slotHostWatch.js`），面板一挂上
就补问一次货架（旧版本要等 400 ms 才问，见下面「验证记录」/ `workshop/originium-exchange/README.md` 的同一条
改动）。业主 2026-11-05：「进入那个按钮是在展开商店一段时间之后才刷出来」。

**手机 / 矮屏**（业主 2026-10-24「手机的商店装备只显示一点点」）：横屏手机上商店栏本身占掉约 3/4 屏高，抽屉
钉在它上方就只剩一行。现在 `max-height ≤ 620px` 或 `max-width ≤ 767px` 时抽屉改成**从顶栏下面铺到屏幕底部**
（宽屏一条 520 px、竖屏铺满宽度），盖住商店栏、关掉即回；头部 / 页签 / 过滤条同时压缩，描述行在手机上隐藏
（留在 tooltip 里），阶级过滤条改成横向可滑的一条。​

## 实现

| 半边 | 走哪条路 |
|---|---|
| 装备 | 全是现成公开路径：`this.itemPool.canGain/left`（共享库存）、`ps.acquireItem(id,{source:'shop'})`（合并 / 进整备区 / 库存记账）、`ps.spend(price)`，再补 `onBuy` / `onSpend`（整备、债务这类卡要看见「买了东西」） |
| 抽卡 | 引擎**一格**新方法 `Match.grantHex(ps, hexId)`（DESIGN §28.58）：包不能 import `applyHex`（零 import 纪律），更不能自己拼一份会静默漂移的 EffectRef，所以引擎把「正式发放」收成一个可复用的方法，测试场 `g.testHex` 也改用它 —— **一条实现** |
| 定价 / 抽谁 / 扣钱 | 全在包里。这样业主改价格只动 `server/store.mjs` 顶上的两个常量 |
| 随机 | 包自己的 FNV-1a + mulberry32（种子 = 本局 seed、回合、玩家 id、该玩家第几次抽），**不碰** `m.rngShop` / `m.rngHex`，也不读时钟；货架是全集 ⇒ 装备那边根本没有随机 |
| 资金同步 | 挂在引擎已有的 `flush()` 上：现金变了才补一帧 `sync`（货架不重复下发，一条 ~200 字节），零轮询、零定时器 |
| 入口位置 | 引擎**一格新槽位** `screen.game.shopTools`（DESIGN §28.8）：商店栏的按钮行由 grid 改成 flex 两行（`ui/shopBar.js` 里多包了一层 `.shopbar__toolrow`），`冻结` 左边渲染 `[data-mod-slot="screen.game.shopTools"]`。包在这格里画一颗横排按钮，抽屉是它的 fixed 子元素 —— **不量像素、不猜宽度**，按钮跟着 HUD 的 rem 缩放 |

## 验证记录

在本机（Windows，DSH 沙箱内）实际跑过：

```
> node test/match/grantHex.test.js
ℹ tests 4  ℹ pass 4  ℹ fail 0

> node test/workshop/field-store.test.js
ℹ tests 22  ℹ pass 22  ℹ fail 0

> node tools/workshop-validate.mjs workshop/field-store
pack field-store (战地商店)
  OK
0 error(s), 0 warning(s)
VALID: the engine accepts this content.
```

测试覆盖：51 件全集与「7 件协议源石专属不在货架」；价格一律 = 原价 ×3；抽卡与引擎 `rollOffers(count: 1)`
在 40 组种子上**逐位等价**；真实引擎里买装备（扣钱 / 落位 / 回执）、抽卡（扣 12 / 真发到手上 / 播报）、
以及 `item / stock / funds / hand / phase / seat / closed / noHex` 八条拒绝路径**资金与 effects 一字节不动**；
帧体 < 4096 字节；假 DOM 里面板画 51 行、过滤、搜索、两段确认、离开休整期收起、`unmount` 退订、**挂载当帧
就发 hello（1.0.1）**。

**真浏览器实测**（`puppeteer-core` + 本机 Edge headless，真服务器 + 真对局走到休整期，1280×720）：收起商店栏
再展开，那颗「商店」按钮 **21–29 ms** 就可见（基线 HEAD：150 ms 时按钮还没有，整块面板 1.3 s ~ 2.6 s 之后才挂
上）。之前「本机做不了真 Chromium 截图」那条结论在本机已经不成立（沙箱不再拦子进程命名管道）。前后对照图与
可重跑的测量脚本在 `public/dev/mod-entry/`。

## 风险与已知限制

* `[ASSUMED]` **不按调度中心等级开放阶级**：业主说「每回合都是全部装备」，所以第 1 回合就能买 6 阶装备。
  想改成「只开到本回合该有的阶级」，在 `server/store.mjs` 的 `_fsBuy` 闸门里加一条 `row.tier > ps.shop.level`（一行）。
* `[ASSUMED]` **同一件可以重复买**（钱够就行），重复购买交给引擎合并成金卡。
* `[ASSUMED]` **抽卡是随机 1 张**，不是三选一（「抽取」按抽卡语义理解）。
* `[ASSUMED]` **不设抽卡次数上限**：12 块的定价本身就是闸门。
* 装备走 `acquireItem` 的普通路径，所以**整备区已满时买不了**（与引擎自己的商店同一条判据）。
* `onBuy` 用一个合成的 `slot: { kind:'item', id, price }` 下发（本店不是引擎的商店格）；今天的
  `onBuy` 处理函数只读 `ev.kind` / `ev.piece`，没有一处依赖「slot 在 `ps.shop.slots` 里」。
* 包的 `server/*.mjs` **零 import**：不跨包 import，也不 import 引擎内部（同一份字节要能在别的服务器上跑）。

## 文件

```
workshop/field-store/
  pack.json            # id / combat:true / server.modules(uses:matchClass, channels:["store"]) / client.panels
  server/store.mjs     # 货架、定价、抽卡、闸门、帧（零 import）
  ui/store.js          # 面板（零 import；tierLabel / filterCatalog / priceLine 是导出的纯函数，方便单测）
  ui/store.css         # 全部选择器收在 .fst 下
```

引擎侧（本包带的两格引擎改动）：

```
server/match/match/hexDraft.js   # + MatchHexDraft.grantHex(ps, hexId)（DESIGN §28.58）
server/match/match/testField.js  # g.testHex 改为复用 grantHex（一条实现）
shared/modSurface.js             # + server.modules.matchHex 表面行
public/js/ui/shopBar.js          # 按钮行包一层 .shopbar__toolrow + 冻结左边渲染 screen.game.shopTools 宿主
public/css/screens/game-shop.css # .shopbar__tools 由 grid 改 flex 两行（按钮行才能插第三格而不挤行）
shared/workshop.js               # CLIENT_PANEL_SLOTS + screen.game.shopTools（§28.8 闭枚举，11 个）
public/js/ui/extensions.js       # MOD_PANEL_SLOTS 同一份名单
docs/MOD-SURFACE.md              # + server.modules.matchHex 表面行
docs/design/mod-layer.md         # + §28.58；§28.8 的槽位表与计数同步
docs/WORKSHOP.md                 # 挂载点表 + 「十一个挂载点」
docs/SYNC-POINTS.md              # + 「加一格包能调的 Match 方法 —— 5 处」；§4 槽位计数 11
docs/UPSTREAM-UPGRADE.md         # §2.3 挂载点清单
test/match/grantHex.test.js      # 引擎方法契约
test/workshop/field-store.test.js# 本包（纯函数 / 真实引擎 / 假 DOM）
```
