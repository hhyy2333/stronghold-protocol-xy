# fix-bands-match · 五条规则修复移植记录（task-8）

> 上游参照：`C:/Users/hhyyl/Downloads/Stronghold-Protocol-Forge-0.21.0-0.3.3/Stronghold-Protocol-Forge-0.21.0-0.3.3`（下称 `上游:`）
> 我方代码树：`Stronghold-Protocol-Forge-协议源石版/app`（下称 `app/`）
> 依据报告：`04-文档/上游0.3.3对比/C-0.3.2.md` §3 档 A 第 3/4/5 条、`B-0.3.1.md` §2.4 / §2.5
> 全部五条**改绿**，每条有新增断言且已实测「改前红、改后绿」（下面逐条给出复现方式）。

## 0. 写域（比你原给的清单多 5 个文件，已获你批准）

| 文件 | 属于 | 改动量 |
|---|---|---|
| `app/server/sim/content/bands/meta.js` | 原清单 | 鸭爵抽签重写、5 个 key 换 hook、凯瑟琳排除 |
| `app/server/match/match/phases.js` | 原清单 | `bossPairSalt` + R15 首次规划重抽 |
| `app/server/match/fields.js` | **原清单写的 `sim/battle/fields.js` 不存在**，实际落点 | `uniteBillBounds`、`validateClientResult` |
| `app/server/match/unite.js` | **原清单写的 `sim/unite.js` 不存在**，实际落点 | `uniteSurvivors` |
| `app/server/match/gamedata.js` | 原清单 | **无需改**：`:215` 只是注释（说明 `also` 不进商店池），缺陷不在这里 |
| `app/server/match/match/spDraft.js` | 原清单 | **无需改**：`:273` 同样是注释；重抽发生在 `rollItems`→`ctx.rollPool` |
| `app/server/match/effectsMeta.js` | 新增（批准） | `ctx.seedFor`（3 行只读）、`GARRISON_HOOK`、特质遍历 hook 白名单 |
| `app/server/match/player/prep.js` | 新增（批准） | `pickReward` 拿到突变细胞即计数 + 清理排队 offer |
| `app/server/sim/battle/spawns.js` | 新增（批准） | 联防运行时子体打 `uniteRuntime`、`_scheduled` |
| `app/server/sim/battle/deploy.js` | 新增（批准） | leak 条目带出 `uniteRuntime` |
| `app/server/sim/spec.js` | 新增（批准） | `uniteLeft` 过滤 `uniteRuntime` |
| `app/server/match/Match.js` | 新增（2 行） | `bossPairsRound` 初始化 + 那句已过时的注释 |

## 1. 逐条总表

| # | 条目 | 状态 | 关键 diff 位置 | 测试文件与数字 |
|---|---|---|---|---|
| 1 | 鸭爵「神秘顾客」每回合只抽一次（#839） | **改绿** | `bands/meta.js`: `unitAction`/`notOwn`/`duckPicks`/`applyDuckPicks`/`duckReplace`（约 409–580 行）、`duckGlobal` 用 `createRng(ctx.seedFor('duck:'+round))`；`effectsMeta.js:664 ctx.seedFor` | `test/sim/fork-fixes-duck-draw.test.js` **5/5**；`test/content/bands.test.js` 鸭爵用例（含四人同抽断言）39/39；`test/match/feedback1-ducklord.test.js` 5/5；`test/sim/feedback5-cb4-pins.test.js` item 35 |
| 2 | 「进入休整期时」改挂机变之后（#851） | **改绿** | `bands/meta.js` 5 个 key `onRoundStart`→`onPrepStart`（`preparation_start_gain_chess_from_round` / `..._every_n_round` / `prep_start_gain_chess_from_pool_in_round` / `round_start_gain_char_chess_in_shop_every_n_round` / `preparation_start_add_special_goods_every_n_round`）；`effectsMeta.js:81 GARRISON_HOOK.SERVER_PREP_START='onPrepStart'` + `:415` 特质遍历白名单加 `onPrepStart` | `test/content/fork-fixes-prep-start.test.js` **6/6**；`test/content/garrisons_meta.test.js` 32/32（开工前 helper 只派发回合开始，改成两个 hook 后全绿）；`test/content/bands.test.js` 39/39 |
| 3 | 隐秘核心 R15 重抽分组（#845） | **改绿（含一条上文批准的有意偏差）** | `phases.js`: 新增 `bossPairSalt(gd, round)` + `_planBossWaves` `fresh = hidden && bossPairsRound !== r`、`fresh ? null : this.bossPairs`、`this.bossPairsRound = r`；`Match.js:644 bossPairsRound = null` | `test/match/fork-fixes-hidden-core-pairs.test.js` **4/4**；`test/match/finalAssault.test.js` 12/12 |
| 4 | 凯瑟琳突变细胞每玩家每局一次（#677） | **改绿** | `bands/meta.js`: `rollItems(..., exclude)` + `MUTATION_CELL_EFFECT`/`isMutationCell`/`mutationCellIds` + `up_shop_add_special_goods` 排除与 `source:'band:band_cathy'`；`player/prep.js` `pickReward` 拿到即写 `band:cathy:cellTaken` 并从排队同源 offer 去掉那一格 | `test/match/fork-fixes-catherine-cell.test.js` **4/4**；`test/match/feedback5-cathy-pool.test.js` 1/1；`test/match/fuzz.test.js`（回放/模糊）2/2 |
| 5 | 联防只给漏过来的那一波记账（#675） | **改绿** | `spawns.js:154-161`（`kind==='unite' && !opts._scheduled ⇒ e.uniteRuntime`）+ `_processSpawns` 传 `_scheduled`；`deploy.js _recordLeak` 带出标记；`spec.js uniteLeft` 三处过滤；`unite.js uniteSurvivors` 跳过；`fields.js uniteBillBounds` 只用 `keySourceCounts`、`validateClientResult` 新增 `uniteRuntime` 分支（只花子体额度，伪造即拒） | `test/match/fork-fixes-unite-runtime.test.js` **4/4**；`test/match/unite-squad-relay` 9/9、`unitedown` 3/3、`unite-variant-nohelper` 5/5、`hud-capsule-resolved` 10/10；`test/sim/battle.test.js` **27/27**（改动前 27/27，逐用例数字一致）；`test/sim/detmath.test.js` **7/7** |

