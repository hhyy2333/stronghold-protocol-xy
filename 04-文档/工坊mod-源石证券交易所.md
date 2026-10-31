# 工坊 mod「源石证券交易所」— 炒股，但用卫戍协议的资金炒

> 交付物：`app/workshop/originium-exchange/`（已装进这台机器的 Forge 包）+ `源石证券交易所-1.0.0.zip`（发给别人用）。
> 形态是**工坊包**：不改引擎一行代码，靠 MOD-SURFACE 的 `client.panels`（C 层）+ `server.modules(matchClass)`（B 层）实现。

## 1. 玩法

每局开一家交易所。六支「盟约概念股」随本局各盟约的**冷热**（几名玩家在玩、叠了多少层）与随机新闻涨跌；
玩家在**休整期**用对局里的**资金**买卖股票，每回合按持仓吃**分红**，可以**借钱加杠杆**，也会**爆仓**，
结算时比**总资产**。

> **2026-10-20 业主口径修正**：初版每股 100 块，实测**一单都买不起** —— 引擎每回合收入只有 4~12，
> 且休整期结束时没用完的钱清零（`economy.leftoverFundsLost: true`），整局总收入约 130。
> 已改成 **5~10 块一股 + 杠杆（2x / 3x）**。

| 股票 | 盟约 | 开市价 | 波动 | 特点 |
|---|---|---|---|---|
| YAN 尚蜀重工 | 炎 | 7.00 | 0.95 | 稳健 |
| VIC 伦蒂尼姆兵工 | 维多利亚 | 6.00 | 1.10 | 大盘 |
| SIR 叙拉古食品 | 叙拉古 | 9.00 | 1.20 | 偏贵 |
| KAZ 卡西米尔骑士竞技 | 卡西米尔 | 5.00 | 1.25 | 低价高波动 |
| KJE 谢拉格矿业 | 谢拉格 | 10.00 | 0.85 | 高价低波动 |
| AEG 阿戈尔深海科技 | 阿戈尔 | 8.00 | 1.30 | 妖股 |

价格**保留两位小数**：整数口径下 5~10 块的股票吃 ±7% 噪声常常四舍五入成 0，行情会拉成直线。

规则数值（都在 `server/exchange.mjs` 顶部三张表里，改完重启服务器生效）：

| 项 | 值 |
|---|---|
| 交易窗口 | 只有 `PREP`（休整期）；作战/结算按钮禁用，服务端也拒单 |
| 资金同步 | 休整期买棋子 / 刷新商店 / 卖棋子导致资金变化时，交易所**自动**补一帧（服务端在引擎 `flush` 之后按现金去重），不用再下一次单 |
| 手续费 | 成交额 ≥ 10 才收，1%（四舍五入、最少 1） |
| 分红 | 每回合「持股 × 现价 × **5%**」向下取整，先分红再改价 |
| 持仓上限 | 每股 **60 股** |
| 单回合涨跌 | 冷热 `-3%..+6%` + 个股噪声 `±7%×波动` + 新闻 `±8..22%`，夹在 `±25%` |
| 股价区间 | 1.00..60.00 |
| 新闻 | 每回合 35% 概率一条，走引擎的滚动条（`m.ticker`）全房间可见 |
| 开市 | 第 1 回合开始；第 2 回合起分红与涨跌 |
| 出局 | 持仓作废、不再分红；收盘显示「已出局」 |

### 杠杆（2026-10-20 新增）

| 档位 | 能借多少 | 说明 |
|---|---|---|
| **1x** | 0 | 不借钱（默认） |
| **2x** | 最多 1× 净资产 | 净资产 = 现金 + 持仓市值 − 负债 |
| **3x** | 最多 2× 净资产 | |

- **先花现金、不够才借**：一单要 36 而手里有 20，就借 16。
- **利息 6%/回合**：从现金扣；付不出就**资本化进负债**（利滚利）。
- **卖出先还债**，剩下的才进现金 —— 现金每回合清零，**还债才是留住价值的路**。
- **维持担保比例 70%**：`负债/持仓市值 > 70%` ⇒ **强制平仓**（从最不值钱的那支开始卖），卖到 ≤ 50%。
- **降档要还得起**：负债超过新档额度时拒绝降档，先把钱还上。
- 爆仓与平仓都在**服务端**执行，面板只收到结果。

**确定性**：行情 = `mulberry32(Match.seed, 回合, 股票 id, 盐)` —— 同一局同一种子必然同一段行情，
不读时钟、不用 `Math.random`。资金变动只走引擎唯一写口 `PlayerState.addFunds()`，随既有 `m.private` 同步。

## 2. 安装 / 启用 / 卸载

