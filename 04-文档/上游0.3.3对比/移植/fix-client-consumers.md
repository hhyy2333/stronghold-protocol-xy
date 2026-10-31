# L — 客户端消费端补齐（task-12）

> 起因：sim 侧两样东西已经算对并且发出去了，客户端没人消费 ——「算对了、画不出来」。
> 路径约定：**我方**相对 `Stronghold-Protocol-Forge-协议源石版/app`（写 `app/...`）；**上游**写 `上游:...`。
> 契约面：**`shared/protocol.js` 未改一行**，`PROTOCOL_VERSION` 仍是 `2`（`app/shared/constants.js:16`）。b.snap 帧只多了一个**可选**键。

---

## §0 一句话

两条消费端都接上了：**朝向走 b.snap 的 `face: [[id, ±1]]`（edge，只发变化的那一帧）**，**淤困的短距离瞬移按 `fx teleport` + `kind:'parasite'` 切断插值、原地停住再落到新格**；两条各配了一个可运行断言（`移植/check-client-consumers.mjs`，5/5 通过），改动共 3 个源文件、生产代码净增约 40 行。

---

## §1 两个症状 → 两个改法

| # | sim 已经做了什么 | 客户端原来怎样 | 现在怎样 | 落点 |
|---|---|---|---|---|
| 1 | `faceCrshd` 每 tick 把「朝阻挡者」同步到 `e.facing`（`app/server/sim/content/enemies/special.js:287-300`，跑在 `frontGuard` 的 tick 上：`app/server/sim/content/enemies/archetypes.js:407-417`） | `UnitInfo` 只在**建视图时**带一次 `facing`（`app/server/sim/snapshot.js:41`）⇒ 模型从出生到重连都朝着出生方向 | 快照新增 `face` 列表，客户端收到变化就把模型转过去 | `app/server/sim/battle/events.js:112-116,141` + `app/public/js/render/interp.js:167-175,469` + `app/public/js/render/units.js:148` |
| 2 | `kitParasite` 附着瞬间把敌人 `stepToward` 到阻挡者格中心，并发 `b.fx('teleport', { x, y, fromX, fromY, id, kind:'parasite' })`（`app/server/sim/content/enemies/element.js:133-141`） | `SnapshotBuffer` 只看距离：0.2 格的小跳当作走路**插值**，看起来是「溜过去」；速度还会被 `units.js` 拿去做 `visFacing` 翻转 | 认出这个 fx 就**切断**那段插值：先停在旧格，到闪烁时刻直接落到新格；跨过闪烁也不做外推 | `app/public/js/render/interp.js:223,267-271,292-302,365-368,419-426,444` |

---

## §2 改法一：逐 tick 朝向（`face` 通道）

### 2.1 形状照谁 —— 一处路径更正

任务书写的是「照 `上游:server/match/events.js` 的 face 事件形状」。上游**没有** `server/match/events.js`；face 的官方形状在
**`上游:server/sim/battle/events.js`**（我方的同源文件就是 `app/server/sim/battle/events.js`）：

- `上游:server/sim/battle/events.js:94`：文档条目 `face: [[id, ±1]]`
- `上游:server/sim/battle/events.js:131`：`if (u.mem.publishFacing) (face || (face = [])).push([u.id, u.facing]);`
- `上游:server/sim/battle/events.js:165`：`if (face) snap.face = face;`
- 消费端：`上游:public/js/render/interp.js:174-181`（`normalizeSnapshot`）与 `:467`（`sample().face`）

所以我按**同一个形状**接：b.snap 多一个可选列表，**不新增 `b.ev` 事件类型**（那要让 `app/public/js/render/app.js` 的事件路由多认一种 tuple，反而更贵、更不像上游）。

### 2.2 三处改动

1. **服务端发布**（`app/server/sim/battle/events.js`）
   - `:112-116`：在快照循环里，按 `u.facing` 取符号（`Unit` 的 getter，`app/server/sim/units.js` 里 `dir === 'LEFT' ? -1 : 1`），**只有和上一帧发布过的符号不同才写一行**；`u.mem.facePub` 记上一帧的值（`mem` 是每个单位都有的自由 scratch，`app/server/sim/units.js:88`）。
   - `:141`：`if (face) snap.face = face;`。
   - `:60-65`：文件头的快照条目文档补一条，并写清「display only / 九字段 tuple 不变 / 没有单位转身就一个字节都不发」。
   - **为什么不用上游的 `mem.publishFacing` 内容开关**：我方 `faceCrshd` 并没有设那个旗标（`app/server/sim/content/enemies/special.js:297-298` 只写 `a.facing` / `e.facing`），而任务约束只让我改这两个文件 —— 改成**变化检测**就不需要内容配合，将来任何逐 tick 转向（不止心虚设计师）都自动通；代价是首帧不重复发（`UnitInfo` 已经带出生朝向，重连也走 `UnitInfo`）。
