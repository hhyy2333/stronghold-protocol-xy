# 移植记录 · fix-sim-enemies（0.3.2 三条敌人行为修复）

> 任务：上游 0.3.2 的三条敌人行为 bug（血珀自流 / 心虚设计师正面朝向 / 淤困附着闪现），落到我方
> `Stronghold-Protocol-Forge-协议源石版/app`（下称 app/）。上游参照包只读。
> 依据：`04-文档/上游0.3.3对比/C-0.3.2.md` §1.1 第 8/9 条、§3 档 A（A6 / A7）；§37.95 见 `上游:docs/history/0.3.2.md:4830`。
> 任务号 task-7（已 claim / complete）。**未 git commit。**

## 0 一句话

三条都在我方成立、都按上游语义落地；血珀与淤困是**纯 sim**改动，心虚设计师是「判定 + 我方 `dir` 同步」，
**逐 tick 的客户端朝向**（上游 events.js 的 `face` 通道）与**淤困瞬移的客户端插值切断**（上游
`public/js/render/interp.js`）不在本次写域，已报 lead。

## 1 逐项

### 1.1 血珀 `enemy_1367_dseed`（上游 §37.107 / PR #720）

**我方缺陷**：`server/sim/content/enemies.js` 的 `STATS_ONLY` 登记为「inert, not counted」——原地站桩不掉血。

**改动**
| 文件 | 位置 | 内容 |
|---|---|---|
| `app/server/sim/content/enemies/special.js` | :386 新 `enemy_1367_dseed` kit；:363-364 拷打者注释改「bleed out」 | ① `spawn`：`noAttack` + 常驻 buff `ab:dseed`，flags `selfBound / noMove / unblockable / noDisplace`（自缚 / 不移动 / 无法被阻挡 / 失衡免疫）；② `iv: 1` + `tick`：`b.loseHp(e, e.s.maxHp * Passive.hp_ratio)` |
| `app/server/sim/content/enemies.js` | 原 :463（现 :462 附近）**只删 1 行** | 删掉 `STATS_ONLY` 里的 `enemy_1367_dseed: 'altar pulse absent …'`（KITS / BOSS_KITS / STATS_ONLY 必须恰好占一个，见 `test/content/enemies_bosses.test.js:56`；lead 已授权只删这一行） |

**语义要点**
- **真实流失**：走 `Battle.loseHp`（`battle/combat.js:48`）——不吃 DEF 3000 / RES 90、不触发闪避与屏障、`tags: ['hpLoss']`、
  **无来源**，且**可以致死**（`applyHpLoss` 照常结算，10 秒流干）。
- **每秒 10%**：靠 kit 循环的固定步长（`enemies.js onTick` 的 `iv` 累加器，TICK = 1/30 s），**不用时钟、不用 rng**，
  完全确定。
- **0% 庇护不减伤**：数据 `Passive.damage_resistance = 0`，因此**什么也不做**（代码里写明理由，不写一个假的乘子）。
- **祭坛脉冲后的重生不实现**：本模式没有唤血祭坛 / 沥血王座（数据 `desc` 只在说那次重生），照上游只留「无祭坛时自流」。
- **拷打者留的两只**：`spawnChildren(..., { route: stayRoute(e), countInTotal: false })` 原样保留——不计击杀、停在原地。
- `[ASSUMED]`：**1 秒的间隔**。天赋表只给比例（`Passive.hp_ratio = 0.1`），周期取自手册「每秒」这句。

### 1.2 心虚设计师 `enemy_10097_crshd`（上游 §37.108 / PR #869）

**我方缺陷**：`frontGuard(…, faceMove)`，注释「faces its walk」——被阻挡时正面不转向阻挡者。

**改动** `special.js` :287 新 `faceCrshd`；:483 把 `frontGuard(cut, faceMove)` 换成 `faceCrshd`；
:13 的 import 去掉不再用的 `faceMove`。

**语义要点**
- 有存活阻挡者且**不同列**：`a.facing = sign(blk.x - e.x)`——正面 80% 减伤（`frontGuard.hitIn` 的 `(s.x-e.x)*a.facing > 0`）**跟着转**。
- 没被阻挡：退回走路方向（与 `faceMove` 同义），行为不变。
- **同列的阻挡者保持上一次朝向**（`[ASSUMED]`：PRTS 只说「正面」，没写同列怎么判）。
- 顺手把 `e.facing = a.facing` 同步到 `dir`（`units.js` 的 `facing` setter）：`snapshot.js unitInfo.facing` 立刻正确，
  **任何在此之后新建的视图**（观战/重连/联防他人战场）画的就是正确朝向。
