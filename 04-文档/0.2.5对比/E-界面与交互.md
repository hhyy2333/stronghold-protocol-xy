# E 区（界面与交互）：0.2.5 官方对 `public/js/screens/**` 与 `public/js/ui/**` 改了 15 个文件，其中唯一真代码撞车在 `ui/components.js`

> 覆盖 15 个文件 / 38 个 hunk；CLEAN-APPLY 5 个，DIVERGED 10 个，新增 0 个。
> 精确撞车（改到同一行）：**1 个文件 / 4 行**，全部在 `public/js/ui/components.js`。
> 其余 9 个 DIVERGED 文件按 `.scratch\audit-025\overlap-exact.csv` 是「自由可搬」（改动行与官方改动行不相交）。

**证据口径**：分类取 `threeway.csv` / `areas.csv`；撞车判定取 `real-collisions.csv` + `overlap-exact.csv`（`unified=0` + 插入点感知）。
旧的 `merge-worksheet.csv` 的 `Collides` 列是 `unified=6` 上下文口径，**会把相邻不重叠的改动误报成撞车**，本报告不采用。
「官方改了什么」= `diffs\<路径>.diff`；「老板改了什么」= `diffs\<路径>.vs-024.diff`；「差官方 0.2.5 多远」= `diffs\<路径>.vs-025.diff`。

> **关于 hunk 计数（避免两处数字对不上）**：本报告的「38 个 hunk」与各节的「N hunk」一律取 **`areas.csv`** 的口径（git 默认 `unified=3` 分组）。
> `overlap-exact.csv` 用的是 **`unified=0`**，同一份改动会被切得更碎，**E 区合计 63 个**（例：`ui/components.js` 在 areas 里是 4 个、在 overlap-exact 里是 13 个；`ui/matchInfo.js` 是 1 个 vs 4 个）。
> 两者**不矛盾，只是切法不同**；撞车行号以 `real-collisions.csv`（`unified=0` + 插入点感知）为准。

---

## 一、结论速览

| # | 文件 | 分类 | 修的是啥 | 来源 | 搬运建议 |
|---|---|---|---|---|---|
| 1 | `public/js/ui/components.js` | DIVERGED | `Tooltip` 加「复合提示框」`aside`（可滚动、可选中、点外/Esc 关） | #484 / PR #494 | **手动合**：官方加 `aside`，老板加 `tapShow`，同一函数同一 JSDoc 相撞；两特性并存的合并片段见 §2.1 |
| 2 | `public/js/screens/game.js` | DIVERGED | 商店刷新单飞（按钮变灰/热键失效）+ 盟约叠层提示音去重 + 预备地图角色可点详情 | #501/PR #507、#482、PR #523 | 自由可搬（3 处，互不相交）；**须与 #7 #10 同批**，否则 `refreshBusy` 传了个没人接的 prop |
| 3 | `public/js/screens/game/range.js` | CLEAN-APPLY | 预备地图角色在准备期的攻击范围 | PR #523 | 直接覆盖 |
| 4 | `public/js/screens/loadout.js` | DIVERGED | 导入带 `ops` 的调配时缺数据整份拒绝；只改潜能/练度也能导出 | PR #538、PR #503 | 自由可搬（2 处，距老板改动 ≥125 行） |
| 5 | `public/js/screens/title.js` | DIVERGED | 页脚加「项目仓库」外链 | #543 | 自由可搬（距老板改动 38 行） |
| 6 | `public/js/ui/fallbackField.js` | DIVERGED | DOM 兜底棋盘的官方伤害数字（`fallbackFloat`）+ 预备地图角色可点 | #412、PR #523 | 自由可搬，但**改动行紧贴老板改的 JSDoc**，补丁上下文可能对不上，见 §4 |
| 7 | `public/js/ui/gameActions.js` | DIVERGED | `onRefreshBusy` 单飞：刷新在途时丢弃再次点击 | #501 / PR #507 | 自由可搬；**单飞的宿主，必须与 #2 #10 同批** |
| 8 | `public/js/ui/gameComponents.js` | DIVERGED | LP 塔数字保留「已结算值」，只旁挂 −N | #479 / PR #504 | 自由可搬；这行老板**没动过**（仍是 0.2.4 的 `value - p`），官方这处会把老板的「提前扣减」显示改掉，属预期行为变更 |
| 9 | `public/js/ui/settings.js` | DIVERGED | 设置项「官方伤害数字」开关 + 说明 | #412 | 自由可搬（距老板改动 21 行）；需配套 #12 与 4 个语言包 |
| 10 | `public/js/ui/shopBar.js` | DIVERGED | 刷新按钮在途变灰 + 提示「正在刷新…」 | #501 / PR #507 | 自由可搬；**须与 #2 #7 同批** |
| 11 | `public/js/ui/gameLogic/camera.js` | CLEAN-APPLY | 首领配对改用服务器下发的 `pub.bossPairs` | 首领配对改随机（CHANGELOG 未单列编号） | 直接覆盖 |
| 12 | `public/js/ui/gameLogic/settings.js` | CLEAN-APPLY | `DEFAULT_SETTINGS` / `sanitizeSettings` 加 `officialDamageNumbers` | #412 | 直接覆盖 |
| 13 | `public/js/ui/hud.js` | DIVERGED | LP 相关注释改口径（「标记」而非「扣减」） | #479 / PR #504 | 自由可搬；官方**只改注释**，老板的 `free` 参数与敌方源石条原样保留 |
| 14 | `public/js/ui/loadoutSync.js` | CLEAN-APPLY | `revision` 计数器：旧请求作废，避免旧技能写回 | PR #540 | 直接覆盖 |
| 15 | `public/js/ui/matchInfo.js` | CLEAN-APPLY | 盟约提示框旁列出本局被禁用的成员 | #484 / PR #494 | 直接覆盖，**但依赖 #1 的 `aside`**；另需 `briefing.css`（D 区） |

**一句话给老板**：这一区真正难的只有一处——`ui/components.js` 的 `Tooltip` 被官方和咱们同时改了。官方给它加了「复合提示框」（盟约禁用名单要用），咱们给它加了「触屏点一下就看」（敌方源石条在用）。**不是二选一，是两件事都得留在同一个 `Tooltip` 里**，而且两边各自在管一个「延迟隐藏」的定时器，合的时候必须让它们共用一个调度点，否则互相 `clearTimeout` 会把对方踩掉。其余 14 个文件照搬即可。

---

## 二、逐文件明细

### 1. `public/js/ui/components.js`　【DIVERGED】★ 本区唯一真撞车

**官方改了什么**（0.2.4 → 0.2.5，hunk 4 处，+35/−12）

具体是给 `Tooltip` 增加 `aside`（第二个内容区）：状态里多一个 `aside` 字段、`Tooltip` 多一个参数、多一个 `asideRef`，`TooltipLayer` 渲染成 `.tooltip__main` + `.tooltip--aside` 两栏，并加上「点框外 / 按 Esc 关闭」「窗口缩放重算位置」「贴边夹取」「复合框可聚焦可滚动」这些行为。

