# D 区（渲染 / 音频 / 客户端外壳）：0.2.5 给 3D 棋盘换了官方战场场景，顺带修了伤害数字、模型多挥一次、血条高度和托管遮罩

> 覆盖 20 个文件 / 57 个 hunk；CLEAN-APPLY 12 个（40 hunk，1264 行），DIVERGED 8 个（17 hunk，407 行），新增 0 个。
> 本区 diff 体量全场最大（1671 行）。**真撞车 2 处：`public/css/theme.css`、`public/js/battle/runner.js`**（下面第三节给结论和可直接贴的合并片段）。

**先说一句最重要的话**：队长后来下的「D 区真撞车 = 0，五个文件全部可整段照搬」这条修正令，**只有 3 个文件成立**。
我用 `git merge-file`（git 自己的三路合并语义）把 D 区 20 个文件逐个实跑了一遍：
`audio.js`、`main.js`、`screens/game.css` 确实**零冲突可整段搬**；但 `theme.css` 和 `battle/runner.js` **实测会冲突**，
`overlap-exact.csv` 把它们标成「自由可搬」是与实测不符的。证据在第三节，请你按实测口径走。

---

## 一、结论速览

| # | 文件 | 分类 | 修的是啥 | 来源 | 搬运建议 |
|---|---|---|---|---|---|
| 1 | `public/js/render/board3d/load.js` | CLEAN-APPLY | 新增「官方战场场景」加载：解析 scene.bin、按材质+光照图分桶合并 | #532 / PR #533 | 直接覆盖（+169） |
| 2 | `public/js/render/board3d/materials.js` | CLEAN-APPLY | 新增场景材质：albedo×光照图×主光的 Unity Shadowmask 近似 + 水面材质 | #532 / PR #533 | 直接覆盖（+129） |
| 3 | `public/js/render/board3d/scene.js` | CLEAN-APPLY | 场景网格建/换/销毁；隐藏分块按当前战场取舍 | #532 / PR #533 | 直接覆盖（+119） |
| 4 | `public/js/render/app.js` | CLEAN-APPLY | 接线官方场景；官方伤害数字开关；预备图角色可点开详情 | #532 / PR #533、#412、PR #523 | 直接覆盖（+45/−16，14 hunk） |
| 5 | `public/js/render/fx/numbers.js` | CLEAN-APPLY | 官方伤害数字：只出红字整数与黄 MISS，不并入累计 | #412 | 直接覆盖（+52） |
| 6 | `public/js/render/fx/fonts.js` | CLEAN-APPLY | MISS 四个字母加进 miss 字体的位图字库 | #412 | 直接覆盖（+1/−1） |
| 7 | `public/js/render/fx/system.js` | CLEAN-APPLY | 把 `officialNumber` 注册进 FX 方法序（防重复定义） | #412 | 直接覆盖（+1/−1） |
| 8 | `public/js/render/fx/simfx.js` | CLEAN-APPLY | 本该红字却被闪避的 ATTACK_MISS 出黄 MISS | #412 | 直接覆盖（+4） |
| 9 | `public/js/render/style.js` | CLEAN-APPLY | 新增 `crit` / `miss` 两套伤害数字配色 | #412 | 直接覆盖（+3） |
| 10 | `public/js/render/spine.js` | CLEAN-APPLY | 干员攻击：每次只播一遍攻击剪辑，不再循环多挥一次 | #506 | 直接覆盖（+20/−23） |
| 11 | `public/js/render/units.js` | DIVERGED | 敌方血条头顶高度改按「原点以上」算 | PR #524 | **可整段照搬**（实测零冲突） |
| 12 | `public/js/audio.js` | DIVERGED | 盟约叠层提示音：同类只响一路、新触发顶旧、重连不补播 | #482 | **可整段照搬**（实测零冲突） |
| 13 | `public/js/main.js` | DIVERGED | 收 `m.layer` 并转给音频层 | #482 | **可整段照搬**（实测零冲突） |
| 14 | `public/css/theme.css` | DIVERGED | `--z-conn` 60→75，让连接横幅压过 AI 托管遮罩 | PR #511 | **★真撞车**：官方改 98 行，老板在 99 行插 `--z-announce`，紧邻 → 手工合 |
| 15 | `public/js/battle/runner.js` | DIVERGED | `ownerOps` 带上自选干员的 `diy` | PR #505 | **★真撞车**：官方与老板改的是同一段头注释 → 手工合 |
| 16 | `public/js/diag.js` | DIVERGED | 诊断行加「official damage numbers」 | #412 | 可整段照搬（实测零冲突） |
| 17 | `public/css/components.css` | DIVERGED | 复合 tooltip（`.tooltip--compound`）样式 | #484 / PR #494 | 可整段照搬（实测零冲突） |
| 18 | `public/css/screens/game.css` | DIVERGED | 简化战场浮字加 `--crit` / `--miss` 两色 | #412 | 可整段照搬（实测零冲突） |
| 19 | `public/css/screens/briefing.css` | CLEAN-APPLY | 被禁成员侧栏 `.brief-bantip` 样式 | #484 / PR #494 | 直接覆盖（+9） |
| 20 | `public/css/screens/title.css` | CLEAN-APPLY | 标题页脚可换行 + 仓库链接样式 | #543 | 直接覆盖（+5） |

**一句话搬运策略**：
- 12 个 CLEAN-APPLY + 5 个实测零冲突的 DIVERGED（第 11~13、16~18 项）= **17 个文件可以整段覆盖**，不会丢老板的任何改动。
- 只有 **第 14、15 两项要手工合**，而且都是「两边都留」的一行级小事，第三节给了成稿片段。

---

## 二、逐文件明细

### A. 0.2.5 最大的一块：3D 棋盘按战场显示官方场景（`#532`、PR `#533`）

CHANGELOG 第 4 行：「提取了官方场景时，11 个战场显示各自的沙地、叙拉古街区或工业风场景，没有场景时仍用金属地块……
完整包附带提取好的场景；精简包和源码可以用 `node tools/setup.mjs --scenes` 在本机下载并提取。」

**症状**：3D 棋盘永远是一块金属地块，跟官方实机的战场（沙地 / 街区 / 工业风）不像。
**根因**：老代码只加载 `TX_autochessi_*` 那套金属棋盘图集和网格，根本没有「官方场景」这条资源通路。
**修完什么样**：从 `data/local-assets.json` 的 `scene/<stageId>` 与 `scene/tex` 组里取 `scene.json` + `scene.bin` + 光照图 + albedo，
拼成一堆按「材质 + 光照图页」合并的网格盖在棋盘位置上；没提取到就退回金属地块。

这 4 个文件都是 **CLEAN-APPLY**（老板一个字没动，与官方 0.2.4 逐字节一致），**可以整段覆盖，零冲突**。

#### 1. `public/js/render/board3d/load.js`　【CLEAN-APPLY】　2 hunk，+169/−1

**官方改了什么**

- **hunk 1（旧行 2–13）**：文件头注释补上 `loadScenePack` 的签名与返回值说明。
- **hunk 2（旧行 155–162，`export function loadBoardPack` 之后）**：新增 165 行——整个官方场景加载器。关键导出：

```diff
+/** Manifest group of a stage's official scene, and of the textures the scenes share. */
+export const sceneGroup = (stageId) => `scene/${stageId}`;
+export const SCENE_TEX_GROUP = 'scene/tex';
+export const SCENE_VERSION = 1;
+/** Bytes per vertex of a scene chunk: position f32×3, uv f32×2, lightmap uv f32×2, normal i8×4, colour u8×4. */
+export const SCENE_VERTEX_BYTES = 36;
```

并把 `resetBoardPack()` 改成连场景缓存一起清：

```diff
-export function resetBoardPack() { cached = null; threePromise = null; threeFailures = 0; }
+export function resetBoardPack() { cached = null; threePromise = null; threeFailures = 0; sceneCache.clear(); }
```

**为什么改**：这是 `#532`/PR `#533` 的前端加载侧。`parseSceneChunks` 是纯粹的二进制切片（36 字节顶点 + 16/32 位索引），
`mergeSceneChunks` 把同一材质桶的分块并成一个网格并重写索引（超过 65535 顶点自动升 32 位），
`sceneMaterialKey` 让「一个材质 + 一页光照图 = 一次 draw」，水面 shader 不采样光照图所以不吃页号。

**老板这边的情况**：老板没动过这个文件（与官方 0.2.4 SHA256 一致），`yours` 里就是 0.2.4 原样。
本文件的 diff 全落在新增区，**不重叠**。

**怎么合**：整段搬。

**搬运动作**：`copy 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\public\js\render\board3d\load.js → Stronghold-Protocol-repo\public\js\render\board3d\load.js`

#### 2. `public/js/render/board3d/materials.js`　【CLEAN-APPLY】　2 hunk，+129/−2

**官方改了什么**