## 2. 逐条细节 / 依据 / [ASSUMED] / 有意偏差

### 2.1 鸭爵（#839）
- 依据：`上游:server/sim/content/bands/meta.js:449-557`（`duckPicks` / `applyDuckPicks` / `duckReplace` / `duckGlobal`）。
- 我方适配：上游靠 `ev.waveSpawns`（本树没有这个字段）取「本回合自身波次」；我用 `spawns.filter(s => !notOwn(s))`（`notOwn` = 悬赏 tag `bounty` 或早前的 `duck`）—— 这正是上游 `duckReplace` 自己的兜底口径，所以不需要动 `match/match/combat.js`。
- 单位身份用 `actionIndex` + k（`waves.js:346` 已写；`withBounties` 把一条 action 拆成几段仍保留 `actionIndex`），所以「另一名玩家的悬赏把时间轴错开」也能对上同一只。
- 抽签流：`ctx.seedFor('duck:<round>')`（新增于 `effectsMeta.js`，`deriveSeed(m.seed, salt)`）—— 每局不同、同回合全队相同、不消耗 `m.rngMeta`（测试里断言了 `m.rngMeta.state()` 前后一致）、预览与实战一致。
- 口径变化（照上游）：领袖与部件**同时**退出候选与时段比例分母（旧代码只在候选过滤里排掉 BOSS rank，仍占分母）。
- `[ASSUMED]`：同一回合换成的种类对四人相同（上游同）；0–2 均匀；精英可被替换；飞行不被替换（沿我方既有）。
- 有意偏差：无。

### 2.2 休整期时机（#851）
- 依据：`上游:server/sim/content/bands/meta.js:34-41`（五个 key 的迁移说明）、`上游:server/match/effectsMeta.js:69,375`。
- 迁移的五个 key 与**没有**迁移的三个（余 `round_start_bond_check_gain_layer`、铃兰 `round_start_activate_char_chess_effect_in_board`、哈洛德 `gain_bond_char_per_round`）与上游逐个一致 —— 依据是它们的数据文本是「回合开始时」。
- 关键第二半：`effectsMeta._garrisons` 只在那几个 hook 上遍历棋盘/手牌，`onPrepStart` 原先**不在**白名单里 —— 只改 `GARRISON_HOOK` 特质不会触发（实测 32 条 garrisons 用例全红），所以 `:415` 一起加。
- `[ASSUMED]`：整键迁移，所以缪尔赛思「在第1回合开始时」和没有时间词的文本（「第3回合获得」「每5回合获得」）跟着 key 走（上游明写）。
- 顺序自证：`test/content/fork-fixes-prep-start.test.js` 最后一条用真实对局（绝境模拟，R3 是机变回合）断言「SP_DRAFT 阶段还没有老鲤的干员，进入 PREP 才有」。