```diff
@@ -531,49 +531,53 @@ export function DialogHost() {
-let tipState = null; // { id, content, rect, placement }
+let tipState = null; // { id, content, aside, rect, placement }
 ...
- * @param {{ text: any, placement?: 'top'|'bottom', delay?: number, block?: boolean, class?: string, children?: any }} props
+ * `aside`: a second section in the same clamped, scrollable box; stacked on narrow screens.
+ * @param {{ text: any, aside?: any, placement?: 'top'|'bottom', delay?: number, block?: boolean, class?: string, children?: any }} props
-export function Tooltip({ text, placement = 'top', delay = 120, block = false, class: cls, children }) {
+export function Tooltip({ text, aside = null, placement = 'top', delay = 120, block = false, class: cls, children }) {
   const textRef = useRef(text);
+  const asideRef = useRef(aside);
   textRef.current = text;
+  asideRef.current = aside;
 ...
-      setTip({ id: idRef.current, content, rect: el.getBoundingClientRect(), placement });
+      setTip({ id: idRef.current, content, aside: asideRef.current, rect: el.getBoundingClientRect(), placement,
+        hold: () => clearTimeout(timer.current), hide });
@@ -583,24 +587,30 @@ export function Tooltip({ text, placement = 'top', delay = 120, block = false, c
-    if (tipState?.id === idRef.current) { clearTimeout(timer.current); timer.current = setTimeout(hide, 1600); }
+    if (tipState?.id === idRef.current && !asideRef.current) { clearTimeout(timer.current); timer.current = setTimeout(hide, 1600); }
-  const onLeave = () => { pressed.current = false; if (Date.now() - touchAt.current > 900) hide(); };
+  const onLeave = () => {
+    pressed.current = false;
+    if (Date.now() - touchAt.current > 900) {
+      if (asideRef.current) { clearTimeout(timer.current); timer.current = setTimeout(hide, 250); }
+      else hide();
+    }
+  };
@@ -619,18 +644,13 @@ export function TooltipLayer() {
-    return () => tipListeners.delete(force);
+    const outside = (e) => { if (tipState?.aside && !e.target?.closest?.('.tooltip')) tipState.hide?.(); };
+    const escape = (e) => { if (e.key === 'Escape') tipState?.hide?.(); };
+    document.addEventListener('pointerdown', outside);
+    document.addEventListener('keydown', escape);
+    window.addEventListener('resize', force);
+    return () => { tipListeners.delete(force); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', force); };
 ...
     left = Math.max(m, Math.min(vw - b.width - m, left));
+    top = Math.max(m, Math.min(vh - b.height - m, top));
 ...
-  return html`<div ref=${boxRef} class=${cx('tooltip', ready && 'is-shown', ready && `tooltip--${pos.place}`)} role="tooltip"
-    style=${ready ? `top:${pos.top}px;left:${pos.left}px` : 'top:-9999px;left:-9999px'}>${tipState.content}</div>`;
+  const hasAside = tipState.aside != null && tipState.aside !== '';
+  const off = 'top:-9999px;left:-9999px';
+  return html`<div ref=${boxRef} class=${cx('tooltip', hasAside && 'tooltip--compound', ready && 'is-shown', ready && `tooltip--${pos.place}`)} role="tooltip"
+    tabIndex=${hasAside ? 0 : undefined} onMouseEnter=${() => tipState?.hold?.()} onMouseLeave=${() => tipState?.hide?.()}
+    onFocusIn=${() => tipState?.hold?.()} onPointerDown=${() => tipState?.hold?.()}
+    onFocusOut=${(e) => { if (!e.currentTarget.contains(e.relatedTarget)) tipState?.hide?.(); }}
+    style=${ready ? `top:${pos.top}px;left:${pos.left}px` : off}>
+    ${hasAside ? html`<div class="tooltip__main">${tipState.content}</div><div class="tooltip--aside">${tipState.aside}</div>` : tipState.content}
+  </div>`;
```

**为什么改**：`#484`「盟约提示框旁列出本局被禁用的成员（#484、PR #494）」。某个盟约被禁用了几个人，光一个红色数字 `3` 说不清是谁；鼠标停在盟约上时，除了原有的说明文字，右边再列一栏「本局禁用干员」——头像、名字、以及这名干员所属的盟约（当前这个高亮）。名单可能很长，所以这一栏要能滚动、能选中复制、移动端要上下堆叠，于是才有 `.tooltip--compound` 和那套夹取/关闭逻辑。

**老板这边的情况**：同一处老板也改了，走的是**另一个方向**——给 `Tooltip` 加触屏「点一下就看」`tapShow`，服务于老板自己加的「敌方协议源石条」（`ui/hexOverlay.js:166` 传 `tapShow=${true}`）。老板的改动（`vs-024.diff`，14 个 hunk）包括：JSDoc 重写、三个触屏常量、签名加 `tapShow`、`hideTimer`、`show(after)`、长按/点击两条触发分支。

```diff
@@ -547,2 +554,8 @@ const TOUCH_TIP_MS = 450;
+/** How long a tooltip stays after a long press's finger lifts. */
+const TOUCH_TIP_HOLD_MS = 1600;
+/** How long a TAP-shown tooltip stays (tapShow): reading time for the text a tap just revealed. */
+const TOUCH_TAP_HOLD_MS = 3000;
+/** Movement (px) still counted as a tap rather than a scroll / drag (the same slop device.js uses). */
+const TOUCH_TAP_SLOP = 10;
+
+export function Tooltip({ text, placement = 'top', delay = 120, block = false, class: cls, tapShow = false, children }) {
```

**怎么合**：**两边特性都要，不能二选一。** 相撞的是 4 行（base-024 行号 544 / 548 / 573 / 589，即 JSDoc 的 `@param` 行、函数签名行、触屏注释行、`onPointerEnd` 的 1600ms 行）：

| 撞点（旧行） | 官方在那里写了什么 | 老板在那里写了什么 |
|---|---|---|
| 544 | JSDoc 加 `aside` 说明 | JSDoc 整体重写为 `tapShow` 说明 |
| 548 | `Tooltip({ text, aside = null, … })` | `Tooltip({ text, …, tapShow = false, … })` |
| 573 | 触屏注释（`aside` 时保持打开） | 触屏注释（`tapShow` / 长按） |
| 589 | `&& !asideRef.current` 守卫 + 1600 常量 | `tapShow` 分支 + `TOUCH_TIP_HOLD_MS` |

**合并要点**（三条，按优先级）：

1. **签名并起来**（两边参数都收）：
   ```js
   export function Tooltip({ text, aside = null, placement = 'top', delay = 120, block = false, class: cls, tapShow = false, children }) {
   ```
   JSDoc 把官方那段（`aside`：同一夹取可滚动框里的第二栏，窄屏上下堆叠）和老板那段（`tapShow`：触屏普通点按即开，再点关闭，`TOUCH_TAP_HOLD_MS` 后自动隐藏；长按依旧有效；桌面 hover 不受影响）拼成两段，参数行按上面顺序写全。

2. **两边各有一个「延迟隐藏」定时器，必须共用一个调度点。** 这是最容易合错的地方：
   - 老板的 `timer.current` 用来放**显示延迟**（`show(after)`）和长按松手后的宽限；`hideTimer.current` 专门用来放「点按展示后读一会儿」（`TOUCH_TAP_HOLD_MS`）。
   - 官方把宽限写在 `timer.current` 上（`aside` 时 250ms），还给 `tipState` 挂了 `hold`/`hide` 供 `TooltipLayer` 回调。

   直接照抄官方那行会覆盖掉老板正在用的 `timer.current`，所以**官方那两处要改写成 `hideTimer.current`**，让「显示延迟」和「停留宽限」各占各的槽：
   ```js
   const setTip = (s) => { tipState = s; for (const fn of [...tipListeners]) fn(); };
   // …
   setTip({ id: idRef.current, content, aside: asideRef.current, rect: el.getBoundingClientRect(), placement,
     hold: () => { clearTimeout(timer.current); clearTimeout(hideTimer.current); }, hide });
   // …
   const onLeave = () => {
     pressed.current = false;
     if (Date.now() - touchAt.current > 900) {
       // 官方原本写 timer.current；本树 timer 归「显示延迟」，宽限一律走 hideTimer
       if (asideRef.current) { clearTimeout(hideTimer.current); hideTimer.current = setTimeout(hide, 250); }
       else hide();
     }
   };
   ```
   老板的 `hide()` 本来就已经同时清两个定时器，`TooltipLayer` 的 `outside` / `escape` 调 `tipState?.hide?.()` 因此天然安全，不用改。

3. **`onPointerEnd` 里两套逻辑并存**：官方加的守卫是「有 `aside` 时不自动收起，留给用户在框里滚动」；老板加的是「`tapShow` 且是一次干净短点按 → 立刻打开并停留 `TOUCH_TAP_HOLD_MS`」。顺序建议：**先跑老板的 `tapShow` 分支（命中就 `return`），再落官方那句带上 `!asideRef.current` 守卫的宽限**，即
   ```js
   if (tipState?.id === idRef.current && !asideRef.current) { clearTimeout(timer.current); timer.current = setTimeout(hide, TOUCH_TIP_HOLD_MS); }
   ```
   （老板已把魔法数 1600 提成 `TOUCH_TIP_HOLD_MS`，保留常量、别退回字面量。）

**跨文件依赖（必须同批落地，否则功能半死）**：

