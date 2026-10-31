# 协议源石 → Forge：第一刀（战斗层）实证

> 承接 [协议源石转Forge-探针实证.md](协议源石转Forge-探针实证.md)（14 行打开四个硬阻塞）。
> 本文是**第一刀**：把战斗层真的搬过去，实测验完。
> 探针树：`_forge-hextech-probe/`

---

## 0. 一句话

**战斗层搬完了，而且跑得起来：79 张卡注册成功、0 告警、对局 0 错误、与基线逐字节一致。**

但**它还没有真的「生效」**——因为对局层（谁发牌、谁给玩家卡）还没搬。
现在它是一台**装好但没接线的机器**：`hexIds()` 返回 79，注册表里 79 个 `hex:` 键，
但**没有任何一局会给玩家发卡**。这正是第二刀要做的。

---

## 1. 搬了什么

### 1.1 新增文件（未改任何现有代码）

| 文件 | 体积 |
|---|---:|
| `server/sim/content/hextech.js` | 102,286 B |
| `server/sim/content/hexcards/*.js`（13 个） | ~1,400 行 |
| `shared/hextech.js` | 10,751 B |
| `data/hextech.json` | 25,841 B |

### 1.2 改动的现有文件（+39 行，含注释）

| 文件 | 改动 | 为什么 |
|---|---:|---|
| `server/sim/damage.js` | +21 | **移植 `isRetaliation`**（见 §2，这是唯一一个真正的引擎缺口） |
| `shared/kitImports.js` | +6 | 4 条白名单（`@sim/damage` / `@sim/body` / `@sim/tokens` / `@ops/op-doroth`） |
| `shared/protocol.js` | +4 | `g.hex` / `g.hexReroll` |
| `server/sim/content/index.js` | +4 | 把 `hextech` 追加进 `DOMAIN_NAMES` |
| `server/match/effectsMeta.js` | +3 | `KEY_RE` + `onHexPick` + `registry.hex()` |
| `shared/constants.js` | +1 | `PHASE.HEX_DRAFT` |

**合计：新增 4 项文件，改动 6 个文件共 +39 行。**

---

## 2. ⚠️ 唯一的意外：`isRetaliation` 是 0.3.0 的新东西

我原本以为「搬文件 + 改 import」就够了。逐符号核对时发现 **Forge 的 `damage.js` 没有 `isRetaliation`**：

```
OURS  server/sim/damage.js:184   export function isRetaliation(dmg) { ... }
FORGE server/sim/damage.js        (不存在)
```

而它被**到处用**：`hexcards/armor.js`、`hexcards/hooks.js`、`hexcards/shieldwall.js`，
甚至**白名单内的** `kits/shared/tier1.js`（`export const isRetaliation = damageIsRetaliation`）。

### 2.1 但它其实**不该算缺口**

我核了 Forge 的内容层，**它已经在发那些标记了**：

| 标记 | 在 Forge 里由谁发出 |
|---|---|
| `steadShare` / `steadThorn` | `content/bonds/addon/battle.js`（`:633` / `:651`） |
| `'counter'` / `'reflect'` / `'springCounter'` | 内容层（实测命中 20 / 4 / 1 处） |

⇒ **Forge 只是缺那个判定函数**，而它读的三类标记**早就存在**。所以移植它是**纯增量**——
Forge 里没有任何东西调用过它，加上去不影响任何既有行为（回归实测确认）。

### 2.2 移植的写法

照 0.3.0 的原样放进 `damage.js`，并把「为什么在这里」写进注释：

```js
const RETALIATION_TAGS = Object.freeze(['counter', 'reflect', 'springCounter']);

export function isRetaliation(dmg) {
  if (!dmg) return false;
  if (dmg.steadThorn || dmg.steadShare) return true;
  return Array.isArray(dmg.tags) && dmg.tags.some((t) => RETALIATION_TAGS.includes(t));
}
```

实测：

```
isRetaliation: function
  counter -> true
  steadThorn -> true
  plain -> false
```

---

## 3. ⚠️ 我犯的一个错，和它教我的事

我一开始把 13 张卡的 import **从相对路径改成了白名单写法**：