- 附带影响（已核）：`u.dir` 只影响盟友部署朝向与精灵翻转；我方 sim 里没有任何敌人按 dir 旋转攻击格（已 grep），
  这条只对这个 key 生效。

### 1.3 淤困 `enemy_9007_acelem`（上游 §37.95 / PR #803）——**我方有这套，已修**

先确认：我方确有淤困 =`enemy_9007_acelem`（`element.js kitParasite`，KITS 注册于 :203 附近；i18n / 悬赏数据里也有），
所以**不是「不适用」**。

**改动** `app/server/sim/content/enemies/element.js`：+ `hypot`(detmath) / `stepToward`(helpers) 两个 import；
`kitParasite.tick` 附着成功时 :136-141 新增：直线闪现到**阻挡者格心**（`stepToward(e, host.tileC, host.tileR, hypot(...))`，
无寻路、确定）→ 丢掉过期路径 `e.route.pts = null`（解除后从新位置重算，ai.js 既有约定）→ 加 `ab:parasiteAttached`
（`noMove + selfBound`，自缚）→ 发 `teleport` fx（带 `fromX/fromY`，客户端据此切断插值）；:126-129 与 :149
（换宿主 / 死亡）一并移除 `ab:parasiteAttached`，**离开宿主即解除自缚**。**不附加「无法被阻挡」**（上游同）。

- 客户端那半（`public/js/render/interp.js` 认 `fx kind==='teleport' && params.kind==='parasite'` 时断插值 + 抑制外推）
  **未做**：不在我的写域，已报 lead 转客户端同学。sim 侧已经把 `fromX/fromY` 发出去，客户端接上即可。

## 2 测试

新文件 **`app/test/sim/enemies-special.test.js`**（5 条，全部最小可复现）：

1. `血珀`：`selfBound/noMove/unblockable/noDisplace` 全为真、`noAttack` 为真、与阻挡者同格仍 `blockedBy === null`；
   `run(1.05)` 掉 `0.1 × maxHp`、`run(+1.0)` 掉 `0.2 × maxHp`；**位置不变、0 次攻击**。
2. `血珀` 流干：9 s 后剩 10%，第 10 秒**死**，`b.total` / `b.killed` 都不动（`countInTotal: false`，与拷打者同路径）。
3. `心虚设计师` 左侧被挡：`facing === -1`，正面 arts 伤害 = 背面 × (1−0.8)；右侧被挡：`facing === +1` 且减伤跟着转到右侧。
4. `心虚设计师` 未被挡时朝走路方向（左 −1 / 右 +1）；同列阻挡者保持上一次朝向（`[ASSUMED]` 钉桩）。
5. `淤困`：附着后 `x/y` **正好等于阻挡者格心**、`ab:parasiteAttached` 带 `noMove/selfBound`、恰好 1 个
   `teleport` fx 且 `fromX > 当前 x`；2 s 不动；宿主倒下后 buff 消失、重新开始移动。

**改动前红 / 改动后绿**（把三处改动临时回退后跑同一文件）：`pass 0 / fail 5`；改回后 `pass 5 / fail 0`。

**跑过的文件与结果**（一律 `node <file>` 单跑，`app/` 为工作目录）：

| 文件 | 结果 |
|---|---|
| `test/sim/enemies-special.test.js`（新） | pass 5 / fail 0 |
| `test/sim/combat.test.js`（含淤困寄生/爆发用例） | pass 24 / fail 0 |
| `test/sim/playtest5_elements.test.js`（含淤困） | pass 18 / fail 0 |
| `test/sim/feedback2-stealth-splash.test.js`（含淤困扩散） | pass 9 / fail 0 |
| `test/content/extra-enemies.test.js`（KITS / STATS_ONLY 互斥） | pass 13 / fail 0 |
| `test/sim/detmath.test.js`（确定性） | pass 7 / fail 0 |
| `test/sim/facing.test.js` / `facing-invariance.test.js` | pass 11 / 5，fail 0 |
| **`test/content/enemies_bosses.test.js`** | **pass 286 / fail 1**（收尾时实测；中途一度 fail 13，见下） |
| `eslint` 三个改动文件 + 新测试 | 0 error（3 warning 均为既有行，不是我改的） |

