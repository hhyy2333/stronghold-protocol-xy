# task-15 批次一 · 其余敌人 kit 改写（enemies.js / bosses.js 组）

> 范围：只碰 kit 在 `server/sim/content/bosses.js`（本轮没有落在 `content/enemies.js` 的条目）里的敌人；
> `content/enemies/*.js` 那批归 fix-sim-enemies，未越界。未 commit；`data/*.json` 未动。

## 1. 本轮做了（2 个，动画时长都有官方证据）

| 敌人 | 技能 | 官方能力类 / 剪辑 | 落法 |
|---|---|---|---|
| 假想敌：胄 `enemy_9013_acstmk` / `_2` | 【灭顶之灾】 `1` | RangedAttack `Skill_1` = **2.333 s**（上游 ATTACK_SKILL_CLIP） | `atk: true, clip: 2.333`（`own` 缺省 ⇒ 要目标才放，与 PRTS「触发索敌和普通攻击相同」一致）；冷却从剪辑末起算 |
| 阿利斯泰尔 `enemy_9032_aclionk` | 【王权号令】 `equip` / `equipA` | RangedAttack `Skill_1` = **3.667 s** | 从 SP tick 循环**挪到攻击伤害帧**（`before` 钩子）：SP 满且攻击这一拍出手时，用号令替代这一击、`c.targets = []`，攻击冷却改成 `max(间隔, 3.667)`；`cast` 事件带第五字段 3.667 |
| 同上 | 【斥退】 `Suicide` | MeleeAttack `Skill_3` = **5.667 s** | `atk: true, clip: 5.667`（走 `attackSlotSkill` / `castNow`） |

为什么号令要挪钩子：它原本是 `tick` 里的 SP 循环（与普攻并排跑）。只加 `atk` 标记不行——它不是"能力对象"，
`attackTurnSkill` 找不到它；而纯靠 `atkCd <= 0 && !swing` 判断，在有目标时那个窗口几乎是 0（引擎的攻击一就绪就开打）。
放在 `before`（普攻伤害帧）才真正实现"占用攻击间隔"，这与 `attackSlotSkill` 同一条官方规则。

## 2. 每改一条都跑了 `node test/content/enemies_bosses.test.js`

旧语料需要补"一次攻击回合"的场景（**断言一条未改、未放宽**）：

| 场景 | 为什么要补 | 改法 |
|---|---|---|
| leader summons take the round's enemy effects（胄 ×2） | 胄 现在要挥砍才有攻击回合，而测试原本 `noAttack = true` | 改成 `atkScale = 0`（照常挥砍、0 伤害），断言不变 |
| 假想敌：胄（arts ray） | 灭顶之灾只在挥砍伤害帧放 | 等的时长 + `e.s.interval` |
| 假想敌：胄 + 刺胄之弹 | 同上（首弹与第二弹各一次） | 两处都 + `e.s.interval`；`noAttack` → `atkScale = 0` |
| 胄 shells only within its range ×2 | 同上 | + `e.s.interval`；`noAttack` → `atkScale = 0` |
| 阿利斯泰尔（王权号令 / 斥退） | 号令要等攻击这一拍、斥退也要一次攻击回合 | `cost + 0.1` → `cost + e.s.interval + 0.3`；`30 - t + 0.2` → `+ e.s.interval`；`noAttack` → `atkScale = 0` |

## 3. 新增测试（`test/sim/attack-slot.test.js`，可独立跑）

- `假想敌：胄 — 【灭顶之灾】takes the attack's turn (clip 2.333 s)`：断言 `cast` 事件里有五字段且 `clip === 2.333`、
  普攻仍在两发之间发生、**死亡集群（非攻击类）仍是三/四字段老形状**。
- `阿利斯泰尔 — 【王权号令】/【斥退】 take the attack's turn (clips 3.667 / 5.667 s)`：断言五字段的 `cast` 只可能是
  3.667 / 5.667 这两个剪辑（即"只有攻击类技能带第五字段"）。

## 4. 测试数字（收口）

| 套件 | 结果 |
|---|---|
| `node test/sim/attack-slot.test.js` | **8 / 8**（原 6 + 本轮 2） |
| `node test/content/enemies_bosses.test.js` | **287 / 287** |
| `node test/sim/cast-turnclip.test.js` | 3 / 3 |
| `node test/sim/battle.test.js` | 27 / 27 |
| `node test/sim/detmath.test.js` | 7 / 7 |

## 5. 没做的（清单，交回 lead 另排）

**A. 卡片在 `content/enemies/*.js`，不属本任务范围（归 fix-sim-enemies）——动画时长上游都有，缺的不是证据：**

| 敌人 | 技能 | 上游剪辑(s) | kit 所在 |
|---|---|---|---|
| 高准度伦蒂尼姆城防自行炮 `enemy_1273_stmgun_2` | `Cannon` | 10 | enemies/special.js |
| 萨卡兹王庭军精锐术师 `enemy_1275_dwlock_2` | `DeathEye` | 0（无剪辑） | enemies/element.js |
| 重弩突袭者 `enemy_1404_msnip` | `CrossAttack` | 0 | enemies/invisible.js |
| W `enemy_1504_cqbw` | `C4` | 4.8 | enemies/leaders.js |
| 鼠王 `enemy_1509_mousek` | `DriftSand` / `SandStorm` | 2.333 / 1.333 | enemies/leaders.js |
| 腐败骑士 `enemy_1513_dekght` | `ChargeAttack` | 0 | enemies/leaders.js |
| 凋零骑士 `enemy_1513_dekght_2` | `TripleAttack` | 1.667 | enemies/leaders.js |
| 锏 `enemy_1525_blkswb`（含二形态） | `CircleAttack` / `CircleAttack2` | 2.067 / 2.067 | enemies/leaders.js |
| 迷路的巨像 `enemy_2003_rockman` | `StunAttack` | 2.333 | enemies/leaders.js |
| 陷落雪祀 `enemy_2050_smsha` | `ChainBuff` | 1.667 | enemies/leaders.js |
| 假想敌：黑云 `enemy_9009_acfort` | `FireWeapon` | 2 | enemies/fly.js |
| 节日爵士乐手 `enemy_10034_cnvsax` | `fire` | 0 | enemies/invisible.js |
| 扎罗 `enemy_1535_wlfmster` | `FearCage` | 0 | enemies/leaders.js |

**B. 本任务范围内但缺证据的：无。**（卢西恩 / 不祥幻影 / 萨米 / 昆图斯 / 管 / 弦 / 自在 已于上两轮完成。）