- **hunk 1（旧行 1–16）**：文件头把 BC5 说明补成「BC5 / DXT5nm」（对应 PR `#534` 的法线贴图解法修复，实现在 F 区 `tools/local-extract/extract.py`，这里只是注释同步）。
- **hunk 2（旧行 340–351，`smogMaterial` 之后）**：新增 `SCENE_LIGHT` 调参、`sceneBlend`、`sceneMaterial`、`sceneWaterMaterial`。

```diff
+export const SCENE_LIGHT = Object.freeze({ range: 8.0, ambient: 0.2, direct: 0.8, indirect: 0.4 });
...
+/** Blend class of a scene material record (scene.json materials[name]): 'opaque' | 'cutout' | 'blend'. */
+export function sceneBlend(info) {
+  if (hasKeyword(info, '_ALPHABLEND_ON') || hasKeyword(info, '_ALPHAPREMULTIPLY_ON')) return 'blend';
+  return hasKeyword(info, '_ALPHATEST_ON') ? 'cutout' : 'opaque';
+}
```

着色器核心（原样摘录）：

```diff
+      '  vec3 light = vec3(uAmbient); float shade = 1.0;',
+      '  #ifdef SCENE_LM',
+      '    vec4 lm = texture2D(uLm, vLm);',
+      '    light += pow(lm.rgb, vec3(2.2)) * uLmScale; shade = mix(1.0, lm.a, uShadow);',
+      '  #endif',
+      '  vec3 n = normalize(gl_FrontFacing ? vN : -vN);',
+      '  light += uLightColor * max(dot(n, uLightDir), 0.0) * shade;',
+      '  gl_FragColor = vec4(a.rgb * light * focusMask(vWorld.xy), a.a);',
```

**为什么改**：官方那套 shader（`Torappu/Scene/StandardRealtimeShadow`）没有照抄，而是用
「albedo ×（光照图烘焙的间接光 + 主光 × N·L × 光照图 alpha 当烘焙阴影）」线性光照近似（Unity 的 Shadowmask 模式）。
代码注释明确标了 `[ASSUMED]` 的调参项（`ambient`、`direct`、`indirect`），没有瞎编成官方数值。
`sceneWaterMaterial` 则是把棋盘已有的水 shader 套进场景材质自己的水色（`_DeepWaterColor` / `_ShallowWaterColor`）。

**老板这边的情况**：没动过，与 0.2.4 逐字节一致。

**怎么合**：整段搬。

**搬运动作**：`copy 参考对象\...\public\js\render\board3d\materials.js → Stronghold-Protocol-repo\public\js\render\board3d\materials.js`

#### 3. `public/js/render/board3d/scene.js`　【CLEAN-APPLY】　7 hunk，+119/−7

**官方改了什么**（7 处）

| hunk | 旧行 | 改了什么 |
|---|---|---|
| 1 | 1–12 | 头注释加 `setScenePack` 一行与「官方场景替换地块/玻璃/贴花/管道/背景」段落 |
| 2 | 14–34 | 头注释「draw calls」段补充说明 |
| 3 | 50–61 | 新增 `sceneGroupVisible(rect, areas)`：判断某个可切换分块（如左右半场、首领场）是否属于当前战场 |
| 4 | 191–202 | 构造函数新增 `scenePacks` / `sceneRes` / `official` / `sceneWater` 四个字段 |
| 5 | 264–297 | `setStage` 改为：先试官方场景，成功就不建地块/玻璃/贴花/管道/背景 |
| 6 | 547–558 | `_update` 里给水面材质的 `uTime` 推进 |
| 7 | 563–574 | `destroy` 里释放所有场景包资源 |

关键片段（hunk 5，`setStage`）：

```diff
-    const key = stage ? `${stage.id || ''}|${(stage.rows || []).join('/')}|${JSON.stringify((stage.devices || []).map((d) => [d.key, d.pos, d.active, d.dir]))}` : '';
+    const official = stage ? this.scenePacks.get(stage.id) || null : null;
+    const key = stage ? `${stage.id || ''}|${official ? official.key : ''}|${(stage.rows || []).join('/')}|${JSON.stringify((stage.devices || []).map((d) => [d.key, d.pos, d.active, d.dir]))}` : '';
```

```diff
-    M.board = this._mesh(board.buckets.board, this.mat.board);
-    M.glass = this._mesh(board.buckets.glass, this.mat.glass);
-    M.decal = this._mesh(board.buckets.decal, this.mat.decal, { cast: false });
-    M.pipe = this._mesh(board.buckets.pipe, this.mat.pipe);
+    this.official = official && this._buildScene(official) ? official : null;
+    if (!this.official) {
+      M.board = this._mesh(board.buckets.board, this.mat.board);
+      M.glass = this._mesh(board.buckets.glass, this.mat.glass);
+      M.decal = this._mesh(board.buckets.decal, this.mat.decal, { cast: false });
+      M.pipe = this._mesh(board.buckets.pipe, this.mat.pipe);
+    }
```

hunk 3 的隐藏分块取舍（官方场景把左右半场/首领场做成可开关的子图）：

```diff
+export function sceneGroupVisible(rect, areas) {
+  if (!Array.isArray(rect) || rect.length < 4) return true;
+  const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
+  return (areas || []).some((a) => cx >= a.c0 - 0.5 && cx <= a.c1 + 0.5 && cy >= a.r0 - 0.5 && cy <= a.r1 + 0.5);
+}
```

**为什么改**：`#532`/PR `#533` 的渲染侧。官方场景里「联防 / 首领」用的左右半场是同一个场景文件里的隐藏子图，
所以必须按当前 `areas`（由 `layout.js` 算出）决定显示哪一块，否则会把关掉的半场也画出。

**老板这边的情况**：没动过，与 0.2.4 逐字节一致。**7 处全部落在新增/替换区，不重叠。**

**怎么合**：整段搬。

**搬运动作**：`copy 参考对象\...\public\js\render\board3d\scene.js → Stronghold-Protocol-repo\public\js\render\board3d\scene.js`

#### 4. `public/js/render/app.js`　【CLEAN-APPLY】　14 hunk，+45/−16

这个文件同时被三条 0.2.5 条目动过，所以 14 个 hunk 要分开说。

**官方改了什么**

| hunk | 旧行 | 改了什么 | 来源 |
|---|---|---|---|
| 1 | 50–62 | 头注释：`setSettings` 参数补 `officialDamageNumbers` | #412 |
| 2 | 122–134 | 导入 `loadScenePack` | #532 / PR #533 |
| 3 | 146–171 | 头注释 | #532 |
| 4 | 262–273 | `settings` 默认值加 `officialDamageNumbers: false` | #412 |
| 5 | 358–369 | 新增 `useOfficialScene(st)`：拿当前 stageId 去加载官方场景 | #532 |
| 6 | 377–389 | `enable3d` 建好 3D 后接 `useOfficialScene(stageRec)` | #532 |
| 7 | 627–639 | `setStage` 里也接 `useOfficialScene(st)` | #532 |
| 8 | 801–831 | `setPrep`：`prepMapChars` 改成同时留「原始盘面坐标」和「显示坐标」 | PR #523 |
| 9 | 1013–1024 | 新增 `mapCharAt(x,y)`：光标下的预备图角色 | PR #523 |
| 10 | 1215–1226 | 指针按下时先判 `mapCharAt`，命中就发带 `prepMapChar: true` 的 `pieceClick` | PR #523 |
| 11 | 1296–1307 | 清场时把 `prepMapChars` 也清掉 | PR #523 |
| 12 | 1440–1452 | `fx.damage(v, amt, e[3], src, e[4])` —— 把官方标记（第 5 个元素）传下去 | #412 |
| 13 | 1877–1888 | `setSettings` 接受 `officialDamageNumbers` | #412 |
| 14 | 1934–1946 | dev 钩子 `pick` 暴露 `mapCharAt` | PR #523 |

关键片段（hunk 12，伤害标记透传）：

```diff
-        fx.damage(v, amt, e[3], src);
+        fx.damage(v, amt, e[3], src, e[4]);
```

**为什么改**：
- `#532`：3D 场景加载要挂在「3D 就绪」和「换 stage」两个时机上。
- `#412`：官方伤害数字模式要求 sim 决定「这一下该不该出红字」，客户端只负责画，所以 `b.ev` 里第 5 个元素（`'r'`）必须原样转交 FX。
- PR `#523`：外勤医疗的预备图角色（`prepMapChars`）以前只是个只读装饰、点不开；
  官方要求准备阶段可以点开它的详情和攻击范围。所以要把「原始盘面坐标」留给自己看（详情/范围用），
  只把「显示坐标」交给渲染，并在指针按下时额外判一次 `mapCharAt`。

**老板这边的情况**：老板没动过这个文件（与官方 0.2.4 逐字节一致）。这 14 处**全部不重叠**。

**怎么合**：整段搬。