**红的那几条不是我**（中途 fail 13，收尾时只剩 1 条）。证据：把我在 `special.js` + `element.js` 的改动**全部临时回退**后，
同一文件是 `pass 272 / fail 15`——比当时的 274/13 多出的 2 条正是我修好的（KITS/STATS_ONLY 互斥、拷打者用例），
红的 13 条两边**完全相同**。它们全部是 bosses.js 的首领行为（胄 / 刺胄之弹 / 管 / 弦 / 昆图斯 / 阿利斯泰尔 / 萨米的意志 /
自在 / 腐败骑士 / dwlock_2 / leader summons / enemyScale），与 **attack-slot 同学正在进行的 0.3.2 §37.19「攻击类技能占普通
攻击回合」移植**同域：`enemies.js` 里已出现 `attackSlotSkill / attackTurnSkill / castNow / markAttackTurn`，`bosses.js`
未提交差异 +454 行（两者 mtime 在我作业期间 19:06 变动）。收尾复跑时他的改动已把 13 条压到 1 条：
**盐风主教昆图斯**（`enemies_bosses.test.js:2975`，`TypeError: Cannot read properties of undefined (reading 'amount')`）——
正是他注释里点名的「昆图斯三形态【大潮】占攻击回合 + 1.667 s clip」那条。**建议 lead 在 attack-slot 收尾后复跑这一个文件归因。**

**注意**：`test/content/enemies_bosses.test.js` 里拷打者那条用例被我按新行为改了（原来写 `run(20)` 断言两只血珀「还活着、
不动」）：现在 5 s 内不动、之后流干，且 `b.total` / `b.killed` 仍不动。这与 attack-slot 同学在同文件的改动是**不同函数**，
但同文件，合并时留意。

## 3 没做 / 做不了的

| 项 | 原因 |
|---|---|
| 心虚设计师**逐 tick 客户端朝向** | 我方快照的 `facing` 只在 `unitInfo`（建视图时）发一次，逐 tick 改朝向需要事件通道（上游 `events.js` 的 `face: [[id, ±1]]`）+ `public/js` 消费。`server/sim/battle/events.js` 与 `public/js` 不在我写域，已报 lead 派给客户端同学。**我做到的是**判定正确 + `dir` 同步（新建视图正确） |
| 淤困**客户端短距离瞬移** | 上游改的是 `public/js/render/interp.js`（认 `teleport` fx 的 `kind==='parasite'` 断插值/抑制外推）。sim 侧 `fromX/fromY` 已发，客户端未接 |
| `docs/design/` 文档更新 | 这三条都是**单个敌人能力**，`docs/design/engine.md:187` 只汇总「SPECIAL 类行为」不逐敌列举；我方逐敌细节写在代码注释与 release notes。且本 checkout 的 `test/docs-consistency.test.js` / `docs-paths.test.js` **本来就是红的**（缺 `test/golden` 与若干文档路径，见 C-0.3.2 §5.2），改动无法自证。已在 `app/CHANGELOG.md` 留文案（下面第 4 节）由 lead 统一并入 |
| golden | 本 checkout 无 `test/golden/` 语料，`npm run golden` 跑不出结论（C-0.3.2 §5.2 已记） |

## 4 建议并入 `app/CHANGELOG.md` 的三行

- **修**：血珀（`enemy_1367_dseed`）在场上没有唤血祭坛 / 沥血王座时每秒流失 10% 最大生命（真实流失，可致死）；
  仍自缚、失衡免疫、不攻击、无法被阻挡，骸骨拷打者留下的两只依旧不计击杀、停在原地（上游 0.3.2 §37.107）。
- **修**：心虚设计师（`enemy_10097_crshd`）被阻挡时正面朝向阻挡者那一侧，正面 80% 减伤跟着转；未被挡时仍朝走路方向；
  同列阻挡者保持上一次朝向。
- **修**：淤困（`enemy_9007_acelem`）附着时闪现至阻挡者格心并自缚，离开宿主即解除；sim 侧发出 `teleport` fx（带起点）
  供客户端切断插值。