- **样式不在本区**：`.tooltip--compound` / `.tooltip--aside` / `.tooltip__main` 及窄屏媒体查询在 **`public/css/components.css`（D-client-render 区）**，官方那一个 hunk（`@@ -505,12 +505,21 @@`）。老板当前 `public/css/components.css` 里 `tooltip--compound` 命中 **0** 次 —— 也就是说**只合 JS 不合 CSS，`aside` 会渲染成一堆没有布局的裸文字**。
  ⚠ **此文件不是「可直接覆盖」，是 DISJOINT（可整段搬 hunk，但不能整文件覆盖）**：`threeway.csv` 明确标 `DIVERGED`（`Size024=47452 / SizeYours=49402`），老板在**同文件末尾**（旧行 994 之后）加了整段 `.announce-bar` 公告条样式（`announce-bar` 在老板树命中 15 次、官方 0.2.4 命中 0 次），并删掉了旧行的 `.topbar__tools` / `.lobby-screen .topbar*` / `.me-chip--btn*`。**若整文件用官方 0.2.5 覆盖，老板的公告条样式会被整段抹掉。** 正确做法：只把官方那 9 行（`@@ -505,12 +505,21 @@`）**按 hunk 搬进 boss 文件**——该 hunk 的上下文区（老板树行 500–520）与官方 0.2.4 **逐行一致**（已比对），可干净合入，且与老板改动相距 **478 行**（`proximity.csv` `MinGap=478`，`overlap-exact.csv` 判「自由可搬」/`CollideHunks=0`）。
- **调用方在本区且是 CLEAN-APPLY**：`ui/matchInfo.js`（本区第 15 项）整文件照搬后会传 `aside=${…}`（`BondBannedAside`，即 #484 的名单栏）。`components.js` 没合 → 这个 prop 被静默忽略，老板看到的将是「照搬了却没效果」。
- 老板 `tapShow` 的调用方是老板自己的 `ui/hexOverlay.js:166`（0.2.5 没有这个文件）——**合 `components.js` 时绝不能把 `tapShow` 丢掉**，否则敌方源石条的触屏提示直接失效。

**搬运动作**：`components.js` 属手动合，无可整段覆盖的部分；建议以**老板现有文件为底**，把官方那 4 个 hunk 按上面三条并进去，然后单独确认 `public/css/components.css` 的 9 行（D 区）也进了。

---

### 2. `public/js/screens/game.js`　【DIVERGED → 自由可搬】

**官方改了什么**（0.2.4 → 0.2.5，hunk 7 处，+11/−5）。7 处按来源分三组：

**(a) 商店刷新单飞（`#501` / PR #507）——hunk 1、2、7**

