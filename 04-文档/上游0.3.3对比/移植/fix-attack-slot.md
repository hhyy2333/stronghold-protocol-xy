# fix-attack-slot · 攻击类技能占用普通攻击的回合（上游 0.3.2 移植）

> **最终态（收口数字）**：`node test/content/enemies_bosses.test.js` **287 / 287 全绿** · `node test/sim/attack-slot.test.js` **6 / 6** ·
> `node test/sim/battle.test.js` **27 / 27**。「断裂生殖」那 1 条最终是**绿**（原因见 §7：语料窗口 + 官方随机平票，不是实现 bug）。

## 1. 改了什么

### 1.1 机制（`app/server/sim/content/enemies.js`）

| 位置 | 内容 |
|---|---|
| `:225 onBeforeAttack` | 引擎 beforeAttack（伤害帧）里先判攻击类技能，命中则本回合不挥砍 |
| `:245 attackSlotSkill` | 施放技能并 `c.targets = []`，`e.atkCd = attackCdAfter` |
| `:255 attackCdAfter` | 攻击冷却 = max(攻击间隔, 技能 clip) |
| `:266 attackTurnSkill` | 选就绪技能：可施放 + cond 成立，按 pr 取最高，同级用 `b.rng.pick` |
| `:287 castNow` | 冷却从动画结束起算：`a.left = max(TICK, cd + clip)` |
| `:344` onTick | atk 技能不再自己按冷却放（等攻击回合）；其余走 castNow |
| `:355` onTick | own 技能额外吃「攻击就绪但没有挥砍」的那一回合（官方 _allowNoTarget 的一面） |
| `:383 ATTACK_TURN_CLIP` | 敌人键 + prefabKey → clip 与 own（kit 不在本文件里的敌人：首领部件、普通/悬赏敌人、「自在」） |
| `:416 markAttackTurn` | 每个敌人首次 tick 打标一次，并汇总 ab.ownTurn |

### 1.2 各 kit（`app/server/sim/content/bosses.js`）

| 位置 | 内容 |
|---|---|
| `:1009` 昆图斯 mk | 四技能全部 atk:true；clip 取 QUINTUS_CLIP；own = !QUINTUS_ATTACK_SKILLS.has(kind) |
| `:1039 / :1049` | QUINTUS_ATTACK_SKILLS = {Tidewater, Rockfall}；QUINTUS_CLIP = {Tidewater 1.667, Rockfall 3, SummonTentac 2, Doom 4.467} |
| `:994` 昆图斯 cond | 追加 `P.tent < phases`：断裂生殖用尽关卡 7 段小队动作后不再释放 |
| `:929` 管/弦 pipeCore | 自定义攻击循环里先 attackTurnSkill，施放则跳过这一击，P.heldUntil = time + clip |
| `:951 / :971` | 裂管之奏 clip 4.167、断弦之奏 clip 3.333，均攻击类 |
| `:1107` 卢西恩 / 不祥幻影 aoe | atk:true, clip:1.8, own:true |
| `:1516` 萨米 kitDeer | 冰凌循环里先 attackTurnSkill；`:1534` 自然涌动 clip 0、`:1547` 物种爆发 clip 2.667 |

### 1.3 「自在」的【破桎而出】（未改 enemies/leaders.js）

由 `ATTACK_TURN_CLIP['enemy_1517_xi']` 打标：ShieldBurst / ShieldBurstReborn → own:false（必须有一次挥砍才放，
附近没有干员就不再展开屏障）；CrossAttack → own:true, clip:1.333（保留原 cond 的半径选择器）。

## 2. 依据（官方口径 → 落地）

| 官方说法 | 落地 |
|---|---|
| 「大多数技能自动触发会占用攻击间隔（即可以攻击时不进行攻击，改为触发技能…）」PRTS 关于技能 | attackSlotSkill 在伤害帧替换这一击 |
| 「同时存在多个可触发的技能时，优先级最高的优先触发，优先级相同则随机」 | attackTurnSkill 的 pr + rng.pick |
| 「同一技能的冷却时间于该技能结束时开始计时」 | castNow 的 cd + clip |
| 昆图斯：大潮 1.667 / 崩坍 3 / 断裂生殖 2 / 物种爆发 4.467（prefab animKey → spine animations） | QUINTUS_CLIP |
| 第三形态：大潮与普攻交替（约每 7 游戏秒一次，原为每 3.5 s 且普攻照常） | 3.5 冷却 + 1.667 clip ⇒ 5.167 s 才就绪，下一回合（7 s）才放 |
| 「断裂生殖仅仍有未执行的小队动作指令时可触发」（7 段分支） | P.tent < phases |
| 断裂生殖 / 物种爆发 _allowNoTarget = 1 | own: true |
| 「自在」破桎而出要目标 | own: false |
| 攻击动画比攻击间隔长 ⇒ 下一次普攻等动画放完（_resetMainAbilityCdWhenCastEnd = 0） | attackCdAfter = max(interval, clip) |