```js
// 我改成了这样（错的）
import { isRetaliation, isHpLoss } from '@sim/damage.js';
```

结果 **13 张卡里有 9 张加载失败**：`Cannot find package '@sim/damage.js'`。

**为什么错**：`@sim/` 这类别名是**工坊包**的写法，由**包的装载器**在做 `import()` 之前重写成真实 URL。
而这一刀是**引擎内的移植**，走的是 Node 原生解析。

实测 Forge 自己的内容模块：

```
引擎内容模块用 ../ 相对路径:  28 处
引擎内容模块用 @... 别名:     0 处
```

⇒ **引擎里就写相对路径，包才写别名。** 我改回相对路径后，15 个模块**全部加载成功**。

> **这条教训值得记**：`@battle/` / `@sim/` / `@ops/` 是**包面对的表面**，
> 不是引擎内部的写法。移植时**不要**为了「看起来符合白名单」而改 import。

---

## 4. 实测结果

### 4.1 模块加载（15/15）

```
hextech.js imported OK
  exports: BATTLE_SPEC_KEYS, DEBT_EFFECT_KEY, DEBT_HANDLER, DEMON_PACT_ITEM_KEY,
           HEX_HOOKS, HEX_KEY, battleModsOf, hasBattlePart, hexCapOf, hexIds,
           install, registerMeta

  ok    armor       installArmor
  ok    hooks
  ok    drill       installDrill
  ok    shieldwall  installShieldwall
  ok    warmachine  installWarmachine
  ok    humanrite   installHumanRite
  ok    rangedist   installRangeDist
  ok    minefield   installMinefield
  ok    breaker     installBreaker
  ok    neurotoxin  installNeurotoxin
  ok    ricochet    installRicochet
  ok    logos       installLogos
  ok    onebody     installOneBody
```

### 4.2 内容发现（`DOMAIN_NAMES` 追加）

```
MODULES: tokens, devices, enemies, bosses, bonds, garrisons, items, bands, choices, hextech
last module: hextech | has install: true
```

**追加在最后**（不是插进中间）：`install()` 要读其他 domain 注册的 effect ref，
而且保持前九个 upstream domain 的相对顺序不变——**golden 语料依赖那个顺序**。

### 4.3 数据装载

```
data/hextech.json: playerHexes 79 | enemyHexes 24 | format.rounds [1,6,11]
getData().hextech: present
hexIds(): 79 ids
  sample: hex_allin, hex_armor, hex_armorbreak, hex_arsenal, hex_bondequalize, ...
```

### 4.4 注册表：`hex:` 键真的进去了

```
createRegistry({ content: false }) :  21 keys,  0 hex:   <- 不注册内容层
createRegistry()                 : 385 keys, 79 hex:   <- 注册内容层（缺省）
=> 本次移植贡献 79 个 hex: 键
   warnings: 0                 <- onHexPick 已被认作合法钩子
   sample: hex:hex_stipend, hex:hex_logistics, hex:hex_echo, hex:hex_refresh, ...

handler for hex:hex_drill:
  hooks: onHexPick, onRoundStart
  RESULT: onRoundStart FIRED through the real dispatcher
```

> **这个测法我先写错过一次，值得记下**：`createRegistry()` 缺省就会调 `registerAllMeta`，
> 所以「注册前 / 注册后」两个读数其实是**同一个对象**，两次都打印 385/79——看起来像「什么都没发生」。
> 正确的对照是 **`content: false` 对 `content: true`**：**21 → 385 键，0 → 79 个 `hex:`**。
> **79 个键是这次移植真的加进去的**，而且 `warnings: 0`——`onHexPick` 已被认作合法钩子。

> 更细的验证：`hex:hex_drill` 的 handler 带 `onHexPick` + `onRoundStart` 两个钩子，
> 走**真实的** `EffectDispatcher.runKey` **确实触发了**。

### 4.5 对局回归（4 局，0 错误）

