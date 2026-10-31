# 协议源石 → Forge：探针实测

> 问题：把本仓的**协议源石**（Hextech）转到 Forge 0.18.6，走哪条路？
> 方法：**实测，不是读源码推断**。写探针直接 import 两棵树的引擎模块，调真实 API 看结果。
> 对照：`Stronghold-Protocol-repo`（0.3.0）vs `参考对象/Stronghold-Protocol-Forge-0.18.6-0.2.6-win-x64/app`

---

## 0. 结论

**路线 A（做成 Forge 包）死了，四个硬阻塞逐个实测确认。**
但不是全死：**战斗层那一半的形状是对的**，死的是**注册表、钩子、阶段、协议**这四处引擎内部。

| 探针 | Forge 0.18.6 | 本仓 0.3.0 |
|---|---|---|
| `register("hex:probe_test")` | ❌ **抛错** `bad key` | ✅ OK |
| `registry.hex()` 方法 | ❌ **不存在** | ✅ 存在 |
| `HOOKS` 含 `onHexPick` | ❌ 19 个，**无** | ✅ 20 个，有 |
| 谁 dispatch `onHexPick` | ❌ **全仓 0 处** | ✅ 8 处 |
| `PHASE.HEX_DRAFT` | ❌ **不存在** | ✅ 存在 |
| `C2S["g.hex"]` | ❌ 不存在 | ✅ 存在 |
| `C2S["g.hexReroll"]` | ❌ 不存在 | ✅ 存在 |
| `install(battle)` 签名 | ✅ 相同 | ✅ 相同 |
| `@battle/index.js`（support） | ✅ 白名单内 | — |
| `@kit/tier1.js` | ✅ 白名单内 | — |

---

## 1. 探针一：元注册表（最硬的一条）

**代码**（直接 import 两棵树的 `server/match/effectsMeta.js`，调真实 `MetaRegistry`）：

```js
const r = new MetaRegistry();
r.register('hex:probe_test', {});
```

**实测输出**：

```
===== FORGE 0.18.6
  exports: EffectDispatcher, GARRISON_HOOK, HOOKS, MAX_DEPTH, MetaRegistry, createRegistry, ...
  HOOKS count: 19 | onHexPick: false
  has .hex() method: false
  register("hex:probe_test")     -> THROWS: MetaRegistry.register: bad key hex:probe_test
  register("effect:probe_test")  -> OK
  register("global:probe_test")  -> OK

===== OURS 0.3.0
  HOOKS count: 20 | onHexPick: true
  has .hex() method: true
  register("hex:probe_test")     -> OK
  r.hex("probe_test", {})        -> OK
```

**根因**（两棵树的 `KEY_RE` 逐字对比）：

```
ours : /^(garrison|band|bond|item|choice|hex|effect|global):[A-Za-z0-9_\-.:#]+$/
forge: /^(garrison|band|bond|item|choice|      effect|global):[A-Za-z0-9_\-.:#]+$/
                                       ^^^^^^ 没有 hex
```

**这不是「一行」能补的**：`hex` 键要配套一个 `registry.hex()` 方法、一个 `HOOKS` 成员、
以及**派发它的调用点**（下一节）。

### 1.1 一个重要的细节：`onHexPick` 只是 warning，`hex:` 键才是致命

我核了 `register()` 的实现——**两棵树逐字相同**：

```js
for (const name of Object.keys(h)) {
  if (typeof h[name] === 'function' && !HOOKS.includes(name) && !HANDLER_EXTRAS.has(name) && this.warnings.length < 200) {
    this.warnings.push(`${key}: '${name}' is not a hook (${HOOKS.join(' ')})`);
  }
}
```

所以一个**合法键**（如 `effect:`）挂 `onHexPick` **不会抛错，只进 warnings**。
而 `_call()` 是按**名字查** `handler[hook]`：

```js
_call(ps, key, handler, hook, source, ev, repeat = 1) {
  const fn = typeof handler[hook] === 'function' ? handler[hook] : ... ;
  if (!fn) return;
  ...
}
```

⇒ **理论上有缝**：用 `effect:` 键 + `onHexPick` 处理器，如果**有人 dispatch**，它就会跑。
但——

## 2. 探针二：谁来 dispatch？（缝被堵死）

**实测**：

```
=== FORGE: who dispatches onHexPick?
  NOBODY dispatches onHexPick in Forge

=== OURS: who dispatches it?
  server/match/effectsMeta.js:53
  server/match/hextech.js:5, 51, 58
  server/sim/content/hextech.js:80, 701, 702, 707
```

**Forge 全仓 0 处**。所以即使你用 `effect:` 键绕过 `KEY_RE`，
**那个处理器永远不会被调用**——派发点在 `server/match/hextech.js` 里，而那是**引擎代码**。

## 3. 探针三：阶段机与协议

**实测**：

```
===== FORGE 0.18.6
  PHASE keys: LOBBY, INFO_CHECK, BAND_DRAFT, BATTLE_CHECK, ROUND_START, SP_DRAFT, PREP, COMBAT, UNITE, SETTLE, FINAL_ASSAULT, HIDDEN_CORE, RESULT
  has HEX_DRAFT: false
  C2S count: 58 | S2C count: 25
  C2S g.hex: false | g.hexReroll: false

===== OURS 0.3.0
  has HEX_DRAFT: true
  C2S count: 57 | S2C count: 24
  C2S g.hex: true | g.hexReroll: true
```

两条都是**包碰不到的**：

- **阶段机**：`PHASE` 是引擎常量，`Match` 的状态转移写在 `server/match/match/phases.js`。
- **协议**：Forge 设计稿原文——*「包不能发明 S2C/C2S 类型。包自己的通道走 `pack.msg`，类型名由引擎定」*。

