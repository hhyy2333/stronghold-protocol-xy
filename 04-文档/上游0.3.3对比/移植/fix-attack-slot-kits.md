# 移植记录 · fix-attack-slot-kits（0.3.2 §37.19「攻击类技能占普通攻击回合」· content/enemies/* 组）

> 任务 task-16。机制（`attackSlotSkill / attackTurnSkill / castNow / markAttackTurn / ATTACK_TURN_CLIP`）在
> `app/server/sim/content/enemies.js`，**归另一位**，我不动。我只改 **`content/enemies/` 目录里那几个 kit 文件**
> （archetypes / leaders / special / element），把"技能自己按冷却放"改成"施放占攻击回合"。
> **未 git commit。**

## 1 我加的那一个口子（archetypes.js）

`skill(s, fire, { cond, sil, cd, icd, id })` 现在多接三个字段：
`{ atk = false, clip = 0, own = false }` → 产出的 ability 上带 `atk / clip / own`（[archetypes.js:628-642](../..//app/server/sim/content/enemies/archetypes.js)）。

- `atk: true` ⇒ `enemies.js onTick` 的"自己按冷却放"分支跳过它（`:347 !a.atk`），只有 `attackTurnSkill` 会在**普通攻击的
  伤害帧**放它；没目标、没挥砍就不放（`own: false` 时）。
- `clip` = 这个官方技能播放的动画时长（秒），`0` = 官方能力没有 animKey。放完 `left = cd + clip`（「冷却时间于技能结束时
  开始计时」），下一次挥砍等 `max(interval, clip)`。
- `own: true` = 这个技能的触发是**它自己的选择器**（`cond`）而不是"普通攻击的目标"，所以"冷却好在手但这一 tick 没挥砍"
  时也能吃那一回合（`enemies.js onTick` 的 `ab.ownTurn`）。上游 `attackSkillOf` 默认 `own = true`，本批四个都与其一致。

**为什么不做成 `ATTACK_TURN_CLIP` 表**：那张表在 `content/enemies.js`（机制文件，不是我写域），而且表里"只打标不改 kit"
会得到既不放技能也不攻击的中间态（该文件 :390-392 自己写了这个已知缺口）。从 kit 端声明 `atk` 是同一条语义、改动面最小。

## 2 clip 证据（我方自己的数据，可复算）

链路与上游一致：`public/assets/local/fx/index.json` → `units.<enemyKey>.skills.<prefabKey>.abilities[]`（官方能力类 +
`animKey`）→ `data/assets.json` → `enemies.<enemyKey>.spine.animations.<animKey>`（秒）。测试里
`test/helpers/attackTurn.js officialAbility()` 直接读这两份数据来断言 `a.clip`，所以 clip **不是抄来的常数**。

| 敌人 | prefab | 官方能力类 | animKey | clip |
|---|---|---|---|---|
| 高准度伦蒂尼姆城防自行炮 `enemy_1273_stmgun_2` | Cannon | RangedAttack | Skill | **10** |
| 萨卡兹王庭军精锐术师 `enemy_1275_dwlock_2` | DeathEye | AbilitySequenceGroup(RangedAttack×2) | —（无） | **0** |
| W `enemy_1504_cqbw` | C4 | RangedAttack | Skill | **4.8** |
| 迷路的巨像 `enemy_2003_rockman` | StunAttack | RangedAttack | Skill | **2.333** |

## 3 本批改了什么（4 个）

| 敌人 | kit 位置 | 改动 |
|---|---|---|
| 高准度伦蒂尼姆城防自行炮 | `special.js:342-366` | Cannon 的 `skill(...)` 加 `atk: true, clip: CANNON_CLIP(10), own: true`；常量 `CANNON_CLIP` 带证据注释（`special.js:35-38`） |
| 萨卡兹王庭军精锐术师 | `element.js:79-104`（kitDeathEye） | DeathEye 加 `atk: true, clip: 0, own: true`（无 animKey，clip 0） |
| W | `leaders.js:127-144` | C4 加 `atk: true, clip: C4_CLIP(4.8), own: true`；`C4_CLIP / ROCKMAN_CLIP` 常量带证据注释（`leaders.js:51-56`） |
| 迷路的巨像 | `leaders.js:233-250` | StunAttack 加 `atk: true, clip: ROCKMAN_CLIP(2.333), own: true` |

## 4 测试

新增 `test/helpers/attackTurn.js`（`abilityOf` / `officialAbility` / `skillDataOf` / `stepToCast`）与**一个敌人一条文件**：

| 文件 | 断言 | 结果 |
|---|---|---|
| `test/sim/attack-turn-stmgun.test.js` | ① `atk === true` 且 `clip` 等于官方动画时长；② 冷却到点但**没有目标/没有攻击回合就一次都不放**；③ 第一个攻击回合把它放出来、**那一刀不算普通攻击**（`stats.attacks` 不变），下一次挥砍等 `max(interval, clip)`，自身 `left` 从 clip 结束起算 | pass 3 / fail 0 |
| `test/sim/attack-turn-dwlock.test.js` | 同上（clip 0：`left = cd`） | pass 3 / fail 0 |
| `test/sim/attack-turn-cqbw.test.js` | 同上（clip 4.8） | pass 3 / fail 0 |
| `test/sim/attack-turn-rockman.test.js` | 同上（clip 2.333，近战被挡才挥砍） | pass 3 / fail 0 |

回归（都单跑 `node <file>`）：
`test/content/enemies_bosses.test.js` **pass 287 / fail 0**（含我改的那条，见下）·
`test/sim/detmath.test.js` pass 7/0 · `test/sim/enemies-special.test.js` 5/0 · `test/sim/combat.test.js` 24/0 ·
`test/sim/playtest5_elements.test.js` 18/0 · `test/sim/feedback2-stealth-splash.test.js` 9/0 ·
`test/content/extra-enemies.test.js` 13/0 · eslint（4 个 kit 文件 + helper + 4 个新测试）0 error。

**改了一条既有断言**（`test/content/enemies_bosses.test.js` 的 `enemy_1275_dwlock_2` DeathEye 那条）：它原来假设
"冷却一到就放"（`initCooldown + hit_duration + 1` 的窗口）。现在死亡之眼要等攻击回合，实测释放落在
`initCooldown + interval + 挥砍前摇` 附近（12.87 s）、爆发在 22 s，所以改成"先断言冷却到点但没放 → runUntil 出现
deathEye 光束 → runUntil 爆发命中同格邻位"。数值断言没动。

## 5 第二批清单（**本轮已全部做完**，见 §7；表头里的「缺什么」是当时的判断）

clip 同样由上面那条链路在**我方数据**里算出，没有一条需要猜：

| 敌人 | kit | prefab / 官方类 | clip | 备注（缺什么） |
|---|---|---|---|---|
| 鼠王 `enemy_1509_mousek` | `leaders.js:146/154` | DriftSand RangedAttack / SandStorm RangedAttack | 2.333 / 1.333 | 两个攻击类技能；数据 priority 都是 0 ⇒ 同优先级随机（`b.rng`）本来就对 |
| 锏 `enemy_1525_blkswb` | `leaders.js:550-551` | CircleAttack MeleeAttack / CircleAttack2 MultiMeleeAttack | 2.067 / 2.067 | 已经是 `skill(...)` 形状，一行可加；两个技能各自 `cond` 互斥（形态 1 / 2） |
| 腐败骑士 `enemy_1513_dekght` | `leaders.js:183-193` | ChargeAttack MeleeAttack | 0（无 animKey） | `cond` 是"自己有阻挡者"= 攻击目标 ⇒ 应 `own: false`（不能抢"没挥砍"的回合） |
| 凋零骑士 `enemy_1513_dekght_2` | `leaders.js:199-211` | TripleAttack RangedAttack | 1.667 | `own: true` |
| 陷落雪祀 `enemy_2050_smsha` | `leaders.js:306 起` | ChainBuff RangedAttack | 1.667 | 需先读它的 kit 是 `skill()` 还是 tick 循环 |
| 扎罗 `enemy_1535_wlfmster` | `leaders.js:569` | FearCage MeleeAttack | 0 | 数据 `spCost: 55`（SP 触发）——要不要算"攻击类技能"需复核，上游表里给了 clip 0 |
| 重弩突袭者 `enemy_1404_msnip` | `invisible.js:25` | CrossAttack RangedAttack | 0 | **文件不在队长点名的那四个里**（同目录，属我写域范围但需你确认） |
| 节日爵士乐手 `enemy_10034_cnvsax` | `invisible.js:73` | fire RangedAttack | 0 | 同上 |
| 假想敌：黑云 `enemy_9009_acfort` | `fly.js:66` | FireWeapon（AbilitySequenceGroup + MultiRangedAttack） | 2 | 同上（fly.js 也不在那四个里）；且该敌人有两个技能（KillOthers pr=0 / FireWeapon pr=1），**我方 slot 对象不带 `priority`**（`{cd, icd, sp, bb, bs, slot}`），要让"优先级高的先放"成立得在 kit 里显式写 `pr: 1` 并注明取自 `data/enemies.json`，或让机制侧把 priority 带进 slot |

**机制侧的已知缺口（业主决定：单列，不夹带机制改动）**：我方 ability slot 的形状是 `{cd, icd, sp, bb, bs, slot}`，**不接受数据里的
`priority`**；而 `attackTurnSkill` 读的是 `a.pr ?? a.sk.pr ?? 0`。本轮在 kit 里显式写 `pr`（只有黑云的 全弹发射 需要：数据
FireWeapon priority 1 / KillOthers 0），注释里写明出处。**将来若搬上游 `attackTurnSkill` 的形状（slot 带 priority）再统一**。

## 6 [ASSUMED] / 未做

- `own` 的取舍按上游 `attackSkillOf` 的默认（`own = true`）：四个技能的选择器都是它们自己的（`cond` 里自己挑目标），
  所以允许它们吃"冷却好、攻击也在手、但这一 tick 没挥砍"的那回合。`own: false` 只留给"触发就是攻击目标"的技能
  （腐败骑士的蓄力攻击，下一批）。
- "就绪在伤害帧判定、而不是挥砍起手时"是机制侧的既有 [ASSUMED]（`content/enemies.js:243` 注释），我不重复。
- 缺证据未做：**没有**——本批四个的 clip 都能在我方数据里复算；剩下九个同样有数据（见上表），只是要按批做。

## 7 第二批（本轮做完的 9 个）

同样的口子（`skill({ atk, clip, own, pr })`，`archetypes.js:639`），一轮把 9 个敌人改完。clip 全部由我方数据复算
（`test/helpers/attackTurn.js officialAbility()` 在断言里直接读 fx/index.json + assets.json）：

| 敌人 | kit 位置 | prefab / 官方类 | clip | own | 其它 |
|---|---|---|---|---|---|
| 鼠王 `enemy_1509_mousek` | `leaders.js:164` / `:177` | DriftSand / SandStorm，都 RangedAttack | **2.333 / 1.333** | true | 两个技能都是攻击类；数据 priority 都 0 ⇒ 同优先级随机（`b.rng`） |
| 锏 `enemy_1525_blkswb` | `leaders.js:562-563` | CircleAttack MeleeAttack / CircleAttack2 MultiMeleeAttack | **2.067 / 2.067** | true | 两个 `cond` 按形态互斥；`Blink / Blink2`（速杀）**不动**，仍按自己的冷却 |
| 腐败骑士 `enemy_1513_dekght` | `leaders.js:205` | ChargeAttack MeleeAttack | **0**（无 animKey） | **false** | 触发就是它的阻挡者＝攻击目标，不能抢"没挥砍"的回合 |
| 凋零骑士 `enemy_1513_dekght_2` | `leaders.js:223` | TripleAttack RangedAttack | **1.667** | true | |
| 陷落雪祀 `enemy_2050_smsha` | `leaders.js:349` | ChainBuff RangedAttack | **1.667** | true | 它的选择器是"别的敌人"（给敌方上 buff），所以"没目标"= 附近没有别的敌人 |
| 扎罗 `enemy_1535_wlfmster` | `leaders.js:634` | FearCage MeleeAttack | **0** | true | **复核结论**：官方类是 MeleeAttack、无 animKey ⇒ 属攻击类。它这里的"冷却"是 SP 成本（spCost 55，[ASSUMED] 敌方 SP +1/s）与 tick 里 静默 的 `P.cast.left` 算术——改成占回合只改"什么时候放"，SP/静默 算术一字未动 |
| 重弩突袭者 `enemy_1404_msnip` | `invisible.js:53` | CrossAttack RangedAttack | **0**（无 animKey） | true | PRTS「技能持续2.5s」是技能自身时长（kit 里 `CROSS_SKILL`），不是动画 ⇒ clip 记 0 |
| 节日爵士乐手 `enemy_10034_cnvsax` | `invisible.js:93` | fire RangedAttack | **0**（无 animKey） | true | 10.6 s 引导是技能自身时长（kit 里），不是动画 |
| 假想敌：黑云 `enemy_9009_acfort` | `fly.js:109` | FireWeapon（AbilitySequenceGroup + MultiRangedAttack `Skill_2`） | **2** | true | **kit 侧显式 `pr: 1`**（数据：FireWeapon 1 / KillOthers 0）；`抓取`（KillOthers）不是攻击类技能，保持自己的冷却 |

测试：一个敌人一条文件（`test/sim/attack-turn-{mousek,blkswb,dekght,dekght2,smsha,wlfmster,msnip,cnvsax,acfort}.test.js`），
每条 3 个断言（① `atk` 且 clip==官方动画时长；② 冷却到点但不满足攻击回合/选择器 ⇒ 一次都不放；③ 攻击回合放它、
那一刀 `stats.attacks` 不变、下一刀等 `max(interval, clip)`、`left` 从 clip 末起算）。断言收在
`test/helpers/attackTurn.js assertTookTheTurn()`，**没有放宽**（`atkCd` 只允许 5 % 相对误差，其余精确）。

结果：13 个 `attack-turn-*` 文件 **pass 39 / fail 0**；`test/content/enemies_bosses.test.js` **287/287**；
`test/sim/detmath.test.js` 7/0；eslint 0 error（4 条既有 warning）。

改旧语料 2 处（只补前置条件/窗口，数值断言没动）：
1. `enemy_1275_dwlock_2` 死亡之眼（§4）：窗口改为"冷却到点没放 → runUntil 出光束 → runUntil 爆发"。
2. `enemy_1513_dekght` 蓄力攻击：加"冷却到点、`initCooldown+0.1` 时还没有 chargeAttack  telegraph"的前置断言，再用
   `runUntil(charged, s.cooldown + s.bb.duration)` 抓释放；后续「蓄力期间 disarmed / 十字伤害数值」原样。

**仍然没做**：见 §5 表尾的机制侧已知缺口（`pr` 不能从数据流到 slot）；另外 `test/sim/feedback1-transform.test.js` 与
`test/sim/feedback1f-liftoff.test.js` 各有 1 条本来就是红的（深池逐火 ember / 胄的 刺胄之弹），我把自己 13 个 `atk` 标记
临时全部关掉后这两条**照样红**，与本次改动无关（是别的同学在改 enemies.js / bosses.js 那一轮的中间态）。