2. **客户端取样**（`app/public/js/render/interp.js`）
   - `:167-175` `normalizeSnapshot`：`face` 列表 → `Map`，**只收 ±1 且 id 在 `units` 里**的条目（坏条目丢掉，和 `stand` / `standCut` 同一套规矩）。
   - `:469`：`o.face = A.face ? A.face.get(id) ?? null : null` —— 和 `ammo` / `layers` 一样取**旧的那张快照**的值，所以它跟 flags 同步、不滑动。
3. **渲染应用**（`app/public/js/render/units.js`）
   - `:148`：`syncView` 里 `if (s.face != null) v.setFacing?.(s.face)`，**在 `v.sync()` 之前**：走路的单位仍按速度翻（`update` 里的 `|vx| > 0.08`），站住的单位采用快照的符号。
   - `:1311-1318`：`setFacing` 的敌人分支原来是只写 `this.facing`，可敌人画的是 `visFacing`（`app/public/js/render/units.js:1338` 的 `modelSign`），站住的敌人拿不到速度翻转 ⇒ 一并写 `_visFacing`。盟友分支不动（它走 `setDir`，会换 Front/Back 模型）。

### 2.3 契约面

- b.snap 帧（`app/server/match/fields.js:61-64 snapFrame` 原样透传快照）**多一个可选键 `face`**；`shared/protocol.js` 一个字符没改，**`PROTOCOL_VERSION` 不抬**（旧页面不认这个键，就当没有）。
- 「新字段不声明就没有」：一个没有单位转身的战斗，`snap.face` 永远不会出现（断言 A 的第 2/4 步钉住这一点）。
- 不进 golden：snapshot 是 display-only，sim 状态一个都没读它（`face` 与 `stand` / `standCut` / `ammo` 同类）。

### 2.4 若客户端没接上，会看到什么（症状）

- **心虚设计师一直朝着出生方向**：它被推动 / 绕到阻挡者另一侧之后，模型不转，但 sim 的「正面 −80% 物理/法术减伤」（`frontGuard` 的 hitIn，`app/server/sim/content/enemies/archetypes.js:411-415`，按 `a.facing` 算）已经按**新**朝向算 —— 玩家会看到「打它背后反而减伤 / 打正面照吃」，是典型的「判定对了、模型没转」。
- 中途加入观战 / 断线重连的人**看到的是对的**（视图按 `UnitInfo` 重建，带当前 `facing`）⇒ 同屏两个人看到的朝向不一致，是这条 bug 最好认的特征。
- 断言表现：`移植/check-client-consumers.mjs` 的 A 条会红（`the changed frame publishes the sign once` 拿不到 `face`）。

---

## §3 改法二：淤困 teleport 的插值切断

### 3.1 改动（全在 `app/public/js/render/interp.js`）

1. `:223` `reset()`：新增 `this.parasiteBlinkTimes = new Map()`（每单位一个闪烁时刻数组）。
2. `:292-302` `pushEvents()`：遇到 `['fx','teleport',x,y,{ id, kind:'parasite' }]` 就把**它被盖的那个时间戳**记到该单位名下（上限 32 条，旧的丢）。记的是时间戳而不是 fx 本身 —— fx 是 cosmetic，落后时会被 `takeEvents` 丢掉，但**切断是状态**，不能跟着丢。
3. `:267-271` `push()`：裁剪快照时顺手清掉比最旧快照还早的闪烁时刻（否则这张 Map 只涨不落）。
4. `:365-368` `_parasiteBlinkAt(id, from, to)`：区间 `(from, to]` 里第一次闪烁的时刻，没有就 `Infinity`。
5. `:419-426` `sample()`：`tele` 多一个条件 `jumpAt < Infinity`；落点用 `afterJump = alpha >= 1 || time >= jumpAt` 决定 —— 闪烁前停在 `a`（旧格），闪烁后直接 `b`（新格），**全程不插值**；`vx/vy` 因为 `!tele` 而为 0，所以既不会「滑」也不会被当成走路去翻 `visFacing`。
6. `:444` 外推分支：跨过闪烁的区间不给速度（否则会在闪烁之后继续沿旧速度预测）。

形状照 `上游:public/js/render/interp.js:298-305`（记录）/ `:365-369`（`_parasiteBlinkAt`）/ `:417-424`（`jumpAt` + `afterJump`）与 `:441-442`（外推守卫）；**只认 `kind === 'parasite'`**，别的 `teleport` fx 仍走原来的距离规则（上游 `:16-18` 的行文，断言 B3 钉住）。

### 3.2 若客户端没接上，会看到什么（症状）

- **淤困「溜」到阻挡者身上**：附着那一刻的 0.2–1 格小跳被 lerp 成一段平滑滑动（约 1–2 帧的位移，2× 战斗速度下看得见），并且 `units.js:1248` 会用它算出的速度把 `visFacing` 翻一下 ⇒ 模型先朝错的一侧再回来。
- **跨格数较大时反而「跳」得对**：位移超过 `teleport` 阈值（默认 2.5 格）会走距离规则，看起来是瞬间跳；于是同一招在不同距离下表现不一致 —— 这也是「有时正常有时不正常」的来源。
- 附着之后 bug 还在：因为瞬移被当成走路，`stand` 那套「到位后停住」的显示规则不生效，敌人会在附着瞬间抖一下。
- 断言表现：`check-client-consumers.mjs` 的 B2 会红（`cut: it is still on the old tile while the interval runs` 拿到中间插值）。