## 4. 探针四：Forge 自己的校验器判 hextech 的 import

**代码**（调 Forge 真实的 `kitImportIssues`）：

```js
kitImportIssues('import x from "server/sim/damage.js";')
```

**实测输出**：

```
@battle/index.js                          ALLOWED
@kit/tier1.js                             ALLOWED
@sim/constants.js                         ALLOWED
@sim/dir.js                               ALLOWED
@sim/targeting.js                         ALLOWED
server/sim/damage.js                      REFUSED: KIT_IMPORT
server/sim/body.js                        REFUSED: KIT_IMPORT
server/sim/content/tokens.js              REFUSED: KIT_IMPORT
server/sim/content/kits/ops/op-doroth.js  REFUSED: KIT_IMPORT
```

而 hextech 的 13 张 hexcard **实际就需要**这些：

| 需要的 | 用在 | 白名单 |
|---|---|---|
| `damage.js` 的 `hasHp` / `isRetaliation` / `isHpLoss` / `makeDamageInfo` | armor, hooks, logos, neurotoxin, shieldwall | ❌ |
| `body.js` | minefield | ❌ |
| `tokens.js` 的 `spawnYanyou` / `TOKEN_IDS` | humanrite | ❌ |
| `kits/ops/op-doroth.js` | minefield | ❌ |

## 5. 战斗层：形状是对的（这是唯一的亮点）

| 需要 | Forge 表面 | 实测 |
|---|---|---|
| `install(battle)` | `pack.json.server.battle` | ✅ **签名逐字相同**（`installContent` 调 `installer.install(battle)`） |
| `registerMeta(registry)` | `pack.json.server.meta` | ✅ 同形 |
| support 辅助函数 | `@battle/index.js` | ✅ 同一份文件 |
| tier1..6 / summoner | `@kit/*.js` | ✅ |

**所以「战斗逻辑」本身能搬——前提是它需要的 helper 也进了白名单。**

## 6. 规模（要搬的东西）

```
玩家协议源石  79 张
敌方协议源石  24 张
核心非测试代码  ~5,447 行
```

| 文件 | 行数 | 层 |
|---|---:|---|
| `server/sim/content/hextech.js` | 1,636 | 战斗 |
| `server/sim/content/hexcards/*.js`（13） | 1,400 | 战斗 |
| `tools/hextech/roster.mjs` | 1,071 | 内容源 |
| `server/match/hextech.js` | 511 | 对局 |
| `public/js/ui/hexOverlay.js` | 266 | 界面 |
| `shared/hextech.js` | 211 | 共享 |
| `server/match/match/hexDraft.js` | 163 | **阶段机** |

---

## 7. 三条路的实测结论

### 路线 A · 做成 Forge 包 —— ❌ **死了**

四个硬阻塞**全部实测确认**，且每一个都在**引擎内部**，包碰不到：

1. `hex:` 键被 `KEY_RE` **抛错拒绝**；
2. `onHexPick` **无人派发**（全仓 0 处）；
3. `HEX_DRAFT` 阶段**不存在**；
4. `g.hex` / `g.hexReroll` **不是协议类型**。

外加 import 白名单缺口（4 类 helper）。

### 路线 B · Fork Forge，作为引擎改动重落 —— 可行，但代价明确

要改的是 Forge 的：`effectsMeta.js`（KEY_RE + HOOKS + registry.hex）、`phases.js`（新阶段）、
`protocol.js`（2 条 C2S）、`kitImports.js`（白名单加 4 项）、`gamedata.js`（hextech 表）。
**约 5,447 行内容**要对着另一套引擎内部重写，而且从此与 Forge 分叉。

### 路线 C · 向 Forge 提能力请求 —— 部分可行

前两格（`hex` 键、`onHexPick`）是**小改动**，符合 Forge 自己「加一格」的清单。
但**阶段机与协议类型**是 Forge 明文排除的形态：

> *「产品功能：野排匹配、房间保留、房内聊天…… 都是产品功能，与 mod 层无关。」*

**协议源石属于同一类。** 它是一个**产品功能**，不是包能表达的东西——包只能填引擎已经挖好的格子。

---

## 8. 一句话

**协议源石转到 Forge，卡点不在工作量，在架构定位。**

它的战斗层（`install(battle)` + 卡片逻辑）**形状上能搬**；
但它的**注册表命名空间、派发钩子、对局阶段、协议消息**这四样，Forge 的 mod 层**结构性地不开放**——
因为那正是 Forge 用来区分「引擎功能」与「包」的那条线。

---

## 附：探针源码

四个探针都是临时脚本，跑完已删。复现方式：

```js
// 探针一（元注册表）
const m = await import(pathToFileURL(join(root, 'server/match/effectsMeta.js')).href);
const r = new m.MetaRegistry();
console.log(m.HOOKS.includes('onHexPick'), typeof r.hex);
try { r.register('hex:probe', {}); } catch (e) { console.log(e.message); }

// 探针二（谁派发）
//   grep -rn "onHexPick" server/

// 探针三（阶段 + 协议）
const c = await import(pathToFileURL(join(root, 'shared/constants.js')).href);
console.log('HEX_DRAFT' in c.PHASE);
const p = await import(pathToFileURL(join(root, 'shared/protocol.js')).href);
console.log('g.hex' in p.C2S);

// 探针四（Forge 的 import 校验器）
const ki = await import(pathToFileURL(join(forge, 'shared/kitImports.js')).href);
console.log(ki.kitImportIssues('import x from "server/sim/damage.js";', null));
```