- **这台机器已经装好**（`app\workshop\originium-exchange\`）。**重启游戏服务器**后生效：关掉 `启动游戏.bat` 的窗口，再双击一次。
- 发给别人：把 `源石证券交易所-1.0.0.zip` **拖到 `安装工坊包.bat` 上**即可（装进对方的 `app\workshop\`，重启生效）。
- 默认每局都启用；房主可以在房间的「模组管理」里单独关掉。
- 卸载 = 删掉 `app\workshop\originium-exchange\` 文件夹，重启。
- 这是 `combat: true` 的玩法包：进房间摘要闸门，客户端会按房间自动对齐字节，所有人看到的行情与成交结果一致。

## 3. 界面

- 挂在 `screen.game.aside`（对局界面右侧的固定浮层）：默认收起成一枚「源石证交所」竖标签，点开是抽屉。
- 顶部：回合 / 相位 / 总资产 / 现金 / 持仓 / 负债；新闻条；数量档位 1 / 5 / 10 / 全部；杠杆档位 1x / 2x / 3x。
- 面板里的现金与可借额度会跟着对局资金实时变（买棋子花了钱，交易所立刻少一截可借额度）。
- 每行：代码、公司、现价（两位小数）、涨跌幅（红涨绿跌）、迷你走势、持股、买 / 卖（持仓为 0 时卖按钮禁用）。
- 收盘：抽屉里盖一层本局总资产排行，标出「股神」。
- 窄屏（≤640px）自动变底部抽屉；面板一挂上时页面上不多任何东西，收到第一份行情才出现。

## 4. 实现（为什么能不改引擎）

| 层 | 用到的表面 | 落点 |
|---|---|---|
| B 服务端 | `server.modules[{ uses:["matchClass"], channels:["trade"] }]` | `server/exchange.mjs`：`registerServer(host)` → `host.matchClass(Base => class extends Base)`，覆写 `startRound / enterPrep / startCombat / finish / handlePackMsg` |
| C 客户端 | `client.panels[{ slot:"screen.game.aside", module, styles, messages:["trade","market"] }]` | `ui/exchange.js` + `ui/exchange.css`：`mount(ctx)` 纯 DOM，`ctx.net.on('market')` 收下行、`ctx.net.send('trade')` 下单 |
| 线协议 | 只用引擎已有的 `pack.msg`（C2S/S2C 白名单类型） | 上行 `trade`，下行 `market`；**没有新增任何协议类型** |
| 资金 | 引擎唯一写口 `ps.addFunds()`（负数=花钱）；`dirty()` 让资金变化走既有 `m.private` | 不改 `data/*.json`、不改规则 |

安全与失败方向：

- 服务端模块**零 import**，过引擎 import 前的静态扫描（无 `process` / `globalThis` / `require` / `eval` / `new Function`）；
- 所有覆写包 `try/catch`：行情坏了最多「交易所不动」，不会打断对局；
- 面板没有 store、没有对局对象、拿不到 socket 之外的口子，只画与发自己的通道消息 —— 改不了对局结果；
- 数值裁决全在服务端：数量、价格、手续费、持股上限、相位、淘汰，面板发什么都得再过一遍；
- 没装这个包 ⇒ 干净安装一个字节都不变；装了但房间关掉它 ⇒ 走引擎原有的「按房间集合物化」。

## 5. 验证记录

| 验证 | 结果 |
|---|---|
| `node tools/workshop-validate.mjs workshop/originium-exchange` | **0 error / 0 warning**，VALID |
| 服务端逻辑自测（假 Match，`app/.scratch/exchange-lead/selftest.mjs`） | 40+ 断言全过：开市、分红、确定性行情、买卖手续费/资金不足/持股上限、相位闸门、淘汰清仓、收盘排行、ticker |
| 真引擎装载链路（`app/.scratch/exchange-lead/wiring.mjs`） | `loadWorkshop` 0 error；`loadServerModules` 1 模块 + 1 个 matchClass 包装器；面板 wire 表 slot/messages/styles 正确；源码扫描 0；zip export→import→再 export **字节一致** |
| 真 Match 对局（验证员 `app/.scratch/exchange-verify/03-real-match.mjs`） | 真 solo 对局 R1 开市 → PREP 买 10 股（手续费 10）→ COMBAT 拒单 → R2 分红 15（先旧价再改价）→ 卖 4 股 → 审计 0 违规；同 seed 两局 R2 行情一致 |
| 淘汰不变式（验证员发现，已修） | 修复前：淘汰者下一回合仍领分红 → `invariants.js` 报 `eliminated with funds`。修复后复跑 0 违规 |
| 客户端面板（验证员假 DOM 测试 `app/.scratch/exchange-client/`） | 10/10：初始隐藏、6 行渲染、买卖发帧、数量档位、收盘排行、丢弃非法、提示淡出、hello 重试、unmount 清理 |
| 真 Chromium 截图 | **本机做不了**：DSH 沙箱禁止子进程命名管道，Chromium 的 mojo 通道起不来（`platform_channel.cc: Access denied`）。面板已由假 DOM 测试覆盖逻辑，CSS 按 `.oex` 作用域静态审查 |

## 6. 风险与已知限制

- **平衡是 mod 级的**：分红会让「攒钱炒股」成为一种可行打法。改了 `LIMITS` / `STOCKS` / `NEWS` 就能调；它不追求官方平衡。
- **面板位置**：`screen.game.aside` 是右侧固定浮层，抽屉展开时会挡住右侧一部分画面；窄屏变底部抽屉。收起后只剩竖标签。
- **只认官方盟约 id**：六支股票绑的是 `data/bonds.json` 里的 `yanShip` 等；官方改盟约 id 时改 `STOCKS` 表即可。
- **Forge 更新**：本包只依赖 `pack.json` 表面（`client.panels` / `server.modules` / `pack.msg`）。上游若抬 `MOD_API_VERSION` 到 2，本包会被**响亮拒绝**（这正是设计意图），届时按新表面迁移。
- **重连**：面板挂载时若已在局内会发 `hello` 补状态（最多 3 次）；对局进行中重连的行情以服务端下一次推送为准。

## 7. 文件

```
app\workshop\originium-exchange\
  pack.json                  清单：combat、server.modules、client.panels
  server\exchange.mjs        服务端：行情/分红/交易/结算（零 import，全 try/catch）
  ui\exchange.js             面板：mount(ctx) 纯 DOM + 两个纯函数（数量口径）
  ui\exchange.css            样式：全部 .oex 作用域、含窄屏
  README.md                  包内说明（也进包身份哈希）
源石证券交易所-1.0.0.zip      发行包（拖到 安装工坊包.bat 上安装）
```

改包注意：包目录里**每个普通文件都进身份哈希**（README 也算），改一个字就是新摘要、重启后客户端要重新对齐。