```diff
@@ -81,13 +81,13 @@ import { Ticker } from '../ui/ticker.js';
-import { actions } from '../ui/gameActions.js';
+import { actions, onRefreshBusy } from '../ui/gameActions.js';
@@ -180,12 +180,16 @@ function MatchScreen() {
   const [collapsed, setCollapsed] = useState(false);
+  // GitHub #501: a g.refresh is still waiting for its reply — the shop's 刷新 button dims while it is (gameActions.js
+  // single-flights the intent; the R hotkey is dropped by the same guard)
+  const [refreshBusy, setRefreshBusy] = useState(false);
+  useEffect(() => onRefreshBusy(setRefreshBusy), []);
@@ -1465,13 +1471,13 @@
-      ${showShop ? html`<${ShopBar} priv=${priv} editable=${editable} collapsed=${collapsed} onCollapse=${setCollapsed}
+      ${showShop ? html`<${ShopBar} priv=${priv} editable=${editable} collapsed=${collapsed} refreshBusy=${refreshBusy} onCollapse=${setCollapsed}
```

**为什么改**：`#501`「刷新请求返回前不会重复发送」。网络慢的时候，玩家点了「刷新」看没反应就又点一下，而每一次 `g.refresh` 到服务器都是一次**要花钱的刷新**。改法：在途期间把再次点击丢掉，同时按钮变灰、R 热键也失效，请求落地（成功或失败）再恢复。

**(b) 盟约叠层提示音去重（`#482`）——hunk 3、4**

```diff
@@ -425,12 +429,13 @@
       if (viewModeRef.current !== 'prep') {
+        audio.stopBondCue('battle');
@@ -756,13 +761,14 @@
-    if (activeBonds > prevActive.current && phase === PHASE.PREP) audio.sfx('bondUp', { volume: 0.7 });
+    // a layer gain of the same update already started the cue (audio.bondCueRecent): keep it, don't restart it
+    if (activeBonds > prevActive.current && phase === PHASE.PREP && !audio.bondCueRecent('prep')) audio.sfx('bondUp', { volume: 0.7, scope: 'prep' });
```

**为什么改**：`#482`「补齐回合开始、机变、休整期和战斗中的盟约叠层提示音；同类最多播放一路，新触发替换旧声音，重连和结算回填不补播」。同一帧里既由「叠层事件」又由「本地状态比对」触发时，会叠着播两遍；用 `bondCueRecent('prep')` 判断这一路刚响过就不再补，并给声音打上 `scope` 便于「同类最多一路」。离开准备期时 `stopBondCue('battle')` 掐掉过期的准备期提示音。

> 注：`audio.stopBondCue` / `audio.bondCueRecent` 由 **`public/js/audio.js`（D-client-render 区）** 提供，本区这两行要等那一区先落地，否则 `audio.stopBondCue` 是 `undefined` 直接抛错。

**(c) 预备地图角色可点详情（PR #523）——hunk 5、6**

```diff
@@ -995,13 +1001,13 @@
-        if (e.unitId != null || e.unit) { setDetail({ kind: 'unit', unit: e.unit || null, unitId: e.unitId, uid: e.uid }); return; }
+        if (e.unitId != null || e.unit) { setDetail({ kind: 'unit', unit: e.unit || null, unitId: e.unitId, uid: e.uid, prepMapChar: e.prepMapChar === true }); return; }
@@ -1395,13 +1401,13 @@
-  // an own board piece in prep (its loadout / stand-in record, its facing); in battle or on a scouted board an ally
+  // an own board piece or read-only prepared map character in prep; in battle or on a scouted board an ally
```

**为什么改**：`PR #523`「准备阶段可以点开该角色的详情和攻击范围」。外勤医疗的「预备地图角色」只是个只读展示、还不是模拟单位，所以它的事件要带上 `prepMapChar: true` 让详情卡和范围计算走另一条路径（配对改动在 `screens/game/range.js`，见 §3）。

**老板这边的情况**：老板在 `game.js` 上动得**非常多**（`vs-024.diff` 31 个 hunk：`HexOverlay`、`ChatBox`、伤害统计面板、测试场面板、`cornerRef` 高度上报、`normalizeHex`/`noteUnits` 导入……）。但按精确比对，官方这 7 个 hunk 与老板改动**没有一行重叠**（`overlap-exact.csv`：`CollideHunks = 0`，「自由可搬」）。

**怎么合**：三组都能直接搬到老板文件对应位置。唯一要留意的是 (b) 依赖 `audio.js`（D 区），(a) 依赖 `gameActions.js` + `shopBar.js`（本区 §7、§10）——**这三件必须一起进**，只加 `game.js` 的 `refreshBusy` 会传一个没有消费方的 prop（不报错，但按钮不变灰）。

**搬运动作**：手动按 hunk 落位（老板文件已大幅重排，行号不可直接用，按上下文定位）。

---

### 3. `public/js/screens/game/range.js`　【CLEAN-APPLY】

**官方改了什么**（1 hunk，+8/−5）

```diff
-  } else if (target?.kind === 'unit' && !showPrep) {
+  } else if (target?.kind === 'unit' && (!showPrep || target.prepMapChar === true)) {
     const unit = target.unit;
     if (!unit || unit.side !== 'ally' || (unit.kind !== 'op' && unit.kind !== 'token')) return null;
     if (unit.area != null && unit.area !== 'board') return null;
+    // A prepared map character is a read-only view, not a simulated unit yet. Its board-space coordinates come from
+    // m.private.prepMapChars and must not be read from a previous battle's snapshot or transformed twice on boss R.
+    if (showPrep && (unit.kind !== 'token' || detail.type !== 'token' || detail.token?.kind !== 'mapChar')) return null;
     // Snapshots exclude undeployed, hidden and removed units. Dead units remain briefly for their death animation.
-    if (!field?.prep && (!snapshot || snapshot[3] <= 0)) return null;
-    row = Math.round(snapshot ? snapshot[2] : unit.y);
-    col = Math.round(snapshot ? snapshot[1] : unit.x);
-    dir = normDir(live?.dir, null) || normDir(unit.dir, null) || (unit.facing === -1 ? 'LEFT' : 'RIGHT');
+    if (!showPrep && !field?.prep && (!snapshot || snapshot[3] <= 0)) return null;
+    row = Math.round(!showPrep && snapshot ? snapshot[2] : unit.y);
+    col = Math.round(!showPrep && snapshot ? snapshot[1] : unit.x);
+    dir = (!showPrep && normDir(live?.dir, null)) || normDir(unit.dir, null) || (unit.facing === -1 ? 'LEFT' : 'RIGHT');
```

**为什么改**：`PR #523`。准备期的预备地图角色还没进模拟，它的坐标只能从 `m.private.prepMapChars` 取；若照旧读上一场战斗的 snapshot，或者首领战 R 半场再做一次镜像变换，范围就会画错位置。所以准备期一律绕开 snapshot / live。

**老板这边的情况**：未动过此文件（`yours` 与官方 0.2.4 逐字节一致）。

**搬运动作**：
```
copy 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\public\js\screens\game\range.js → Stronghold-Protocol-repo\public\js\screens\game\range.js
```

---

### 4. `public/js/screens/loadout.js`　【DIVERGED → 自由可搬】

**官方改了什么**（3 hunk，+19/−1）

**(a) 导入缺数据整份拒绝（`PR #538`）——hunk 1、2**

```diff
@@ -448,12 +448,26 @@ export function missingGameData(tab, status = data.status) {
+/**
+ * A loadout payload that carries `ops` (including empty `ops`) replaces 潜能 / 练度. 自选 operators are in that list
+ * and only backups.json names them, so the refusal is the 自选编队 one: chess.json and backups.json both loaded.
+ * Null when the payload has no `ops` (an older file leaves the current 练度 alone) or that data is ready (GitHub #538).
+ */
+export function loadoutOpsImportRefusal(ops, ready, status = data.status) {
+  if (ops == null) return null;
+  return importRefusal('diy', ready, status);
+}
@@ -583,12 +597,16 @@ function LoadoutScreen({ st }) {
     const res = parseImport(ioText);
     if (!res.ok) { toast(t('导入失败：{error}', { error: res.error }), 'error'); return; }
+    // ops replaces 潜能 / 练度, including 自选 operators that only backups.json names. Missing data used to drop
+    // them and still save, clearing a 练度 the file did not mean to erase (GitHub #538).
+    const opsRefused = loadoutOpsImportRefusal(res.ops, ready);
+    if (opsRefused) { toast(opsRefused.text, opsRefused.tone); return; }
```

**为什么改**：`PR #538`「导入带潜能 / 练度的调配文件时，若缺少自选编队所需的游戏数据，整份导入会被拒绝，不再清掉已保存的练度」。症状：导入一份带 `ops` 的文件时如果 `backups.json` 还没载入，那些「自选干员」会被当成无效条目直接丢掉，但文件**照样保存**——等于把玩家原有的练度清空了。根因是「部分失败也提交」。修完：只要载荷带 `ops`（含空 `ops`）就在前置检查里整份拒绝，一次改动都不做。

**(b) 只改潜能/练度也能导出（`PR #503`）——hunk 3**

```diff
@@ -672,13 +690,13 @@ function LoadoutScreen({ st }) {
-        <${Button} variant="ghost" size="sm" data-testid="loadout-export" disabled=${!nChanged} onClick=${openExport} title=${t('导出当前调配（可复制或下载）')}>${t('导出')}<//>
+        <${Button} variant="ghost" size="sm" data-testid="loadout-export" disabled=${!nChanged && !Object.keys(st.ops || {}).length} onClick=${openExport} title=${t('导出当前调配（可复制或下载）')}>${t('导出')}<//>
```

**为什么改**：`PR #503`「只修改自选潜能 / 练度时也能导出调配」。`nChanged` 只统计干员调配的改动，只调了潜能/练度时它是 0，导出按钮就一直灰着。

**老板这边的情况**：老板改过此文件 3 处（`vs-024.diff`：`RosterRow` 与 `Detail` 里的 `chessAvatarUrl(..., data.get('local'))`、删掉一个空行）。与官方 3 个 hunk 的最近距离 **125 行**，互不相干。

**搬运动作**：手动按 hunk 落位；无冲突。

---

### 5. `public/js/screens/title.js`　【DIVERGED → 自由可搬】

**官方改了什么**（1 hunk，+5/−2）

```diff
@@ -288,11 +288,14 @@ export function TitleScreen() {
       <span>${t('非官方同人复刻 · 游戏素材版权归 上海鹰角网络 / Yostar 所有')}</span>
-      <${MicroLabel}>v${APP_VERSION} · WEB SIMULATION<//>
-      ${DEV_BUILD ? html`<span class="title-dev" role="note">${t('开发版 · 不稳定，请勿用于公开服务器')}</span>` : null}
+      <span class="title-foot__meta">
+        <a class="title-repo" href="https://github.com/sganggs/Stronghold-Protocol" target="_blank" rel="noopener noreferrer">${t('项目仓库')}</a>
+        <${MicroLabel}>v${APP_VERSION} · WEB SIMULATION<//>
+        ${DEV_BUILD ? html`<span class="title-dev" role="note">${t('开发版 · 不稳定，请勿用于公开服务器')}</span>` : null}
+      </span>
```

**为什么改**：`#543`「标题画面页脚新增『项目仓库』链接，在新标签页打开本项目仓库」。把版本号那行包进 `.title-foot__meta`，前面挂外链。

**老板这边的情况**：老板改过 2 处（加 `import { UpdateNotesButton }` 与在**右上角工具条**里放 `<${UpdateNotesButton} class="title-notes" />`）。注意老板那处加在页面**上方的 `title-corner__tools`**（旧行 250 附近），官方改在**页脚**（旧行 288-298），两者相距 **38 行**，不撞。

**怎么合**：直接搬官方页脚那一段。**若沿用官方的写法，注意它新增的 `title-foot__meta` 与 `title-repo` 两个类样式在 `public/css/screens/title.css`（D 区）**，官方同时加了 5 行；只搬 JS 不搬 CSS 会得到一个没换行、没 hover 下划线的裸链接。

**搬运动作**：手动落位页脚；顺带确认 `public/css/screens/title.css`（D 区）的 `.title-foot__meta` / `.title-repo` 已进。

---

### 6. `public/js/ui/fallbackField.js`　【DIVERGED → 自由可搬】

**官方改了什么**（4 hunk，+31/−7）

**(a) DOM 兜底棋盘的官方伤害数字（`#412`）——hunk 1、2、4**

```diff
@@ -57,12 +57,36 @@ export function fallbackTileClass(stage, row, col) {
+/**
+ * The simplified board's floating label for one event, or null when that event draws no digits.
+ * Official mode keeps only a marked red integer (including 0) and a yellow MISS. The slot stays above the unit;
+ * the random offset of the Pixi numbers is not repeated here [ASSUMED].
+ */
+export function fallbackFloat(e, settings) {
+  if (!settings?.damageNumbers || !Array.isArray(e)) return null;
+  if (settings.officialDamageNumbers === true) {
+    if (e[0] === 'fx' && e[1] === 'dodge' && e[4] && e[4].num === 'm') return { id: e[4].id, text: 'MISS', type: 'miss' };
+    if (e[0] !== 'dmg' || e[4] !== 'r') return null;
+    const amount = Math.round(Number(e[2]) || 0);
+    if (!Number.isFinite(amount) || amount < 0) return null;
+    return { id: e[1], text: String(amount), type: 'crit' };
+  }
+  if (e[0] !== 'dmg' && e[0] !== 'heal') return null;
+  const amount = Math.round(Number(e[2]) || 0);
+  if (amount <= 0) return null;
+  const type = e[0] === 'heal' ? 'heal' : (e[3] === 'arts' ? 'arts' : e[3] === 'true' ? 'true' : 'phys');
+  return { id: e[1], text: e[0] === 'heal' ? `+${amount}` : String(amount), type };
+}
@@ -75,13 +99,13 @@ export function createFallbackView(host, opts = {}) {
-    drag: null, hoverTarget: null, floats: [], settings: { damageNumbers: true, ...(opts.settings || {}) },
+    drag: null, hoverTarget: null, floats: [], settings: { damageNumbers: true, officialDamageNumbers: false, ...(opts.settings || {}) },
@@ -453,17 +479,15 @@
-        } else if ((e[0] === 'dmg' || e[0] === 'heal') && st.settings.damageNumbers && st.floats.length < 60) {
-          const amount = Math.round(Number(e[2]) || 0);
-          if (amount <= 0) continue;
-          const type = e[0] === 'heal' ? 'heal' : (e[3] === 'arts' ? 'arts' : e[3] === 'true' ? 'true' : 'phys');
-          st.floats.push({ key: `${now}:${Math.random()}`, id: e[1], text: e[0] === 'heal' ? `+${amount}` : String(amount), type, at: now });
+        } else if (st.floats.length < 60) {
+          const spec = fallbackFloat(e, st.settings);
+          if (spec) st.floats.push({ key: `${now}:${Math.random()}`, id: spec.id, text: spec.text, type: spec.type, at: now });
```

**为什么改**：`#412`「设置新增『官方伤害数字』（默认关闭）：打开后只按 PRTS『伤害红字（暴击）』显示红色整数，以及本该出红字却被闪避的 MISS；关闭时仍显示每一次命中」。把原来内联在事件循环里的浮字逻辑抽成纯函数 `fallbackFloat`，并按新设置分流：官方模式只留红色暴击整数（含 0）和黄色 `MISS`。`[ASSUMED]` 点是「不再重复 Pixi 数字的随机偏移」。

**(b) 预备地图角色可点（`PR #523`）——hunk 3**

```diff
@@ -334,13 +358,15 @@
           pieces.push(html`<div key=${`map:${u.uid}`} class="ff-piece ff-piece--token ff-piece--map-char"
-            style=${`transform:translate(${pos.x}px,${pos.y}px);width:${L.tile}px;height:${L.tile}px;pointer-events:none`}
+            style=${`transform:translate(${pos.x}px,${pos.y}px);width:${L.tile}px;height:${L.tile}px`}
+            onPointerDown=${(e) => { if (e.button === 0) emit('pieceClick', { unit: u, unitId: null, uid: u.uid, prepMapChar: true, button: 0, clientX: e.clientX, clientY: e.clientY }); }}
+            onContextMenu=${(e) => { e.preventDefault(); emit('pieceClick', { unit: u, unitId: null, uid: u.uid, prepMapChar: true, button: 2, detail: true, clientX: e.clientX, clientY: e.clientY }); }}
```

**为什么改**：同 PR #523。原来 `pointer-events:none` 让预备地图角色完全点不到；现在放开并抛出带 `prepMapChar: true` 的 `pieceClick`，与 §2 hunk 5 配套。

**老板这边的情况**：老板改过此文件 4 处（`vs-024.diff`：`createFallbackView` 的 JSDoc 加 `local?: any`、新增 `const local = () => opts.local || …`、`chessAvatarUrl(mm, …, local())`、道具图标 `slice(0, 2)` 改 `slice(0, 3)`）。精确比对为**零行重叠**，但**改动行紧贴官方的上下文行**（`proximity.csv` `MinGap = 0`）——见 §4 的落地提醒。

**搬运动作**：手动按 hunk 落位。注意 (a) 的 `officialDamageNumbers` 需要 §12（`gameLogic/settings.js`）与 §9（设置界面）配套，且真正的 Pixi 渲染分流在 **`public/js/render/*`（D 区）**；本文件只管 DOM 兜底棋盘。

---

### 7. `public/js/ui/gameActions.js`　【DIVERGED → 自由可搬】

**官方改了什么**（2 hunk，+23/−1）：**这就是 `#501` 单飞的宿主**。

```diff
@@ -17,12 +17,28 @@ let inflight = 0;
+// Single-flight shop refresh (GitHub #501, single-ptilopsis): under a high RTT the shop has not answered yet while the
+// player taps 刷新 again — every extra g.refresh the client sends is a paid refresh (server/match intents.js → ps.refresh).
+// A tap while the previous request is still on the wire is dropped; the button dims and the R hotkey stays inert (both
+// call actions.refresh) until the request settles (success or failure). This is not server-side cancellation or
+// idempotency: a timed-out request may already have executed. The shop bar receives onRefreshBusy via the game screen.
+let refreshPending = false;
+const refreshBusyListeners = new Set();
+const emitRefreshBusy = () => { for (const fn of [...refreshBusyListeners]) { try { fn(refreshPending); } catch { /* ignore */ } } };
+
+/**
+ * Subscribe to the shop refresh's in-flight state — fires once with the current state.
+ */
+export function onRefreshBusy(fn) { refreshBusyListeners.add(fn); try { fn(refreshPending); } catch { /* ignore */ } return () => refreshBusyListeners.delete(fn); }
@@ -52,13 +68,19 @@ export const actions = {
-  refresh: () => act('g.refresh'),
+  // a tap while the previous g.refresh is still on the wire is dropped (GitHub #501) — see onRefreshBusy above
+  refresh: () => {
+    if (refreshPending) return Promise.resolve(false);
+    refreshPending = true;
+    emitRefreshBusy();
+    return act('g.refresh').finally(() => { refreshPending = false; emitRefreshBusy(); });
+  },
```

**为什么改**：`#501`「刷新请求返回前不会重复发送」。根因是客户端对同一意图没有互斥：每一次点击都真的发 `g.refresh`，而服务器每收到一次就扣一次钱。修完：在途期间的点击直接返回 `false`（不发网络），并用 `onRefreshBusy` 广播状态给界面。

**老板这边的情况**：老板改过此文件 8 处（`vs-024.diff`：加 `localAsset` 导入、`g.hex`/`g.hexReroll` 音效表、`hexCue`、`sfxUrl` 支持、`hex`/`hexReroll`/`testFunds`/`testHex`/`testEnemyHex`/`loadout` 等动作）。**老板树里没有 `onRefreshBusy`**（0.2.4 本来就没有），所以官方 hunk 1 是纯新增。

**怎么合**：官方两个 hunk 都能落到老板文件里。注意老板在 `onBusy` 之后插了 `hexCue`，官方那段 `onRefreshBusy` 的插入点在 `onBusy` 前后皆可（放在 `onBusy` 旁最自然）。

**搬运动作**：手动落位。**本文件是 `#501` 的根**——§2 `game.js`、§10 `shopBar.js` 都只是消费方，三件必须同批（`overlap-exact.csv` 把这三个都判为「自由可搬」，所以不会有合入冲突，只有「缺一不可」的功能依赖）。

---

### 8. `public/js/ui/gameComponents.js`　【DIVERGED → 自由可搬】

**官方改了什么**（1 hunk，+4/−3）：LP 塔的数字改为**保留已结算值**。

```diff
@@ -198,23 +198,24 @@ export function GIcon({ name, class: cls, title }) {
  * Green LP tower + number. `pending` (> 0): the loss the running battle's leaks will cost at settlement (user
- * playtest #3 item 2) — the number shows value − pending in red followed by a −N tick that pops again on every change
- * (keyed); `note` a small tag after it (联防中); `tip` the title text.
+ * playtest #3 item 2) — the number keeps the settled LP (owner-approved #479 / #504),
+ * shown in red with a −N tick that pops again on every change (keyed); `note` a
+ * small tag after it (联防中); `tip` the title text.
 ...
-    <b class="num lp__val">${ok ? Math.max(0, value - p) : '--'}</b>
+    <b class="num lp__val">${ok ? Math.max(0, value) : '--'}</b>
```

**为什么改**：`#479`（PR #504，采纳自 @robll-v1）「生命值在结算前保留当前数值，旁边标出待扣的 −N」。原实现把「预计要扣的」当场从大数字里减掉，看起来像是已经扣了；官方是**大数字不动**，只在旁边挂一个红色 `−N` 提醒。所以 `value - p` 改回 `value`。

**老板这边的情况**：**老板没动过这一行**——老板的 `gameComponents.js` 在这一处与官方 0.2.4 完全一致（都是 `value - p`）；老板在本文件的改动是加 `hextech` 到 `GAME_FILES`、`UnitThumb` 传 `data.get('local')` 等，在**别的行**（`overlap-exact.csv` 判「自由可搬」）。

**怎么合**：直接搬官方这处。但要向老板讲清楚**这是行为变更**：老板自己也在 `hud.js` / `screens/game.js` 里做了一套更细的「实时预估扣血」（含海克斯「不灭壁垒」的免扣修正 `freeLeak`）。搬完官方这处后：
- 大数字 = 已结算 LP（不再预扣）—— 官方口径；
- `−N` 角标 = 仍然由老板的 `pending` 驱动（`pendingLoss(leaks, cap, free)`，含 `free` 修正）—— 保留老板的加成。

两者**可以共存且语义自洽**：官方只管「主数字别预扣」，老板只管「角标算得准」。

**搬运动作**：手动落位这一行 + 上面那段 JSDoc。

---

### 9. `public/js/ui/settings.js`　【DIVERGED → 自由可搬】

**官方改了什么**（1 hunk，+2/−0）

```diff
@@ -260,12 +260,14 @@ export function SettingsModal({ open, onClose }) {
        <${Toggle} label=${t('显示伤害数字')} micro="DAMAGE NUMBERS" value=${s.damageNumbers} onChange=${(v) => updateSettings({ damageNumbers: v })} />
+      <${Toggle} label=${t('官方伤害数字')} micro="OFFICIAL NUMBERS" value=${s.officialDamageNumbers} onChange=${(v) => updateSettings({ officialDamageNumbers: v })} />
+      <p class="set-hint">${t('只显示达到官方暴击条件的红色数字。关闭时仍显示每一次命中。')}</p>
```

**为什么改**：`#412` 的设置入口（说明见 §6）。

**老板这边的情况**：老板改过此文件 15 处（`vs-024.diff`：把「问题反馈」整段从「复制诊断信息到 GitHub issue」重写成「发送给服主」`POST /api/feedback`、新增 `FEEDBACK_NOTES`、`textarea`、`send`/`copyFallback`，以及 `SettingsButton` 去掉 `square` 参数）。与官方这 1 个 hunk 的最近距离 **21 行**，不重叠。

**怎么合**：把两行插在「显示伤害数字」之后即可。

**必须配套（否则开关点了没反应）**：
- §12 `gameLogic/settings.js`（CLEAN-APPLY）：`DEFAULT_SETTINGS` 与 `sanitizeSettings` 要认 `officialDamageNumbers`；否则 `settingsStore` 存不住这个值。
- **4 个语言包**（`public/i18n/{en,ja,ko,zh-TW}.json`，F-meta 区）：新增 msgid **`官方伤害数字`** 与 **`只显示达到官方暴击条件的红色数字。关闭时仍显示每一次命中。`**。**实测老板树这四个包各缺 1 条**（官方 0.2.5 的 `en.json` 里 `官方伤害数字` 命中 1 次，老板树 0 次）。
- 消费方：§6 `fallbackField.js` 与 **`public/js/render/*`（D 区）**。

---

### 10. `public/js/ui/shopBar.js`　【DIVERGED → 自由可搬】

**官方改了什么**（3 hunk，+7/−5）：`#501` 单飞的界面侧。

```diff
@@ -7,13 +7,15 @@
-// D / R / F keys stay one-press shortcuts. There is no drag-to-sell zone: selling is the 出售 +N button of a tapped
+// D / R / F keys stay one-press shortcuts — a 刷新 whose request is still on the wire dims the button and swallows
+// further taps and the R key until the reply lands (GitHub #501; the single-flight lives in ui/gameActions.js
+// onRefreshBusy, ui/shopBar.js only draws it). There is no drag-to-sell zone: selling is the 出售 +N button of a tapped
@@ -283,19 +285,19 @@ export function RewardCards({ offer, priv, editable, onPick, onDetail, onLater,
- * @param {{ priv:any, editable:boolean, collapsed:boolean, onCollapse:(c:boolean)=>void,
+ * @param {{ priv:any, editable:boolean, collapsed:boolean, refreshBusy?:boolean, onCollapse:(c:boolean)=>void,
-export function ShopBar({ priv, editable, collapsed, onCollapse, onBuy, onLevel, onRefresh, onFreeze, onDetail, onDetailClose, onRefuse, barRef,
+export function ShopBar({ priv, editable, collapsed, refreshBusy = false, onCollapse, onBuy, onLevel, onRefresh, onFreeze, onDetail, onDetailClose, onRefuse, barRef,
@@ -351,16 +353,16 @@
-      <button type="button" class="toolbtn toolbtn--amber" disabled=${!!refReason} onClick=${onRefresh} title=${refReason || t('刷新商店 · {key}', { key: hk.refresh })}>
+      <button type="button" class="toolbtn toolbtn--amber" disabled=${!!refReason || refreshBusy} onClick=${onRefresh} title=${refReason || (refreshBusy ? t('正在刷新…') : t('刷新商店 · {key}', { key: hk.refresh }))}>
 ...
-        ${free > 0 ? html`<span class="toolbtn__free">${t('免费 ×{free}', { free })}</span>` : html`<${HexBadge} value=${shop.refreshPrice ?? 1} tone=${refReason ? 'dark' : 'gold'} size="sm" />`}
+        ${free > 0 ? html`<span class="toolbtn__free">${t('免费 ×{free}', { free })}</span>` : html`<${HexBadge} value=${shop.refreshPrice ?? 1} tone=${refReason || refreshBusy ? 'dark' : 'gold'} size="sm" />`}
```

**为什么改**：`#501`。按钮在途期间 `disabled`、标题换成「正在刷新…」、价格徽章转暗。

**老板这边的情况**：老板只改过 1 处（`ChessCard` 里 `chessPortraitUrl(m, c, data.get('local'))`）。与官方 3 个 hunk 最近距离 **84 行**，自由可搬。

**配套**：新增 msgid **`正在刷新…`** 到 4 个语言包（老板树实测缺失，官方 0.2.5 各 1 条）。同时 `game.js`（§2）要把 `refreshBusy` 传进来，`gameActions.js`（§7）要提供 `onRefreshBusy`。

**搬运动作**：手动落位 3 处。

---

### 11. `public/js/ui/gameLogic/camera.js`　【CLEAN-APPLY】

**官方改了什么**（2 hunk，+15/−8）：首领配对改为读服务器下发的 `pub.bossPairs`。

```diff
@@ -1,41 +1,50 @@
+/** Server-owned random pairs. Seat inference is only for an older server without the field. */
+function prepPair(pub, myId) {
+  const alive = (Array.isArray(pub?.players) ? pub.players : []).filter(p => isObj(p) && p.alive !== false);
+  if (!alive.some(p => p.playerId === myId)) return [];
+  if (pub.bossPairs !== undefined) {
+    return (Array.isArray(pub.bossPairs) ? pub.bossPairs : []).find(g => Array.isArray(g) && g.includes(myId)) || [];
+  }
+  const ids = alive.sort((a, b) => int(a.seat, 99) - int(b.seat, 99)).map(p => p.playerId);
+  const i = ids.indexOf(myId);
+  return ids.slice(i - i % 2, i - i % 2 + 2);
+}
 ...
-  const alive = (Array.isArray(pub.players) ? pub.players : []).filter((p) => isObj(p) && p.alive !== false)
-    .sort((a, b) => int(a.seat, 99) - int(b.seat, 99));
-  const idx = alive.findIndex((p) => p.playerId === myId);
+  const idx = prepPair(pub, myId).indexOf(myId);
@@ -48,15 +57,13 @@ export function teamFrameIds(pub, myId) {
-  const alive = players.filter((p) => p.alive !== false).sort((a, b) => int(a.seat, 99) - int(b.seat, 99)).map((p) => p.playerId);
-  const idx = alive.indexOf(myId);
-  const pair = alive.slice(idx - (idx % 2), idx - (idx % 2) + 2);
+  const pair = prepPair(pub, myId);
```

**为什么改**：CHANGELOG 0.2.5「首领配对改为每局随机，准备期至开战固定，隐藏首领沿用同局分组；客户端棋盘和队友框同步实际配对」——**该条 CHANGELOG 未单列 `#编号`，推断为伴随改动**（同批的 `server/match/finalAssault.js` 在 C 区）。原来客户端按「座位顺序两两配对」自己推算，现在服务器把实际分组放在 `m.public.bossPairs` 里下发；客户端优先读它，仅在旧服务器没有该字段时才退回座位推断。`prepCamera`（自己站哪半场）与 `teamFrameIds`（队友框绿框）共用同一个 `prepPair`，保证两者一致。

**老板这边的情况**：未动过此文件。

**搬运动作**：
```
copy 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\public\js\ui\gameLogic\camera.js → Stronghold-Protocol-repo\public\js\ui\gameLogic\camera.js
```
> 说明：官方 hunk 2 里删掉的 `const alive = …` / `const idx = …` 两行在 hunk 头之外还引用了 `players`，整文件覆盖即可保持一致；**但 `pub.bossPairs` 需要 `shared/protocol.js`（F-meta 区）与服务器侧同步**，否则 `pub.bossPairs` 恒为 `undefined`，只是退回旧行为（不报错）。

---

### 12. `public/js/ui/gameLogic/settings.js`　【CLEAN-APPLY】

**官方改了什么**（2 hunk，+3/−2）

```diff
@@ -21,19 +21,19 @@ import { DEFAULT_HOTKEYS, sanitizeHotkeys } from './shortcuts.js';
-export const DEFAULT_SETTINGS = Object.freeze({ bgm: 0.6, sfx: 0.8, voice: 0.8, voiceLang: 'cn', voiceOverrides: Object.freeze({}), muted: false, damageNumbers: true, quality: 'high', textSize: 'sm', keys: DEFAULT_HOTKEYS });
+export const DEFAULT_SETTINGS = Object.freeze({ bgm: 0.6, sfx: 0.8, voice: 0.8, voiceLang: 'cn', voiceOverrides: Object.freeze({}), muted: false, damageNumbers: true, officialDamageNumbers: false, quality: 'high', textSize: 'sm', keys: DEFAULT_HOTKEYS });
@@ -41,11 +41,12 @@ export function sanitizeSettings(raw) {
     damageNumbers: typeof r.damageNumbers === 'boolean' ? r.damageNumbers : DEFAULT_SETTINGS.damageNumbers,
+    officialDamageNumbers: typeof r.officialDamageNumbers === 'boolean' ? r.officialDamageNumbers : false,
```

**为什么改**：`#412`。新设置默认**关闭**；`sanitizeSettings` 负责把本地存的值读回来、非法值回落 `false`。注意这里**没有改 `TEXT_SIZES`**（仍是 `['sm','md','lg','xl']`）——「设置新增四档文字大小（#435、PR #446）」是 **0.2.3** 的改动，不在 0.2.5 段，别误挂。

**老板这边的情况**：未动过此文件。

**搬运动作**：
```
copy 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\public\js\ui\gameLogic\settings.js → Stronghold-Protocol-repo\public\js\ui\gameLogic\settings.js
```

---

### 13. `public/js/ui/hud.js`　【DIVERGED → 自由可搬】

**官方改了什么**（3 hunk，+9/−7）：**全部是注释**，没有一行可执行代码。

```diff
@@ -9,19 +9,20 @@
-// Normal rounds (user playtest #3 item 2): the LP tower drops live as the own battle's enemies enter the blue gate —
-// lp − min(lpCapPerRound, counted leaks) in red with a −N tick, 联防中 while a 联防 may still save part of it (liveLp;
+// Normal rounds (user playtest #3 item 2): the LP tower marks the own battle's leaks live as its enemies enter the blue
+// gate — the settled lp stays until settlement, in red with a −min(lpCapPerRound, counted leaks) tick (GitHub #479: the
+// official keeps the current value until settlement), 联防中 while a 联防 may still save part of it (liveLp;
@@ -180,15 +181,16 @@ export function ownLeaks(local, server) {
- * The own LP while a normal round's battle runs: the loss its counted leaks will cost is shown at once (red, −N)
+ * The own LP while a normal round's battle runs: the loss its counted leaks will cost is marked at once (red, −N) instead
+ * of only at settlement — the number itself keeps the settled LP until settlement (GitHub #479: the official shows the
@@ -349,13 +351,13 @@ export function PauseButton({ paused, busy = false, onToggle }) {
- *   live: the own battle's pending LP loss (liveLp): the tower shows lp − pending in red with a −N tick, 联防中 during 联防;
+ *   live: the own battle's pending LP loss (liveLp): the tower keeps the settled lp and adds a red −N tick, 联防中 during 联防;
```

**为什么改**：`#479` / PR #504。只把措辞从「扣减」改成「标记」，与 §8 的 `gameComponents.js` 实际改动对上。

**老板这边的情况**：老板改过 10 处（`vs-024.diff`：加 `EnemyHexStrip` 导入与 `<${EnemyHexStrip} …>`（敌方协议源石条）、`pendingLoss(leaks, cap, free)` 加 `free` 参数与 `Math.max(0, n - f)`、`liveLp` 加 `free`）。官方改的注释行与老板改的代码行**不相交**（`overlap-exact.csv` 判「自由可搬」）。

**怎么合**：搬官方注释时**保留老板的 `free` 语义**。合并后这段注释应同时说清两件事，建议措辞：
> 主数字保持已结算 LP 到结算（官方 #479）；角标 `−N` 的数值另按 `pendingLoss(leaks, cap, free)` 计，`free` 是海克斯「不灭壁垒」本回合免扣的泄漏数。

**关键：不要因为搬注释而顺手「对齐」代码。** 官方 `base-025` 的 `pendingLoss` 是 `Math.min(c, n)`、没有 `free`；老板的是 `Math.min(c, Math.max(0, n - f))`。**官方没改这个函数体，老板的 `free` 必须留**，否则海克斯「不灭壁垒」的免扣显示会回归成「显示 −3，结算只扣 −2」的老毛病（正是老板在 `screens/game.js` 注释里点名修掉的那个）。

**搬运动作**：手动改 3 段注释。

---

### 14. `public/js/ui/loadoutSync.js`　【CLEAN-APPLY】

**官方改了什么**（3 hunk，+8/−3）：用一个 `revision` 计数器作废「还在等游戏数据」的旧同步请求。

```diff
@@ -166,12 +166,13 @@ export const closeLoadout = () => loadoutStore.set({ open: false });
   let seq = 0;            // requests sent (the reply of an older one never overrides a newer one's state)
+  let revision = 0;       // edits and welcome invalidate a preparation still awaiting game data (GitHub #540)
@@ -186,15 +187,18 @@
   async function flush() {
     if (disposed) return;
     if (net.status !== 'online') { setState('idle'); return; } // the next welcome resends
+    const preparing = revision;
     try {
       const payload = await prepare();
-      if (disposed) return;
+      // a newer edit or welcome happened while prepare awaited chess/backups: do not send, and do not touch the
+      // sync state that newer flush owns (an older skill must not overwrite a restore-defaults)
+      if (disposed || preparing !== revision) return;
@@ -218,21 +222,22 @@
     } catch (e) {
+      if (disposed || preparing !== revision) return;
       console.warn(`[${tag}] sync failed`, e);
       setState('error');
 ...
-  const offWelcome = net.on('welcome', () => { lastSent = null; pendingJson = null; seq++; schedule(50); });
+  const offWelcome = net.on('welcome', () => { revision++; lastSent = null; pendingJson = null; seq++; schedule(50); });
 ...
-    if (keys.some((k) => s[k] !== prev[k])) { edited = true; schedule(); }
+    if (keys.some((k) => s[k] !== prev[k])) { revision++; edited = true; schedule(); }
```

**为什么改**：`PR #540`「干员调配同步在等待游戏数据时，恢复默认或之后的修改会使仍在准备的旧请求作废，避免旧技能写回服务器」。根因：`flush()` 里 `await prepare()`（等 `chess`/`backups` 数据）会让出事件循环；期间玩家点了「恢复默认」或又改了技能，旧的那份 `prepare()` 结果随后仍会发出去，把新的选择覆盖掉。修完：进入 `await` 前记下 `revision`，回来后若已变则**既不发送也不改同步状态**（避免旧技能覆盖新技术）。

**老板这边的情况**：未动过此文件。

**搬运动作**：
```
copy 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\public\js\ui\loadoutSync.js → Stronghold-Protocol-repo\public\js\ui\loadoutSync.js
```

---

### 15. `public/js/ui/matchInfo.js`　【CLEAN-APPLY】⚠ 依赖 §1

**官方改了什么**（1 hunk，+27/−2）：新增 `BondBannedAside`，并把它作为 `Tooltip` 的 `aside` 传进去。

```diff
@@ -66,28 +66,53 @@ export function DiyBannedLine({ model, class: cls = 'brief-banned__diy' }) {
+/**
+ * The box beside a bond's tooltip: its banned members (the badge's count), each with avatar, name and bonds (the hovered
+ * one highlighted); null when none are banned.
+ */
+function BondBannedAside(bond, model, banned) {
+  const ids = (Array.isArray(bond.visibleMembers) ? bond.visibleMembers : []).filter((id) => banned.has(id));
+  if (!ids.length) return null;
+  const nameOf = new Map(model.bonds.map((b) => [b.bondId, b.name]));
+  return html`<div class="brief-bantip">
+    <div class="brief-bantip__h">${t('本局禁用干员')}</div>
+    ${ids.map((id) => {
+      const c = data.lookup('chess', id);
+      const bonds = (Array.isArray(c?.bonds) ? c.bonds : []).filter((b) => nameOf.has(b));
+      return html`<div key=${id} class="brief-bantip__op" data-chess=${id}>
+        <${UnitThumb} kind="chess" id=${id} size="xs" showTier=${false} />
+        <div class="brief-bantip__txt"><b>${c?.name || id}</b>
+          <span>${bonds.map((b, i) => html`${i ? ' · ' : ''}<span class=${cx(b === bond.bondId && 'is-this')}>${nameOf.get(b)}</span>`)}</span></div>
+      </div>`;
+    })}
+  </div>`;
+}
 ...
 export function MatchBondRow({ title, micro, bonds, model }) {
   const m = data.get('assets');
+  const banned = new Set(model.banned);
 ...
-        return html`<${Tooltip} key=${b.bondId} text=${briefingBondTip(b.name, state, bannedN)}>
+        return html`<${Tooltip} key=${b.bondId} text=${briefingBondTip(b.name, state, bannedN)}
+          aside=${bannedN > 0 ? BondBannedAside(b, model, banned) : null}>
```

**为什么改**：`#484`「盟约提示框旁列出本局被禁用的成员（#484、PR #494，感谢 @YuriRestia）」。盟约上的红色数字只说「禁了几个人」，这个 `aside` 才把「是谁、他还属于哪些盟约」列出来。

**老板这边的情况**：未动过此文件（`vs-024.diff` 为空）。

**怎么合**：整文件覆盖。**但有三处跨文件依赖，缺一就是「照搬了没效果」**：

1. **`ui/components.js` 的 `aside`（本区 §1）必须先合** —— 否则 `aside=` 这个 prop 被静默忽略，鼠标停上去只有原来的文字说明，右边那一栏根本不出现。这是本区唯一的真撞车，也是这两个文件的耦合点。
2. **`public/css/screens/briefing.css`（D-client-render 区）** 的 `.brief-bantip*` 共 9 行（含 `.brief-bantip__op`、`__txt`、`.is-this` 等）。老板当前树里没有这些类。
3. **msgid `本局禁用干员`**：实测老板树 `public/i18n/{en,ja,ko,zh-TW}.json` **各已有**（`en.json:685` → `"Banned Operators"`），**无需新增**。

**搬运动作**：
```
copy 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\public\js\ui\matchInfo.js → Stronghold-Protocol-repo\public\js\ui\matchInfo.js
```

---

## 三、搬运总表（CLEAN-APPLY 5 件）

以下 5 个文件经 `threeway.csv` / `overlap-exact.csv` 双重确认老板**一行未动**，可直接整文件覆盖：

| 文件 | 官方 hunk | 来源 | 依赖提醒 |
|---|---|---|---|
| `public/js/screens/game/range.js` | 1 | PR #523 | 与 `screens/game.js` hunk 5 配套 |
| `public/js/ui/gameLogic/camera.js` | 2 | 首领配对随机（无编号） | 需 `pub.bossPairs`（`shared/protocol.js`，F 区 + 服务器） |
| `public/js/ui/gameLogic/settings.js` | 2 | #412 | 与 `ui/settings.js`、`i18n` 4 包配套 |
| `public/js/ui/loadoutSync.js` | 3 | PR #540 | 无 |
| `public/js/ui/matchInfo.js` | 1 | #484 / PR #494 | **强依赖 `ui/components.js` 的 `aside`（本区 §1）+ `briefing.css`（D 区）** |

以 `参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\` 为源、`Stronghold-Protocol-repo\` 为落点，逐件复制即可（示例见各节「搬运动作」）。

---

## 四、不确定项与落地提醒

1. **「自由可搬」≠「`git apply` 一定能过」。** 本区有 4 个文件（`screens/game.js`、`ui/fallbackField.js`、`ui/gameActions.js`、`ui/hud.js`）在精确口径下**零行重叠**，但 `proximity.csv` 的 `MinGap` 都是 **0** —— 意思是官方改动的**上下文行**恰好被老板改过。例如 `ui/fallbackField.js`：官方 hunk 1 把
   ` * @param {{ data: any, assets?: any, settings?: any }} opts`
   当作**未改动的上下文行**引用，而老板把它改成了
   ` * @param {{ data: any, assets?: any, local?: any, settings?: any }} opts`。
   改动内容本身不冲突，但机械套用官方补丁会因上下文不匹配而报错。**这 4 个文件请用三方合并或按上下文手工定位**，别指望 `patch` 直接吃。

2. **`ui/components.js` 的 CSS 不在本区。** `.tooltip--compound` / `.tooltip--aside` / `.tooltip__main` 及窄屏媒体查询在 `public/css/components.css`（**D-client-render 区**，官方 +9 行）。老板当前该文件 `tooltip--compound` 命中 **0** 次。**JS 与 CSS 必须同批**，否则 §15 `matchInfo.js` 的名单栏会渲染成一堆无布局的裸文字。

3. **`#501` 是「一个根 + 两个消费方」，不能只搬一件。** `ui/gameActions.js`（`onRefreshBusy` 与 `refresh` 互斥）是根；`screens/game.js`（`refreshBusy` state 与传参）和 `ui/shopBar.js`（按钮变灰与 `正在刷新…`）是消费方。少了根，点击照旧重复发送（bug 未修）；少了消费方，功能正确但玩家看不出在途状态。

4. **`#412` 横跨 3 个区，本区只是其中一段。** 本区负责设置项（§9）、设置校验（§12）、DOM 兜底棋盘（§6）；**真正的 Pixi 渲染分流在 D 区**（`public/js/render/app.js`、`render/fx/numbers.js`、`render/fx/simfx.js`），诊断信息在 D 区（`public/js/diag.js`）。老板树里 `officialDamageNumbers` 目前**全仓 0 命中**（官方 0.2.5 有 15 处），说明这个特性在本树完全没落地。

5. **新 msgid 清单（需 F-meta / i18n 区补 4 个包）**：`官方伤害数字`、`只显示达到官方暴击条件的红色数字。关闭时仍显示每一次命中。`（#412）、`正在刷新…`（#501）、`项目仓库`（#543）。**实测老板树这四个包对这 4 条都是 0 命中**，而官方 0.2.5 各 1 条。反之 `本局禁用干员`（`matchInfo.js` 用）老板树已有，**不要重复添加**。

6. **一处口径更正（供队长与老板对齐）**：队长交底里把「文字大小四档（#435/PR #446）」列为本区可挂条目。核对 CHANGELOG 后确认：该条位于 **0.2.3 段**（`参考对象\...\CHANGELOG.md:69`），而 **0.2.5 段是第 1–45 行**；0.2.5 里 `TEXT_SIZES` 未见改动（`base-024` 与 `base-025` 都是 `['sm','md','lg','xl']`）。**故本区不应挂 #435/PR #446**，此处按 BRIEF「不许瞎编编号」的要求不予采用。

7. **PR #511（AI 托管遮罩挡住「在此页面继续」）不在本区。** 已定位其代码改动为 `public/css/theme.css` 的 `--z-conn: 60 → 75`（该 token 唯一使用处是 `public/css/components.css:976` 的 `.conn-banner`）——**theme.css 与 components.css 都归 D-client-render 区**。本区 E 的文件清单里没有这两处改动，故不列。