**搬运动作**：`copy 参考对象\...\public\js\render\app.js → Stronghold-Protocol-repo\public\js\render\app.js`

> ⚠️ **跨区提醒**：hunk 12/13 的官方伤害数字要真的生效，**必须同时搬 A 区 `server/sim/damage.js`**
> （0.2.5 新增 `officialDamageMark` / `officialExpectedAmount`，并在 `applyHpLoss` 里 `ev.push('r')`、
> 闪避时给 `num: 'm'`）和 **E 区 `public/js/ui/settings.js`**（`官方伤害数字` 开关）。
> 只搬 D 区 = 开关点了没反应。这三处是一条链，谁都不能漏。

---

### B. 设置新增「官方伤害数字」（`#412`）

CHANGELOG 第 5 行：「打开后只按 PRTS「伤害红字（暴击）」显示红色整数，以及本该出红字却被闪避的 MISS；关闭时仍显示每一次命中。」

**症状**：开着伤害数字时屏幕上是一串花哨的漂字；官方实机只飘红色整数（暴击）和黄色 MISS。
**根因**：本地一直是「自己排版的伤害数字」，没有「官方模式」这个概念。
**修完什么样**：设置里多一个开关（默认关）。打开后走 `officialNumber`：红整数（含 0）或 `MISS`，**不并入累计**、不受拥挤合并逻辑影响。

以下 5 个文件都是 **CLEAN-APPLY**。

#### 5. `public/js/render/fx/numbers.js`　【CLEAN-APPLY】　4 hunk，+52/−6

**官方改了什么**

- **hunk 1（旧行 35–57）**：`numChars` 认识 MISS；新增官方版抖动/抬升常量。

```diff
-/** Characters of a damage number as drawn (heals get a '+'). */
-const numChars = (v, style) => String(Math.round(v)).length + (style === 'heal' ? 1 : 0);
+/** Characters of a damage number as drawn (heals get a '+'; a yellow MISS is four letters). */
+const numChars = (v, style) => (style === 'miss' ? 4 : String(Math.round(v)).length + (style === 'heal' ? 1 : 0));
+
+// [ASSUMED] PRTS says a red number sits at a random spot in a range above the model and gives no pixels.
+const OFFICIAL_JITTER_X = 0.7;   // tiles, full width (±0.35)
+const OFFICIAL_LIFT_MIN = 0.15;  // tiles above the head
+const OFFICIAL_LIFT_SPAN = 0.4;
```

- **hunk 2（旧行 63–75）**：`damage()` 多收一个 `mark`，按官方模式分流。

```diff
-    damage(view, amount, type, srcView) {
+    damage(view, amount, type, srcView, mark) {
...
-    if (this.ctx.settings?.damageNumbers !== false) this.number(view, amount, style, big);
+    if (this.ctx.settings?.damageNumbers === false) return;
+    // Official mode (设置「官方伤害数字」): only a sim-marked red integer. Sparks and the slash stay.
+    if (this.ctx.settings?.officialDamageNumbers) {
+      if (mark === 'r') this.officialNumber(view, amount, 'crit');
+      return;
+    }
+    this.number(view, amount, style, big);
```

- **hunk 3（旧行 93–105）**：治疗也走官方分流 + 新增整个 `officialNumber()`。

```diff
-    if (this.ctx.settings?.damageNumbers !== false) this.number(view, amount, 'heal', false);
+    if (this.ctx.settings?.damageNumbers !== false && !this.ctx.settings?.officialDamageNumbers) this.number(view, amount, 'heal', false);
+  }
+
+  /**
+   * One official popup: a red integer (including 0) or the yellow MISS. It does not join a running total.
+   * Position is client-side only — the sim stays deterministic.
+   */
+  officialNumber(view, amount, style) {
```

- **hunk 4（旧行 126–138）**：累计合并时把官方数字排除在外。

```diff
-      if (t.unit !== view || t.fading) continue;
+      if (t.unit !== view || t.fading || t.official) continue;
```

**为什么改**：`#412`。要点是「官方模式只认 sim 的标记」——`mark === 'r'` 才出红字；
`officialNumber` 不参与累计（`t.official` 在合并里被跳过），位置抖动也明确写了 `[ASSUMED]`（PRTS 只说「随机位置」没给像素），
并且强调「位置只在客户端算，sim 仍确定性」。

**老板这边的情况**：没动过（与 0.2.4 逐字节一致）。

**怎么合**：整段搬。

**搬运动作**：`copy 参考对象\...\public\js\render\fx\numbers.js → Stronghold-Protocol-repo\public\js\render\fx\numbers.js`

#### 6. `public/js/render/fx/fonts.js`　【CLEAN-APPLY】　1 hunk，+1/−1

```diff
-      }, { chars: [['0', '9'], '+-×!'], resolution: 2, padding: 6 });
+      }, { chars: st.font === 'sp-dmg-miss' ? [['0', '9'], '+-×!', 'MISS'] : [['0', '9'], '+-×!'], resolution: 2, padding: 6 });
```

**为什么改**：`#412`。位图字体是按字符集预烘的，`MISS` 四个字母不在默认集里就会画不出来 —— 只给 `sp-dmg-miss` 这个字体补上，别的字体不变。

**老板这边的情况**：没动过。

**怎么合**：整段搬。

#### 7. `public/js/render/fx/system.js`　【CLEAN-APPLY】　1 hunk，+1/−1

```diff
-const FX_METHOD_ORDER = ["quality","load",...,"damage","_slash","heal","number",...];
+const FX_METHOD_ORDER = ["quality","load",...,"damage","_slash","heal","officialNumber","number",...];
```

**为什么改**：`#412`。`FxSystem` 是把多个 `Fx*` 子类的方法**按这张表混进原型**的，而且有「同名定义两次就 throw」的自检（见该文件下方循环）。
新增了 `officialNumber` 方法就必须登记进表，否则要么挂不上去、要么触发重复定义报错。

**老板这边的情况**：没动过。

**怎么合**：整段搬。

#### 8. `public/js/render/fx/simfx.js`　【CLEAN-APPLY】　1 hunk，+4

```diff
         case 'dodge': {
           this.particle('soft', p.x, p.y, { tint: 0xffffff, life: 0.3, s0: s / 128 * 0.5, s1: s / 128 * 0.9, a0: 0.5, a1: 0 });
           this.particle('slash', p.x, p.y, { tint: col, life: 0.22, s0: s / 128 * 0.8, s1: s / 128 * 1.1, a0: 0.7, a1: 0, rot: -0.5 });
+          // num:'m' — the sim already decided this dodge would have been a red number (PRTS yellow MISS, #ff9000).
+          if (ex.num === 'm' && at.v && this.ctx.settings?.damageNumbers !== false && this.ctx.settings?.officialDamageNumbers) {
+            this.officialNumber(at.v, 0, 'miss');
+          }
           break;
         }
```

**为什么改**：`#412` 的后半句「以及本该出红字却被闪避的 MISS」。闪避走的是 `dodge` 特效而不是 `damage`，
所以要在特效里补一次判定：只有 sim 打了 `num:'m'`（说明这一下本该是红字）才飘黄色 MISS。
**老板这边的情况**：没动过。

**怎么合**：整段搬。

#### 9. `public/js/render/style.js`　【CLEAN-APPLY】　1 hunk，+3

```diff
   elem: { font: 'sp-dmg-elem', fill: ['#fff4e0', '#ff7b3a'], stroke: '#3a1000' },
+  // Official red integer and yellow MISS (PRTS 作战机制 「伤害红字（暴击）」, MISS #ff9000). Default numbers never use these.
+  crit: { font: 'sp-dmg-crit', fill: ['#ffd0d0', '#ff2a2a'], stroke: '#4a0000' },
+  miss: { font: 'sp-dmg-miss', fill: ['#ffe0a8', '#ff9000'], stroke: '#4a2400' },
 });
```

**为什么改**：`#412`。给官方模式的两套配色。`miss` 用的 `#ff9000` 与 `simfx.js` 注释里写的 PRTS 黄一致（自洽）。

**老板这边的情况**：没动过。`DMG_STYLE` 是 `Object.freeze` 的，但新增 key 属于整文件覆盖，不影响老板任何改动。

**怎么合**：整段搬。

---

### C. 模型多挥一次（`#506`）

CHANGELOG 第 32 行：「修复干员一次攻击后模型继续循环、多挥一次的问题，保留迟到消息的现有前摇同步方式。」

#### 10. `public/js/render/spine.js`　【CLEAN-APPLY】　5 hunk，+20/−23

**官方改了什么**