### 2.3 隐秘核心 R15（#845）—— 含一条**有意偏差**
- 依据：`上游:server/match/finalAssault.js:67-71`（`bossPairSalt`）、`上游:server/match/match/phases.js:402-419`。
- 已做：独立 salt `boss-pairs:<round>`；该回合**首次**规划 `previous: null`（不复用最终攻势的搭档）；`bossPairsRound` 守住同回合内的再规划（退出只为落单者重配）；`Match.js` 那句「the hidden round retains partners and sides」改成现状。
- **有意偏差（业主决定优先）**：上游 #845 的另一半「重新抽左右」= `pairPlayers` 里 `rng.shuffle`，**不搬**。理由：业主 2026-10-16 决定配对按**座位序**（`app/server/match/finalAssault.js:63-84` 注释），客户端 `m.public.bossPairs` 缺席时的兜底 `prepPair` 就是座位序相邻两两，随机配对会把玩家的半场翻过去 → 重现「boss 波摆人会卡回道中」。
- 后果：本树 R15「不与 R14 成对」是靠「重抽 + 不传 previous」实现，而配对函数本身与 seed 无关，所以正常局面下 R14 与 R15 的组恰好相同；可观测差异出现在**R14 有人被淘汰**（旧行为保 R14 旧组，新行为按座位重配）—— 新测试正是钉这个。
- `[ASSUMED]`：无新增；`boss-pairs:<round>` 的 round 用十进制拼接（与上游一致）。

### 2.4 凯瑟琳（#677）
- 依据：`上游:server/sim/content/bands/meta.js:293-306`、`上游:server/match/player/prep.js:48-62`、`上游:server/sim/content/support/index.js:225-237`。
- 我方适配：上游的 `mutationCellIds/isMutationCell` 走「多版本数据」那套（`isVersionData`），本树没有版本轴，所以按**数据的 effectId**（`eff_acarm072`）识别，而不是硬编码 item id —— 重新生成表也不失效。
- 「其余选项数量不缩水」：`rollItems` 遇到被排除的 id 是 `continue`（继续抽），而不是少给一件。
- 「只算真拿到」：`pickReward` 里 `gained && offer.source === 'band:band_cathy' && isMutationCell(...)` 才置位。
- `[ASSUMED]`：展示/放弃不算；精锐记录（`_b`）不算；昆图斯的独立给料不走这个额度（同上游）。

### 2.5 联防记账（#675）
- 依据：`上游:server/sim/battle/spawns.js:155-161`、`上游:server/sim/battle/deploy.js:262-280`、`上游:server/match/unite.js:171-192`、`上游:server/match/fields.js:732-740` 与 `:842-861`、`上游:server/sim/spec.js:340-367`。
- 结算口径：`uniteSurvivors` / `uniteLeft` 过滤 `uniteRuntime`；`uniteBillBounds` 只数 `keySourceCounts`（**这就是 HUD ×N 被抬高的那处**：旧口径把 `derivedSourceCounts` 也加进上限）。
- 校验口径不改严：`validateClientResult` 仍**收下**带标记的漏怪，但只花「子体额度」（`takeDerived`），并且伪造标记（一个不可能由该波子体产生的 key）直接 `bad('unite runtime')` → 服务端复算。
- `[ASSUMED]`（上游同）：子体额度证明不了出身；既是排定身体又是别人子体的 key（当前表里 27 个）仍可在额度内被标记，只有 `SP_VERIFY=all` 能关掉这个缺口。
- **「改动前/后」观测差异**（用同一条既有语料对照）：`test/sim/battle.test.js` 改动前 **27/27**、改动后 **27/27**（逐用例同名同数，无移动）——即本次 sim 改动在常规战斗路径上零扰动；行为差异只在联防：`uniteBillBounds` 由 `1 + 3 = 4`（父 1 + 子体额度 3）变成 `1`；`uniteSurvivors` 由 `2`（父 + 子）变成 `1`；`uniteLeft` 同样只数漏进来的那只。这三个数字都写进了新测试。

## 3. 我开工前的既有红灯（不是本次改动造成的）

| 文件 | 开工前 | 收工时 | 说明 |
|---|---|---|---|
| `app/test/content/bands.test.js` | 37/39（2 fail） | **39/39** | 开工前那 2 条我顺手修绿了（旧 helper 只派发 `onRoundStart`，与 #851 的新时机冲突；改成同时派发两个 hook 并补「回合开始不发」的断言） |
| `app/test/sim/feedback5-cb4-pins.test.js` | 6/8（2 fail） | 6/8（同 2 fail） | **item 47**（昆图斯 5×3 体型）/ **item 52**（首领按数据间隔攻击）—— 首领/敌人几何与攻击节奏，属 `fix-sim-enemies` 那摊；我把 item 35（鸭爵）按新抽签口径改成种子遍历后它回绿 |
| `app/test/match/clientCombat.test.js` | 未测（开工前没跑这一支） | 24/26（2 fail） | `full co-op match … honest clients are never rejected` 与 `Final Assault, honest authority …`。我用三轮**回退实验**证明不是我：①关掉 `validateClientResult` 的 `uniteRuntime` 分支 → 仍 2 fail；②`GARRISON_HOOK` 回退 `onRoundStart` → 仍 2 fail；③五个 band key 全回退 → 仍 2 fail。最可能来自并行的敌人/首领改动或本来就红 |
| `app/test/docs-paths.test.js` / `docs-consistency.test.js` | — | **跑不了** | 它们在沙箱里 `spawnSync git EPERM`（要先 `git ls-files`），属环境限制，与本次改动无关；我这几个文件里的引用一律写「upstream Forge 0.3.x §37.x」，没有新增 `DESIGN §37` 这类会被判红的本树编号引用 |