---

## §4 可运行断言

`04-文档/上游0.3.3对比/移植/check-client-consumers.mjs`（在本仓库根目录跑，不需要浏览器 / PIXI / 服务端）：

```bash
node "04-文档/上游0.3.3对比/移植/check-client-consumers.mjs"
```

| # | 断言 | 覆盖 |
|---|---|---|
| A | 快照 `face`：没变的帧不带这个键；翻走的那一帧带 `[[id, -side]]`；下一 tick `faceCrshd` 把它转回来，再带 `[[id, side]]`；之后又静默 | 服务端发布（含 `faceCrshd` 真的会改朝向这一半）—— 用真实 `makeBattle` + `enemy_10097_crshd` 被真实干员阻挡 |
| B1 | 没有 fx 时，0.2 格位移**被插值**（半程 10.1，有速度） | 对照组：切断不是因为「小位移一律不插值」 |
| B2 | 带 `kind:'parasite'` 的 `teleport` fx：中途仍在旧格（10）、速度为 0；到点落到新格（10.2）；越过闪烁不外推 | 插值切断（纯函数 `SnapshotBuffer`） |
| B3 | `kind` 不是 `parasite` 的 `teleport` fx：仍正常插值 | 不误伤别的瞬移表现 |
| B4 | `face` 是 edge（变化帧 ±1 / 其余 null）；非 ±1 的符号、快照里没有的 id 被丢掉 | 客户端取样与清洗 |

实际输出：**5/5 通过**（`A ok / B1 ok / B2 ok / B3 ok / B4 ok`）。

入库建议：A 移到 `app/test/content/facing-crshd.test.js`，B1–B4 移到 `app/test/render/interp-face-teleport.test.js`（`app/test/render/` 目前只有 `charge-ring.test.js`，正好补上 interp 的位置）。

---

## §5 验证跑过的套件

| 命令（cwd = `app/`） | 结果 | 说明 |
|---|---|---|
| `node ../04-文档/.../check-client-consumers.mjs`（根目录跑） | **5/5 通过** | 就是 §4 |
| `node test/match/feedback1-runner-forms.test.js` | **14/14 通过** | 唯一 import `render/interp.js` 与 `SnapshotBuffer` 的套件：晚进场 / 隐藏标签页 / 追赶帧全绿 ⇒ 我没改坏插值缓冲 |
| `node test/content/facing.test.js` | **14/14 通过** | 朝向 / 阻挡 / 推拉方向一族；`frontGuard` 与 `e.facing` 的行为没变 |
| `node test/render/charge-ring.test.js` | **9/9 通过** | `units.js` 仍可加载（该文件同时在跑别人的充能环改动） |
| `node test/sim/battle.test.js` | **27/27 通过** | 战斗主套件，快照每 tick 都在产出 `face` 候选 |
| `npx eslint <改的 3 个文件>` | **0 error** | 3 个 warning 全在 `units.js` 里别人的充能环/技能 clip 片段（`:1022/:1031/:2263`），不是本次的 |
| `node test/docs-consistency.test.js` | 16 通过 / **9 失败（预存在）** | 失败项断言的是 items / bosses / playtests / 语音的**文档与代码一致**（`app/test/docs-consistency.test.js:787-826` 一类），与这三个文件无关；这棵工作树里 `data/*.json`、`docs/*`、`CHANGELOG.md` 本来就是大面积未提交的改动 |
| `node test/sim/hud-readouts.test.js` | 4 通过 / **2 失败（预存在）** | 失败断言是 `娅娜 S2 的技能 kind`（`app/test/sim/hud-readouts.test.js:83`：实际 `'instant'`、期望 `'charges'`），读的是 kit 分类，与快照字段无关 —— 我方 `data/chess.json` 的这版数据/kit 漂移 |

> golden：本树没有 `test/golden/`（`app/CHANGELOG.md:50` 已写明），所以「0 移动」这条在这里无法跑；本次改动不读也不写任何 sim 状态，按 display-only 归类。

---

## §6 范围与后续

- **改了 3 个源文件**（任务书说 2 个）：`server/match/events.js` 这个路径在**两个仓库里都不存在**（真正的发布者在 `server/sim/battle/events.js`）；另外「客户端渲染消费」这一步只能落在 `public/js/render/units.js`（`syncView` 与 `setFacing` 都在里面，`interp.js` 够不到视图对象）。除这两个必要落点外没有扩大改动：生产代码每处 ≤ 6 行。
- 未做（留给后续，不在本任务范围）：`UnitView.setFacing` 对**盟友**的 ±1 语义仍只有左右（UP/DOWN 保持原方向，`app/public/js/render/units.js:1315-1317`）；如果以后有逐 tick 转向的**干员**（目前没有），要另行决定是否允许 `setDir` 换 Front/Back。
- 未做：`face` 目前只被 `units.js` 的敌人翻转读；`public/js/render/vfx/` 里的官方特效如果需要「跟随朝向」，也要走 `sample().face`，这颗钉子钉在 `syncView` 上，将来一处即可复用。