| hunk | 旧行 | 改了什么 |
|---|---|---|
| 1 | 3–16 | 头注释：攻击改为「消耗前摇或直接从 OnAttack 起播，一次」 |
| 2 | 30–43 | 头注释：删除「攻击模式持续 ~1.4 个攻击间隔」的老描述 |
| 3 | 155–170 | `clipPerAttack` / `wound` 注释；`wound` 不再是「仅 clipPerAttack」 |
| 4 | 363–388 | `windUp()`：不再区分 single，统一 `_play(clip.loop, false, …)`，`attackUntil` 按剩余剪辑时长 |
| 5 | 394–435 | `attack()`：`wasAttacking` 判定与收尾分支重写 |

核心（hunk 4/5）：

```diff
-    const single = once || this.clipPerAttack;
-    // in rhythm: attack() re-phases; a clip-per-attack actor starts each attack's clip anew unless already wound up for it
-    if (this.mode === 'attack' && this.current === clip.loop && (!this.clipPerAttack || once || this.wound)) return false;
+    // One queued attack owns one wind-up. A later attack may begin while the previous recovery is still playing.
+    if (this.mode === 'attack' && this.current === clip.loop && (once || this.wound)) return false;
...
-    this.attackUntil = this.clock + lead + (single ? Math.max(0, loopDur - hit) / plan.ts : Math.max(0.45, iv * 1.4));
-    this._play(clip.loop, !single, { timeScale: plan.tsWind, start: plan.start, mix: 0.06 });
+    this.attackUntil = this.clock + lead + Math.max(0, loopDur - hit) / plan.ts;
+    this._play(clip.loop, false, { timeScale: plan.tsWind, start: plan.start, mix: 0.06 });
```

```diff
-    const wasAttacking = this.mode === 'attack' && this.current === clip.loop && (!per || this.wound);
+    const wasAttacking = this.mode === 'attack' && this.current === clip.loop && this.wound;
     this.mode = 'attack';
-    this.attackUntil = this.clock + (single ? Math.max(0, loopDur - hit) / ts : Math.max(0.45, this.interval * 1.4));
+    this.attackUntil = this.clock + Math.max(0, loopDur - hit) / ts;
```

**为什么改**：`#506`。干员（非 `clipPerAttack`）以前是**循环**播攻击剪辑，靠 `attackUntil = max(0.45, interval*1.4)` 兜着；
一旦消息迟到/成批到达，循环剪辑就会在上一击之后接着多挥一次。改成「每次攻击只播一遍」后就不会多挥。
代码里保留了老板要的那条：迟到（`windUntil` 已被粗粒度更新跨过）时对**干员**仍做原来的命中相位微调：

```diff
+        // Preserve operator hit-phase correction when a coarse/batched update crossed windUntil.
+        // This adjusts the prepared single clip; it does not start another visual swing.
+        if (!once && !per) {
+          const t = e.trackTime % loopDur;
+          let d = hit - t;
+          if (d > loopDur / 2) d -= loopDur; else if (d < -loopDur / 2) d += loopDur;
+          e.trackTime += d * 0.8;
+        }
```

**老板这边的情况**：没动过这个文件（与官方 0.2.4 逐字节一致）。5 处全部不重叠。

**怎么合**：整段搬。

**搬运动作**：`copy 参考对象\...\public\js\render\spine.js → Stronghold-Protocol-repo\public\js\render\spine.js`

---

### D. 敌方血条头顶高度（PR `#524`）

CHANGELOG 第 33 行：「敌方血条的头顶高度改按原点以上的高度计算，原点在身体中部的敌人不再把血条顶到上限。」

#### 11. `public/js/render/units.js`　【DIVERGED】　2 hunk，+40/−7　→ **实测可整段照搬**

**官方改了什么**

- **hunk 1（旧行 225–236）**：新增 `HEAD_TOP_K` / `HEAD_TILES_CAP` / `HEAD_TILES_CAP_BOSS` 与 `headTilesForUnit()` 导出。

```diff
+/** The share of a model's height a bar is placed above (the head is not the very top of the silhouette). */
+export const HEAD_TOP_K = 0.92;
+/** Enemies whose model is taller than this many tiles keep their bar at the cap — a bar must stay on screen. */
+export const HEAD_TILES_CAP = 2.2;
+export const HEAD_TILES_CAP_BOSS = 3.2;
```

```diff
+  if (b && Number.isFinite(b.height) && b.height > 20) {
+    // how far the box reaches *above the origin*: 猎狗pro −3.7, 大鲍勃 −2.6 (feet-anchored, ≈ height), 逐腐兽 −404.7 of
+    // 722.6 and 锏 −798 of 1183 (origin mid-body). Using the raw height there put the bar about a tile too high.
+    const top = Number.isFinite(b.y) ? b.y + b.height : b.height;
+    return clamp(Math.min(Math.max(top, 20), 900) * UNIT.modelScale * k * HEAD_TOP_K, 0.55, cap);
+  }
```

- **hunk 2（旧行 1294–1312）**：`UnitView._update` 里把原来内联的头高计算改成调用该函数。

```diff
-    let headTiles = UNIT.headroom;
-    if (this.isEnemy && spineShown && this.actor.entry.bounds) headTiles = clamp(this.actor.height * UNIT.modelScale * this.modelK * this.modelKY * 0.92, 0.55, this.isBoss ? 3.2 : 2.2);
-    else if (this.isEnemy && this.isBoss) headTiles = 2.2;
-    else if (this.isEnemy && spineShown) headTiles = clamp(UNIT.headroom * this.modelK * this.modelKY, 0.55, 2.2);
-    this._headTiles = headTiles;
+    const actor = spineShown ? this.actor : null;
+    const headTiles = this._headTiles = headTilesForUnit({
+      isEnemy: this.isEnemy, isBoss: this.isBoss, spineShown,
+      bounds: actor && actor.entry ? actor.entry.bounds : null,
+      modelK: this.modelK, modelKY: this.modelKY,
+    });
```

**为什么改**：症状是某些敌人血条顶到上限、离模型老远。根因：老代码用 `this.actor.height`（包围盒的**原始高度**），
但逐腐兽、锏这类模型的**原点在身体中部**，原始高度会把血条抬高约一格。改成用「包围盒顶端到原点的距离」`bounds.y + bounds.height`。

**老板这边的情况**：**这个文件老板改过**（`yours` 比官方 0.2.4 多 3350 字节），而且 `overlap.csv` 把它标成 `DISJOINT`（2 个官方 hunk vs 7 个老板 hunk，重叠行 0）。
老板的改动加的是别的东西（`CHARGE_HUD` 充能环、`_updateChargeRing`、`charges` 快照字段、`textures.js` 的 `chargeRing`/`CHARGE_RING` 导入）。
**官方这两处改的正是老板新代码旁边的 `_update` 头高段与 `EL_BAR` 导出区。**

**怎么合**：**我实跑了 `git merge-file`，结果是 `CLEAN-MERGE`（exit 0，零冲突标记）**，
并且合并后 `headTilesForUnit` 与 `CHARGE_HUD`/`_updateChargeRing` **两份都在**（已用文本检索确认）。
所以按第三节的口径：**可以整段照搬，不用手工并**。
唯一要留个心眼的是 hunk 1 的位置——官方把 `HEAD_TOP_K` 插在 `EL_BAR` 之后，老板的 `CHARGE_HUD` 也插在那附近；
git 能自动排好，但搬完请扫一眼 `EL_BAR` 与 `CHARGE_HUD` 两个 `Object.freeze` 都还在、没有互相嵌套。

**搬运动作**：整段复制即可：
`copy 参考对象\...\public\js\render\units.js → Stronghold-Protocol-repo\public\js\render\units.js`

> ⚠️ 覆盖前请确认：老板的 `CHARGE_HUD` / `_updateChargeRing` / `charges` 是**只在本文件 + `textures.js`** 实现的
> （`textures.js` 不在 0.2.5 改动清单里，不会被覆盖）。整段覆盖 `units.js` 会丢这些，**所以这里不要用「覆盖」，
> 要用「git 三路合并」或等价地把官方两个 hunk 打进去**。见第三节的搬运建议 —— 这也是我把 17 个文件分两类的原因：
> CLEAN-APPLY 才有资格谈「覆盖」，有老板改动的文件一律用合并。

---

### E. 盟约叠层提示音（`#482`）

CHANGELOG 第 28 行：「补齐回合开始、机变、休整期和战斗中的盟约叠层提示音；同类最多播放一路，新触发替换旧声音，重连和结算回填不补播。」

#### 12. `public/js/audio.js`　【DIVERGED】　7 hunk，+70/−3　→ **实测可整段照搬**

**官方改了什么**（7 处）

| hunk | 旧行 | 改了什么 |
|---|---|---|
| 1 | 522–533 | 构造函数新增 `bondCueNode` / `bondCueToken` / `bondCueScope` |
| 2 | 663–674 | `setVolumes` 里静音或 sfx≤0 时停掉提示音 |
| 3 | 831–842 | 新增 `bondCueRecent()` / `stopBondCue()` / `_playBondCue()` / `layerGain()` 四个方法 |
| 4 | 859–876 | `sfx()` 的 jsdoc 加 `scope`；`bondUp` 改走 `_playBondCue` |
| 5 | 1010–1021 | `setFieldUnits()` 里 `stopBondCue()` |
| 6 | 1053–1065 | 事件流认识 `layer` 类型 → `layerGain(e[2], e[3], 'battle')` |
| 7 | 1173–1184 | `installAudio` 的 sync：非游戏路由 / 非战斗阶段时停在播的提示音 |