| 场景 | 结果 |
|---|---|
| solo FUNNY × 1（基线） | 9 回合 · LP 27.0 · wins 1/1 · **0 errors** · 1582 ms |
| solo FUNNY × 1（战斗层装上） | 9 回合 · LP 27.0 · wins 1/1 · **0 errors** · 1593 ms |
| solo NORMAL × 3（带数据） | 13.67 回合均值 · wins 2/3 · **0 errors** · 10388 ms |

**FUNNY 那一行与基线逐字节一致**——战斗层装上去**没有改变任何既有行为**。

---

## 5. ⚠️ 现在它还没「生效」

这是这一刀**必须说清**的边界。

战斗层装着、数据在、79 个 `hex:` 键注册好——但**没有任何一局会给玩家发卡**。
因为发卡是**对局层**的事：

| 还缺的 | 在哪 |
|---|---|
| `rollOffers()` 发牌 | `shared/hextech.js`（**已搬**） |
| `applyHex()` 把卡给玩家 | `server/match/hextech.js`（**未搬**） |
| `MatchHexDraft` 阶段类 | `server/match/match/hexDraft.js`（**未搬**） |
| `afterRoundStart` 的分支 | `server/match/match/phases.js`（**未搬**） |
| `hexRounds()` | `server/match/gamedata.js`（**未搬**） |
| `hexSpawnMods` / 视图投影 | `server/match/hextech.js`（**未搬**） |

⇒ **第一刀交付的是「引擎认得协议源石」，第二刀才交付「玩家能拿到协议源石」。**

---

## 6. 第二刀要做什么（预告）

| 文件 | 行数 | 难度 |
|---|---:|---|
| `server/match/hextech.js` | 511 | 中（依赖 `finalAssault.js` 的 `bossPoolHp`） |
| `server/match/match/hexDraft.js` | 163 | **低**（自包含，只依赖 `shared/hextech.js` + `hextech.js` + `common.js`） |
| `server/match/match/phases.js` | +1 | **极低**（一条分支） |
| `server/match/gamedata.js` | 增量 | 低（`hexRounds()`） |
| `server/match/Match.js` | 增量 | 低（挂 `MatchHexDraft` 到原型链） |

**集成点仍然是一条分支**：

```js
if (!this.isTestField() && this.gd.hexRounds().includes(this.round)) this.enterHexDraft();
else if (this.gd.spRounds().includes(this.round)) this.enterSpDraft();
else this.enterPrep();
```

---

## 7. 一句话总结

**第一刀证明了两件事**：

1. **战斗层能原样搬过去**——15 个模块零改动加载（只补了一个纯增量函数），对局行为逐字节不变；
2. **引擎侧只有一个真缺口**（`isRetaliation`），而且它是纯增量的——
   三类标记 Forge 早就在发，只是没人做那个判定。

**它没有证明的**：玩家能不能拿到卡。那是对局层的事，在第二刀。

---

## 附：探针树现状

```
_forge-hextech-probe/
  server/sim/content/hextech.js       <- NEW（战斗层主体）
  server/sim/content/hexcards/*.js    <- NEW（13 张卡）
  shared/hextech.js                   <- NEW（共享规则）
  data/hextech.json                   <- NEW（79 张卡的数据）
  server/sim/damage.js                <- +21（isRetaliation）
  server/sim/content/index.js         <- +4（DOMAIN_NAMES）
  server/match/effectsMeta.js         <- +3（hex 键 + 钩子）
  shared/{constants,protocol,kitImports}.js  <- +11
  public/assets -> junction 到 Forge 原件
```

**重跑验证**：

```bash
cd _forge-hextech-probe
node tools/matchrun.mjs --mode solo --difficulty FUNNY --seeds 1 --quiet
```
## 8. 我在这两轮里犯的两个错（都留着，因为教训有用）

| # | 错 | 教训 |
|---|---|---|
| 1 | 把 13 张卡的 import 改成 `@sim/` 白名单写法 | **引擎内写相对路径，包才写别名**（§3） |
| 2 | 用 `registerAllMeta` 前后对比证明「键进去了」 | `createRegistry()` 缺省已含内容注册 ⇒ 两次读的是同一个对象；**正确对照是 `content: false` 对 `true`**（§4.4） |

两条都是**「验证方法本身有洞」**，不是结论错。留在这里因为同样的坑还会再踩。
