# 移植记录 · lead（穿透顺序 / 重入 buff / detmath 守卫）

> 业主 2026-10-30：「这些修bug的我要」+「功能动画也要」。本条是我自己动手的三处。

## 1. §37.30 固定穿透先减、百分比穿透后乘（PR #798）

- 落点：`app/server/sim/damage.js` 的 `mitigate()`，物理与法术各一行。
  - 旧：`Math.max(0, D * (1 - pct) - flat)` —— 先乘百分比再减固定，两种穿透同时存在时**多穿透**。
  - 新：`Math.max(0, D - flat) * (1 - pct)` —— 与 `上游:server/sim/attack/calculation.js:15,20` 逐字同形。
- 依据：PRTS 伤害公式；官方 0.3.2 公告「修正固定穿透与百分比穿透同时存在时的计算顺序」（§35.30 / PR #798）。
- 影响面：只影响"固定 + 百分比穿透同时存在"的伤害实例。上游实测 288 场景动 17 个（艾丽妮 / 圣聆初雪 / 迷迭香 /
  送葬人 / Pith 这类同类叠加）。我方没有 golden 语料，所以靠下面的单测钉住公式本身。
- 测试：`app/test/sim/fork-fixes-penetration-and-buffs.test.js`「physical DEF subtracts fixed penetration before
  percentage penetration」。用 D=300 / flat=175 / pct=30% 这组数，旧式给 35 有效防御、新式给 87.5，差 52.5 点伤害。
- **同时更新了一处钉住旧口径的老测试**：`app/test/sim/core.test.js` 的「damage formulas」把旧顺序当基准
  （75 vs 900、85 vs 900），已改成官方顺序的 875 / 850，并就地写清了 `(300 − 50) × 0.5` 的算式。

## 2. §37.5 重入式 buff 移除（round49 崩溃）

- 落点：`app/server/sim/battle/status.js` 的 `removeBuff()`。
  - 旧：`for (let i = unit.buffs.length - 1; i >= 0; i--)` 直接走 live 数组；`onRemove` 里再移除别的 buff 时索引
    已经指向别的条目 —— 轻则漏掉一个匹配项，重则读到 `undefined` 后取 `.key` 抛 TypeError。
  - 新：先把匹配项做快照再按对象身份逐条定位删除（与 `上游:server/sim/battle/status.js:67-78` 同形）。
- 依据：官方 0.3.2 §35.5；上游 golden **0 移动** —— 这是崩溃修复，不是平衡改动。
- 测试：同文件两条 —— ① `onRemove` 里清空整个 `buffs` 的极端重入不再抛错；② 多个同 key 的 buff 全部移除、
  不匹配的留下、每个 `onRemove` 都跑自己的那一次。

## 3. 顺手修掉一处**我方自有**的确定性破坏（不是上游的）

- `app/server/sim/content/kits/ops/chess_char_6_22-oblvns.js`（丰川祥子）用了 `Math.hypot` / `Math.atan2` /
  `Math.sin` / `Math.cos` / `Math.pow`，`node test/sim/detmath.test.js` 的守卫因此一直是红的（本 checkout 的 CI 从
  这个 kit 进来那天起就红）。
- 改法：改用 `server/sim/detmath.js` 的 `hypot / atan2 / sin / cos / powi`。其中 `Math.pow(1 - steer, dt / frame)`
  是分数指数，detmath 只给整数指数的 `powi`，所以改成**先按参考帧 `NOTE.frame` 取整成帧数再 `powi`**
  （`Math.max(1, Math.round(dt / NOTE.frame))`）：sim 的 tick 就是 1/30 s、`NOTE.frame` 也是 1/30 s，常规情况下帧数 = 1，
  `powi(x, 1) === x`，行为与改动前**逐位相同**；只有将来 dt 不是整数帧时才与旧式有微小差异（属 [ASSUMED]）。
- 验证：`node test/sim/detmath.test.js` 7/7 绿（改动前 6/7，红的正是这条守卫）。

## 跑过的测试

```
node test/sim/detmath.test.js                              7/7  pass
node test/sim/fork-fixes-penetration-and-buffs.test.js     4/4  pass
```

## 顺手发现：本 checkout 有 **7 条既有红灯**（与本次改动无关，已 A/B 验证）

`node test/sim/hexcards-armor.test.js` 15 条里 7 条失败（`反击装甲`：期望 100% 当前 DEF 的回击 200，实际 400）。
把 `damage.js` 与 `status.js` **分别**回退到改动前的写法再跑，失败数一模一样（8 pass / 7 fail），
所以不是这两处改动引起的 —— 是工作区里未提交的 协议源石 改动（`server/sim/content/hextech.js`、`shared/hextech.js`、
`server/match/hextech.js` 都处于 modified 状态，`hexcards/armor.js:137` 的 `defRatio` 默认值 200 与测试期望的 100 不一致）。
**这条要业主定夺**：要么是测试没跟上新口径，要么是 `defRatio` 的默认值被误改。

## 没做 / 交给别人

- 分阶段结算内核（§37.32/33/34/35）：不搬（见 00-总纲与建议 §5 第三档）。
- 其余规则修复由 fix-sim-enemies / fix-bands-match / fix-client-l10n / fix-client-render / fix-attack-slot 分别落，
  动画清单由 research-anim 出。