关键片段（hunk 3，「同类最多一路 + 新触发顶旧」）：

```diff
+  /** The official ADD_BOND bank has maxSoundAllowed=1 / popOldest=true. No extra cooldown. */
+  stopBondCue(scope = null) {
+    if (scope && this.bondCueScope !== scope) return;
+    this.bondCueToken++;
+    this.bondCueScope = null;
+    const cur = this.bondCueNode;
+    this.bondCueNode = null;
+    if (!cur) return;
+    try { cur.src.stop(); } catch { /* already ended */ }
+    cur.end();
+  }
+
+  /** One cue per real gain, including several layers at once or an inactive bond. */
+  layerGain(bondId, add, scope = 'prep') {
+    if (typeof bondId === 'string' && bondId && Number.isFinite(add) && add > 0) this.sfx('bondUp', { volume: 0.7, scope });
+  }
```

hunk 7（「重连和结算回填不补播」）：

```diff
+          if (deps.selectRoute(s) !== 'game') audio.stopBondCue();
+          else if (![PHASE.COMBAT, PHASE.UNITE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE].includes(pub?.phase)) {
+            // A new prep gain can precede its m.public phase update. Cancel only the previous battle's cue.
+            audio.stopBondCue('battle');
+          }
```

**为什么改**：`#482`。官方 `ADD_BOND` 音库是 `maxSoundAllowed=1 / popOldest=true`——**同类只允许一路、新的顶掉旧的**。
所以要有 token 机制（`bondCueToken`）保证异步解码完成后旧的不能再出声；`bondCueRecent` 用来挡住
「同一次准备期更新既加层（`m.layer`）又抬活跃盟约数（`screens/game.js`）」导致的重复触发。

**老板这边的情况**：老板改过这个文件，`overlap.csv` 标 `PARTIAL-OVERLAP`（官方 7 hunk / 老板 1 hunk，重叠 1 行）。
老板加的是 **`playUrl(url, o)`** —— 给海克斯抽取的本地音效（`hextech/audio` 的 `selectGold` / `reroll`）用的通路，
由 E 区 `public/js/ui/gameActions.js` 调用。老板那一处 hunk 落在**旧行 859–876 区间**，正是官方 hunk 4 的位置。

**怎么合**：**我实跑了 `git merge-file`，结果是 `CLEAN-MERGE`（exit 0，零冲突标记）**，
合并后官方四项（`_playBondCue` / `bondCueRecent` / `layerGain` / `stopBondCue`）与老板的 `playUrl` **全在**（已检索确认），
合并结果 `node --check` 通过。
注意：`overlap-exact.csv` 说本文件 0 撞车 hunk —— 这一条**与实测一致**，可直接用。
**不要用「整段覆盖」**（会丢 `playUrl`），**要用三路合并**。

**搬运动作（三路合并，保两边）**：
```
git merge-file -p <老板的 audio.js> <base-024 的 audio.js> <base-025 的 audio.js> > audio.js.merged
# 确认后替换；合并结果应为 exit 0、无 <<<<<<< 标记
```

#### 13. `public/js/main.js`　【DIVERGED】　2 hunk，+5/−1　→ **实测可整段照搬**

**官方改了什么**

- **hunk 1（旧行 41–53）**：导入 `audio`（`import { audio, installAudio } from './audio.js';`）
- **hunk 2（旧行 226–237）**：`wireNet()` 里新增 `m.layer` 监听

```diff
+  net.on('m.layer', (msg) => {
+    const s = store.get();
+    if (selectRoute(s) === 'game' && msg.playerId === s.me?.playerId) audio.layerGain(msg.bondId, msg.add);
+  });
```

**为什么改**：`#482` 的客户端入口。服务端 `server/match/player/economy.js` 发 `m.layer`（`{ t:'m.layer', playerId, bondId, add }`），
这里收到后只处理「本机自己」的，再交给 `audio.layerGain` 出声。

**老板这边的情况**：老板改过 `main.js`（加 `ModsHost`、`UpdateNotesHost`、`AnnounceBanner`、`store` 的若干导出），
`overlap.csv` 标 `PARTIAL-OVERLAP`（官方 2 hunk / 老板 16 hunk，重叠 3 行）—— **重叠的是导入区**。

**怎么合**：**实测 `git merge-file` = `CLEAN-MERGE`（exit 0）**，合并后官方的 `m.layer` 监听与老板的
`ModsHost` / `AnnounceBanner` / `UpdateNotesHost` **全在**，`node --check` 通过。
所以**可以整段照搬**（实际用三路合并最稳），不要「手工挑行」。

> ⚠️ **跨区提醒（已逐树实测核对）**：`m.layer` 这条往返链路是 **3 个区各一段**，缺一段就全链断：
>
> | 环节 | 位置 | 归属 | base-024 | base-025 | 老板树 |
> |---|---|---|---|---|---|
> | 协议条目 | `shared/protocol.js:475`、`:476` | F 区 | 0 | 2 | 0 |
> | **发送点** | **`server/match/player/economy.js:52`** | **C 区** | **0** | **1** | **0** |
> | 接收 + 转音频 | `public/js/main.js:232` | D 区（本区） | 0 | 1 | 0 |
> | 出声 | `public/js/audio.js:842`（注释）/ `layerGain` | D 区（本区） | 0 | 1 | 0 |
>
> **发送点确认是 `server/match/player/economy.js:52`**（`this.m.sendTo(this.playerId, { t: 'm.layer', playerId: this.playerId, bondId, add })`），
> **不是** `match/phases.js` 或 `match/bossRounds.js`——那两个文件 0.2.5 也改了，但改的是别的东西。
> 全树按 `m.layer` 精确匹配（排除 `unit.mem.layers`）：base-024 **0** 处、老板树 **0** 处、base-025 **5** 处。
> 只搬 D 区的 `main.js` + `audio.js` 而漏了 C 区那个发送点 → 提示音永远不响。
>
> 两个容易数错的坑（我都踩过，记下来）：
> 1. `server/sim/content/kits/ops/chess_char_4_18-mudrok.js` 里的 `unit.mem.layers` **会被 `m\.layer` 正则误命中** 6 次
>    （三个树里都有），数「`m.layer` 出现几次」时**必须排除**，否则会得到 base-024=7 / base-025=12 这种错数。
> 2. `server/sim/battle/economy.js` 的 `_ev(['layer', …])` 是**战斗事件流**（`fx 'layer'` → `audio.layerGain(e[2], e[3], 'battle')`），
>    三个树里都在，**不是 0.2.5 新增**，别和协议层的 `m.layer` 混为一谈。

---

### F. AI 托管遮罩挡住「在此页面继续」（PR `#511`）　★真撞车

CHANGELOG 第 34 行：「修复 AI 托管遮罩挡住「在此页面继续」按钮。」

#### 14. `public/css/theme.css`　【DIVERGED】　1 hunk，+1/−1　→ **★真撞车，必须手工合**

**官方改了什么**（唯一一处，旧行 92–104）

```diff
   /* layers */
   --z-screen: 1;
   --z-banner: 40;
-  --z-conn: 60;
+  --z-conn: 75;
   --z-modal: 80;
```

**为什么改**：症状是连不上服务器时弹出的连接横幅上那个「在此页面继续 / 重新连接」按钮点不动。
根因是层级：连接横幅 `.conn-banner` 用 `--z-conn`（60），而「AI 托管中 / 本局模拟已结束」遮罩 `.awayov` 是**写死的 `z-index: 70`**
（`public/css/screens/game.css`，`position: fixed; inset: 0`，铺满整屏）。60 < 70 → 遮罩盖在横幅上面，按钮被吃掉点击。
官方把 `--z-conn` 抬到 **75**（> 70 且仍 < `--z-modal` 的 80），横幅就压过遮罩了。

**老板这边的情况**：老板改过这个文件，`overlap.csv` 标 `PARTIAL-OVERLAP`。老板在 `--z-conn: 60;` 的**紧接着的下一行**插了 4 行：

```diff
   --z-conn: 60;
+  /* 全体公告 (ui/announce.js): above every screen, the in-match top bar and the connection banner; below the modal /
+     toast layers — a dialog the player opened is a deliberate interaction and a standing broadcast must not cover it,
+     but an announcement is never hidden behind the game either. */
+  --z-announce: 70;
```

