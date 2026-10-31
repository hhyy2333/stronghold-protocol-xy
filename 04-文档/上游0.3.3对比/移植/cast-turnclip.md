# task-13 · 攻击回合内技能的表现（cast turnClip）

> 缺口①收口。依据：上游 0.3.2 §37.57「attack-turn casts play their clip」与 enemies/helpers.js castSlot 的五字段写法。
> 未 commit；PROTOCOL_VERSION 未动（新增的是**可选**字段，不声明就没有）。

## 1. 改了什么（5 处）

| 文件 | 改动 |
|---|---|
| `server/sim/content/enemies/helpers.js:110` `castSlot(b, e, s, turnClip = null)` | 有 turnClip ⇒ 发五字段 `['cast', id, slot, dur, turnClip]`；没有 ⇒ 与原来逐字节相同（三或四字段） |
| `server/sim/content/enemies.js:291` `castNow` | 攻击回合的施放传该技能的 clip：`castSlot(b, e, a.sk, a.atk ? (a.clip > 0 ? a.clip : 0) : null)` |
| `public/js/render/app.js` `case 'cast'` | 把第五字段交给视图：`v.setSkillSlot?.(slot); v.holdCast?.(Number(e[4]))` |
| `public/js/render/app.js` `case 'atk'` | `src.castHold > 0` 时这一回合**不放普攻动画**（`wiring.attack` / `fx.attack` 都跳过；`onAttack` 等记账不动） |
| `public/js/render/units.js` | 新增纯函数 `castHoldSeconds(clip)`（0/缺失/非法 ⇒ 0，上限 8 s）、视图字段 `castHold`、`holdCast(clip)`（设好持有时长并让 actor 用该槽位的剪辑播一次）、`update(dt)` 里按动画速率递减 |
| `shared/protocol.js:1035` | 只改注释：记下可选第五字段及其含义（形状未变） |

## 2. 事件新形状

```
['cast', id, slot]                 // 非攻击回合、技能无 duration —— 与改动前逐字节相同
['cast', id, slot, dur]            // 非攻击回合、技能有 duration —— 同上
['cast', id, slot, dur, turnClip]  // 攻击回合的施放：turnClip = 该技能官方剪辑长度（s），dur 无则 0
```

## 3. 客户端表现

- 槽位的剪辑来自 `setSkillSlot` → `actor.setSkillIndex` → `spine.js _attackClip()`；
- `holdCast` 用 `actor.attack(clip, true)` 让该槽位的剪辑**播一次、时长就是 clip**；
- 这段时间里 `atk` 事件**不再触发动普攻动画**，结束后自然回到正常；
- **官方未给动画的技能**（clip 0）：不持有，播普攻动画 **[ASSUMED]**（代码注释里写明）。

## 4. 测试

| 套件 | 结果 |
|---|---|
| `node test/sim/cast-turnclip.test.js`（新，3 条） | **3 / 3** ① 无 turnClip 的 cast 形状不变（长度 3/4、`e[4] === undefined`、duration 仍在第 4 位）② 攻击回合的 cast 是五字段且含大潮的 1.667 ③ `castHoldSeconds` 纯函数（1.667→1.667、0/undefined/'2'/−1/NaN→0、99→8） |
| `node test/sim/attack-slot.test.js` | 6 / 6 |
| `node test/content/enemies_bosses.test.js` | 287 / 287 |
| `node test/sim/battle.test.js` | 27 / 27 |
| `node test/sim/detmath.test.js` | 7 / 7（sim 侧无时钟：turnClip 只是事件里的一个数） |
| `node test/render/charge-ring.test.js` | 9 / 9（证明 units.js 在 node 里仍可导入，纯函数可测） |

## 5. 仍要二次接线的一点（写清）

`actor.attack(clip, once)` 只保证「按该槽位的剪辑播一次」；**剪辑内的动作细节**（起手帧、命中帧、
若该技能的官方 Ability 有自己的 animKey 偏移）仍由既有 `spine.js` 的 attack 播放器决定。
若之后发现某些技能（如 崩坍 3.0 s）播出来节奏不对，那是 `spine.js` 播放器要按技能 Ability 的 animKey 播
（上游 render/units.js UnitView.onCast 的做法），属**渲染层后续项**，不影响本任务的机制与事件契约。