## 3. [ASSUMED]（代码里已标）

1. 就绪判定在伤害帧，不是挥砍起手（起手那一刻才就绪的技能等到下一回合）。
2. 冷却从施放那一拍重新起算（clip 比间隔短时代价等于间隔）。
3. 技能效果落在攻击的伤害帧，不是它自己 clip 的末帧。
4. 管/弦、萨米的自定义攻击循环也被较长的 clip 顶住（heldUntil / held）。
5. own:true 的条目标注时要求技能确有 cond（否则可能在既无目标又无选择器时开火）——比上游更保守。
6. 施放动画期间不能普攻。

## 4. 测试

- **新增** `app/test/sim/attack-slot.test.js`（`node test/sim/attack-slot.test.js`）—— **6/6 通过**：
  1. 攻击类技能等攻击回合；无目标不放（stub 能力）。
  2. 有目标时技能占用那一回合；攻击与施放不在同一拍；冷却从施放起算。
  3. **昆图斯第三形态：大潮间隔 7.00 s**（实测 3.9 → 10.9 → 21.4 → 28.4 → 35.4 …，其余全 7.00 s），且没有一拍同时有普攻。
  4. 无目标时大潮 0 次、断裂生殖照放（_allowNoTarget）。
  5. 「自在」无目标 ⇒ 破桎而出 0 次；有目标 ⇒ 放。
  6. 断裂生殖 7 次后不再释放。
- `node test/sim/battle.test.js` —— **27/27 通过**。
- `node test/content/enemies_bosses.test.js` —— **273/287**，14 条失败：全部是旧语料按「技能自己按冷却放」写的，
  需要照上游的做法给场景补一次攻击回合（有目标 + 等到伤害帧）。逐条：
  萨卡兹王庭军精锐术师 DeathEye · 腐败骑士 蓄力攻击 · 「自在」破桎而出 · 胄（3 条：灭顶之灾 / 刺胄之弹 / 弹着）·
  管 裂管之奏 · 管+弦 断弦之奏 · 昆图斯 崩坍 · 阿利斯泰尔 王权号令 · 萨米的意志 · leader summons take the round's enemy effects。
  另 `萨卡兹骸骨拷打者（血珀）` 那条属 fix-sim-enemies 正在改的 special.js 范围。
  失败形态同一类：`assert.ok(...fx... 'rockfall')` / `0 ≈ 2500`（期望伤害）——即「等到某时间点技能必然已放」，
  而现在技能要先等到一次攻击回合。

## 5. 没做的项（原因）

| 项 | 原因 |
|---|---|
| 上面 14 条旧语料的适配 | 每条要读该测试场景（射程内有没有干员、是否被阻挡、时间窗多长）再补攻击回合；14 条逐个调试，本轮预算不够，已列清单交回 |
| castSlot 第 5 字段 turnClip（客户端按技能 clip 播） | 属客户端渲染面（render/units.js UnitView.onCast），不在本任务可改文件里；当前只发原有的 cast 事件 |
| 上游两张表以外的敌人 | 没有动画时长证据，**没有猜** |
| 第三形态「寒冷 + 任意减速 ⇒ 每回合都是大潮」的边界 | 实现上自然成立（clip 不随减速变短），未单写测试 |

## 6. 风险

1. **golden 会动**：本机没有 `test/golden/`，无法在本目录复核；matches 族（首领场）预计移动，需在完整仓跑 npm run golden 并逐场景归因。
2. 上面 14 条不修完，enemies_bosses 会一直红——不是回归，是旧期望值。
3. ATTACK_TURN_CLIP 的 own:true 条目依赖 kit 自带 cond；缺失时退化成「必须有挥砍」（保守，不会误放）。

## 7. 旧语料适配（第二轮，lead 要求逐条说明）

最终数字：node test/content/enemies_bosses.test.js = **287 / 287 全绿**；attack-slot 6/6；battle.test.js 27/27。

改动全部是**前置条件**（给场景一次攻击回合），断言一条未改、未放宽：

| 场景 | 为什么要补 | 改法 |
|---|---|---|
| 盐风主教昆图斯（崩坍 / 大潮） | 两者现在是攻击类技能，只在挥砍的伤害帧施放 | 等的时长加一个攻击间隔 e.s.interval |
| 盐风主教昆图斯（断裂生殖 / 物种爆发） | 与第三形态大潮抢同一个攻击回合（数据优先级同为 0 ⇒ 官方随机平票） | 等 3 个攻击间隔 + 末段窗口 6 s → 20 s（**已绿**，真因见 §10） |
| 假想敌：管（裂管之奏） | 只在自定义攻击循环的那一拍施放 | + e.s.interval |
| 假想敌：管+弦（断弦之奏） | 同上（弦的循环） | + str.s.interval |
| 萨米的意志（自然涌动 / 物种爆发） | 两者都是攻击类技能 | 各 + e.s.interval |
| 「自在」（破桎而出 ×2 处） | 测试原本把 noAttack 打开 = 根本没有攻击回合；破桎而出要目标才放 | 改成 profile.atkScale = 0（照常挥砍但 0 伤害），伤害断言因此仍然精确；另 + 攻击间隔 |
| 「自在」（纬地经天） | 与破桎而出抢回合 | + 2 个攻击间隔 |