## 4. 没做 / 做不了的项 + 下一步

1. **文档同步（硬规则欠账）**：本次改了规则，但 `app/docs/design/` 与 `app/docs/history/` 我没动（不在批准写域内，且文档测试在本沙箱跑不了）。建议下一步：`docs/design/match.md` 补「R15 首次规划重抽 + 座位序配对（业主 2026-10-16）」与「联防只计漏进来的那一波」两段；`docs/design/` 的 30/31 批次（休整期时机、鸭爵同抽）各一条；`docs/history/` 当前版本文件加四条（#839 / #845 / #851 / #677 / #675）。
2. **R15「重新抽左右」的政治面**：按你裁决不做。若业主将来改主意（愿意放弃客户端 `prepPair` 兜底），落点是 `app/server/match/finalAssault.js:pairPlayers` 的 `singles` 分支加 `rng.shuffle` + 组内洗牌，并同改 `app/public/js/ui/gameLogic/camera.js prepPair`。
3. **`match/match/bossRounds.js:75`** 仍用字面量 `'boss-pairs'`（不是 `bossPairSalt`）。在该路径上 `previous` 已经决定了结果，行为无差；只做一致性收尾时把字面量换成 `bossPairSalt(this.gd, this.round)` 即可（我没动，避免扩大写域）。
4. `app/server/match/gamedata.js` 与 `app/server/match/match/spDraft.js` 按你的指针去看过，实际**无需改动**（那两行是注释）；已在 §0 说明。

## 5. 实测记录（本沙箱一律 `node test/xxx.test.js` 单文件直跑）

```
test/sim/battle.test.js                      27/27   （底线条，改动前 27/27）
test/sim/detmath.test.js                      7/7    （底线条，确定性）
test/sim/fork-fixes-duck-draw.test.js         5/5    （新）
test/content/fork-fixes-prep-start.test.js    6/6    （新）
test/match/fork-fixes-hidden-core-pairs.test.js 4/4  （新）
test/match/fork-fixes-catherine-cell.test.js  4/4    （新）
test/match/fork-fixes-unite-runtime.test.js   4/4    （新）
test/content/bands.test.js                   39/39   （开工前 37/39）
test/content/garrisons_meta.test.js          32/32   （改到一半时曾 21/32，补 GARRISON_HOOK + 遍历白名单后全绿）
test/match/feedback1-ducklord.test.js         5/5
test/match/unite-squad-relay.test.js          9/9
test/match/unitedown.test.js                  3/3
test/match/unite-variant-nohelper.test.js     5/5
test/match/hud-capsule-resolved.test.js      10/10
test/match/finalAssault.test.js              12/12
test/match/feedback5-cathy-pool.test.js       1/1
test/sim/feedback5-cb4-pins.test.js           6/8    （既有红：item 47 / item 52）
test/content/feedback5-duck-restealth.test.js 3/3
test/match/fuzz.test.js                       2/2
test/match/meta.test.js 9/9 · draft 10/10 · pool 10/10
test/match/clientCombat.test.js              24/26   （2 红，见 §3 的三轮回退实验）
eslint（本次改动的 10 个文件）             0 error / 4 warning（全部是改动前就有的行）
```

「改前红、改后绿」的复现方式（我逐条实测过，红/绿数字见下）：

| 条目 | 回退一处即可复现红 | 结果 |
|---|---|---|
| 1 | `duckGlobal` 把 `createRng(ctx.seedFor(...))` 换回 `ctx.rng` | 新测试 4/5 fail 1 |
| 2 | `GARRISON_HOOK.SERVER_PREP_START` 换回 `'onRoundStart'` | 新测试 4/6 fail 2 |
| 3 | `fresh ? null : this.bossPairs` 改回 `this.bossPairs` | 新测试 2/4 fail 2 |
| 4 | `exclude` 改成 `null` | 新测试 3/4 fail 1 |
| 5 | `uniteBillBounds` 加回 `derivedSourceCounts` | 新测试 3/4 fail 1 |