**这就是真撞车的原因**：官方改第 **98** 行（`--z-conn`），老板在 **99–102** 行插新内容——**行区间不相邻重叠，但紧贴**。
`overlap-exact.csv` 按「改动行区间是否相交」判成「自由可搬」，可是 **git 的三路合并会因为改动紧邻而报冲突**。
我实跑 `git merge-file` 的结果是 **`CONFLICT(1)`，2 个冲突标记**，冲突块正是：

```
<<<<<<< 老板
  --z-conn: 60;
  /* 全体公告 … */
  --z-announce: 70;
||||||| base-024
  --z-conn: 60;
=======
  --z-conn: 75;
>>>>>>> base-025
```

**怎么合**：**两边都要，取官方的 75 + 保留老板的 announce 块**。成稿片段（可直接替换那一小段）：

```css
  /* layers */
  --z-screen: 1;
  --z-banner: 40;
  /* 0.2.5（PR #511）：60 → 75，让连接横幅压过 game.css 里写死 z-index: 70 的 .awayov
     （AI 托管中 / 本局模拟已结束遮罩），否则横幅上的「在此页面继续」按钮被遮罩吃掉点击 */
  --z-conn: 75;
  /* 全体公告 (ui/announce.js): above every screen, the in-match top bar and the connection banner; below the modal /
     toast layers — a dialog the player opened is a deliberate interaction and a standing broadcast must not cover it,
     but an announcement is never hidden behind the game either. */
  --z-announce: 70;
  --z-modal: 80;
  --z-toast: 90;
  --z-tooltip: 95;
  --z-rotate: 100;
```

**两个要留意的点（不确定就说）**：
1. 老板那段注释里写着公告在「the connection banner」**之上**，但官方把 `--z-conn` 抬到 75 之后，
   连接横幅（75）反而在公告（70）**之上**，注释与新数值不再自洽。
   **不过两者空间上不重叠**：`.conn-banner` 是 `position: fixed; bottom: .24rem;`，`.announce-bar` 是 `top: 0;`
   一个贴底一个贴顶，谁压谁对观感没有影响。所以这是**注释措辞**问题，不是功能问题 —— 不改也能用，
   建议顺手把那半句「and the connection banner」去掉以免下一个人看糊涂。
2. `--z-announce: 70` 与 `.awayov` 的 `70` **相等**。理论上公告和托管遮罩可能同屏，
   同值时由 DOM 顺序决定谁在上面。我不知道官方对此有没有明确意图（0.2.5 里没有公告这个功能，
   `--z-announce` 是老板自己的），**这里标为不确定，不做断言**；若在意，把公告调到 71 或 69 都能明确关系。

---

### G. 观战盟约名单带上自选干员（PR `#505`）　★真撞车

CHANGELOG 第 31 行：「观战时的盟约成员名单带上自选干员（PR #505）」。感谢 @Xinglang233。

#### 15. `public/js/battle/runner.js`　【DIVERGED】　2 hunk，+5/−3　→ **★真撞车，必须手工合**

**官方改了什么**

- **hunk 1（旧行 58–72，文件头注释）**：`ownerOps` 的签名注释加上 `diy?`，并补一句说明。
- **hunk 2（旧行 880–892，`ownerOps` 实现）**：返回值带上自选干员的 `diy`。

```diff
-            return si ? { ...o, standInFor: si } : o;
+          const diy = u.def?.diyFor ? u.def.loadout?.diy : null;
+          return { ...o, ...(si ? { standInFor: si } : {}), ...(diy ? { diy: { ...diy } } : {}) };
```

**为什么改**：症状是观战 / 看队友时，盟约成员弹窗里那些**自选（DIY）干员**算不进对应干员的盟约，名单对不上。
根因：`ownerOps` 以前只回 `{ kind, ownerId, defId, items?, standInFor? }`，**没有 `diy`**，
而消费方 `public/js/ui/watchBonds.js` 明确要读 `u.diy.charId` 才能把单位归到正确的干员：

```js
// watchBonds.js:171-172（两个树里都一样，本文件不在 0.2.5 改动清单内）
// 0.2.0 自选编队: a DIY slot's unit names its operator (UnitInfo diy) — the popup counts it for that operator's bonds
if (isObj(u.diy) && typeof u.diy.charId === 'string') p.diy = u.diy;
```

也就是说：`diy` 早就在 `UnitInfo` 里了，`watchBonds` 也早就认了，**只有 `ownerOps` 这条旁路没带上**，所以观战时丢。
0.2.5 就是补上这一条。

**老板这边的情况**：老板改过这个文件，`overlap.csv` 标 `PARTIAL-OVERLAP`（官方 2 hunk / 老板 3 hunk，重叠 1 行）。
老板在同一段**文件头注释**里加了 `damageReport` 的说明（`battleRunner.damageReport(playerId?, fieldId?)`，
给 `ui/damageReport.js` 伤害统计面板用，服务端 `server/sim/spec.js damageReport`），
属于老板自己的 0.3.0 功能（实测：`damageReport` 在 base-024/base-025 均为 0 次，老板树 7 次）。

**这就是真撞车的原因**：官方 hunk 1 改的是 `ownerOps` 那几行注释，老板改的是**紧挨着的同一个注释块**
（老板把 `damageReport` 插在 `ownerOps` 之前）。两边改的是同一段连续注释。
`overlap-exact.csv` 标它「自由可搬」，但 `git merge-file` 实测 **`CONFLICT(1)`，2 个冲突标记**，冲突块就是这段注释：

```
<<<<<<< 老板
//   battleRunner.damageReport(playerId?, fieldId?) → …（老板新增 5 行）
//   battleRunner.ownerOps(ownerId, fieldId?) → [{ kind: 'op', ownerId, defId, items?, standInFor? }] that player's
||||||| base-024
//   battleRunner.ownerOps(ownerId, fieldId?) → [{ kind: 'op', ownerId, defId, items?, standInFor? }] that player's
=======
//   battleRunner.ownerOps(ownerId, fieldId?) → [{ kind: 'op', ownerId, defId, items?, standInFor?, diy? }] that player's
>>>>>>> base-025
```

**怎么合**：**两边都留**。注释部分保留老板的 `damageReport` 说明，并把官方 `diy?` 加进 `ownerOps` 的签名行；
实现部分取官方的三行。

**成稿片段 1 —— 头注释（替换冲突块）**：

```js
//   battleRunner.damageReport(playerId?, fieldId?) → the 伤害统计 rows of the battle on screen (server/sim/spec.js
//                           damageReport: per operator, summon damage folded into its owner, biggest first) | null when
//                           no battle is on screen / `fieldId` names another field. Read-only, like unitStats: it takes
//                           the stats the sim computed, and the panel is the only reader (ui/damageReport.js)
//   battleRunner.ownerOps(ownerId, fieldId?) → [{ kind: 'op', ownerId, defId, items?, standInFor?, diy? }] that player's
//                           operators in the battle on screen with their equipment (a teammate's bond popup: the members in
//                           play, DESIGN §20.15, 变形同构体 wearers included; a 补位 stand-in names the replaced charId,
//                           a 自选 operator carries its pick like UnitInfo) | []
```

**成稿片段 2 —— `ownerOps` 实现（取官方，老板此处没改）**：

```js
        return list.filter((u) => u && u.kind === 'op' && u.ownerId === ownerId && typeof u.defId === 'string')
          .map((u) => {
            const o = Array.isArray(u.items) && u.items.length ? { kind: 'op', ownerId, defId: u.defId, items: [...u.items] } : { kind: 'op', ownerId, defId: u.defId };
            const si = u.def && typeof u.def.standInFor === 'string' ? u.def.standInFor : null;
            const diy = u.def?.diyFor ? u.def.loadout?.diy : null;
            return { ...o, ...(si ? { standInFor: si } : {}), ...(diy ? { diy: { ...diy } } : {}) };
          });
```

**顺带一条好消息**：老板在**同一个文件**里还有一处 `SIM_DATA_FILES` 的改动
（加了 `'hextech'`，附一大段「浏览器侧敌方言灵卡为什么不生效」的排查注释），
它落在**另一个 hunk**，与官方两处**不重叠**，实测合并后完整保留（已检索确认 `'backups', 'hextech'` 仍在）。
所以本文件合并后应当是：官方 `diy` + 老板 `damageReport` + 老板 `hextech` **三者都在**，`node --check` 通过。

---

### H. 其余 DIVERGED（都可整段照搬）

#### 16. `public/js/diag.js`　【DIVERGED】　1 hunk，+1/−1　→ 实测零冲突

**官方改了什么**（旧行 203–215）

```diff
-    lines.push(`settings: ${join(`quality ${settings.quality}`, settings.damageNumbers ? 'damage numbers' : null, settings.muted ? 'muted' : null)}`);
+    lines.push(`settings: ${join(`quality ${settings.quality}`, settings.damageNumbers ? 'damage numbers' : null, settings.officialDamageNumbers ? 'official damage numbers' : null, settings.muted ? 'muted' : null)}`);
```