**性质：规则变更导致语料过期，不是为绿而改。** 官方依据同上（PRTS 「大多数技能自动触发会占用攻击间隔」、
「同一技能的冷却时间于该技能结束时开始计时」），每个场景的旧期望都建立在"技能自己按冷却放"的旧实现上。

## 8. 两条按 lead 要求写死的口径

1. **血珀那条（enemy_1364_spnaxe_2 萨卡兹骸骨拷打者）归 fix-sim-enemies**（它在 enemies/special.js 加 kit），
   本任务**没有动**它；本轮跑下来它是绿的，不代表我改过。
2. **castSlot 第 5 字段 turnClip 是已知缺口**：机制（占回合、clip 计时）已经对，**表现层还没跟上** ——
   客户端目前仍按原来的 cast 事件播（没有 turnClip，不会按技能的官方 clip 长度播）。
   不要以为这块做完了；上游对应实现是 enemies/helpers.js castSlot + render/units.js UnitView.onCast。

## 9. 本轮的机制收口（表收窄）

ATTACK_TURN_CLIP 只保留「自在」一个键。上游那两张表里另外 20 余个键（胄 / 阿利斯泰尔 / 腐败骑士 / 凋零骑士 /
萨卡兹王庭军精锐术师 / 重弩突袭者 / 黑云 / 城防炮 / W / 鼠王 / 迷路的巨像 / 陷落雪祀 / 锏 / 扎罗 / 节日爵士乐手）
**本轮没搬**：它们的 kit 仍是"技能自己按冷却放"的写法（胄的 kitHelm 是 tick 循环、阿利斯泰尔的王权号令是 SP 循环），
只打标不改 kit 会得到"既不放技能也不攻击"的中间态 —— 这是已知缺口，随各自 kit 改写再做。

## 10. 「昆图斯 断裂生殖 / 物种爆发」那 1 条的结案（lead 要求查到底）

分类结论：**(c) + (b)**，**不是 (a)**，我们的机制没有 bug；也不是 cond 读空字段。

- 那 1 条的真实形态是 **TypeError: Cannot read properties of undefined (reading 'amount')**，位置在**测试自己**的
  `h.hooksOf('lpLoss')[0].amount` —— 即 lpLoss 事件数组为空（物种爆发还没放），不是我们代码里某个字段 undefined，
  `P.tent` 从来没未初始化（`P = { stage: 0, t0, stageAt, tent: 0 }`）。
- 用一次性探针（已删除）在失败点读到：断生殖「casts 1 / tentacle fx 1」——它**放得出来**；第三形态时
  `Doom` 的 cond 为 true（stage 2、tent < Infinity），只是**还没轮到它那一拍**。
- 语料只等了 `h.run(6)`（约 1.7 个攻击回合），而第三形态的【大潮】cd 3.5 s 几乎每回合就绪，两者数据优先级都是 0 ⇒
  官方「优先级相同则随机触发其中之一」。6 s 里没抽到它，是**随机平票 + 窗口太短**，不是行为错。
- 改法：只把窗口 6 s → 20 s（多等几个回合），**断言一条没放宽，反而更严**：
  新增 `assert.equal(h.hooksOf('lpLoss').length, 1, 'exactly one 物种爆发 LP loss')`，金额仍是 100。

## 11. 「已知缺口」的两句口径（lead 要求写死）

1. 上游 `ATTACK_SKILL_CLIP` / `ENEMY_ATTACK_SKILL_CLIP` 里另外 20 余个键（胄 / 阿利斯泰尔 / 萨卡兹王庭军精锐术师 /
   腐败骑士 / 凋零骑士 / 重弩突袭者 / 黑云 / 城防炮 / W / 鼠王 / 迷路的巨像 / 陷落雪祀 / 锏 / 扎罗 / 节日爵士乐手 …）
   现在是**旧行为（技能自己按冷却放）**，因为它们的 kit 还没改成"施放即占用攻击回合"的写法。
2. 只在那张表里打标、不改对应 kit，会得到"**既不放技能也不攻击**"的中间态（技能被挪去等一个永远不会来的攻击回合），
   所以**不许批量打标**；随各自 kit 改写时逐个搬，并配动画时长证据。