**为什么改**：`#412`。错误报告里要能看出「官方伤害数字」开没开，否则玩家报的渲染问题没法复现。
**老板这边的情况**：老板改过 `diag.js`（加了 `diagnosticsPayload()` 上传反馈等，`overlap.csv` 标 `DISJOINT`），但改的都是这个文件的其他部分。
**怎么合**：**实测 `git merge-file` = `CLEAN-MERGE`（exit 0）**，合并后 `official damage numbers` 与老板的 `diagnosticsPayload` 都在，`node --check` 通过。
**搬运动作**：三路合并（或用官方那行改进去）。

#### 17. `public/css/components.css`　【DIVERGED】　1 hunk，+9/−0　→ 实测零冲突

**官方改了什么**（旧行 505–516）

```diff
+.tooltip--aside { max-width: 3.2rem; white-space: normal; }
+.tooltip--compound { display: flex; gap: .16rem; max-width: min(8rem, calc(100vw - 16px)); max-height: calc(100dvh - 16px); overflow: auto; pointer-events: auto; overscroll-behavior: contain; }
+.tooltip--compound .tooltip__main { flex: 1 1 2.2rem; min-width: 0; }
+.tooltip--compound .tooltip--aside { flex: 1 1 2.2rem; min-width: 0; border-left: 1px solid var(--line-2); padding-left: .12rem; }
+@media (max-width: 600px) {
+  .tooltip--compound { flex-direction: column; }
+  .tooltip--compound .tooltip__main, .tooltip--compound .tooltip--aside { flex: none; max-width: 100%; width: 100%; }
+  .tooltip--compound .tooltip--aside { border-left: 0; border-top: 1px solid var(--line-2); padding: .1rem 0 0; }
+}
```

**为什么改**：`#484` / PR `#494`「盟约提示框旁列出本局被禁用的成员」。要在 tooltip 里并排放「主内容 + 侧栏」，
所以加了复合 tooltip 布局；窄屏（≤600px）自动改成上下排。
**老板这边的情况**：老板改过本文件（`overlap.csv` 标 `DISJOINT`），加的是公告条 `.announce-bar` 等一整块，位置在文件很后面。
**怎么合**：**实测 `CLEAN-MERGE`（exit 0）**，`tooltip--compound` 与老板的 `announce-bar` 都在。
**跨区提醒**：本条的消费者是 **E 区 `public/js/ui/components.js` 与 `ui/matchInfo.js`**，
而 `ui/components.js` 是**全场唯一的真代码撞车点（不归 D 区）**——搬 D 区这条 CSS 时若 E 区还没合 `components.js`，
侧栏样式会先到位但没组件用，不会报错，只是不显示。

#### 18. `public/css/screens/game.css`　【DIVERGED】　1 hunk，+2/−0　→ 实测零冲突

**官方改了什么**（旧行 678–689）

```diff
 .ff-float--heal { color: #6dff9c; }
+.ff-float--crit { color: #ff2a2a; }
+.ff-float--miss { color: #ff9000; }
 @keyframes float-up { to { transform: translate(-50%, -.4rem); opacity: 0; } }
```

**为什么改**：`#412`。给**简化（DOM）战场**那套浮字补官方模式的两色（等于 `style.js` 里 3D 侧的 `crit`/`miss` 的 DOM 版）。
`#ff9000` 与 `style.js`、`simfx.js` 注释三处一致。
**老板这边的情况**：老板改过本文件（`overlap.csv` 标 `DISJOINT`），老板的改动在 `.pauseov` 等处（暂停遮罩等）。
**怎么合**：**实测 `CLEAN-MERGE`（exit 0）**，`ff-float--crit/miss` 与老板的 `pauseov` 都在。
**注意**：`overlap.csv`（旧口径）把它标 `DISJOINT`、`overlap-exact.csv`（新口径）标「自由可搬」，**两者一致，且与实测一致**。这条可以放心。

---

### I. 其余 CLEAN-APPLY

#### 19. `public/css/screens/briefing.css`　【CLEAN-APPLY】　1 hunk，+9/−0

```diff
+/* the box beside a bond's tooltip (matchInfo.js BondBannedAside): its banned members with avatar, name and bonds */
+.brief-bantip { display: flex; flex-direction: column; gap: .06rem; }
+.brief-bantip__h { font-size: calc(.12 * var(--t)); font-weight: 700; letter-spacing: .06em; color: var(--red); }
+.brief-bantip__op { display: flex; align-items: center; gap: .08rem; }
+.brief-bantip__op .uthumb { flex: none; }
+.brief-bantip__txt { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
+.brief-bantip__txt b { font-size: calc(.14 * var(--t)); color: var(--text-hi); }
+.brief-bantip__txt > span { font-size: calc(.12 * var(--t)); color: var(--text-lo); }
+.brief-bantip__txt .is-this { color: var(--mint-400); }
```

**为什么改**：`#484` / PR `#494`。被禁成员侧栏（`BondBannedAside`）的排版：头像 + 名字 + 盟约，自己高亮成薄荷色。
**老板这边的情况**：没动过（与 0.2.4 逐字节一致）。**怎么合**：整段覆盖。
**搬运动作**：`copy 参考对象\...\public\css\screens\briefing.css → Stronghold-Protocol-repo\public\css\screens\briefing.css`
**跨区提醒**：组件在 E 区 `ui/matchInfo.js`，D 区只管样式。

#### 20. `public/css/screens/title.css`　【CLEAN-APPLY】　1 hunk，+5/−0

```diff
   bottom: .3rem;
   display: flex;
   justify-content: space-between;
   align-items: flex-end;
+  flex-wrap: wrap;
+  gap: .12rem .2rem;
   font-size: calc(.13 * var(--t));
   color: var(--text-dim);
 }
+.title-foot__meta { display: flex; align-items: flex-end; gap: .16rem; flex-wrap: wrap; justify-content: flex-end; }
+.title-repo { color: inherit; text-decoration: none; border-bottom: 1px solid transparent; }
+.title-repo:hover, .title-repo:focus-visible { color: var(--text-hi); border-bottom-color: currentColor; }
```

**为什么改**：`#543`「标题画面页脚新增「项目仓库」链接」。页脚多了个链接要能换行不挤爆，所以给页脚加 `flex-wrap`，
给链接加下划线悬停反馈。
**老板这边的情况**：没动过（与 0.2.4 逐字节一致）。**怎么合**：整段覆盖。
**搬运动作**：`copy 参考对象\...\public\css\screens\title.css → Stronghold-Protocol-repo\public\css\screens\title.css`
**跨区提醒**：链接本身在 E 区 `public/js/screens/title.js`（`+5/−2`），D 区只管样式。

---

## 三、撞车与搬运（关键结论）

### 3.1 我用什么口径判的（请以此为准）

`merge-worksheet.csv` 的 `Collides` 用 `unified=6` 上下文，相邻不重叠会误报；队长的修正令改用 `unified=0` +
插入点感知，把 D 区判成 **0 撞车**。**两个 CSV 都是「按改动行区间是否相交」推的**，而真正的判据是
**git 自己的三路合并会不会冲突**。所以我对 D 区 20 个文件逐个实跑了：

```
git merge-file -p <老板树文件> <base-024 同路径> <base-025 同路径>
```

结果：

| 判定 | 文件数 | 文件 |
|---|---|---|
| `CLEAN-MERGE`（exit 0，零冲突标记） | **18** | components.css, briefing.css, screens/game.css, title.css, audio.js, diag.js, main.js, render/app.js, board3d/load.js, board3d/materials.js, board3d/scene.js, fx/fonts.js, fx/numbers.js, fx/simfx.js, fx/system.js, spine.js, style.js, render/units.js |
| `CONFLICT`（exit 1） | **2** | **`public/css/theme.css`**、**`public/js/battle/runner.js`** |

对合并成功的 JS 文件我还跑了 `node --check`（audio / main / diag / units / app / spine / numbers 全部 exit 0），
并逐个核对了「官方新特性 + 老板新特性是否都在」——都在。

### 3.2 与队长修正令的分歧（请复核这一条）

> 修正令：「D 区真撞车 = 0，以下文件全部降级为『自由可搬』：`main.js`、`battle/runner.js`、`audio.js`、`theme.css`、`screens/game.css`。」

**实测结论：其中 3 个成立，2 个不成立。**

| 文件 | 修正令 | 实测 `git merge-file` | 差异原因 |
|---|---|---|---|
| `public/js/main.js` | 自由可搬 | **CLEAN-MERGE** ✅ 一致 | — |
| `public/js/audio.js` | 自由可搬 | **CLEAN-MERGE** ✅ 一致 | — |
| `public/css/screens/game.css` | 自由可搬 | **CLEAN-MERGE** ✅ 一致 | — |
| `public/css/theme.css` | 自由可搬 | **CONFLICT** ❌ 不一致 | 官方改第 **98** 行，老板在 **99–102** 行插入，**紧邻**；行区间不相交但 git 视为同一 hunk 冲突 |
| `public/js/battle/runner.js` | 自由可搬 | **CONFLICT** ❌ 不一致 | 官方改 `ownerOps` 注释行，老板在**同一个连续注释块**里加 `damageReport`；`overlap-exact.csv` 的行区间判定没算进「同一注释块被两边各改一处」 |

**影响面**：这 2 个文件**不是不能搬，而是不能「整段覆盖」或「让工具自动合」**——必须按 2.14 / 2.15 给的成稿片段手工合一次。
两处的合并本身都是「两边都留」的一行级小事，**工作量很小，但漏了会丢东西**：
- `theme.css` 若只取官方 → 丢掉老板的 `--z-announce: 70`（公告条层级），公告条会被模态框/提示层盖住；
- `runner.js` 若只取官方 → 丢掉老板的 `damageReport`（伤害统计面板的整条通路）。
- 反过来若只取老板 → 分别丢掉 `#511` 的 z-index 修复和 PR `#505` 的 `diy`。

**建议**：`overlap-exact.csv` 里这两行建议改成「紧邻撞车 / 手工合」，并给判据加一条
「同一注释块或相邻插入」——纯行区间相交会漏掉这类。

### 3.3 搬运总表

| 文件 | 分类 | 实测 | 动作 |
|---|---|---|---|
| 12 个 CLEAN-APPLY | CLEAN-APPLY | CLEAN-MERGE | **整段覆盖**（零冲突，零丢失） |
| `render/units.js` | DIVERGED | CLEAN-MERGE | 三路合并；**别覆盖**（会丢老板的 `CHARGE_HUD`/充能环） |
| `audio.js` | DIVERGED | CLEAN-MERGE | 三路合并；**别覆盖**（会丢老板的 `playUrl`） |
| `main.js` | DIVERGED | CLEAN-MERGE | 三路合并；**别覆盖**（会丢 `ModsHost`/`AnnounceBanner`/`UpdateNotesHost`） |
| `diag.js` | DIVERGED | CLEAN-MERGE | 三路合并（丢 `diagnosticsPayload` 就没法上传反馈） |
| `components.css` | DIVERGED | CLEAN-MERGE | 三路合并（丢公告条 `.announce-bar`） |
| `screens/game.css` | DIVERGED | CLEAN-MERGE | 三路合并（丢暂停遮罩 `.pauseov`） |
| **`theme.css`** | DIVERGED | **CONFLICT** | **手工合**，用 §2.14 成稿片段 |
| **`battle/runner.js`** | DIVERGED | **CONFLICT** | **手工合**，用 §2.15 两段成稿片段 |

一句话：**D 区只有 12 个文件可以谈「覆盖」；另外 8 个都有老板的改动，一律走三路合并**（其中 6 个 git 能自动合干净，2 个要手工）。

### 3.4 跨区依赖（漏了 D 区就白干）

| D 区文件 | 依赖谁 | 漏了会怎样 |
|---|---|---|
| `render/app.js`（hunk 12/13）、`fx/numbers.js`、`fx/simfx.js` | A 区 `server/sim/damage.js` 的 `officialDamageMark` / `officialExpectedAmount` / `ev.push('r')` / `num:'m'` | 开关点了没反应（sim 从不下发标记）。实测两棵基线树里 `officialDamageMark` 与 `officialExpectedAmount` **各 0 处、`ev.push('r')` 0 处、`num:'m'` 0 处**；base-025 里两个函数**各 4 处引用**（含 2 个定义）、`ev.push('r')` 1 处、`num:'m'` 1 处 |
| `render/app.js`、`fx/numbers.js` | E 区 `public/js/ui/settings.js` 的「官方伤害数字」开关 | 界面上没有开关可点 |
| `main.js`、`audio.js` | C 区 `server/match/player/economy.js:52` 的 `m.layer` 发送点（+ F 区 `shared/protocol.js:475/476` 协议条目） | 提示音永远不响。实测全树 `m.layer`（排除 `mem.layers`）：base-024 0 处、老板树 0 处、base-025 5 处 |
| `render/board3d/*`、`render/app.js` | F 区 `tools/setup.mjs --scenes` + `tools/local-extract/scenes.py` / `fetch_scenes.py`（两个 0.2.5 新文件） | 代码在但没场景资源，永远退回金属地块（不报错）。实测老板 `data/local-assets.json` 里 `scene/` 组 0 条 |
| `components.css`、`briefing.css` | E 区 `ui/components.js`（**全场唯一真代码撞车**）、`ui/matchInfo.js` | 样式到位但没组件用，静默不显示 |
| `screens/title.css` | E 区 `screens/title.js` | 同上 |
| `screens/game.css` | E 区 `ui/hud.js`、`ui/shopBar.js`、`ui/gameActions.js` | 同上 |
| `render/units.js` | E 区同文件的 `textures.js chargeRing`（**老板私有，不在 0.2.5 清单内**） | 若误用「整段覆盖」，充能环会因缺导出而崩/不显示 |

### 3.5 不确定的部分（不编）

1. **`render/app.js` 14 个 hunk 里有一半是注释行**（头注释、jsdoc），我按「hunk 落在哪个功能区」归类到 `#532`/`#412`/PR `#523` 三条上；
   纯注释措辞本身不影响功能，若你要逐字对齐官方措辞，直接整段覆盖即可。
2. **`theme.css` 的 `--z-announce(70)` 与 `.awayov(70)` 同值**的先后关系：官方 0.2.5 没有公告功能，
   无权威依据，**不确定官方意图**，故只标注不结论（见 §2.14 第 2 点）。
3. **PR `#534`（BC5/DXT5nm 法线贴图）在 D 区只有 `materials.js` 头注释一处**，
   真正的实现在 F 区 `tools/local-extract/extract.py`（那是 F 区的活）。D 区渲染侧只是「消费正确的法线贴图」，
   **如果 F 区不搬 extract.py，3D 金属棋盘发灰的问题不会好**（这条也解释了为什么 `materials.js` 是 CLEAN-APPLY：老板没动）。
4. 我没有找到 0.2.5 里任何一条**明确**对应 `render/app.js` 中「`prepMapChars` 保留原始盘面坐标」这个改法的条目，
   我把它归到 PR `#523`（「准备阶段可以点开该角色的详情和攻击范围」）——**这是合理推断，不是 CHANGELOG 原文点名**。
   若你要严格起见，可记作「CHANGELOG 未单列，推断为 PR #523 的伴随改动」。

---

## 四、逐 hunk 索引（防止漏 hunk）

按 BRIEF 要求「每个 hunk 都要有下文」。D 区 57 个 hunk 的落点：

| 文件 | hunk 数 | 在上文的位置 |
|---|---|---|
| `board3d/load.js` | 2 | §2.1 表格（2 行全覆盖） |
| `board3d/materials.js` | 2 | §2.2（hunk1 头注释 / hunk2 新增材质） |
| `board3d/scene.js` | 7 | §2.3 表格（7 行全覆盖） |
| `render/app.js` | 14 | §2.4 表格（14 行全覆盖） |
| `render/fx/numbers.js` | 4 | §2.5（4 处逐条） |
| `render/fx/fonts.js` | 1 | §2.6 |
| `render/fx/system.js` | 1 | §2.7 |
| `render/fx/simfx.js` | 1 | §2.8 |
| `render/style.js` | 1 | §2.9 |
| `render/spine.js` | 5 | §2.10 表格（5 行全覆盖） |
| `render/units.js` | 2 | §2.11（hunk1 `headTilesForUnit` / hunk2 调用点） |
| `audio.js` | 7 | §2.12 表格（7 行全覆盖） |
| `main.js` | 2 | §2.13（hunk1 导入 / hunk2 `m.layer`） |
| `css/theme.css` | 1 | §2.14 ★ |
| `battle/runner.js` | 2 | §2.15（hunk1 注释 / hunk2 实现）★ |
| `diag.js` | 1 | §2.16 |
| `css/components.css` | 1 | §2.17 |
| `css/screens/game.css` | 1 | §2.18 |
| `css/screens/briefing.css` | 1 | §2.19 |
| `css/screens/title.css` | 1 | §2.20 |
| **合计** | **57** | 与 `areas.csv` D-client-render 的 57 一致 |

**覆盖自检**：CLEAN-APPLY 12 个 / 40 hunk，DIVERGED 8 个 / 17 hunk，合计 20 文件 / 57 hunk；
MISSING-IN-YOURS **0 个**（D 区没有 0.2.5 新增文件，两个新文件 `tools/local-extract/scenes.py`、`fetch_scenes.py` 归 F 区）。
与 `diffstat.csv` 的 `+690 / −73`（D 区 20 文件合计）也对得上（`areas.csv` 的 `DiffLines` 合计 1671 行）。
